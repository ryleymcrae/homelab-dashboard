import asyncio

import pytest

from backend.adapters.docker_adapter import DockerAdapter
from backend.adapters.tcp_adapter import TcpAdapter
from backend.adapters.http_adapter import HttpAdapter
from backend.models.core import Status


def test_tcp_adapter_reports_offline_for_closed_port():
    adapter = TcpAdapter("t1", "Test TCP", host="127.0.0.1", port=1, timeout_seconds=0.5)
    service = asyncio.run(adapter.get_status())
    assert service.status == Status.OFFLINE
    assert service.failure is not None
    assert service.failure.reason == "connection_failed"


def test_tcp_adapter_exposes_no_actions_by_default():
    adapter = TcpAdapter("t1", "Test TCP", host="127.0.0.1", port=1)
    assert adapter.get_supported_actions() == []


def test_http_adapter_reports_offline_for_unreachable_host():
    adapter = HttpAdapter("h1", "Test HTTP", url="http://192.0.2.1:81/", timeout_seconds=0.5)
    service = asyncio.run(adapter.get_status())
    assert service.status == Status.OFFLINE
    assert service.failure is not None
    assert service.failure.reason == "unreachable"


def test_every_service_carries_only_populated_metrics():
    """A service must never report a metric it cannot actually measure
    (spec section 12/37) -- verified here by checking TCP failure state
    carries only host/port, not fabricated latency."""
    adapter = TcpAdapter("t1", "Test TCP", host="127.0.0.1", port=1, timeout_seconds=0.5)
    service = asyncio.run(adapter.get_status())
    metric_keys = {m.key for m in service.metrics}
    assert "latency" not in metric_keys


def test_banner_survives_online_and_offline_status():
    """A configured splash-art banner must show up regardless of the
    service's current health -- an offline service shouldn't lose its
    custom art, same as it doesn't lose its custom icon."""
    online = TcpAdapter("t1", "Test TCP", host="127.0.0.1", port=1, banner="/banners/test.svg")
    # Port 1 is never actually open in this test env, so this is offline;
    # the point is that `banner` is set regardless of adapter type/status.
    service = asyncio.run(online.get_status())
    assert service.status == Status.OFFLINE
    assert service.banner == "/banners/test.svg"

    http_adapter = HttpAdapter("h1", "Test HTTP", url="http://192.0.2.1:81/", timeout_seconds=0.5, banner="/banners/test.svg")
    http_service = asyncio.run(http_adapter.get_status())
    assert http_service.status == Status.OFFLINE
    assert http_service.banner == "/banners/test.svg"


def test_format_ports_collapses_consecutive_range():
    """Docker reports one binding per bound IP (0.0.0.0 and ::), which
    used to render as the same port twice; adjacent unremapped ports
    should also collapse into a single readable range."""
    from backend.adapters.docker_adapter import _format_ports

    ports = {
        "2456/udp": [{"HostIp": "0.0.0.0", "HostPort": "2456"}, {"HostIp": "::", "HostPort": "2456"}],
        "2457/udp": [{"HostIp": "0.0.0.0", "HostPort": "2457"}, {"HostIp": "::", "HostPort": "2457"}],
    }
    assert _format_ports(ports) == "2456~2457 udp"


def test_format_ports_keeps_remapped_ports_individual():
    from backend.adapters.docker_adapter import _format_ports

    ports = {"80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}]}
    assert _format_ports(ports) == "8080->80/tcp"


def test_format_ports_empty_returns_none():
    from backend.adapters.docker_adapter import _format_ports

    assert _format_ports({}) is None


def test_fetch_a2s_info_returns_none_for_unreachable_server():
    """No Source-engine server is listening on this port -- must degrade
    to None (no metrics added) rather than raising and breaking the
    service's own Docker/systemd status."""
    from backend.adapters.game_status import fetch_a2s_info

    info = asyncio.run(fetch_a2s_info("127.0.0.1", 1, timeout=0.5))
    assert info is None


def test_a2s_status_metrics_builds_players_map_and_version():
    from dataclasses import dataclass

    from backend.adapters.game_status import a2s_status_metrics

    @dataclass
    class FakeInfo:
        player_count: int
        max_players: int
        map_name: str
        version: str

    info = FakeInfo(player_count=3, max_players=10, map_name="meadows", version="0.219.4")
    metrics = {m.key: m for m in a2s_status_metrics(info)}
    assert metrics["players"].value == "3 / 10"
    assert metrics["map"].value == "meadows"
    assert metrics["version"].value == "0.219.4"


def test_docker_adapter_accepts_a2s_options():
    """Just verifies the constructor wiring -- a real A2S round trip
    against Docker is covered by the unreachable-server test above and
    the live game servers themselves."""
    adapter = DockerAdapter(
        "d1", "Test", container="x", endpoint="unix:///nonexistent",
        a2s_port=2457, a2s_address="127.0.0.1",
    )
    assert adapter.a2s_port == 2457
    assert adapter.a2s_address == "127.0.0.1"
