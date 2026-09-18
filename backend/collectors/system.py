"""
Local system collector.

Uses psutil (and /sys/class/thermal as a fallback for temperature) to
produce real metrics for the local host. Never fabricates a value: if a
sensor genuinely isn't available on this hardware, the corresponding
field is left as None and the frontend renders "unavailable" rather than
a fake number (spec section 21/37).
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

import psutil

from backend.adapters.base import describe_exception
from backend.models.core import FailureDetail, HostInfo, Metric, MetricType, Status

_boot_time = psutil.boot_time()

# psutil.cpu_percent(interval=None) compares against the last call and is
# meaningless (reports 0.0 or a stale value) the very first time it's
# invoked in a process. Priming it once at import time means the first
# real snapshot served to a client is already accurate, instead of
# showing a misleading 0% on dashboard startup.
psutil.cpu_percent(interval=None)


def get_local_host_metrics(
    host_id: str, name: str, model: Optional[str] = None, icon: Optional[str] = None
) -> HostInfo:
    try:
        cpu_percent = psutil.cpu_percent(interval=None)
        cpu_cores = psutil.cpu_count(logical=True)
        freq = psutil.cpu_freq()
        cpu_freq_mhz = freq.current if freq else None

        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")

        uptime_seconds = int(time.time() - _boot_time)
        temperature_c = _read_temperature()

        return HostInfo(
            id=host_id,
            name=name,
            address="127.0.0.1",
            status=Status.ONLINE,
            model=model,
            icon=icon,
            uptime_seconds=uptime_seconds,
            cpu_percent=round(cpu_percent, 1),
            cpu_cores=cpu_cores,
            cpu_freq_mhz=round(cpu_freq_mhz, 0) if cpu_freq_mhz else None,
            mem_percent=round(mem.percent, 1),
            mem_used_bytes=mem.used,
            mem_total_bytes=mem.total,
            disk_percent=round(disk.percent, 1),
            disk_used_bytes=disk.used,
            disk_total_bytes=disk.total,
            temperature_c=temperature_c,
            is_local=True,
        )
    except Exception as exc:  # noqa: BLE001 - never let a collector crash the loop
        return HostInfo(
            id=host_id,
            name=name,
            address="127.0.0.1",
            status=Status.UNKNOWN,
            icon=icon,
            is_local=True,
            failure=FailureDetail(reason="collector_error", message=describe_exception(exc)),
        )


# (wall-clock time, read_bytes, write_bytes) from the previous detail
# fetch, so throughput can be derived from a delta -- disk_io_counters()
# is cumulative since boot, not an instantaneous rate. Same pattern as
# SystemdAdapter._sample_cpu_percent. None until the first call this
# process has made, at which point "Disk I/O" simply doesn't appear yet
# rather than showing a fabricated rate.
_last_disk_io: Optional[tuple[float, int, int]] = None


def get_local_host_detail_metrics() -> list[Metric]:
    """Deeper, more expensive metrics than the always-on broadcast snapshot
    carries -- per-core CPU, per-partition disk usage, disk I/O throughput,
    swap. Meant to be called on demand (a host detail page opening), not
    every 2 seconds, since percpu sampling and walking every mounted
    partition cost real time on a Pi. Never fabricates: a metric that
    can't be read on this platform is simply omitted."""
    metrics: list[Metric] = []

    try:
        per_core = psutil.cpu_percent(interval=0.1, percpu=True)
        for i, pct in enumerate(per_core):
            metrics.append(Metric(f"cpu_core_{i}", f"Core {i}", round(pct, 1), MetricType.PERCENT, unit="%"))
    except Exception:  # noqa: BLE001 - not available on every platform
        pass

    try:
        swap = psutil.swap_memory()
        if swap.total > 0:
            metrics.append(Metric("swap", "Swap", round(swap.percent, 1), MetricType.PERCENT, unit="%"))
    except Exception:  # noqa: BLE001
        pass

    try:
        for part in psutil.disk_partitions(all=False):
            try:
                usage = psutil.disk_usage(part.mountpoint)
            except (PermissionError, OSError):
                continue
            metrics.append(
                Metric(
                    f"disk_{part.mountpoint}",
                    part.mountpoint,
                    round(usage.percent, 1),
                    MetricType.PERCENT,
                    unit="%",
                )
            )
    except Exception:  # noqa: BLE001
        pass

    metrics.extend(_disk_io_rate_metrics())

    return metrics


def _disk_io_rate_metrics() -> list[Metric]:
    global _last_disk_io
    try:
        io = psutil.disk_io_counters()
    except Exception:  # noqa: BLE001
        return []
    if io is None:
        return []

    now = time.monotonic()
    metrics: list[Metric] = []
    if _last_disk_io is not None:
        prev_time, prev_read, prev_write = _last_disk_io
        dt = now - prev_time
        if dt > 0:
            read_rate = max(0.0, (io.read_bytes - prev_read) / dt)
            write_rate = max(0.0, (io.write_bytes - prev_write) / dt)
            metrics.append(Metric("disk_read_rate", "Disk Read", round(read_rate), MetricType.BYTES, unit="/s"))
            metrics.append(Metric("disk_write_rate", "Disk Write", round(write_rate), MetricType.BYTES, unit="/s"))
    _last_disk_io = (now, io.read_bytes, io.write_bytes)
    return metrics


def _read_temperature() -> Optional[float]:
    """Try psutil's sensors API first (covers most x86 boards), then fall
    back to Raspberry Pi's /sys/class/thermal, which psutil.sensors_temperatures
    does not always expose. Returns None gracefully if nothing is found --
    never fabricated."""
    try:
        temps = psutil.sensors_temperatures()
        for entries in temps.values():
            for entry in entries:
                if entry.current:
                    return round(entry.current, 1)
    except (AttributeError, OSError):
        pass  # not available on this platform (e.g. some containers)

    thermal_zone = Path("/sys/class/thermal/thermal_zone0/temp")
    if thermal_zone.exists():
        try:
            millideg = int(thermal_zone.read_text().strip())
            return round(millideg / 1000.0, 1)
        except (ValueError, OSError):
            pass

    return None
