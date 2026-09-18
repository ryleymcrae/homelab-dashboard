"""
End-to-end API test. Runs the FastAPI app against a temporary demo-mode
config so it needs no real Docker/systemd/network access -- verifying the
REST contract the frontend depends on.
"""
import tempfile
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient


@pytest.fixture
def demo_client(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "config.yml"
        config_path.write_text(yaml.safe_dump({"demo_mode": True, "dashboard": {"title": "Test Lab"}}))
        monkeypatch.setenv("DASHBOARD_CONFIG", str(config_path))
        # Auth is opt-in via this env var -- make sure a var set outside
        # the test runner can't leak into these auth-agnostic tests.
        monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
        # HistoryStore is also constructed at import time (backend/api/main.py)
        # and defaults to /data/history.sqlite3 -- unwritable for a non-root
        # dev user. Isolate it into the same temp dir so the suite doesn't
        # depend on an env var set outside this fixture.
        monkeypatch.setenv("DASHBOARD_HISTORY_DB", str(Path(tmp) / "history.sqlite3"))
        monkeypatch.setenv("DASHBOARD_AUDIT_DB", str(Path(tmp) / "audit.sqlite3"))
        monkeypatch.setenv("DASHBOARD_ALERTS_DB", str(Path(tmp) / "alerts.sqlite3"))

        # Import after env vars are set so ConfigStore/HistoryStore pick them up on module load.
        import importlib

        import backend.api.main as main_module
        from backend.demo.runtime import runtime as demo_runtime

        importlib.reload(main_module)
        # `runtime` is a module-level singleton (backend/demo/runtime.py),
        # not reset by reloading main_module -- clear it so one test's
        # simulated stop/restart can't leak into the next.
        demo_runtime.reset()
        with TestClient(main_module.app) as client:
            yield client


def test_snapshot_endpoint_returns_demo_data(demo_client):
    resp = demo_client.get("/api/snapshot")
    assert resp.status_code == 200
    data = resp.json()
    assert data["dashboard"]["title"] == "Test Lab"
    assert isinstance(data["hosts"], list)
    assert len(data["hosts"]) > 1  # every configured host, not just the local one
    for host in data["hosts"]:
        assert host["status"] in ("online", "offline", "warning", "unknown")
    assert data["overallStatus"] in ("online", "offline", "warning", "unknown")
    assert isinstance(data["services"], list)
    assert len(data["services"]) > 0


def test_hosts_endpoint_lists_every_host(demo_client):
    resp = demo_client.get("/api/hosts")
    assert resp.status_code == 200
    hosts = resp.json()
    assert len(hosts) > 1
    ids = {h["id"] for h in hosts}
    assert "ziri-mini" in ids  # the local host
    assert any(not h["isLocal"] for h in hosts)  # at least one remote host is present too


def test_host_detail_404_for_unknown_host(demo_client):
    resp = demo_client.get("/api/hosts/does-not-exist")
    assert resp.status_code == 404


def test_service_detail_404_for_unknown_service(demo_client):
    resp = demo_client.get("/api/services/does-not-exist")
    assert resp.status_code == 404


def test_actions_work_in_demo_mode(demo_client, monkeypatch):
    # Real timing isn't worth waiting on in a unit test -- see
    # backend/demo/runtime.py:ACTION_DELAY_SCALE.
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    resp = demo_client.post("/api/services/plex/actions/restart")
    assert resp.status_code == 200
    assert resp.json()["status"] == "online"


def test_unsupported_action_rejected_in_demo_mode(demo_client):
    # "ssh" only declares no actions in demo data -- see backend/demo/generator.py.
    resp = demo_client.post("/api/services/ssh/actions/restart")
    assert resp.status_code == 400


def test_action_logged_to_audit_log(demo_client, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    demo_client.post("/api/services/plex/actions/restart")
    entries = demo_client.get("/api/audit-log").json()
    assert any(e["action"] == "restart" and e["target"] == "plex" and e["result"] == "success" for e in entries)


def test_health_endpoint(demo_client):
    resp = demo_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_host_detail_metrics_endpoint(demo_client):
    resp = demo_client.get("/api/hosts/ziri-mini/detail")
    assert resp.status_code == 200
    metrics = resp.json()["metrics"]
    assert any(m["key"].startswith("cpu_core_") for m in metrics)


def test_host_detail_metrics_404_for_unknown_host(demo_client):
    resp = demo_client.get("/api/hosts/does-not-exist/detail")
    assert resp.status_code == 404


def test_service_logs_endpoint_for_service_with_logs(demo_client):
    resp = demo_client.get("/api/services/plex/logs")
    assert resp.status_code == 200
    lines = resp.json()["lines"]
    assert len(lines) > 0
    assert all("text" in l for l in lines)


def test_service_logs_404_for_unknown_service(demo_client):
    resp = demo_client.get("/api/services/does-not-exist/logs")
    assert resp.status_code == 404


def test_logs_ws_sends_initial_batch_then_new_lines(demo_client, monkeypatch):
    monkeypatch.setattr("backend.api.main._LOG_POLL_INTERVAL_SECONDS", 0.05)
    monkeypatch.setattr("backend.demo.runtime._LOG_APPEND_CHANCE", 1.0)  # deterministic: always appends
    with demo_client.websocket_connect("/ws/logs/plex") as ws:
        first = ws.receive_json()
        assert len(first["lines"]) > 0
        second = ws.receive_json()
        assert len(second["lines"]) > 0
        # The second batch is genuinely new lines, not a repeat of the first.
        assert second["lines"][0]["text"] != first["lines"][0]["text"] or second["lines"] != first["lines"]


def test_logs_ws_sends_error_message_for_unknown_service(demo_client):
    # Accepts the connection and sends a real error rather than closing
    # before accept -- a bare close code can't carry a human-readable
    # reason, and the frontend needs one to stop retrying (see
    # frontend/src/components/LogsDialog.tsx).
    with demo_client.websocket_connect("/ws/logs/does-not-exist") as ws:
        msg = ws.receive_json()
        assert "error" in msg


def test_logs_ws_sends_error_message_for_service_without_logs(demo_client):
    with demo_client.websocket_connect("/ws/logs/home-assistant") as ws:
        msg = ws.receive_json()
        assert "error" in msg


def test_get_service_config_for_configurable_service(demo_client):
    resp = demo_client.get("/api/services/plex/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["applied"]["restartPolicy"] == "unless-stopped"
    assert data["pending"] is None


def test_get_service_config_400_for_unconfigurable_service(demo_client):
    resp = demo_client.get("/api/services/home-assistant/config")
    assert resp.status_code == 400


def test_get_service_config_404_for_unknown_service(demo_client):
    resp = demo_client.get("/api/services/does-not-exist/config")
    assert resp.status_code == 404


def test_patch_service_config_stages_pending_change(demo_client):
    resp = demo_client.patch("/api/services/plex/config", json={"cpuLimit": "4"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["pending"]["cpuLimit"] == "4"
    assert data["applied"]["cpuLimit"] == "2"  # unchanged until a restart

    # The pending state persists across reads.
    again = demo_client.get("/api/services/plex/config").json()
    assert again["pending"]["cpuLimit"] == "4"


def test_pending_config_applies_on_restart(demo_client, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    demo_client.patch("/api/services/plex/config", json={"memLimit": "4g"})
    demo_client.post("/api/services/plex/actions/restart")
    after = demo_client.get("/api/services/plex/config").json()
    assert after["applied"]["memLimit"] == "4g"
    assert after["pending"] is None


def test_config_change_logged_to_audit_log(demo_client):
    demo_client.patch("/api/services/plex/config", json={"cpuLimit": "1"})
    entries = demo_client.get("/api/audit-log").json()
    assert any(e["action"] == "config_change" and e["target"] == "plex" and e["result"] == "success" for e in entries)


def test_update_and_rollback_round_trip(demo_client, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    before = demo_client.get("/api/services/plex").json()
    before_image = next(m["value"] for m in before["metrics"] if m["key"] == "image")

    update_resp = demo_client.post("/api/services/plex/actions/update")
    assert update_resp.status_code == 200
    updated_image = next(m["value"] for m in update_resp.json()["metrics"] if m["key"] == "image")
    assert updated_image != before_image

    # Nothing left to update to -- doing it again is rejected.
    assert demo_client.post("/api/services/plex/actions/update").status_code == 400

    rollback_resp = demo_client.post("/api/services/plex/actions/rollback")
    assert rollback_resp.status_code == 200
    rolled_back_image = next(m["value"] for m in rollback_resp.json()["metrics"] if m["key"] == "image")
    assert rolled_back_image == before_image

    entries = demo_client.get("/api/audit-log").json()
    actions_logged = [(e["action"], e["target"], e["result"]) for e in entries]
    assert ("update", "plex", "success") in actions_logged
    assert ("rollback", "plex", "success") in actions_logged


def test_host_action_endpoint(demo_client, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    resp = demo_client.post("/api/hosts/ziri-mini/actions/clear_package_cache")
    assert resp.status_code == 200
    assert resp.json()["lastActionResult"]["action"] == "clear_package_cache"

    entries = demo_client.get("/api/audit-log").json()
    assert any(e["action"] == "clear_package_cache" and e["target"] == "host:ziri-mini" for e in entries)


def test_host_action_404_for_unknown_host(demo_client):
    resp = demo_client.post("/api/hosts/does-not-exist/actions/reboot")
    assert resp.status_code == 404


def test_host_action_400_for_unsupported_action(demo_client):
    resp = demo_client.post("/api/hosts/raspberry-pi/actions/reboot")
    assert resp.status_code == 400


def test_host_jobs_endpoint(demo_client):
    resp = demo_client.get("/api/hosts/ziri-mini/jobs")
    assert resp.status_code == 200
    jobs = resp.json()
    assert any(j["id"] == "nightly-backup" for j in jobs)


def test_run_host_job_endpoint(demo_client, monkeypatch):
    monkeypatch.setattr("backend.demo.runtime.ACTION_DELAY_SCALE", 0)
    resp = demo_client.post("/api/hosts/ziri-mini/jobs/nightly-backup/run")
    assert resp.status_code == 200
    assert resp.json()["lastStatus"] in ("success", "failure")

    entries = demo_client.get("/api/audit-log").json()
    assert any(e["action"] == "job_run" and e["target"] == "host:ziri-mini" for e in entries)


def test_run_host_job_404_for_unknown_job(demo_client):
    resp = demo_client.post("/api/hosts/ziri-mini/jobs/does-not-exist/run")
    assert resp.status_code == 404


def test_host_backup_status_endpoint(demo_client):
    resp = demo_client.get("/api/hosts/ziri-mini/backup")
    assert resp.status_code == 200
    assert resp.json()["lastStatus"] == "success"


def test_host_backup_status_null_for_untracked_host(demo_client):
    resp = demo_client.get("/api/hosts/raspberry-pi/backup")
    assert resp.status_code == 200
    assert resp.json() is None


def test_snapshot_includes_active_alert_count(demo_client):
    resp = demo_client.get("/api/snapshot")
    assert "alertsActive" in resp.json()


def test_alerts_endpoint_returns_a_list(demo_client):
    # Not asserting emptiness: the alerting loop evaluates immediately on
    # startup (backend/api/main.py:_alerting_loop), and demo hosts have a
    # small, deliberate chance of an occasional spike already crossing a
    # default threshold at that exact moment (backend/demo/generator.py)
    # -- exactly the realism the spec asked for, so a real alert existing
    # here already is a legitimate outcome, not a bug.
    resp = demo_client.get("/api/alerts")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_alert_lifecycle_via_api(demo_client):
    import backend.api.main as main_module
    from backend.models.core import AlertSeverity

    alert = main_module.alert_store.trigger(
        fingerprint="host:test-host:cpu_percent",
        severity=AlertSeverity.WARNING,
        title="Test alert",
        message="test",
        metric="cpu_percent",
        target_type="host",
        target_id="test-host",
        target_name="test-host",
        value=95.0,
        threshold=90.0,
        suggested_action=None,
    )

    listed = demo_client.get("/api/alerts").json()
    assert any(a["id"] == alert.id for a in listed)

    ack = demo_client.post(f"/api/alerts/{alert.id}/acknowledge")
    assert ack.status_code == 200
    assert ack.json()["status"] == "acknowledged"

    mute = demo_client.post(f"/api/alerts/{alert.id}/mute", json={"muted": True})
    assert mute.status_code == 200
    assert mute.json()["muted"] is True

    snooze = demo_client.post(f"/api/alerts/{alert.id}/snooze", json={"minutes": 60})
    assert snooze.status_code == 200
    assert snooze.json()["snoozedUntil"] is not None

    entries = demo_client.get("/api/audit-log").json()
    logged_actions = {e["action"] for e in entries}
    assert {"alert_acknowledge", "alert_mute", "alert_snooze"} <= logged_actions


def test_acknowledge_unknown_alert_404(demo_client):
    resp = demo_client.post("/api/alerts/does-not-exist/acknowledge")
    assert resp.status_code == 404


def test_snooze_requires_numeric_minutes(demo_client):
    import backend.api.main as main_module
    from backend.models.core import AlertSeverity

    alert = main_module.alert_store.trigger(
        fingerprint="host:test-host:mem_percent", severity=AlertSeverity.WARNING,
        title="t", message="m", metric="mem_percent", target_type="host",
        target_id="test-host", target_name="test-host", value=95.0, threshold=90.0, suggested_action=None,
    )
    resp = demo_client.post(f"/api/alerts/{alert.id}/snooze", json={"minutes": "not-a-number"})
    assert resp.status_code == 400


def test_notifier_test_send_missing_env_var(demo_client, monkeypatch):
    monkeypatch.setattr("backend.notifications.base.SEND_DELAY_SCALE", 0)
    import backend.api.main as main_module

    main_module.config_store.update(
        {"alerting": {"notifiers": [{"id": "n1", "type": "webhook", "name": "Test Webhook", "url_env": "DASHBOARD_TEST_MISSING"}]}}
    )
    resp = demo_client.post("/api/notifiers/n1/test")
    assert resp.status_code == 200
    assert resp.json()["success"] is False

    entries = demo_client.get("/api/audit-log").json()
    assert any(e["action"] == "notifier_test" and e["target"] == "notifier:n1" for e in entries)


def test_notifier_test_send_unknown_id_404(demo_client):
    resp = demo_client.post("/api/notifiers/does-not-exist/test")
    assert resp.status_code == 404


def test_fleet_summary_endpoint(demo_client):
    resp = demo_client.get("/api/fleet")
    assert resp.status_code == 200
    data = resp.json()
    assert data["totalHosts"] > 1
    assert data["containersTotal"] >= 1


@pytest.mark.parametrize("hours", [1, 6, 24, 168, 720])
def test_history_endpoint_supports_every_selectable_range(demo_client, hours):
    resp = demo_client.get(f"/api/history/host.ziri-mini.cpu?hours={hours}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["series"] == "host.ziri-mini.cpu"
    assert len(data["points"]) > 0
