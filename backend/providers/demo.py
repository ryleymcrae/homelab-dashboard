"""
The simulated-data provider. Wraps backend/demo/generator.py behind the
exact same DashboardProvider interface LiveProvider implements, so
`demo_mode: true` is "construct a different provider" rather than an
`if demo_mode` branch scattered through the API layer. Every new mock
metric added to generator.py automatically flows through here with no
changes needed in this file.

Actions are real (simulated) as of the admin-actions phase: generator.py
stays a pure function of wall-clock time, and backend/demo/runtime.py
layers the one thing a pure function can't represent -- "a user clicked
stop, so this should now appear stopped" -- on top of it. See
runtime.py's docstring for why that split exists.
"""
from __future__ import annotations

from dataclasses import replace

from backend.demo import generator as demo
from backend.demo.runtime import runtime
from backend.models.core import (
    Action,
    ActionKind,
    BackupStatus,
    FleetSummary,
    HostInfo,
    LogLine,
    Metric,
    MetricType,
    ScheduledJob,
    Service,
)
from backend.providers.base import (
    ActionError,
    ConfigUnsupportedError,
    DashboardProvider,
    LogsUnsupportedError,
    NetworkSnapshot,
    NotFoundError,
    ServiceConfigState,
)


def _overlay_host(host: HostInfo) -> HostInfo:
    """Same idea as _overlay for services: layers runtime state (a
    reboot in progress or just completed, the last action's result) on
    top of generator.py's default snapshot. Host actions are static per
    host (unlike update/rollback, nothing makes REBOOT stop being
    offered), so this always applies the current whitelist rather than
    conditionally including it."""
    status = runtime.host_status_override(host.id)
    return replace(
        host,
        status=status if status is not None else host.status,
        actions=demo.default_host_actions(host.id),
        last_action_result=runtime.host_last_action_result(host.id),
    )


def _overlay(service: Service) -> Service:
    """Applies any in-progress/completed simulated action for this service
    on top of generator.py's default snapshot: status, the "restarts"
    metric, and -- for configurable services -- current image version
    plus update/rollback actions, which only appear when applicable
    (spec: the frontend renders only the actions actually present)."""
    status = runtime.status_override(service.id)
    restart_count = runtime.restart_count_override(service.id)
    if status is None and restart_count is None and not service.has_config:
        return service

    metrics = service.metrics
    actions = service.actions

    if restart_count is not None:
        metrics = [replace(m, value=restart_count) if m.key == "restarts" else m for m in metrics]

    if service.has_config:
        default_image = demo.default_image_state(service.id)
        if default_image is not None:
            image_state = runtime.get_image_state(service.id, default_image)
            metrics = [*metrics, Metric("image", "Image", image_state.current, MetricType.TEXT)]
            if image_state.available:
                metrics = [*metrics, Metric("update_available", "Update Available", True, MetricType.BOOLEAN)]
                actions = [
                    *actions,
                    Action(
                        ActionKind.UPDATE,
                        "Update",
                        confirm_title=f"Update {service.name}?",
                        confirm_body=f"This will update to {image_state.available} and restart the container.",
                    ),
                ]
            if image_state.previous:
                actions = [
                    *actions,
                    Action(
                        ActionKind.ROLLBACK,
                        "Rollback",
                        destructive=True,
                        confirm_title=f"Roll back {service.name}?",
                        confirm_body=f"This will roll back to {image_state.previous} and restart the container.",
                    ),
                ]

    return replace(service, status=status if status is not None else service.status, metrics=metrics, actions=actions)


class DemoProvider(DashboardProvider):
    async def get_hosts(self) -> list[HostInfo]:
        return [_overlay_host(h) for h in demo.demo_hosts()]

    async def get_host_detail(self, host_id: str) -> list[Metric]:
        if not any(h.id == host_id for h in demo.demo_hosts()):
            raise NotFoundError(f"Host '{host_id}' not found")
        return demo.demo_host_detail_metrics(host_id)

    async def get_services(self) -> list[Service]:
        return [_overlay(s) for s in demo.demo_services()]

    async def get_service(self, service_id: str) -> Service:
        match = next((s for s in demo.demo_services() if s.id == service_id), None)
        if not match:
            raise NotFoundError(f"Service '{service_id}' not found")
        return _overlay(match)

    async def get_service_logs(self, service_id: str, lines: int) -> list[LogLine]:
        match = next((s for s in demo.demo_services() if s.id == service_id), None)
        if not match:
            raise NotFoundError(f"Service '{service_id}' not found")
        if not match.has_logs:
            raise LogsUnsupportedError("This service does not support log viewing")
        return runtime.tail_logs(service_id, demo.demo_logs(service_id), lines)

    async def execute_service_action(self, service_id: str, action_kind: str) -> Service:
        base = next((s for s in demo.demo_services() if s.id == service_id), None)
        if base is None:
            raise NotFoundError(f"Service '{service_id}' not found")

        if action_kind in (ActionKind.UPDATE.value, ActionKind.ROLLBACK.value):
            # Not in base.actions -- generator.py is static and can't know
            # whether an update/rollback is currently possible, so these
            # are validated against has_config here instead, and the
            # specific precondition (an update/previous version actually
            # existing) is checked inside runtime.run_update/run_rollback.
            if not base.has_config:
                raise ActionError(f"'{action_kind}' is not a supported action for service '{base.name}'")
            default_image = demo.default_image_state(service_id)
            assert default_image is not None  # has_config=True implies one exists -- see generator.py
            if action_kind == ActionKind.UPDATE.value:
                await runtime.run_update(service_id, default_image)
            else:
                await runtime.run_rollback(service_id, default_image)
            return _overlay(base)

        supported = {a.kind.value for a in base.actions}
        if action_kind not in supported:
            raise ActionError(
                f"'{action_kind}' is not a supported action for service '{base.name}' "
                f"(supported: {sorted(supported) or 'none'})"
            )
        base_restart_count = next((int(m.value) for m in base.metrics if m.key == "restarts"), 0)
        await runtime.run_action(service_id, action_kind, base_restart_count)
        return _overlay(base)

    async def get_network(self) -> NetworkSnapshot:
        return NetworkSnapshot(
            targets=demo.demo_network_targets(),
            traffic=demo.demo_network_traffic(),
            local_address=None,
            active_interface=None,
        )

    async def get_history(self, series: str, since_seconds: int) -> list[tuple[int, float]]:
        return demo.demo_history(series, since_seconds)

    async def get_fleet_summary(self) -> FleetSummary:
        return demo.demo_fleet_summary(await self.get_services())

    def _require_configurable(self, service_id: str):
        base = next((s for s in demo.demo_services() if s.id == service_id), None)
        if base is None:
            raise NotFoundError(f"Service '{service_id}' not found")
        if not base.has_config:
            raise ConfigUnsupportedError("This service does not support config editing")
        default = demo.default_container_config(service_id)
        assert default is not None  # has_config=True implies a default exists -- see generator.py
        return default

    async def get_service_config(self, service_id: str) -> ServiceConfigState:
        default = self._require_configurable(service_id)
        return runtime.get_config(service_id, default)

    async def update_service_config(self, service_id: str, patch: dict) -> ServiceConfigState:
        default = self._require_configurable(service_id)
        return runtime.update_config(service_id, default, patch)

    def _require_host(self, host_id: str) -> HostInfo:
        base = next((h for h in demo.demo_hosts() if h.id == host_id), None)
        if base is None:
            raise NotFoundError(f"Host '{host_id}' not found")
        return base

    async def execute_host_action(self, host_id: str, action_kind: str) -> HostInfo:
        base = self._require_host(host_id)
        supported = {a.kind.value for a in demo.default_host_actions(host_id)}
        if action_kind not in supported:
            raise ActionError(
                f"'{action_kind}' is not a supported action for host '{base.name}' "
                f"(supported: {sorted(supported) or 'none'})"
            )
        await runtime.run_host_action(host_id, action_kind)
        return _overlay_host(base)

    async def get_scheduled_jobs(self, host_id: str) -> list[ScheduledJob]:
        self._require_host(host_id)
        return runtime.get_scheduled_jobs(host_id)

    async def run_scheduled_job(self, host_id: str, job_id: str) -> ScheduledJob:
        self._require_host(host_id)
        return await runtime.run_scheduled_job(host_id, job_id)

    async def get_backup_status(self, host_id: str) -> BackupStatus | None:
        self._require_host(host_id)
        return runtime.get_backup_status(host_id)
