"""
Host collection.

Builds a HostInfo for every entry under `hosts:` -- not just the machine
the backend happens to run on. The local host (`is_local: true`) is
measured directly via psutil (collectors/system.py); every other host
either speaks the same metrics contract over `agent_url`, or -- if no
agent is configured -- is monitored via reachability only, exactly as
documented in docs/architecture.md. Either way, every configured host
produces a HostInfo the frontend can render with the same components,
same gauges, same "unavailable" handling for missing sensors.

This mirrors backend/adapters/factory.py's role for services: the single
place that turns config entries into the generic domain objects, so the
API layer never has to special-case any one host.
"""
from __future__ import annotations

import asyncio

import httpx

from backend.adapters import docker_adapter
from backend.adapters.base import describe_exception, short_reason
from backend.adapters.docker_adapter import DockerEndpoint
from backend.collectors import network as net_collector
from backend.collectors import system as sys_collector
from backend.config.schema import AppConfig, HostConfig, IntegrationConfig
from backend.models.core import FailureDetail, HostInfo, Metric, MetricType, Status


def host_id(cfg: HostConfig) -> str:
    return cfg.id


async def _agent_metrics(hid: str, cfg: HostConfig) -> HostInfo:
    """A host with `agent_url` is expected to expose the same metrics
    contract as GET /api/hosts/{id} on this very backend -- see
    docs/architecture.md."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(cfg.agent_url)
            resp.raise_for_status()
            data = resp.json()
        return HostInfo(
            id=hid,
            name=cfg.name,
            address=cfg.address,
            status=Status.ONLINE,
            model=cfg.model,
            icon=cfg.icon,
            uptime_seconds=data.get("uptimeSeconds"),
            cpu_percent=data.get("cpuPercent"),
            cpu_cores=data.get("cpuCores"),
            cpu_freq_mhz=data.get("cpuFreqMhz"),
            mem_percent=data.get("memPercent"),
            mem_used_bytes=data.get("memUsedBytes"),
            mem_total_bytes=data.get("memTotalBytes"),
            disk_percent=data.get("diskPercent"),
            disk_used_bytes=data.get("diskUsedBytes"),
            disk_total_bytes=data.get("diskTotalBytes"),
            temperature_c=data.get("temperatureC"),
            is_local=False,
        )
    except (httpx.HTTPError, ValueError) as exc:
        return HostInfo(
            id=hid,
            name=cfg.name,
            address=cfg.address,
            status=Status.OFFLINE,
            model=cfg.model,
            icon=cfg.icon,
            is_local=False,
            failure=FailureDetail(
                reason="agent_unreachable",
                message=f"Could not reach agent at {cfg.agent_url}: {describe_exception(exc)}",
            ),
        )


async def _docker_api_host(hid: str, cfg: HostConfig, conn: IntegrationConfig) -> HostInfo:
    """No agent, but a Docker API assigned (Settings > Devices): up/down is
    whether that API answers, and `docker info` supplies what Docker
    knows about the machine -- CPU count, memory size, OS. Usage figures
    (CPU%, memory used, disk, temperature) stay None: Docker doesn't
    report them for the host, and they're never fabricated."""
    try:
        info = await asyncio.to_thread(docker_adapter.host_info, DockerEndpoint.from_connection(conn))
    except Exception as exc:  # noqa: BLE001 - docker SDK errors vary; failure is data here
        return HostInfo(
            id=hid,
            name=cfg.name,
            address=cfg.address,
            status=Status.OFFLINE,
            model=cfg.model,
            icon=cfg.icon,
            is_local=False,
            failure=FailureDetail(
                reason="docker_api_unreachable",
                message=f"Could not reach Docker API '{conn.name}' at {conn.docker_url}: {short_reason(exc)}",
            ),
        )
    return HostInfo(
        id=hid,
        name=cfg.name,
        address=cfg.address,
        status=Status.ONLINE,
        model=cfg.model or info.get("OperatingSystem"),
        icon=cfg.icon,
        cpu_cores=info.get("NCPU"),
        mem_total_bytes=info.get("MemTotal"),
        is_local=False,
    )


async def _reachability_only(hid: str, cfg: HostConfig) -> HostInfo:
    """No agent configured: report up/down from a ping reachability
    probe only -- not a fixed-port TCP connect, since a host may not run
    anything on 80/443 (e.g. a headless Pi with only SSH) while still
    being very much online. Metric fields stay None -- never fabricated
    -- and the frontend renders them as "unavailable", same as a
    missing sensor."""
    if not cfg.address:
        return HostInfo(
            id=hid,
            name=cfg.name,
            address=None,
            status=Status.UNKNOWN,
            model=cfg.model,
            icon=cfg.icon,
            is_local=False,
            failure=FailureDetail(
                reason="no_address",
                message="Host has neither `address` nor `agent_url` configured",
            ),
        )
    latency = await net_collector.ping_host(cfg.address)
    status = Status.ONLINE if latency is not None else Status.OFFLINE
    return HostInfo(
        id=hid,
        name=cfg.name,
        address=cfg.address,
        status=status,
        model=cfg.model,
        icon=cfg.icon,
        is_local=False,
        failure=None
        if status == Status.ONLINE
        else FailureDetail(reason="host_unreachable", message=f"Cannot reach {cfg.address}"),
    )


async def get_host_metrics(cfg: HostConfig, docker_conn: IntegrationConfig | None = None) -> HostInfo:
    """Local psutil and a remote agent both measure more than Docker can,
    so they stay the source of a host's vitals even with a Docker API
    assigned -- that connection then only serves the host's containers
    (backend/adapters/factory.py) and Docker details (get_host_detail).
    Without either, the Docker API beats a bare ping."""
    hid = host_id(cfg)
    if cfg.is_local:
        return sys_collector.get_local_host_metrics(hid, cfg.name, cfg.model, cfg.icon)
    if cfg.agent_url:
        return await _agent_metrics(hid, cfg)
    if docker_conn is not None:
        return await _docker_api_host(hid, cfg, docker_conn)
    return await _reachability_only(hid, cfg)


async def build_all_hosts(config: AppConfig) -> list[HostInfo]:
    if not config.hosts:
        return []
    return list(await asyncio.gather(*(get_host_metrics(h, config.docker_connection_for(h.name)) for h in config.hosts)))


async def _docker_detail(conn: IntegrationConfig) -> list[Metric]:
    try:
        info = await asyncio.to_thread(docker_adapter.host_info, DockerEndpoint.from_connection(conn))
    except Exception as exc:  # noqa: BLE001
        return [Metric(key="docker_unreachable", label=f"Docker API ({conn.name})", value=f"Unreachable: {short_reason(exc)}", type=MetricType.TEXT)]
    return docker_adapter.info_metrics(info)


async def get_host_detail(cfg: HostConfig, docker_conn: IntegrationConfig | None = None) -> list[Metric]:
    """Everything below, plus the Docker details when a Docker API is
    assigned to the host."""
    base = await _base_host_detail(cfg)
    return base + (await _docker_detail(docker_conn) if docker_conn is not None else [])


async def _base_host_detail(cfg: HostConfig) -> list[Metric]:
    """Deeper metrics for one host, fetched on demand (not part of the 2s
    broadcast snapshot -- see backend/collectors/system.py). Mirrors the
    three-tier strategy build_all_hosts uses for the cheap snapshot:
    local -> native (expensive) psutil calls; agent -> the same detail
    contract fetched from the remote instance; reachability-only -> no
    detail available, same as its metric fields being None in the
    snapshot."""
    if cfg.is_local:
        # psutil's percpu sampling blocks for ~100ms; run off the event
        # loop so it doesn't stall the broadcast loop or other requests.
        return await asyncio.to_thread(sys_collector.get_local_host_detail_metrics)
    if cfg.agent_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{cfg.agent_url}/detail")
                resp.raise_for_status()
                data = resp.json()
            return [
                Metric(
                    key=m["key"],
                    label=m["label"],
                    value=m["value"],
                    type=MetricType(m["type"]),
                    unit=m.get("unit"),
                    secondary=m.get("secondary", False),
                    sparkline_key=m.get("sparklineKey"),
                )
                for m in data.get("metrics", [])
            ]
        except (httpx.HTTPError, ValueError, KeyError):
            return []
    return []
