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

from backend.adapters.base import describe_exception
from backend.collectors import network as net_collector
from backend.collectors import system as sys_collector
from backend.config.schema import HostConfig
from backend.models.core import FailureDetail, HostInfo, Metric, MetricType, Status


def host_id(cfg: HostConfig) -> str:
    return cfg.name.lower().replace(" ", "-")


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


async def get_host_metrics(cfg: HostConfig) -> HostInfo:
    hid = host_id(cfg)
    if cfg.is_local:
        return sys_collector.get_local_host_metrics(hid, cfg.name, cfg.model, cfg.icon)
    if cfg.agent_url:
        return await _agent_metrics(hid, cfg)
    return await _reachability_only(hid, cfg)


async def build_all_hosts(hosts: list[HostConfig]) -> list[HostInfo]:
    if not hosts:
        return []
    return list(await asyncio.gather(*(get_host_metrics(h) for h in hosts)))


async def get_host_detail(cfg: HostConfig) -> list[Metric]:
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
