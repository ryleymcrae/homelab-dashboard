"""
systemd adapter.

Uses `systemctl show` for read-only status (no shell interpolation of user
input -- unit names are validated against the configured allow-list only)
and `systemctl start/stop/restart` for actions, invoked via subprocess
with an argument list (never a shell string) to avoid injection.

If systemd/dbus is unavailable (e.g. running inside a minimal container
without systemd, which is common), this adapter reports Status.UNKNOWN
with a clear FailureDetail rather than crashing.
"""
from __future__ import annotations

import asyncio
import shutil
import time
from typing import Optional

from backend.adapters.base import AdapterError, ServiceAdapter, describe_exception
from backend.adapters.game_status import (
    a2s_status_metrics,
    fetch_a2s_info,
    fetch_game_status,
    game_status_metrics,
)
from backend.models.core import (
    Action,
    ActionKind,
    FailureDetail,
    LogLine,
    Metric,
    MetricType,
    Service,
    Status,
)

_SHOW_PROPERTIES = (
    "ActiveState,SubState,UnitFileState,ActiveEnterTimestamp,"
    "MainPID,MemoryCurrent,CPUUsageNSec,TasksCurrent,NRestarts,Description"
)


def _parse_int(value: Optional[str]) -> Optional[int]:
    """systemd reports an absent/untracked property as the literal string
    "[not set]" (or omits it) rather than a sentinel number -- never
    fabricate a 0 or unlimited value for those, just omit the metric."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None

_ALLOWED_UNIT_CHARS = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.@:\\"
)


def _validate_unit_name(unit: str) -> None:
    """Defense in depth: only allow characters valid in systemd unit names.
    Prevents this adapter from ever becoming an arbitrary-command surface,
    per spec section 29."""
    if not unit or not set(unit) <= _ALLOWED_UNIT_CHARS:
        raise AdapterError(f"Refusing invalid unit name: {unit!r}")


async def _run_systemctl(*args: str) -> tuple[int, str, str]:
    if shutil.which("systemctl") is None:
        raise AdapterError("systemctl not found on this host")
    proc = await asyncio.create_subprocess_exec(
        "systemctl",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(), stderr.decode()


class SystemdAdapter(ServiceAdapter):
    def __init__(
        self, service_id: str, name: str, unit: str, status_url: Optional[str] = None,
        a2s_port: Optional[int] = None, a2s_address: Optional[str] = None, **options,
    ):
        super().__init__(service_id, name, **options)
        _validate_unit_name(unit)
        self.unit = unit
        self.status_url = status_url
        self.a2s_port = a2s_port
        self.a2s_address = a2s_address
        # (wall-clock time, cumulative CPU ns) from the previous poll, so
        # CPU% can be derived from a delta -- CPUUsageNSec is cumulative
        # since unit start, not an instantaneous reading like Docker's
        # stats API gives us for free.
        self._last_cpu_sample: Optional[tuple[float, int]] = None

    def get_supported_actions(self) -> list[Action]:
        return [
            Action(ActionKind.START, "Start", confirm_title=f"Start {self.name}?"),
            Action(
                ActionKind.STOP,
                "Stop",
                destructive=True,
                confirm_title=f"Stop {self.name}?",
                confirm_body="This will stop the systemd unit.",
            ),
            Action(
                ActionKind.RESTART,
                "Restart",
                confirm_title=f"Restart {self.name}?",
                confirm_body="This will restart the systemd unit. The service will be briefly unavailable.",
            ),
        ]

    async def get_status(self) -> Service:
        try:
            code, out, err = await _run_systemctl(
                "show", self.unit, f"--property={_SHOW_PROPERTIES}",
            )
        except AdapterError as exc:
            return Service(
                id=self.service_id,
                name=self.name,
                type="systemd",
                status=Status.UNKNOWN,
                icon=self.options.get("icon", "cog"),
                banner=self.options.get("banner"),
                failure=FailureDetail(reason="systemd_unavailable", message=describe_exception(exc)),
            )

        if code != 0:
            return Service(
                id=self.service_id,
                name=self.name,
                type="systemd",
                status=Status.UNKNOWN,
                icon=self.options.get("icon", "cog"),
                banner=self.options.get("banner"),
                failure=FailureDetail(reason="systemctl_error", message=err.strip() or "systemctl failed"),
            )

        props = dict(line.split("=", 1) for line in out.strip().splitlines() if "=" in line)
        active_state = props.get("ActiveState", "unknown")
        sub_state = props.get("SubState", "unknown")

        if active_state == "active":
            status = Status.ONLINE
        elif active_state in ("failed",):
            status = Status.WARNING
        else:
            status = Status.OFFLINE

        metrics = [
            Metric("state", "Unit state", f"{active_state} ({sub_state})", MetricType.TEXT),
        ]

        uptime = _parse_uptime(props.get("ActiveEnterTimestamp", ""))
        if status == Status.ONLINE and uptime is not None:
            metrics.append(Metric("uptime", "Uptime", uptime, MetricType.DURATION))

        description = props.get("Description")
        if description:
            metrics.append(Metric("description", "Description", description, MetricType.TEXT, secondary=True))

        main_pid = _parse_int(props.get("MainPID"))
        if main_pid:  # 0 means "no main process" -- not running, nothing to show
            metrics.append(Metric("main_pid", "Main PID", main_pid, MetricType.COUNT, secondary=True))

        cpu_percent = self._sample_cpu_percent(_parse_int(props.get("CPUUsageNSec")))
        if cpu_percent is not None:
            metrics.append(Metric("cpu", "CPU Usage", round(cpu_percent, 1), MetricType.PERCENT, unit="%"))

        mem_bytes = _parse_int(props.get("MemoryCurrent"))
        if mem_bytes is not None:
            metrics.append(Metric("memory", "Memory", mem_bytes, MetricType.BYTES))

        tasks = _parse_int(props.get("TasksCurrent"))
        if tasks is not None:
            metrics.append(Metric("tasks", "Tasks", tasks, MetricType.COUNT, secondary=True))

        restarts = _parse_int(props.get("NRestarts"))
        if restarts is not None:
            metrics.append(Metric("restarts", "Restarts", restarts, MetricType.COUNT, secondary=True))

        if self.status_url:
            data = await fetch_game_status(self.status_url)
            if data:
                metrics.extend(game_status_metrics(data))

        if self.a2s_port:
            info = await fetch_a2s_info(self.a2s_address or "127.0.0.1", self.a2s_port)
            if info:
                metrics.extend(a2s_status_metrics(info))

        failure = None
        if status != Status.ONLINE:
            failure = FailureDetail(
                reason="unit_not_active",
                message=f"Unit '{self.unit}' is {active_state}",
            )

        return Service(
            id=self.service_id,
            name=self.name,
            type="systemd",
            status=status,
            icon=self.options.get("icon", "cog"),
            banner=self.options.get("banner"),
            metrics=metrics,
            actions=self.get_supported_actions(),
            has_logs=True,
            failure=failure,
        )

    def supports_logs(self) -> bool:
        return True

    async def get_logs(self, lines: int = 200) -> list[LogLine]:
        if shutil.which("journalctl") is None:
            raise AdapterError("journalctl not found on this host")
        proc = await asyncio.create_subprocess_exec(
            "journalctl", "-u", self.unit, "-n", str(lines), "--no-pager", "-o", "short-iso",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise AdapterError(stderr.decode().strip() or "journalctl failed")
        return [LogLine(text=line) for line in stdout.decode(errors="replace").splitlines() if line]

    def _sample_cpu_percent(self, cpu_ns: Optional[int]) -> Optional[float]:
        """CPUUsageNSec is cumulative since the unit started, so a single
        reading can't give a percent -- derive it from the delta against
        the previous poll, the same way psutil.cpu_percent works."""
        if cpu_ns is None:
            return None
        now = time.monotonic()
        percent = None
        if self._last_cpu_sample is not None:
            prev_time, prev_ns = self._last_cpu_sample
            dt = now - prev_time
            if dt > 0 and cpu_ns >= prev_ns:
                percent = max(0.0, min(100.0, ((cpu_ns - prev_ns) / (dt * 1e9)) * 100.0))
        self._last_cpu_sample = (now, cpu_ns)
        return percent

    async def execute_action(self, action_kind: str) -> Service:
        if action_kind not in (ActionKind.START.value, ActionKind.STOP.value, ActionKind.RESTART.value):
            raise AdapterError(f"Unsupported action '{action_kind}' for systemd adapter")
        code, _, err = await _run_systemctl(action_kind, self.unit)
        if code != 0:
            raise AdapterError(err.strip() or f"systemctl {action_kind} failed")
        await asyncio.sleep(0.5)
        return await self.get_status()


def _parse_uptime(timestamp: str) -> int | None:
    import datetime

    if not timestamp:
        return None
    try:
        started = datetime.datetime.strptime(timestamp, "%a %Y-%m-%d %H:%M:%S %Z")
        started = started.replace(tzinfo=datetime.timezone.utc)
        return max(0, int((datetime.datetime.now(datetime.timezone.utc) - started).total_seconds()))
    except ValueError:
        return None
