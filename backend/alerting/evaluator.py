"""
Threshold evaluation.

Provider-agnostic on purpose: this reads whatever `HostInfo`/`Service`
objects the current snapshot already contains (real or demo -- both
providers produce the same shapes, per backend/providers/base.py) and
compares them against configured thresholds. There is no separate
"live" vs "demo" evaluator; the only thing that differs between real and
simulated alerting is whether the *metrics themselves* occasionally
cross a threshold (see backend/demo/generator.py's spike behavior).

Duration-based conditions ("down for N minutes") need to remember how
long something has been bad across ticks -- that small bit of state
lives here, in memory, on the one AlertEvaluator instance the broadcast
loop holds. Losing it on a restart just resets the debounce timer,
which is an acceptable simplification for exactly the reason
backend/demo/runtime.py's module-level state is: this is a monitoring
convenience, not a system of record.
"""
from __future__ import annotations

import time

from backend.config.schema import AlertingConfig, ThresholdConfig
from backend.models.core import Alert, AlertSeverity, HostInfo, Service, Status
from backend.persistence.alerts import AlertStore

_METRIC_LABELS = {
    "cpu_percent": ("CPU usage", "%"),
    "mem_percent": ("Memory usage", "%"),
    "disk_percent": ("Disk usage", "%"),
    "temp_c": ("Temperature", "°C"),
}

# A service reporting OFFLINE or UNKNOWN counts as "down" for this
# purpose -- WARNING (degraded but running, e.g. Enshrouded's "no
# players in 24h" demo state) is a different, already-surfaced concern
# (FailureBanner) and deliberately doesn't feed this alert.
_SERVICE_DOWN_STATUSES = (Status.OFFLINE, Status.UNKNOWN)


def merge_thresholds(default: ThresholdConfig, override: ThresholdConfig | None) -> ThresholdConfig:
    """A per-host/per-service override only replaces the fields it
    actually set in config.yml -- `model_fields_set` (not "is this field
    None") is what distinguishes "not specified, inherit the global
    default" from "explicitly disabled" (an override can genuinely set
    e.g. `temp_c: null` to disable just that one check)."""
    if override is None:
        return default
    data = default.model_dump()
    for field in override.model_fields_set:
        data[field] = getattr(override, field)
    return ThresholdConfig(**data)


class AlertEvaluator:
    def __init__(self, store: AlertStore):
        self.store = store
        self._bad_since: dict[str, float] = {}

    def evaluate(self, hosts: list[HostInfo], services: list[Service], config: AlertingConfig) -> list[Alert]:
        """Runs one evaluation pass and returns only the alerts that
        *newly* fired this pass -- an already-active alert being
        refreshed isn't returned, so a single incident notifies once,
        not on every evaluation tick. Called by the alerting loop
        (backend/api/main.py); never touches acknowledge/mute/snooze
        state, which only a human action changes."""
        if not config.enabled:
            return []

        newly_triggered: list[Alert] = []

        for host in hosts:
            thresholds = merge_thresholds(config.defaults, config.host_overrides.get(host.name))
            for metric, value in (
                ("cpu_percent", host.cpu_percent),
                ("mem_percent", host.mem_percent),
                ("disk_percent", host.disk_percent),
                ("temp_c", host.temperature_c),
            ):
                self._check_instant("host", host.id, host.name, metric, value, getattr(thresholds, metric), newly_triggered)

            can_reboot = any(a.kind.value == "reboot" for a in host.actions)
            self._check_duration(
                "host", host.id, host.name, "host_unreachable",
                is_bad=host.status == Status.OFFLINE,
                minutes_threshold=thresholds.offline_minutes,
                title=f"{host.name} is unreachable",
                message_bad=f"{host.name} has been unreachable for over {{minutes:.0f}} minutes.",
                suggested_action="reboot" if can_reboot else None,
                out=newly_triggered,
            )

        for service in services:
            thresholds = merge_thresholds(config.defaults, config.service_overrides.get(service.name))
            can_restart = any(a.kind.value == "restart" for a in service.actions)
            self._check_duration(
                "service", service.id, service.name, "service_down",
                is_bad=service.status in _SERVICE_DOWN_STATUSES,
                minutes_threshold=thresholds.offline_minutes,
                title=f"{service.name} is down",
                message_bad=f"{service.name} has been down for over {{minutes:.0f}} minutes.",
                suggested_action="restart" if can_restart else None,
                out=newly_triggered,
            )

        return newly_triggered

    def _check_instant(
        self, target_type: str, target_id: str, target_name: str, metric: str,
        value: float | None, threshold: float | None, out: list[Alert],
    ) -> None:
        fingerprint = f"{target_type}:{target_id}:{metric}"
        if threshold is None or value is None:
            # Disabled, or the sensor/metric genuinely isn't available --
            # neither is "still bad", so any existing alert clears.
            self.store.resolve(fingerprint)
            return
        if value <= threshold:
            self.store.resolve(fingerprint)
            return

        label, unit = _METRIC_LABELS[metric]
        was_active = self.store.get_active(fingerprint) is not None
        alert = self.store.trigger(
            fingerprint=fingerprint,
            severity=AlertSeverity.WARNING,
            title=f"{label} high on {target_name}",
            message=f"{target_name} {label.lower()} at {value:.0f}{unit} (threshold {threshold:.0f}{unit}).",
            metric=metric,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            value=value,
            threshold=threshold,
            suggested_action=None,
        )
        if not was_active:
            out.append(alert)

    def _check_duration(
        self, target_type: str, target_id: str, target_name: str, metric: str, *,
        is_bad: bool, minutes_threshold: float | None, title: str, message_bad: str,
        suggested_action: str | None, out: list[Alert],
    ) -> None:
        fingerprint = f"{target_type}:{target_id}:{metric}"
        if minutes_threshold is None:
            self._bad_since.pop(fingerprint, None)
            self.store.resolve(fingerprint)
            return
        if not is_bad:
            self._bad_since.pop(fingerprint, None)
            self.store.resolve(fingerprint)
            return

        now = time.time()
        since = self._bad_since.setdefault(fingerprint, now)
        elapsed_minutes = (now - since) / 60
        if elapsed_minutes < minutes_threshold:
            return  # bad, but not for long enough yet -- debounces a single missed poll

        was_active = self.store.get_active(fingerprint) is not None
        alert = self.store.trigger(
            fingerprint=fingerprint,
            severity=AlertSeverity.CRITICAL,
            title=title,
            message=message_bad.format(minutes=elapsed_minutes),
            metric=metric,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            value=round(elapsed_minutes, 1),
            threshold=minutes_threshold,
            suggested_action=suggested_action,
        )
        if not was_active:
            out.append(alert)
