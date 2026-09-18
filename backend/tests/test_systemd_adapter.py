import asyncio

import pytest

from backend.adapters.base import AdapterError
from backend.adapters.systemd_adapter import SystemdAdapter, _parse_int, _validate_unit_name


def test_valid_unit_names_accepted():
    _validate_unit_name("nginx.service")
    _validate_unit_name("my-app_v2.service")


@pytest.mark.parametrize(
    "malicious",
    [
        "nginx.service; rm -rf /",
        "nginx.service && cat /etc/shadow",
        "$(reboot)",
        "`reboot`",
        "nginx.service|whoami",
        "",
    ],
)
def test_malicious_unit_names_rejected(malicious):
    with pytest.raises(AdapterError):
        _validate_unit_name(malicious)


def test_adapter_construction_validates_unit_name():
    with pytest.raises(AdapterError):
        SystemdAdapter("s1", "Bad", unit="nginx.service; rm -rf /")


def test_parse_int_treats_not_set_as_none():
    """systemd reports an untracked property as the literal string
    "[not set]" -- must never be parsed as a fabricated 0."""
    assert _parse_int("[not set]") is None
    assert _parse_int(None) is None
    assert _parse_int("1544192") == 1544192


def test_systemd_adapter_reports_expanded_metrics_for_a_real_unit():
    """systemd-journald is present and active on any systemd Linux host,
    so this exercises the real `systemctl show` path end to end rather
    than mocking it -- consistent with how the local system collector's
    tests already hit real psutil."""
    adapter = SystemdAdapter("j1", "Journald", unit="systemd-journald.service")
    service = asyncio.run(adapter.get_status())
    keys = {m.key for m in service.metrics}
    assert "state" in keys
    assert "main_pid" in keys
    assert "memory" in keys
    assert "tasks" in keys
    assert "restarts" in keys
    # CPU% needs a second sample (it's derived from a delta), not present yet.
    assert "cpu" not in keys

    service2 = asyncio.run(adapter.get_status())
    assert "cpu" in {m.key for m in service2.metrics}


def test_systemd_adapter_status_url_adds_game_metrics_without_affecting_status(monkeypatch):
    """A game server managed by systemd has no way for systemd itself to
    know about player counts -- status_url is a purely additive metrics
    source and must never override the process-based online/offline
    status."""
    from backend.adapters import systemd_adapter

    async def fake_fetch(url, timeout=3.0):
        return {"online": False, "players": 2, "max_players": 8}

    monkeypatch.setattr(systemd_adapter, "fetch_game_status", fake_fetch)

    adapter = SystemdAdapter(
        "j2", "Journald", unit="systemd-journald.service", status_url="http://example.invalid/status"
    )
    service = asyncio.run(adapter.get_status())
    players = next(m for m in service.metrics if m.key == "players")
    assert players.value == "2 / 8"
    # The unit is genuinely active -- status_url's "online: false" must not
    # flip that, since systemd/Docker process state is the source of truth.
    assert service.status.value == "online"
