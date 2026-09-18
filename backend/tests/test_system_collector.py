from backend.collectors.system import get_local_host_metrics
from backend.models.core import Status


def test_local_host_metrics_returns_real_values():
    host = get_local_host_metrics("local", "test-host")
    assert host.status in (Status.ONLINE, Status.UNKNOWN)
    if host.status == Status.ONLINE:
        assert host.cpu_percent is not None
        assert 0 <= host.cpu_percent <= 100
        assert host.mem_percent is not None
        assert host.mem_total_bytes is not None
        assert host.mem_used_bytes is not None
        assert host.mem_used_bytes <= host.mem_total_bytes
        assert host.uptime_seconds is not None
        assert host.uptime_seconds >= 0


def test_local_host_metrics_never_raises():
    # Collector must degrade gracefully rather than throwing, even under
    # unusual conditions -- this just asserts the call always returns.
    host = get_local_host_metrics("local", "test-host")
    assert host is not None
    assert host.is_local is True


def test_temperature_is_none_or_plausible():
    host = get_local_host_metrics("local", "test-host")
    if host.temperature_c is not None:
        assert -20 <= host.temperature_c <= 120
