"""
Auth gate behavior: disabled by default, required once DASHBOARD_PASSWORD
is set, bypassed only for configured trusted IPs (the kiosk use case).
"""
import tempfile
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient


def _make_client(monkeypatch, tmp, *, password=None, trusted_ips=None, guest_mode=False):
    config_path = Path(tmp) / "config.yml"
    config = {"demo_mode": True, "dashboard": {"title": "Test Lab"}, "guest_mode": guest_mode}
    if trusted_ips is not None:
        config["auth"] = {"trusted_ips": trusted_ips}
    config_path.write_text(yaml.safe_dump(config))
    monkeypatch.setenv("DASHBOARD_CONFIG", str(config_path))
    monkeypatch.setenv("DASHBOARD_HISTORY_DB", str(Path(tmp) / "history.sqlite3"))
    monkeypatch.setenv("DASHBOARD_AUDIT_DB", str(Path(tmp) / "audit.sqlite3"))
    monkeypatch.setenv("DASHBOARD_ALERTS_DB", str(Path(tmp) / "alerts.sqlite3"))
    if password is None:
        monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("DASHBOARD_PASSWORD", password)

    import importlib

    import backend.api.main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


def test_no_password_set_means_no_auth_required(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp)
        with client:
            assert client.get("/api/auth/status").json() == {
                "required": False, "authenticated": True, "guestMode": False, "isAdmin": False,
            }
            assert client.get("/api/snapshot").status_code == 200


def test_password_set_blocks_unauthenticated_requests(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2")
        with client:
            status = client.get("/api/auth/status").json()
            assert status == {"required": True, "authenticated": False, "guestMode": False, "isAdmin": False}
            assert client.get("/api/snapshot").status_code == 401


def test_correct_password_grants_a_session(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2")
        with client:
            resp = client.post("/api/auth/login", json={"password": "hunter2"})
            assert resp.status_code == 200
            assert client.get("/api/snapshot").status_code == 200
            assert client.get("/api/auth/status").json()["authenticated"] is True


def test_wrong_password_is_rejected(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2")
        with client:
            resp = client.post("/api/auth/login", json={"password": "wrong"})
            assert resp.status_code == 401
            assert client.get("/api/snapshot").status_code == 401


def test_logout_clears_session(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2")
        with client:
            client.post("/api/auth/login", json={"password": "hunter2"})
            assert client.get("/api/snapshot").status_code == 200
            client.post("/api/auth/logout")
            assert client.get("/api/snapshot").status_code == 401


def test_trusted_ip_skips_login(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        # Exercised via X-Forwarded-For (what the shipped nginx sets) rather
        # than the TestClient's own connection address, which is a fixed
        # "testclient" pseudo-host rather than a real IP.
        client = _make_client(monkeypatch, tmp, password="hunter2", trusted_ips=["127.0.0.1"])
        with client:
            resp = client.get("/api/snapshot", headers={"x-forwarded-for": "127.0.0.1"})
            assert resp.status_code == 200


def test_untrusted_ip_still_requires_login(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2", trusted_ips=["127.0.0.1"])
        with client:
            resp = client.get("/api/snapshot", headers={"x-forwarded-for": "10.0.0.99"})
            assert resp.status_code == 401


# -- guest mode -----------------------------------------------------------

def test_guest_mode_without_password_blocks_actions_but_not_viewing(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, guest_mode=True)
        with client:
            assert client.get("/api/snapshot").status_code == 200
            resp = client.post("/api/services/plex/actions/restart")
            assert resp.status_code == 403


def test_guest_mode_login_is_a_noop_without_a_password_so_actions_stay_blocked(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, guest_mode=True)
        with client:
            # No DASHBOARD_PASSWORD configured -- login "succeeds" (matches
            # existing verify_password behavior) but issues no real session,
            # since auth.auth_enabled() is False. Documents the documented
            # lockout: without a password, guest mode can't be escaped from the UI.
            client.post("/api/auth/login", json={"password": "anything"})
            resp = client.post("/api/services/plex/actions/restart")
            assert resp.status_code == 403


def test_guest_mode_trusted_ip_can_view_but_not_act(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2", trusted_ips=["127.0.0.1"], guest_mode=True)
        with client:
            headers = {"x-forwarded-for": "127.0.0.1"}
            assert client.get("/api/snapshot", headers=headers).status_code == 200
            # Trusted IP bypasses the login wall for viewing, but is
            # deliberately NOT treated as admin proof for guest mode.
            resp = client.post("/api/services/plex/actions/restart", headers=headers)
            assert resp.status_code == 403


def test_guest_mode_logged_in_admin_can_act(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2", trusted_ips=["127.0.0.1"], guest_mode=True)
        with client:
            headers = {"x-forwarded-for": "127.0.0.1"}
            client.post("/api/auth/login", json={"password": "hunter2"}, headers=headers)
            assert client.get("/api/auth/status", headers=headers).json()["isAdmin"] is True
            resp = client.post("/api/services/plex/actions/restart", headers=headers)
            assert resp.status_code == 200


def test_guest_mode_login_and_logout_remain_reachable(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        client = _make_client(monkeypatch, tmp, password="hunter2", trusted_ips=["127.0.0.1"], guest_mode=True)
        with client:
            headers = {"x-forwarded-for": "127.0.0.1"}  # viewing (needed to reach logout) via the trusted IP
            assert client.post("/api/auth/login", json={"password": "wrong"}, headers=headers).status_code == 401
            client.post("/api/auth/login", json={"password": "hunter2"}, headers=headers)
            assert client.post("/api/auth/logout", headers=headers).status_code == 200
