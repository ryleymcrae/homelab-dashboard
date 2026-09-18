"""
Network collector.

Auto-discovers the active interface, LAN address, and default gateway
where practical, all overridable via config.yml (spec section 14).
Performs lightweight ICMP-free connectivity checks (TCP connect, which
works without root, unlike raw ICMP sockets) to avoid requiring elevated
privileges in the container.
"""
from __future__ import annotations

import asyncio
import socket
import time
from typing import Optional

import psutil

from backend.models.core import FailureDetail, NetworkTarget, NetworkTraffic, Status

_last_counters: Optional[tuple[float, int, int]] = None  # (timestamp, bytes_recv, bytes_sent)


def get_local_network_info() -> dict:
    """Best-effort discovery of the local address and active interface."""
    local_address = None
    active_interface = None
    try:
        # Doesn't actually send packets; just asks the OS to pick a route.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_address = s.getsockname()[0]
    except OSError:
        pass

    if local_address:
        for iface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and addr.address == local_address:
                    active_interface = iface
                    break

    return {"local_address": local_address, "active_interface": active_interface}


def get_default_gateway() -> Optional[str]:
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                fields = line.strip().split()
                if len(fields) >= 3 and fields[1] == "00000000":
                    dest_hex = fields[2]
                    return socket.inet_ntoa(bytes.fromhex(dest_hex)[::-1])
    except (OSError, ValueError):
        pass
    return None


async def tcp_ping(host: str, port: int = 80, timeout: float = 2.0) -> Optional[float]:
    """Latency in ms via a TCP connect, or None if unreachable. Avoids
    requiring raw-socket privileges for ICMP."""
    start = time.monotonic()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return round((time.monotonic() - start) * 1000, 1)
    except (OSError, asyncio.TimeoutError):
        return None


async def check_internet(target: str = "1.1.1.1") -> NetworkTarget:
    latency = await tcp_ping(target, 443)
    if latency is not None:
        return NetworkTarget(
            id="internet", name="Internet", kind="internet", address=target,
            status=Status.ONLINE, icon="globe", latency_ms=latency,
        )
    return NetworkTarget(
        id="internet", name="Internet", kind="internet", address=target,
        status=Status.OFFLINE, icon="globe",
        failure=FailureDetail(reason="internet_unreachable", message=f"Could not reach {target}"),
    )


async def check_gateway(address: Optional[str]) -> NetworkTarget:
    address = address or get_default_gateway()
    if not address:
        return NetworkTarget(
            id="gateway", name="Gateway", kind="gateway", address=None, status=Status.UNKNOWN,
            icon="router", failure=FailureDetail(reason="gateway_not_found", message="Could not auto-detect a default gateway"),
        )
    latency = await tcp_ping(address, 80)
    status = Status.ONLINE if latency is not None else Status.WARNING
    return NetworkTarget(
        id="gateway", name="Gateway", kind="gateway", address=address, status=status,
        icon="router", latency_ms=latency,
        failure=None if status == Status.ONLINE else FailureDetail(
            reason="gateway_unreachable", message=f"No response from gateway {address} (may still be routing)"
        ),
    )


async def check_device(name: str, address: str, icon: Optional[str] = None) -> NetworkTarget:
    """Reachability check for a configured `network.devices` entry --
    these are network-only things (an IoT gadget, a switch's web UI) so
    a TCP connect on a common web port is a reasonable liveness signal."""
    latency = await tcp_ping(address, 80)
    if latency is None:
        latency = await tcp_ping(address, 443)
    status = Status.ONLINE if latency is not None else Status.OFFLINE
    return NetworkTarget(
        id=f"device-{address}", name=name, kind="device", address=address, status=status,
        icon=icon, latency_ms=latency,
        failure=None if status == Status.ONLINE else FailureDetail(
            reason="device_unreachable", message=f"Cannot reach {address}"
        ),
    )


async def ping_host(address: str, timeout: float = 2.0) -> Optional[float]:
    """Latency in ms if `address` is alive, or None if not -- the signal
    for "is this machine up", independent of whatever services (if any)
    it happens to run. Unlike `tcp_ping`, this doesn't require the host
    to have anything listening on a specific port: a bare Raspberry Pi
    with only SSH running is unreachable on 80/443 but very much online.

    Shells out to the system `ping` binary (ICMP) rather than a raw
    socket, since that avoids requiring CAP_NET_RAW/root in this
    process -- most `ping` binaries are already suid or capability'd for
    this. Falls back to a TCP connect on a few common ports if `ping`
    is missing or blocked (e.g. some minimal containers), so a host
    isn't wrongly marked offline just because ICMP isn't available in
    this particular deployment."""
    try:
        start = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(max(1, int(timeout))), address,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        returncode = await asyncio.wait_for(proc.wait(), timeout=timeout + 1)
        if returncode == 0:
            return round((time.monotonic() - start) * 1000, 1)
    except (OSError, asyncio.TimeoutError):
        pass  # ping binary missing, or this environment can't send ICMP

    for port in (22, 443, 80):
        latency = await tcp_ping(address, port, timeout)
        if latency is not None:
            return latency
    return None


async def check_host(name: str, address: str, icon: Optional[str] = None) -> NetworkTarget:
    """Reachability check for a host reused from the `hosts:` list --
    uses `ping_host` (not a fixed-port TCP connect) since a host is a
    whole machine, not a specific web service, and shouldn't read as
    offline just because it has nothing listening on 80/443."""
    latency = await ping_host(address)
    status = Status.ONLINE if latency is not None else Status.OFFLINE
    return NetworkTarget(
        id=f"host-{address}", name=name, kind="host", address=address, status=status,
        icon=icon, latency_ms=latency,
        failure=None if status == Status.ONLINE else FailureDetail(
            reason="host_unreachable", message=f"Cannot reach {address}"
        ),
    )


def get_network_traffic() -> NetworkTraffic:
    """Computes current Mbps from the delta between polls, plus
    since-boot cumulative totals from psutil counters."""
    global _last_counters
    counters = psutil.net_io_counters()
    now = time.monotonic()

    download_mbps = 0.0
    upload_mbps = 0.0
    if _last_counters:
        prev_time, prev_recv, prev_sent = _last_counters
        dt = max(now - prev_time, 0.001)
        download_mbps = round(((counters.bytes_recv - prev_recv) * 8 / 1_000_000) / dt, 2)
        upload_mbps = round(((counters.bytes_sent - prev_sent) * 8 / 1_000_000) / dt, 2)

    _last_counters = (now, counters.bytes_recv, counters.bytes_sent)

    return NetworkTraffic(
        download_mbps=max(0.0, download_mbps),
        upload_mbps=max(0.0, upload_mbps),
        total_downloaded_bytes=counters.bytes_recv,
        total_uploaded_bytes=counters.bytes_sent,
        period_label="since boot",
    )
