"""
Docker adapter.

Talks to the Docker Engine API via the `docker` SDK. Requires
/var/run/docker.sock to be mounted into the backend container (see
docs/docker.md and docs/security.md for the implications of this).

This module is the ONLY place in the backend that imports `docker`. If
Docker is unavailable (socket missing, daemon down, permission denied),
every Docker-backed service degrades gracefully to Status.UNKNOWN /
Status.OFFLINE with a FailureDetail -- it never crashes other collectors.
"""
from __future__ import annotations

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

try:
    import docker
    from docker.errors import DockerException, NotFound

    DOCKER_SDK_AVAILABLE = True
except ImportError:  # docker SDK not installed in this environment
    DOCKER_SDK_AVAILABLE = False


_client = None
_client_error: Optional[str] = None


def get_docker_client(socket_url: str = "unix:///var/run/docker.sock"):
    """Lazily create a single shared Docker client. Returns None (and
    records the error) if Docker is unreachable -- callers must handle
    that gracefully rather than raising."""
    global _client, _client_error
    if not DOCKER_SDK_AVAILABLE:
        _client_error = "docker SDK not installed"
        return None
    if _client is not None:
        return _client
    try:
        _client = docker.DockerClient(base_url=socket_url, timeout=5)
        _client.ping()
        _client_error = None
        return _client
    except Exception as exc:  # noqa: BLE001 - Docker can raise many types
        _client_error = str(exc)
        _client = None
        return None


def list_discoverable_containers(socket_url: str = "unix:///var/run/docker.sock") -> list[dict]:
    """Enumerate ALL running/stopped containers for the setup/discovery UI.
    Per spec section 20, discovery is separate from monitoring: this does
    NOT add anything to the dashboard, it just lists what's available so
    the user can choose."""
    client = get_docker_client(socket_url)
    if client is None:
        return []
    results = []
    for c in client.containers.list(all=True):
        labels = c.labels or {}
        results.append(
            {
                "id": c.short_id,
                "container": c.name,
                "image": c.image.tags[0] if c.image.tags else c.image.short_id,
                "state": c.status,
                "suggestedName": labels.get("homelab.dashboard.name", c.name),
                "suggestedIcon": labels.get("homelab.dashboard.icon"),
                "dashboardEnabledLabel": labels.get("homelab.dashboard.enable") == "true",
            }
        )
    return results


class DockerAdapter(ServiceAdapter):
    def __init__(
        self, service_id: str, name: str, container: str, socket_url: str,
        status_url: Optional[str] = None, a2s_port: Optional[int] = None,
        a2s_address: Optional[str] = None, **options,
    ):
        super().__init__(service_id, name, **options)
        self.container_name = container
        self.socket_url = socket_url
        self.status_url = status_url
        self.a2s_port = a2s_port
        self.a2s_address = a2s_address

    def get_supported_actions(self) -> list[Action]:
        return [
            Action(ActionKind.START, "Start", confirm_title=f"Start {self.name}?"),
            Action(
                ActionKind.STOP,
                "Stop",
                destructive=True,
                confirm_title=f"Stop {self.name}?",
                confirm_body="This will stop the container. Active connections may be interrupted.",
            ),
            Action(
                ActionKind.RESTART,
                "Restart",
                confirm_title=f"Restart {self.name}?",
                confirm_body="This will stop and start the container. Active connections may be interrupted.",
            ),
        ]

    async def get_status(self) -> Service:
        client = get_docker_client(self.socket_url)
        if client is None:
            return Service(
                id=self.service_id,
                name=self.name,
                type="docker",
                status=Status.UNKNOWN,
                icon=self.options.get("icon", "docker"),
                banner=self.options.get("banner"),
                failure=FailureDetail(
                    reason="docker_unavailable",
                    message=f"Cannot reach Docker daemon: {_client_error or 'unknown error'}",
                ),
            )
        try:
            c = client.containers.get(self.container_name)
        except NotFound:
            return Service(
                id=self.service_id,
                name=self.name,
                type="docker",
                status=Status.OFFLINE,
                icon=self.options.get("icon", "docker"),
                banner=self.options.get("banner"),
                failure=FailureDetail(
                    reason="container_not_found",
                    message=f"Container '{self.container_name}' does not exist",
                ),
            )
        except DockerException as exc:
            return Service(
                id=self.service_id,
                name=self.name,
                type="docker",
                status=Status.UNKNOWN,
                icon=self.options.get("icon", "docker"),
                banner=self.options.get("banner"),
                failure=FailureDetail(reason="docker_error", message=describe_exception(exc)),
            )

        service = self._to_service(c)
        if self.status_url:
            data = await fetch_game_status(self.status_url)
            if data:
                service.metrics.extend(game_status_metrics(data))
        if self.a2s_port:
            info = await fetch_a2s_info(self.a2s_address or "127.0.0.1", self.a2s_port)
            if info:
                service.metrics.extend(a2s_status_metrics(info))
        return service

    def _to_service(self, c) -> Service:
        state = c.attrs.get("State", {})
        running = state.get("Running", False)
        health = state.get("Health", {}).get("Status")  # "healthy"|"unhealthy"|"starting"|None

        if not running:
            status = Status.OFFLINE
        elif health == "unhealthy":
            status = Status.WARNING
        else:
            status = Status.ONLINE

        metrics: list[Metric] = []

        started_at = state.get("StartedAt")
        if running and started_at:
            uptime_seconds = _uptime_from_iso(started_at)
            metrics.append(
                Metric("uptime", "Uptime", uptime_seconds, MetricType.DURATION)
            )

        cpu_pct, mem_used, mem_limit = _container_resource_usage(c)
        if cpu_pct is not None:
            metrics.append(Metric("cpu", "CPU Usage", round(cpu_pct, 1), MetricType.PERCENT, unit="%"))
        if mem_used is not None:
            metrics.append(Metric("memory", "Memory", mem_used, MetricType.BYTES))

        ports = c.attrs.get("NetworkSettings", {}).get("Ports") or {}
        port_str = _format_ports(ports)
        if port_str:
            metrics.append(Metric("ports", "Ports", port_str, MetricType.TEXT))

        metrics.append(Metric("state", "Container state", c.status, MetricType.TEXT))
        if health:
            metrics.append(Metric("health", "Health state", health, MetricType.TEXT))

        failure = None
        if status == Status.OFFLINE:
            failure = FailureDetail(reason="container_stopped", message=f"Container '{self.container_name}' is not running")
        elif status == Status.WARNING:
            failure = FailureDetail(reason="container_unhealthy", message="Docker health check reports unhealthy")

        return Service(
            id=self.service_id,
            name=self.name,
            type="docker",
            status=status,
            icon=self.options.get("icon", "docker"),
            banner=self.options.get("banner"),
            metrics=metrics,
            actions=self.get_supported_actions(),
            has_logs=True,
            failure=failure,
        )

    def supports_logs(self) -> bool:
        return True

    async def get_logs(self, lines: int = 200) -> list[LogLine]:
        client = get_docker_client(self.socket_url)
        if client is None:
            raise AdapterError(f"Docker unavailable: {_client_error}")
        try:
            c = client.containers.get(self.container_name)
            raw = c.logs(tail=lines, timestamps=True).decode("utf-8", errors="replace")
        except DockerException as exc:
            raise AdapterError(describe_exception(exc)) from exc
        return [_parse_docker_log_line(line) for line in raw.splitlines() if line]

    async def execute_action(self, action_kind: str) -> Service:
        client = get_docker_client(self.socket_url)
        if client is None:
            raise AdapterError(f"Docker unavailable: {_client_error}")
        try:
            c = client.containers.get(self.container_name)
            if action_kind == ActionKind.START.value:
                c.start()
            elif action_kind == ActionKind.STOP.value:
                c.stop(timeout=10)
            elif action_kind == ActionKind.RESTART.value:
                c.restart(timeout=10)
            else:
                raise AdapterError(f"Unsupported action '{action_kind}' for docker adapter")
        except DockerException as exc:
            raise AdapterError(str(exc)) from exc

        # Verify actual resulting state rather than trusting the command.
        time.sleep(0.5)
        return await self.get_status()


def _parse_docker_log_line(line: str) -> LogLine:
    """Docker's `timestamps=True` prefixes each line with an RFC3339
    timestamp and a single space, e.g. "2024-01-01T00:00:00.123456789Z
    starting up". Split it off when present rather than leaving the raw
    timestamp mixed into the displayed text."""
    ts, sep, rest = line.partition(" ")
    if sep and ts.endswith("Z") and "T" in ts:
        return LogLine(text=rest, ts=ts)
    return LogLine(text=line)


def _format_ports(ports: dict) -> Optional[str]:
    """Docker's `NetworkSettings.Ports` lists one binding per bound IP
    (0.0.0.0 and ::), so a naive walk reports every port twice; and a
    contiguous block of ports (a common game-server pattern, e.g.
    2456-2457/udp) reads as noise one line at a time. Dedupe to one entry
    per (container_port, protocol) and collapse runs of consecutive,
    unremapped ports into "2456~2457 udp" instead of
    "2456->2456/udp, 2456->2456/udp, 2457->2457/udp, 2457->2457/udp"."""
    mapped: dict[tuple[int, str], int] = {}
    for container_port, bindings in ports.items():
        if not bindings:
            continue
        try:
            port_str, proto = container_port.split("/")
            c_port = int(port_str)
            host_port = int(bindings[0].get("HostPort"))
        except (ValueError, TypeError):
            continue
        mapped[(c_port, proto)] = host_port

    if not mapped:
        return None

    by_proto: dict[str, list[int]] = {}
    remapped: list[str] = []
    for (c_port, proto), host_port in mapped.items():
        if host_port == c_port:
            by_proto.setdefault(proto, []).append(c_port)
        else:
            remapped.append(f"{host_port}->{c_port}/{proto}")

    parts: list[str] = []
    for proto, port_list in sorted(by_proto.items()):
        port_list.sort()
        run_start = run_end = port_list[0]
        for p in port_list[1:] + [None]:
            if p is not None and p == run_end + 1:
                run_end = p
                continue
            parts.append(f"{run_start} {proto}" if run_start == run_end else f"{run_start}~{run_end} {proto}")
            if p is not None:
                run_start = run_end = p

    return ", ".join(parts + sorted(remapped))


def _uptime_from_iso(started_at_iso: str) -> int:
    import datetime

    try:
        started = datetime.datetime.fromisoformat(started_at_iso.replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        return max(0, int((now - started).total_seconds()))
    except ValueError:
        return 0


def _container_resource_usage(c) -> tuple[Optional[float], Optional[int], Optional[int]]:
    """Single-shot (non-streaming) stats read. Returns (cpu_percent, mem_used_bytes, mem_limit_bytes)."""
    try:
        stats = c.stats(stream=False)
    except Exception:  # noqa: BLE001
        return None, None, None

    try:
        cpu_delta = (
            stats["cpu_stats"]["cpu_usage"]["total_usage"]
            - stats["precpu_stats"]["cpu_usage"]["total_usage"]
        )
        system_delta = (
            stats["cpu_stats"].get("system_cpu_usage", 0)
            - stats["precpu_stats"].get("system_cpu_usage", 0)
        )
        online_cpus = stats["cpu_stats"].get("online_cpus") or len(
            stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
        )
        cpu_pct = (cpu_delta / system_delta) * online_cpus * 100.0 if system_delta > 0 else None
    except (KeyError, ZeroDivisionError, TypeError):
        cpu_pct = None

    mem_used = stats.get("memory_stats", {}).get("usage")
    mem_limit = stats.get("memory_stats", {}).get("limit")
    return cpu_pct, mem_used, mem_limit
