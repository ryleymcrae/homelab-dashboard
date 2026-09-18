"""
Mutable state for demo-mode actions.

backend/demo/generator.py is deliberately a pure function of wall-clock
time -- demo_services() computes fresh values on every call, with no
memory of anything a user did. That's fine for read-only display, but
start/stop/restart need something to actually change: this module is
the small, explicit place where that statefulness lives, layered on top
of generator.py's output rather than mixed into it.

A single module-level `runtime` (like docker_adapter.py's lazy `_client`)
is shared by every DemoProvider instance, so a simulated container stays
stopped across an unrelated config change instead of quietly resetting --
it only resets when the process itself restarts, same as real state would.
"""
from __future__ import annotations

import asyncio
import random
import time

from dataclasses import replace

from backend.demo import generator as demo
from backend.models.core import ActionKind, ActionResult, BackupStatus, HostActionKind, LogLine, ScheduledJob, Status
from backend.providers.base import ActionError, ContainerConfig, ImageState, NotFoundError, ServiceConfigState


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# Update/rollback take longer than a plain restart in this simulation --
# a pull-and-recreate is heavier than restarting the existing container.
_UPDATE_DELAY_SECONDS = 3.5
_ROLLBACK_DELAY_SECONDS = 2.5

# Chance, on each poll from the log-follow WebSocket (backend/api/main.py:
# logs_ws), that a new line gets appended to a service's simulated log
# buffer -- enough to feel like something is actually happening without
# a new line every single poll, which would read as mechanical.
_LOG_APPEND_CHANCE = 0.5
_LOG_BUFFER_CAP = 500

# Scales every simulated action's delay -- tests set this to 0 so the
# suite doesn't spend real wall-clock seconds waiting on fake I/O, while
# normal operation keeps a delay realistic enough that the frontend's
# in-progress states are actually visible rather than an instant flip.
ACTION_DELAY_SCALE = 1.0

# Base delay per action kind, before ACTION_DELAY_SCALE and jitter.
_BASE_DELAY_SECONDS = {
    ActionKind.START.value: 1.0,
    ActionKind.STOP.value: 1.5,
    ActionKind.RESTART.value: 2.0,
}

_FINAL_STATUS = {
    ActionKind.START.value: Status.ONLINE,
    ActionKind.STOP.value: Status.OFFLINE,
    ActionKind.RESTART.value: Status.ONLINE,
}

# Host actions take longer than container ones -- a reboot or a backup
# run is a heavier operation than restarting one process.
_HOST_ACTION_DELAY_SECONDS = {
    HostActionKind.REBOOT.value: 6.0,
    HostActionKind.DOCKER_PRUNE.value: 2.5,
    HostActionKind.RESTART_DOCKER.value: 4.0,
    HostActionKind.CLEAR_PACKAGE_CACHE.value: 2.0,
    HostActionKind.RUN_BACKUP.value: 5.0,
}

# Occasional simulated failure, per spec -- the UI has to be able to show
# a failed reboot/backup as genuinely different from success, not just a
# hypothetical code path. Reboot and backup fail more often than the
# lighter-weight maintenance actions, matching how much more can go
# wrong in each.
_HOST_ACTION_FAILURE_CHANCE = {
    HostActionKind.REBOOT.value: 0.12,
    HostActionKind.DOCKER_PRUNE.value: 0.05,
    HostActionKind.RESTART_DOCKER.value: 0.10,
    HostActionKind.CLEAR_PACKAGE_CACHE.value: 0.05,
    HostActionKind.RUN_BACKUP.value: 0.15,
}


class DemoRuntime:
    """Per-service simulated state that persists across requests for the
    life of this provider: current status (once touched by an action) and
    how many times it's been restarted."""

    def __init__(self) -> None:
        self._status: dict[str, Status] = {}
        self._restart_count: dict[str, int] = {}
        self._log_buffer: dict[str, list[LogLine]] = {}
        self._config: dict[str, ContainerConfig] = {}
        self._pending_config: dict[str, ContainerConfig] = {}
        self._image: dict[str, ImageState] = {}
        self._host_status: dict[str, Status] = {}
        self._host_last_action_result: dict[str, ActionResult] = {}
        self._backup_status: dict[str, BackupStatus] = {}
        self._job_overrides: dict[tuple[str, str], ScheduledJob] = {}

    def reset(self) -> None:
        """Back to "nothing has happened yet" -- used by tests so one
        test's simulated stop/restart can't leak into the next, since
        `runtime` below is a shared module-level singleton."""
        self._status.clear()
        self._restart_count.clear()
        self._log_buffer.clear()
        self._config.clear()
        self._pending_config.clear()
        self._image.clear()
        self._host_status.clear()
        self._host_last_action_result.clear()
        self._backup_status.clear()
        self._job_overrides.clear()

    def tail_logs(self, service_id: str, seed: list[LogLine], limit: int) -> list[LogLine]:
        """The seed (backend/demo/generator.py:demo_logs) only applies the
        first time a service's logs are read -- after that, this buffer
        is the source of truth, growing on its own so a "follow" log
        viewer actually has something new to show on a later poll."""
        buf = self._log_buffer.setdefault(service_id, list(seed))
        if random.random() < _LOG_APPEND_CHANCE:
            buf.append(demo.random_log_line(service_id))
            if len(buf) > _LOG_BUFFER_CAP:
                del buf[: len(buf) - _LOG_BUFFER_CAP]
        return buf[-limit:]

    def get_config(self, service_id: str, default: ContainerConfig) -> ServiceConfigState:
        applied = self._config.setdefault(service_id, default)
        return ServiceConfigState(applied=applied, pending=self._pending_config.get(service_id))

    def update_config(self, service_id: str, default: ContainerConfig, patch: dict) -> ServiceConfigState:
        """Merges `patch` onto the current pending config (or the applied
        one, if nothing's staged yet) and stores the result as pending --
        never applied immediately. `patch` may set any subset of
        ContainerConfig's fields; `env` replaces the whole dict rather
        than merging key-by-key, since "remove this variable" has to be
        expressible and a deep-merge can't distinguish that from "leave
        it alone.\""""
        applied = self._config.setdefault(service_id, default)
        baseline = self._pending_config.get(service_id, applied)
        updated = replace(baseline, **{k: v for k, v in patch.items() if k in ("env", "cpu_limit", "mem_limit", "restart_policy")})
        self._pending_config[service_id] = updated
        return ServiceConfigState(applied=applied, pending=updated)

    def _apply_pending_config(self, service_id: str) -> None:
        pending = self._pending_config.pop(service_id, None)
        if pending is not None:
            self._config[service_id] = pending

    def get_image_state(self, service_id: str, default: ImageState) -> ImageState:
        return self._image.setdefault(service_id, default)

    async def run_update(self, service_id: str, default: ImageState) -> ImageState:
        state = self.get_image_state(service_id, default)
        if state.available is None:
            raise ActionError(f"No update available for '{service_id}'")
        self._status[service_id] = Status.WARNING
        delay = _UPDATE_DELAY_SECONDS * ACTION_DELAY_SCALE * random.uniform(0.85, 1.15)
        if delay > 0:
            await asyncio.sleep(delay)
        # The version just installed becomes the rollback target; no
        # further update is "available" until a new one is (this
        # simulation doesn't manufacture an endless chain of updates).
        updated = ImageState(current=state.available, available=None, previous=state.current)
        self._image[service_id] = updated
        self._status[service_id] = Status.ONLINE
        return updated

    async def run_rollback(self, service_id: str, default: ImageState) -> ImageState:
        state = self.get_image_state(service_id, default)
        if state.previous is None:
            raise ActionError(f"No previous version to roll back to for '{service_id}'")
        self._status[service_id] = Status.WARNING
        delay = _ROLLBACK_DELAY_SECONDS * ACTION_DELAY_SCALE * random.uniform(0.85, 1.15)
        if delay > 0:
            await asyncio.sleep(delay)
        # The version rolled back from becomes available again -- you can
        # re-apply the same update rather than it just vanishing.
        rolled_back = ImageState(current=state.previous, available=state.current, previous=None)
        self._image[service_id] = rolled_back
        self._status[service_id] = Status.ONLINE
        return rolled_back

    def status_override(self, service_id: str) -> Status | None:
        return self._status.get(service_id)

    def restart_count_override(self, service_id: str) -> int | None:
        return self._restart_count.get(service_id)

    async def run_action(self, service_id: str, action_kind: str, base_restart_count: int) -> Status:
        """Simulates a real adapter's timing: an immediately-visible
        transitional state (so a concurrent poll of the services list
        shows *something* changing, not just the dialog that triggered
        it), then a delay proportional to what the real action would
        take, then the final settled state. Uses only existing Status
        values -- no "starting"/"stopping" status was introduced -- the
        same way a real Docker container already shows OFFLINE mid-
        restart rather than a dedicated transitional status."""
        self._status[service_id] = Status.WARNING
        delay = _BASE_DELAY_SECONDS[action_kind] * ACTION_DELAY_SCALE * random.uniform(0.85, 1.15)
        if delay > 0:
            await asyncio.sleep(delay)

        if action_kind == ActionKind.RESTART.value:
            current = self._restart_count.get(service_id, base_restart_count)
            self._restart_count[service_id] = current + 1

        if action_kind in (ActionKind.START.value, ActionKind.RESTART.value):
            # A real container would need to be recreated (not just
            # restarted) to pick up new env vars/limits -- but from this
            # simulation's point of view, "the config took effect" is
            # exactly what start/restart represents to a user.
            self._apply_pending_config(service_id)

        final = _FINAL_STATUS[action_kind]
        self._status[service_id] = final
        return final

    def host_status_override(self, host_id: str) -> Status | None:
        return self._host_status.get(host_id)

    def host_last_action_result(self, host_id: str) -> ActionResult | None:
        return self._host_last_action_result.get(host_id)

    async def run_host_action(self, host_id: str, action_kind: str) -> ActionResult:
        """Same shape as run_action, one level up: an immediately-visible
        transitional state for reboot/restart-docker (the two that
        actually affect reachability), a realistic delay, then a result
        -- which fails outright some of the time, on purpose (spec:
        "occasional simulated failure so the UI has to handle it
        gracefully"). Every branch produces a human-readable message,
        since a host action's result is shown as a persistent banner
        (HostInfo.last_action_result), not a generic error toast."""
        if action_kind in (HostActionKind.REBOOT.value, HostActionKind.RESTART_DOCKER.value):
            self._host_status[host_id] = Status.WARNING

        delay = _HOST_ACTION_DELAY_SECONDS[action_kind] * ACTION_DELAY_SCALE * random.uniform(0.85, 1.15)
        if delay > 0:
            await asyncio.sleep(delay)

        success = random.random() >= _HOST_ACTION_FAILURE_CHANCE[action_kind]

        if action_kind == HostActionKind.REBOOT.value:
            self._host_status[host_id] = Status.ONLINE if success else Status.OFFLINE
            message = (
                "Host is back online."
                if success
                else "Host did not come back online after reboot -- check it directly."
            )
        elif action_kind == HostActionKind.RESTART_DOCKER.value:
            # The host itself was never down -- only the daemon (and, in
            # reality, every container on it) restarted.
            self._host_status[host_id] = Status.ONLINE
            message = (
                "Docker daemon restarted successfully."
                if success
                else "Docker daemon failed to restart -- the socket did not come back."
            )
        elif action_kind == HostActionKind.DOCKER_PRUNE.value:
            freed_gb = random.uniform(0.3, 3.5)
            message = (
                f"Freed {freed_gb:.1f} GB (removed stopped containers, unused networks, dangling images)."
                if success
                else "Docker prune failed: could not reach the Docker daemon."
            )
        elif action_kind == HostActionKind.CLEAR_PACKAGE_CACHE.value:
            freed_mb = random.uniform(80, 600)
            message = (
                f"Freed {freed_mb:.0f} MB of package cache."
                if success
                else "Failed to clear package cache: package manager lock held by another process."
            )
        elif action_kind == HostActionKind.RUN_BACKUP.value:
            message = self._settle_backup(host_id, success)
        else:
            raise ActionError(f"Unknown host action '{action_kind}'")

        result = ActionResult(action=action_kind, success=success, message=message, timestamp=_now_iso())
        self._host_last_action_result[host_id] = result
        return result

    def _settle_backup(self, host_id: str, success: bool) -> str:
        current = self.get_backup_status(host_id)
        now_iso = _now_iso()
        if current is None:
            # Shouldn't happen -- RUN_BACKUP is only ever offered on a
            # host that has backup tracking (see generator.py). Defensive
            # fallback rather than a crash if that ever drifts.
            current = BackupStatus(None, None, None, None)
        if success:
            size = int(random.uniform(0.5, 45) * 1024**3)
            self._backup_status[host_id] = BackupStatus(
                last_backup_at=now_iso, last_attempt_at=now_iso, last_status="success", size_bytes=size
            )
            return f"Backup completed successfully ({size / 1024**3:.1f} GB)."
        self._backup_status[host_id] = replace(current, last_attempt_at=now_iso, last_status="failure")
        return "Backup failed: destination unreachable."

    def get_backup_status(self, host_id: str) -> BackupStatus | None:
        default = demo.default_backup_status(host_id)
        if default is None:
            return None
        return self._backup_status.setdefault(host_id, default)

    def get_scheduled_jobs(self, host_id: str) -> list[ScheduledJob]:
        return [self._job_overrides.get((host_id, j.id), j) for j in demo.default_scheduled_jobs(host_id)]

    async def run_scheduled_job(self, host_id: str, job_id: str) -> ScheduledJob:
        base = next((j for j in demo.default_scheduled_jobs(host_id) if j.id == job_id), None)
        if base is None:
            raise NotFoundError(f"No scheduled job '{job_id}' for host '{host_id}'")
        current = self._job_overrides.get((host_id, job_id), base)
        if current.action_kind is None:
            raise ActionError(f"Job '{job_id}' has no runnable action")

        # "Run Now" and the schedule firing on its own go through the
        # exact same execution, confirmation-worthiness, and (at the API
        # layer) audit logging as triggering the action directly.
        result = await self.run_host_action(host_id, current.action_kind)

        period = demo.JOB_PERIOD_SECONDS.get(job_id, 86400)
        updated = replace(
            current,
            last_run=_now_iso(),
            last_status="success" if result.success else "failure",
            next_run=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + period)),
        )
        self._job_overrides[(host_id, job_id)] = updated
        return updated


runtime = DemoRuntime()
