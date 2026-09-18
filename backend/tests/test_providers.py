"""
Provider abstraction: DemoProvider must satisfy the exact same contract
LiveProvider does (NotFoundError/ActionError/LogsUnsupportedError for the
same situations) so backend/api/main.py never has to know which one it's
talking to. The end-to-end behavior through the API is already covered by
test_api.py/test_auth.py; this targets the provider layer directly.
"""
import tempfile
from pathlib import Path

import pytest
import yaml

from backend.config.loader import ConfigStore
from backend.demo.runtime import runtime as demo_runtime
from backend.models.core import Status
from backend.persistence.history import HistoryStore
from backend.providers.base import ActionError, LogsUnsupportedError, NotFoundError
from backend.providers.demo import DemoProvider
from backend.providers.live import LiveProvider


@pytest.fixture(autouse=True)
def _reset_demo_runtime():
    # `runtime` (backend/demo/runtime.py) is a module-level singleton
    # shared by every DemoProvider instance, so one test's simulated
    # stop/restart doesn't leak into the next.
    demo_runtime.reset()
    yield
    demo_runtime.reset()


@pytest.fixture
def provider():
    return DemoProvider()


def test_live_provider_fleet_summary_with_no_hosts_or_services(monkeypatch):
    """No real Docker/systemd access needed -- an empty config exercises
    the aggregation logic itself without depending on host collectors."""
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "config.yml"
        config_path.write_text(yaml.safe_dump({}))
        store = ConfigStore(config_path)
        history = HistoryStore(Path(tmp) / "history.sqlite3")
        live = LiveProvider(store, history)

        import asyncio

        summary = asyncio.run(live.get_fleet_summary())
        assert summary.total_hosts == 0
        assert summary.containers_total == 0
        assert summary.total_power_draw_w is None  # never fabricated -- no real sensor exists yet


def test_live_provider_history_delegates_to_the_real_history_store():
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "config.yml"
        config_path.write_text(yaml.safe_dump({}))
        store = ConfigStore(config_path)
        history = HistoryStore(Path(tmp) / "history.sqlite3")
        history.record("host.test.cpu", 42.0)
        live = LiveProvider(store, history)

        import asyncio

        points = asyncio.run(live.get_history("host.test.cpu", 3600))
        assert points == [(points[0][0], 42.0)]


@pytest.mark.asyncio
async def test_get_hosts_returns_every_demo_host(provider):
    hosts = await provider.get_hosts()
    assert len(hosts) > 1
    assert any(h.is_local for h in hosts)


@pytest.mark.asyncio
async def test_get_host_detail_unknown_host_raises(provider):
    with pytest.raises(NotFoundError):
        await provider.get_host_detail("does-not-exist")


@pytest.mark.asyncio
async def test_get_host_detail_known_host_returns_metrics(provider):
    hosts = await provider.get_hosts()
    metrics = await provider.get_host_detail(hosts[0].id)
    assert any(m.key.startswith("cpu_core_") for m in metrics)


@pytest.mark.asyncio
async def test_get_service_unknown_raises(provider):
    with pytest.raises(NotFoundError):
        await provider.get_service("does-not-exist")


@pytest.mark.asyncio
async def test_get_service_logs_unsupported_service_raises(provider):
    services = await provider.get_services()
    without_logs = next(s for s in services if not s.has_logs)
    with pytest.raises(LogsUnsupportedError):
        await provider.get_service_logs(without_logs.id, 200)


@pytest.mark.asyncio
async def test_get_service_logs_supported_service_returns_lines(provider):
    services = await provider.get_services()
    with_logs = next(s for s in services if s.has_logs)
    lines = await provider.get_service_logs(with_logs.id, 200)
    assert len(lines) > 0


@pytest.mark.asyncio
async def test_execute_service_action_unsupported_kind_raises(provider):
    with pytest.raises(ActionError):
        await provider.execute_service_action("ssh", "restart")  # ssh declares no actions


@pytest.mark.asyncio
async def test_execute_service_action_unknown_service_raises(provider):
    with pytest.raises(NotFoundError):
        await provider.execute_service_action("does-not-exist", "restart")


@pytest.mark.asyncio
async def test_execute_service_action_transitions_and_persists(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    result = await provider.execute_service_action("plex", "restart")
    assert result.status == Status.ONLINE
    # The next read reflects the simulated action too, not just the
    # immediate return value -- runtime state, not a one-off response.
    refetched = await provider.get_service("plex")
    assert refetched.status == Status.ONLINE


@pytest.mark.asyncio
async def test_stop_then_start_round_trips(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    stopped = await provider.execute_service_action("plex", "stop")
    assert stopped.status == Status.OFFLINE
    started = await provider.execute_service_action("plex", "start")
    assert started.status == Status.ONLINE


@pytest.mark.asyncio
async def test_restart_increments_restart_count(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    before = await provider.get_service("plex")
    before_count = next(m.value for m in before.metrics if m.key == "restarts")
    await provider.execute_service_action("plex", "restart")
    after = await provider.get_service("plex")
    after_count = next(m.value for m in after.metrics if m.key == "restarts")
    assert after_count == before_count + 1


@pytest.mark.asyncio
async def test_get_network_returns_targets_and_traffic(provider):
    data = await provider.get_network()
    assert len(data.targets) > 0
    assert data.traffic.download_mbps >= 0


@pytest.mark.asyncio
@pytest.mark.parametrize("hours", [1, 6, 24, 168, 720])
async def test_get_history_backfills_every_selectable_range(provider, hours):
    points = await provider.get_history("host.ziri-mini.cpu", hours * 3600)
    assert len(points) > 10
    # Oldest-first, and nothing from the future.
    now = points[-1][0]
    assert points[0][0] < points[-1][0]
    assert all(ts <= now for ts, _ in points)


@pytest.mark.asyncio
async def test_get_history_unknown_series_still_returns_points(provider):
    # Demo history falls back to a generic wave shape for a series it
    # doesn't specifically know about, rather than erroring.
    points = await provider.get_history("host.some-future-host.cpu", 3600)
    assert len(points) > 0


@pytest.mark.asyncio
async def test_get_service_config_unconfigurable_service_raises(provider):
    from backend.providers.base import ConfigUnsupportedError

    with pytest.raises(ConfigUnsupportedError):
        await provider.get_service_config("home-assistant")


@pytest.mark.asyncio
async def test_update_service_config_merges_onto_pending_not_applied(provider):
    await provider.update_service_config("plex", {"cpu_limit": "4"})
    state = await provider.update_service_config("plex", {"mem_limit": "4g"})
    assert state.pending.cpu_limit == "4"  # earlier staged change preserved
    assert state.pending.mem_limit == "4g"
    assert state.applied.cpu_limit == "2"  # still the original default


@pytest.mark.asyncio
async def test_update_action_not_offered_until_available(provider):
    plex = await provider.get_service("plex")
    kinds = {a.kind.value for a in plex.actions}
    assert "update" in kinds  # default demo image state has one available
    assert "rollback" not in kinds  # nothing to roll back to yet


@pytest.mark.asyncio
async def test_update_then_rollback_round_trips(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    before = await provider.get_service("plex")
    before_image = next(m.value for m in before.metrics if m.key == "image")

    updated = await provider.execute_service_action("plex", "update")
    updated_image = next(m.value for m in updated.metrics if m.key == "image")
    assert updated_image != before_image
    assert not any(a.kind.value == "update" for a in updated.actions)  # just-applied update is gone
    assert any(a.kind.value == "rollback" for a in updated.actions)

    rolled_back = await provider.execute_service_action("plex", "rollback")
    rolled_back_image = next(m.value for m in rolled_back.metrics if m.key == "image")
    assert rolled_back_image == before_image
    assert any(a.kind.value == "update" for a in rolled_back.actions)
    assert not any(a.kind.value == "rollback" for a in rolled_back.actions)


@pytest.mark.asyncio
async def test_update_unavailable_after_already_updated(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    await provider.execute_service_action("plex", "update")
    with pytest.raises(ActionError):
        await provider.execute_service_action("plex", "update")


@pytest.mark.asyncio
async def test_rollback_unavailable_before_any_update(provider):
    with pytest.raises(ActionError):
        await provider.execute_service_action("plex", "rollback")


@pytest.mark.asyncio
async def test_update_rejected_for_unconfigurable_service(provider):
    with pytest.raises(ActionError):
        await provider.execute_service_action("home-assistant", "update")


@pytest.mark.asyncio
async def test_host_actions_vary_per_host(provider):
    hosts = {h.id: h for h in await provider.get_hosts()}
    ziri_mini_kinds = {a.kind.value for a in hosts["ziri-mini"].actions}
    assert {"reboot", "docker_prune", "restart_docker", "clear_package_cache", "run_backup"} <= ziri_mini_kinds
    # Reachability-only host with no agent -- nothing to execute anything through.
    assert hosts["raspberry-pi"].actions == []


@pytest.mark.asyncio
async def test_host_reboot_and_restart_docker_require_typed_confirmation(provider):
    hosts = {h.id: h for h in await provider.get_hosts()}
    by_kind = {a.kind.value: a for a in hosts["ziri-mini"].actions}
    assert by_kind["reboot"].require_typed_confirmation == "ziri-mini"
    assert by_kind["restart_docker"].require_typed_confirmation == "ziri-mini"
    assert by_kind["docker_prune"].require_typed_confirmation is None


@pytest.mark.asyncio
async def test_execute_host_action_unsupported_raises(provider):
    with pytest.raises(ActionError):
        await provider.execute_host_action("raspberry-pi", "reboot")


@pytest.mark.asyncio
async def test_execute_host_action_unknown_host_raises(provider):
    with pytest.raises(NotFoundError):
        await provider.execute_host_action("does-not-exist", "reboot")


@pytest.mark.asyncio
async def test_execute_host_action_produces_a_result(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    host = await provider.execute_host_action("ziri-mini", "clear_package_cache")
    assert host.last_action_result is not None
    assert host.last_action_result.action == "clear_package_cache"
    assert host.last_action_result.message  # some human-readable text either way


@pytest.mark.asyncio
async def test_reboot_failure_leaves_host_offline(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    monkeypatch.setattr("backend.demo.runtime._HOST_ACTION_FAILURE_CHANCE", {"reboot": 1.0})
    host = await provider.execute_host_action("ziri-mini", "reboot")
    assert host.status == Status.OFFLINE
    assert host.last_action_result.success is False


@pytest.mark.asyncio
async def test_reboot_success_leaves_host_online(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    monkeypatch.setattr("backend.demo.runtime._HOST_ACTION_FAILURE_CHANCE", {"reboot": 0.0})
    host = await provider.execute_host_action("ziri-mini", "reboot")
    assert host.status == Status.ONLINE
    assert host.last_action_result.success is True


@pytest.mark.asyncio
async def test_get_scheduled_jobs_unknown_host_raises(provider):
    with pytest.raises(NotFoundError):
        await provider.get_scheduled_jobs("does-not-exist")


@pytest.mark.asyncio
async def test_run_scheduled_job_updates_last_and_next_run(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    monkeypatch.setattr("backend.demo.runtime._HOST_ACTION_FAILURE_CHANCE", {"run_backup": 0.0})
    jobs_before = await provider.get_scheduled_jobs("ziri-mini")
    job = next(j for j in jobs_before if j.id == "nightly-backup")
    updated = await provider.run_scheduled_job("ziri-mini", job.id)
    assert updated.last_status == "success"
    assert updated.last_run != job.last_run
    assert updated.next_run != job.next_run


@pytest.mark.asyncio
async def test_run_scheduled_job_unknown_job_raises(provider):
    with pytest.raises(NotFoundError):
        await provider.run_scheduled_job("ziri-mini", "does-not-exist")


@pytest.mark.asyncio
async def test_backup_status_none_for_untracked_host(provider):
    assert await provider.get_backup_status("raspberry-pi") is None


@pytest.mark.asyncio
async def test_run_backup_updates_backup_status(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    monkeypatch.setattr("backend.demo.runtime._HOST_ACTION_FAILURE_CHANCE", {"run_backup": 0.0})
    before = await provider.get_backup_status("ziri-mini")
    await provider.execute_host_action("ziri-mini", "run_backup")
    after = await provider.get_backup_status("ziri-mini")
    assert after.last_status == "success"
    assert after.last_backup_at != before.last_backup_at
    assert after.size_bytes is not None


@pytest.mark.asyncio
async def test_run_backup_failure_does_not_update_last_backup_at(provider, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    monkeypatch.setattr("backend.demo.runtime._HOST_ACTION_FAILURE_CHANCE", {"run_backup": 1.0})
    before = await provider.get_backup_status("ziri-mini")
    await provider.execute_host_action("ziri-mini", "run_backup")
    after = await provider.get_backup_status("ziri-mini")
    assert after.last_status == "failure"
    assert after.last_backup_at == before.last_backup_at  # last *successful* backup unchanged


@pytest.mark.asyncio
async def test_get_fleet_summary_aggregates_across_hosts(provider):
    hosts = await provider.get_hosts()
    summary = await provider.get_fleet_summary()
    assert summary.total_hosts == len(hosts)
    assert summary.total_cores == sum(h.cpu_cores or 0 for h in hosts)
    assert summary.containers_total >= 1  # plex, at least
    assert summary.containers_running <= summary.containers_total
