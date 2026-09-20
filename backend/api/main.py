"""
Dashboard API.

This is the ONLY surface the frontend talks to. It aggregates data from
collectors/adapters into the generic models in backend.models.core and
exposes it over REST (for initial page loads) and WebSocket (for live
updates). No route here ever leaks Docker/systemd/psutil-specific shapes
-- everything is translated to Service/HostInfo/NetworkTarget first.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend import auth
from backend.adapters.docker_adapter import DockerEndpoint, list_discoverable_containers
from backend.alerting.evaluator import AlertEvaluator, merge_thresholds
from backend.config.loader import ConfigError, ConfigStore
from backend.integrations import status as integration_status
from backend.integrations.base import build_integration
from backend.models.core import HostInfo, Status
from backend.notifications.base import build_notifier
from backend.persistence.alerts import AlertStore
from backend.persistence.assets import CONTENT_TYPES, MAX_BYTES, URL_PREFIX, AssetError, AssetStore, AssetTooLarge, references
from backend.persistence.audit import AuditLogStore
from backend.persistence.history import HistoryStore
from backend.providers.base import ActionError, ConfigUnsupportedError, LogsError, LogsUnsupportedError, NotFoundError
from backend.providers.factory import select_provider

logger = logging.getLogger("dashboard")

app = FastAPI(title="Homelab Dashboard API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

config_store = ConfigStore()
history = HistoryStore(
    retention_days=config_store.config.history.retention_days,
    max_rows_per_series=config_store.config.history.max_rows_per_series,
)
audit_log = AuditLogStore()
asset_store = AssetStore()
alert_store = AlertStore()
alert_evaluator = AlertEvaluator(alert_store)
provider = select_provider(config_store, history)

_ws_clients: set[WebSocket] = set()

# Requests to these paths are never gated -- otherwise a client could never
# find out it needs to log in, or log in at all.
_AUTH_EXEMPT_PATHS = {"/api/health", "/api/auth/login", "/api/auth/status"}

# Login/logout must always work regardless of guest mode -- logging in is
# how a guest becomes an admin, so it can't itself require being one.
_GUEST_MODE_EXEMPT_PATHS = {"/api/auth/login", "/api/auth/logout"}
_MUTATING_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


def _client_ip(conn: Request | WebSocket) -> str | None:
    """Shared by the auth gate, the WS handshake check, and the audit log
    -- one place that knows X-Forwarded-For is trusted here only because
    the shipped nginx is the sole thing that can reach this process (see
    docs/security.md)."""
    return auth.client_ip_from_headers(
        conn.client.host if conn.client else None,
        conn.headers.get("x-forwarded-for"),
    )


def _session_token(conn: Request | WebSocket) -> str | None:
    return conn.cookies.get(auth.SESSION_COOKIE)


def _actor(request: Request) -> str:
    return auth.describe_actor(_client_ip(request), config_store.config.auth.trusted_ips, _session_token(request))


@app.middleware("http")
async def _auth_gate(request: Request, call_next):
    if request.url.path not in _AUTH_EXEMPT_PATHS:
        if not auth.is_authenticated(_client_ip(request), config_store.config.auth.trusted_ips, _session_token(request)):
            return Response(
                content=json.dumps({"detail": "Authentication required"}),
                status_code=401,
                media_type="application/json",
            )
    if (
        config_store.config.guest_mode
        and request.method in _MUTATING_METHODS
        and request.url.path not in _GUEST_MODE_EXEMPT_PATHS
        and not auth.is_admin(_session_token(request))
    ):
        return Response(
            content=json.dumps({"detail": "Guest mode is active -- log in to perform this action."}),
            status_code=403,
            media_type="application/json",
        )
    return await call_next(request)


@app.get("/api/auth/status")
async def auth_status(request: Request):
    return {
        "required": auth.auth_enabled(),
        "authenticated": auth.is_authenticated(
            _client_ip(request), config_store.config.auth.trusted_ips, _session_token(request)
        ),
        "guestMode": config_store.config.guest_mode,
        "isAdmin": auth.is_admin(_session_token(request)),
    }


@app.post("/api/auth/login")
async def auth_login(body: dict, response: Response):
    password = body.get("password", "")
    if not auth.verify_password(password):
        raise HTTPException(401, "Incorrect password")
    if auth.auth_enabled():
        response.set_cookie(
            auth.SESSION_COOKIE,
            auth.issue_session_token(),
            max_age=auth.SESSION_LIFETIME_SECONDS,
            httponly=True,
            samesite="lax",
        )
    return {"ok": True}


@app.post("/api/auth/logout")
async def auth_logout(response: Response):
    response.delete_cookie(auth.SESSION_COOKIE)
    return {"ok": True}


# --------------------------------------------------------------------------
# Snapshot assembly -- shared by REST and WebSocket paths so both surfaces
# are always consistent.
# --------------------------------------------------------------------------

async def _hosts_snapshot() -> list[HostInfo]:
    """Every host declared under `hosts:`, collected uniformly -- the
    local machine via psutil, remote hosts via their agent or a bare
    reachability check (backend/collectors/hosts.py). No host is
    special-cased or silently dropped."""
    return await provider.get_hosts()


def _overall_status(hosts: list[HostInfo]) -> Status:
    """Worst-of across every host, so a single unhealthy host (local or
    remote) is reflected in the header, not just the local machine."""
    if not hosts:
        return Status.UNKNOWN
    priority = {Status.OFFLINE: 0, Status.WARNING: 1, Status.UNKNOWN: 2, Status.ONLINE: 3}
    return min((h.status for h in hosts), key=lambda s: priority[s])


async def _services_snapshot() -> list[dict]:
    return [s.to_dict() for s in await provider.get_services()]


async def _network_snapshot() -> dict:
    data = await provider.get_network()
    return {
        "targets": [t.to_dict() for t in data.targets],
        "traffic": data.traffic.to_dict(),
        "localAddress": data.local_address,
        "activeInterface": data.active_interface,
    }


def _alert_thresholds(hosts: list[HostInfo]) -> dict:
    """Each host's effective resource thresholds (defaults + its override),
    so a tile can say "alert at 70°C" instead of guessing. Empty when
    alerting is off -- a limit nothing acts on shouldn't be shown as one."""
    alerting = config_store.config.alerting
    if not alerting.enabled:
        return {}
    out = {}
    for h in hosts:
        t = merge_thresholds(alerting.defaults, alerting.host_overrides.get(h.name))
        out[h.id] = {"cpuPercent": t.cpu_percent, "memPercent": t.mem_percent, "diskPercent": t.disk_percent, "tempC": t.temp_c}
    return out


async def _full_snapshot() -> dict:
    hosts, services, network = await asyncio.gather(
        _hosts_snapshot(), _services_snapshot(), _network_snapshot()
    )
    return {
        "hosts": [h.to_dict() for h in hosts],
        "overallStatus": _overall_status(hosts).value,
        "services": services,
        "network": network,
        "dashboard": {
            "title": config_store.config.dashboard.title,
            "tagline": config_store.config.dashboard.tagline,
            "theme": config_store.config.dashboard.theme,
            "accentColor": config_store.config.dashboard.accent_color,
            "density": config_store.config.dashboard.density,
            "timezone": config_store.config.dashboard.timezone,
            "temperatureUnit": config_store.config.dashboard.temperature_unit,
            "metricDisplay": config_store.config.dashboard.metric_display.model_dump(),
            "logo": config_store.config.dashboard.logo,
            "favicon": config_store.config.dashboard.favicon,
            "navIcons": config_store.config.dashboard.nav_icons,
            "chartGrid": config_store.config.dashboard.chart_grid,
        },
        "alertThresholds": _alert_thresholds(hosts),
        "alertsActive": alert_store.count_active(),
        "timestamp": int(time.time()),
    }


# --------------------------------------------------------------------------
# REST routes
# --------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/snapshot")
async def snapshot():
    return await _full_snapshot()


@app.get("/api/hosts")
async def hosts():
    return [h.to_dict() for h in await _hosts_snapshot()]


@app.get("/api/hosts/{host_id}")
async def host_detail(host_id: str):
    match = next((h for h in await _hosts_snapshot() if h.id == host_id), None)
    if not match:
        raise HTTPException(404, "Host not found")
    return match.to_dict()


@app.get("/api/hosts/{host_id}/detail")
async def host_detail_metrics(host_id: str):
    """Deeper metrics (per-core CPU, disk I/O, per-partition usage...) for
    one host, fetched on demand rather than carried in the every-2-second
    broadcast snapshot -- see backend/collectors/system.py."""
    try:
        metrics = await provider.get_host_detail(host_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"metrics": [m.to_dict() for m in metrics]}


@app.post("/api/hosts/{host_id}/actions/{action_kind}")
async def run_host_action(host_id: str, action_kind: str, request: Request):
    """Whitelisted host-level actions only -- HostActionKind
    (backend/models/core.py) is a fixed enum, never an arbitrary string,
    and DemoProvider/LiveProvider both reject anything not already
    advertised in that host's `actions` (see execute_host_action)."""
    actor = _actor(request)
    target = f"host:{host_id}"
    try:
        result = await provider.execute_host_action(host_id, action_kind)
    except NotFoundError as exc:
        audit_log.record(actor, action_kind, target, "not_found", str(exc))
        raise HTTPException(404, str(exc)) from exc
    except ActionError as exc:
        audit_log.record(actor, action_kind, target, "failed", str(exc))
        raise HTTPException(400, str(exc)) from exc
    outcome = result.last_action_result
    audit_log.record(
        actor, action_kind, target,
        "success" if (outcome is None or outcome.success) else "action_failed",
        outcome.message if outcome else "",
    )
    return result.to_dict()


@app.get("/api/hosts/{host_id}/jobs")
async def host_jobs(host_id: str):
    try:
        jobs = await provider.get_scheduled_jobs(host_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return [j.to_dict() for j in jobs]


@app.post("/api/hosts/{host_id}/jobs/{job_id}/run")
async def run_host_job(host_id: str, job_id: str, request: Request):
    actor = _actor(request)
    target = f"host:{host_id}"
    try:
        job = await provider.run_scheduled_job(host_id, job_id)
    except NotFoundError as exc:
        audit_log.record(actor, "job_run", target, "not_found", f"job={job_id}: {exc}")
        raise HTTPException(404, str(exc)) from exc
    except ActionError as exc:
        audit_log.record(actor, "job_run", target, "failed", f"job={job_id}: {exc}")
        raise HTTPException(400, str(exc)) from exc
    audit_log.record(
        actor, "job_run", target,
        "success" if job.last_status == "success" else "action_failed",
        f"job={job_id}",
    )
    return job.to_dict()


@app.get("/api/hosts/{host_id}/backup")
async def host_backup_status(host_id: str):
    try:
        status = await provider.get_backup_status(host_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return status.to_dict() if status else None


@app.get("/api/services")
async def services():
    return await _services_snapshot()


@app.get("/api/services/{service_id}")
async def service_detail(service_id: str):
    try:
        service = await provider.get_service(service_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return service.to_dict()


@app.post("/api/services/{service_id}/actions/{action_kind}")
async def run_action(service_id: str, action_kind: str, request: Request):
    actor = _actor(request)
    try:
        result = await provider.execute_service_action(service_id, action_kind)
    except NotFoundError as exc:
        audit_log.record(actor, action_kind, service_id, "not_found", str(exc))
        raise HTTPException(404, str(exc)) from exc
    except ActionError as exc:
        audit_log.record(actor, action_kind, service_id, "failed", str(exc))
        raise HTTPException(400, str(exc)) from exc
    audit_log.record(actor, action_kind, service_id, "success")
    return result.to_dict()


@app.get("/api/audit-log")
async def audit_log_entries(limit: int = 200):
    return audit_log.query(limit=limit)


# --------------------------------------------------------------------------
# Alerting
# --------------------------------------------------------------------------

@app.get("/api/alerts")
async def list_alerts(status: str | None = None, limit: int = 200):
    return [a.to_dict() for a in alert_store.list(status=status, limit=limit)]


@app.post("/api/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, request: Request):
    if alert_store.get(alert_id) is None:
        raise HTTPException(404, "Alert not found")
    actor = _actor(request)
    alert = alert_store.acknowledge(alert_id)
    audit_log.record(actor, "alert_acknowledge", f"alert:{alert_id}", "success")
    return alert.to_dict()


@app.post("/api/alerts/{alert_id}/mute")
async def mute_alert(alert_id: str, body: dict, request: Request):
    if alert_store.get(alert_id) is None:
        raise HTTPException(404, "Alert not found")
    muted = bool(body.get("muted", True))
    actor = _actor(request)
    alert = alert_store.set_muted(alert_id, muted)
    audit_log.record(actor, "alert_mute" if muted else "alert_unmute", f"alert:{alert_id}", "success")
    return alert.to_dict()


@app.post("/api/alerts/{alert_id}/snooze")
async def snooze_alert(alert_id: str, body: dict, request: Request):
    if alert_store.get(alert_id) is None:
        raise HTTPException(404, "Alert not found")
    try:
        minutes = float(body["minutes"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Body must include a numeric 'minutes'")
    until_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + minutes * 60))
    actor = _actor(request)
    alert = alert_store.snooze(alert_id, until_iso)
    audit_log.record(actor, "alert_snooze", f"alert:{alert_id}", "success", f"{minutes} minutes")
    return alert.to_dict()


@app.post("/api/notifiers/{notifier_id}/test")
async def test_notifier(notifier_id: str, request: Request):
    config = next((n for n in config_store.config.alerting.notifiers if n.id == notifier_id), None)
    if config is None:
        raise HTTPException(404, "Notifier not found")
    actor = _actor(request)
    notifier = build_notifier(config)
    result = await notifier.send("Test Notification", "This is a test notification from your homelab dashboard.")
    audit_log.record(
        actor, "notifier_test", f"notifier:{notifier_id}",
        "success" if result.success else "failed", result.message,
    )
    return {"success": result.success, "message": result.message}


def _integration_state_dict(integration_id: str) -> dict:
    state = integration_status.get(integration_id)
    return {
        "id": integration_id,
        "status": state.status,
        "message": state.message,
        "lastCheckedAt": state.last_checked_at,
        "lastSuccessAt": state.last_success_at,
    }


@app.get("/api/integrations")
async def list_integration_status():
    """Live status only -- the connections themselves (type, name, and
    per-type fields) are read/written through GET/PATCH /api/config, the
    same as widgets and notifiers. This just answers "is it working"."""
    return [_integration_state_dict(c.id) for c in config_store.config.integrations.connections]


@app.post("/api/integrations/{integration_id}/test")
async def test_integration(integration_id: str, request: Request):
    config = next((c for c in config_store.config.integrations.connections if c.id == integration_id), None)
    if config is None:
        raise HTTPException(404, "Integration not found")
    actor = _actor(request)
    integration = build_integration(config)
    result = await integration.test_connection()
    integration_status.record_test(integration_id, result.success, result.message)
    audit_log.record(
        actor, "integration_test", f"integration:{integration_id}",
        "success" if result.success else "failed", result.message,
    )
    return {"success": result.success, "message": result.message, **_integration_state_dict(integration_id)}


@app.get("/api/services/{service_id}/logs")
async def service_logs(service_id: str, lines: int = 200):
    try:
        log_lines = await provider.get_service_logs(service_id, lines)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except LogsUnsupportedError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LogsError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"lines": [l.to_dict() for l in log_lines]}


@app.get("/api/services/{service_id}/config")
async def service_config(service_id: str):
    try:
        state = await provider.get_service_config(service_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ConfigUnsupportedError as exc:
        raise HTTPException(400, str(exc)) from exc
    return state.to_dict()


_CONFIG_PATCH_KEYS = {"env": "env", "cpuLimit": "cpu_limit", "memLimit": "mem_limit", "restartPolicy": "restart_policy"}


@app.patch("/api/services/{service_id}/config")
async def update_service_config(service_id: str, patch: dict, request: Request):
    """Accepts the same camelCase keys GET returns (cpuLimit/memLimit/
    restartPolicy/env), translated to ContainerConfig's Python field
    names here at the API boundary -- the one place that should know
    about wire-format casing, same as every to_dict() doing the reverse."""
    actor = _actor(request)
    translated = {_CONFIG_PATCH_KEYS[k]: v for k, v in patch.items() if k in _CONFIG_PATCH_KEYS}
    try:
        state = await provider.update_service_config(service_id, translated)
    except NotFoundError as exc:
        audit_log.record(actor, "config_change", service_id, "not_found", str(exc))
        raise HTTPException(404, str(exc)) from exc
    except ConfigUnsupportedError as exc:
        audit_log.record(actor, "config_change", service_id, "failed", str(exc))
        raise HTTPException(400, str(exc)) from exc
    audit_log.record(actor, "config_change", service_id, "success", str(patch))
    return state.to_dict()


@app.get("/api/network")
async def network():
    return await _network_snapshot()


@app.get("/api/history/{series}")
async def history_series(series: str, hours: float = 6):
    rows = await provider.get_history(series, since_seconds=int(hours * 3600))
    return {"series": series, "points": [{"ts": ts, "value": value} for ts, value in rows]}


@app.get("/api/fleet")
async def fleet_summary():
    return (await provider.get_fleet_summary()).to_dict()


@app.get("/api/discovery/docker")
async def discover_docker(host: str | None = None):
    """List discoverable containers for the setup UI. Discovery only --
    never auto-adds anything to the dashboard (spec section 20). With
    `host`, lists that host's containers -- through its assigned Docker
    API if it has one, the same Docker its services would use."""
    conn = config_store.config.docker_connection_for(host)
    endpoint = DockerEndpoint.from_connection(conn) if conn else DockerEndpoint(config_store.config.integrations.docker_socket)
    return await asyncio.to_thread(list_discoverable_containers, endpoint)


# --------------------------------------------------------------------------
# Uploaded images (logo, favicon, icons, banners) -- backend/persistence/assets.py.
# Referenced from config.yml by URL; POST/DELETE are mutating, so the auth
# and guest-mode gates in _auth_gate cover them like any other admin action.
# --------------------------------------------------------------------------

# Multipart framing around a MAX_BYTES file stays well under this.
_UPLOAD_OVERHEAD_BYTES = 64 * 1024


@app.get("/api/assets")
async def list_assets():
    dump = config_store.config.model_dump(mode="json")
    return [{**a, "usedBy": references(dump, a["url"])} for a in asset_store.list()]


@app.post("/api/assets", status_code=201)
async def upload_asset(request: Request):
    # Checked before the body is parsed: the multipart parser would
    # otherwise spool an arbitrarily large upload to disk first, and this
    # port is reachable without nginx's own body limit in front of it.
    length = request.headers.get("content-length")
    if length is None:
        raise HTTPException(411, "Uploads need a Content-Length.")
    if int(length) > MAX_BYTES + _UPLOAD_OVERHEAD_BYTES:
        raise HTTPException(413, f"Images can be at most {MAX_BYTES // (1024 * 1024)} MB.")
    form = await request.form()
    upload = form.get("file")
    if upload is None or isinstance(upload, str):
        raise HTTPException(400, "Expected a `file` field.")
    data = await upload.read(MAX_BYTES + 1)
    actor = _actor(request)
    try:
        name = asset_store.save(data)
    except AssetTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except AssetError as exc:
        audit_log.record(actor, "asset_upload", upload.filename or "", "rejected", str(exc))
        raise HTTPException(415, str(exc)) from exc
    audit_log.record(actor, "asset_upload", name, "success", upload.filename or "")
    return {"name": name, "url": URL_PREFIX + name}


@app.get("/api/assets/{name}")
async def get_asset(name: str):
    path = asset_store.path(name)
    if path is None:
        raise HTTPException(404, "No such image")
    return FileResponse(
        path,
        media_type=CONTENT_TYPES[path.suffix[1:]],
        headers={
            # Content-addressed: these bytes can never change under this name.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


@app.delete("/api/assets/{name}")
async def delete_asset(name: str, request: Request):
    if asset_store.path(name) is None:
        raise HTTPException(404, "No such image")
    used_by = references(config_store.config.model_dump(mode="json"), URL_PREFIX + name)
    if used_by:
        raise HTTPException(409, {"message": "This image is still in use.", "usedBy": used_by})
    asset_store.delete(name)
    audit_log.record(_actor(request), "asset_delete", name, "success")
    return {"ok": True}


@app.get("/api/config")
async def get_config():
    return config_store.config.model_dump(mode="json")


@app.patch("/api/config")
async def patch_config(patch: dict, request: Request):
    global provider
    # Trusted IPs decide who skips the login screen. Once a password
    # exists, only someone who actually used it may change that list --
    # otherwise a trusted kiosk could quietly add any other machine.
    if "auth" in patch and auth.auth_enabled() and not auth.is_admin(_session_token(request)):
        raise HTTPException(403, "Changing trusted IPs requires logging in with the dashboard password.")
    try:
        config_store.update(patch)
    except ConfigError as exc:
        raise HTTPException(400, str(exc)) from exc
    # HistoryStore is built once at startup; keep its limits in step with
    # config so a retention change applies now, not after a restart.
    history.retention_days = config_store.config.history.retention_days
    history.max_rows_per_series = config_store.config.history.max_rows_per_series
    # Rebuilding rather than mutating in place also covers demo_mode being
    # flipped at runtime -- the provider itself, not just its adapters,
    # may need to change.
    provider = select_provider(config_store, history)
    return config_store.config.model_dump(mode="json")


# --------------------------------------------------------------------------
# WebSocket live updates
# --------------------------------------------------------------------------

_LOG_POLL_INTERVAL_SECONDS = 2


def _new_log_lines(previous: list, current: list) -> list:
    """Lines in `current` that come after the last line in `previous`,
    matched by content rather than position -- a tail-limited read's
    window can shift underneath us between polls, so comparing indices
    directly would misfire. If the last previously-seen line can't be
    found at all (log source rotated/cleared), resync silently instead
    of flooding the client with a full duplicate history."""
    if not previous:
        return list(current)
    last_text, last_ts = previous[-1].text, previous[-1].ts
    for i in range(len(current) - 1, -1, -1):
        if current[i].text == last_text and current[i].ts == last_ts:
            return current[i + 1 :]
    return []


@app.websocket("/ws/logs/{service_id}")
async def logs_ws(websocket: WebSocket, service_id: str):
    """Generic "follow" support for any provider: poll the same
    `get_service_logs` every route already uses, diff against the
    previous poll, and push only the new lines. No provider-specific
    streaming code needed -- LiveProvider gets real (if coarsely-
    polled) tailing for free, and DemoProvider's simulated buffer
    (backend/demo/runtime.py:tail_logs) grows on its own between polls."""
    if not auth.is_authenticated(
        _client_ip(websocket), config_store.config.auth.trusted_ips, _session_token(websocket)
    ):
        # No client is listening yet to receive a reason -- an unauthenticated
        # caller gets the same abrupt close a raw TCP-level rejection would.
        await websocket.close(code=4401)
        return

    # Accept unconditionally, even if the very first fetch is about to fail:
    # a close before accept can only carry a bare code, not a human-readable
    # reason (the WS closing handshake doesn't exist yet to carry one) -- the
    # browser just sees an abnormal disconnect and, per the frontend's retry
    # logic, tries again forever. Sending a real error message requires
    # already being connected.
    await websocket.accept()

    try:
        current = await provider.get_service_logs(service_id, lines=200)
    except (NotFoundError, LogsUnsupportedError, LogsError) as exc:
        await websocket.send_text(json.dumps({"error": str(exc)}))
        await websocket.close(code=4400)
        return

    await websocket.send_text(json.dumps({"lines": [l.to_dict() for l in current]}))
    try:
        while True:
            await asyncio.sleep(_LOG_POLL_INTERVAL_SECONDS)
            try:
                latest = await provider.get_service_logs(service_id, lines=200)
            except (NotFoundError, LogsUnsupportedError, LogsError) as exc:
                await websocket.send_text(json.dumps({"error": str(exc)}))
                break
            new_lines = _new_log_lines(current, latest)
            if new_lines:
                await websocket.send_text(json.dumps({"lines": [l.to_dict() for l in new_lines]}))
            current = latest
    except WebSocketDisconnect:
        pass
    else:
        # Reached only via the inner `break` above -- an error was already
        # sent; close deliberately so the browser sees a clean shutdown
        # rather than an abrupt one indistinguishable from a dropped
        # connection worth retrying.
        with contextlib.suppress(RuntimeError):
            await websocket.close()


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    # @app.middleware("http") only ever runs for the ASGI "http" scope, not
    # "websocket" -- the handshake needs its own check, using the same
    # cookie/trusted-IP rules as every REST route.
    if not auth.is_authenticated(
        _client_ip(websocket), config_store.config.auth.trusted_ips, _session_token(websocket)
    ):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            # Client is push-only from the server's perspective; we still
            # read to detect disconnects promptly.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)


def _record_history(data: dict) -> None:
    """One history sample from a snapshot. Called every
    `history.sample_interval_seconds`, not every broadcast tick -- with a
    2-second tick, the per-series row cap would otherwise cover about a
    day of history no matter what `retention_days` says."""
    metrics_to_record = {}
    for host_data in data["hosts"]:
        if host_data.get("cpuPercent") is not None:
            metrics_to_record[f"host.{host_data['id']}.cpu"] = host_data["cpuPercent"]
            metrics_to_record[f"host.{host_data['id']}.mem"] = host_data.get("memPercent") or 0
    if metrics_to_record:
        history.record_many(metrics_to_record)
    traffic = data.get("network", {}).get("traffic", {})
    if traffic:
        history.record_many(
            {
                "network.download_mbps": traffic.get("downloadMbps", 0),
                "network.upload_mbps": traffic.get("uploadMbps", 0),
            }
        )


async def _broadcast_loop():
    """Pushes a fresh snapshot to all connected clients on a cadence that
    balances responsiveness against load on low-powered hardware (spec
    section 23). Also samples history and runs periodic retention cleanup."""
    last_cleanup = 0.0
    last_sample = 0.0
    while True:
        try:
            data = await _full_snapshot()
            payload = json.dumps(data)
            dead = []
            for ws in list(_ws_clients):
                try:
                    await ws.send_text(payload)
                except Exception:  # noqa: BLE001
                    dead.append(ws)
            for ws in dead:
                _ws_clients.discard(ws)

            now = time.time()
            if now - last_sample >= config_store.config.history.sample_interval_seconds:
                _record_history(data)
                last_sample = now
            if now - last_cleanup > 3600:
                history.cleanup()
                last_cleanup = now
        except Exception:  # noqa: BLE001 - the broadcast loop must never die
            logger.exception("broadcast loop iteration failed")

        await asyncio.sleep(2)


_ALERT_EVAL_INTERVAL_SECONDS = 15


async def _alerting_loop():
    """Evaluates thresholds on a slower cadence than the broadcast loop --
    alert conditions don't need 2-second resolution, and duration-based
    checks (a service down for N minutes) are measured in minutes
    anyway. Dispatches notifications only for newly-triggered alerts;
    re-evaluating an already-active one is silent
    (backend/alerting/evaluator.py) -- one incident notifies once."""
    while True:
        try:
            hosts, services = await asyncio.gather(provider.get_hosts(), provider.get_services())
            newly_triggered = alert_evaluator.evaluate(hosts, services, config_store.config.alerting)
            for alert in newly_triggered:
                for notifier_config in config_store.config.alerting.notifiers:
                    if not notifier_config.enabled:
                        continue
                    try:
                        result = await build_notifier(notifier_config).send(alert.title, alert.message)
                        logger.info("notifier %s for alert %s: %s", notifier_config.id, alert.id, result.message)
                    except Exception:  # noqa: BLE001 - one bad notifier must not break the others
                        logger.exception("notifier %s failed for alert %s", notifier_config.id, alert.id)
        except Exception:  # noqa: BLE001 - the alerting loop must never die
            logger.exception("alerting loop iteration failed")
        await asyncio.sleep(_ALERT_EVAL_INTERVAL_SECONDS)


@app.on_event("startup")
async def _on_startup():
    app.state.broadcast_task = asyncio.create_task(_broadcast_loop())
    app.state.alerting_task = asyncio.create_task(_alerting_loop())


@app.on_event("shutdown")
async def _on_shutdown():
    for attr in ("broadcast_task", "alerting_task"):
        task = getattr(app.state, attr, None)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
