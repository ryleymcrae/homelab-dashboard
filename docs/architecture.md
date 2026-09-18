# Architecture

## The core boundary

The frontend talks to exactly one thing: the Dashboard API. It never
imports or knows about Docker, systemd, psutil, Prometheus, or any other
collection technology.

```
Frontend (React)
   │  REST + WebSocket
   ▼
Dashboard API (FastAPI)
   │
   ▼
DashboardProvider          (backend/providers/base.py) — one instance, chosen once
   │
   ├── LiveProvider          (backend/providers/live.py) — demo_mode: false
   │      ├── Host collector        (backend/collectors/hosts.py)    — every configured host
   │      ├── System collector      (backend/collectors/system.py)   — psutil, for the local host
   │      ├── Network collector     (backend/collectors/network.py)  — sockets, /proc
   │      ├── Docker adapter        (backend/adapters/docker_adapter.py)
   │      ├── systemd adapter       (backend/adapters/systemd_adapter.py)
   │      ├── HTTP adapter          (backend/adapters/http_adapter.py)
   │      ├── TCP adapter           (backend/adapters/tcp_adapter.py)
   │      ├── Prometheus adapter    (backend/adapters/prometheus_adapter.py)  — optional
   │      └── Custom plugins        (backend/plugins/)
   │
   └── DemoProvider          (backend/providers/demo.py) — demo_mode: true
          └── Simulated data        (backend/demo/generator.py)
```

Every collector/adapter translates whatever it talks to into the generic
models in `backend/models/core.py`:

- `Service` — a Docker container, systemd unit, HTTP endpoint, TCP
  target, or plugin, all represented identically.
- `HostInfo` — a monitored machine.
- `NetworkTarget` / `NetworkTraffic` — network health and throughput.
- `Metric` — one labeled value with a semantic `MetricType` the frontend
  uses to pick a rendering widget (gauge, sparkline, plain text...)
  without knowing what produced the value.
- `Action` — a capability (`start`/`stop`/`restart`) a service exposes.
  The frontend renders only the actions actually present; it never
  assumes every service has the same controls.
- `FailureDetail` — the *reason* something is unhealthy. A host being
  unreachable, Docker being down, and a service reporting `unhealthy`
  are different failure modes with different messages, not "Offline"
  three times.

## Why this matters

The same `ServiceCard` and `ServiceDetail` React components render a
Docker container, a systemd unit, an HTTP check, and a Minecraft server
identically, because by the time data reaches the frontend it has
already been reduced to the same vocabulary. Adding a tenth integration
type never requires frontend changes — only a new adapter that emits
`Service` objects.

## Request flow

1. On startup, `ConfigStore` loads and validates `config.yml` against the
   Pydantic schema in `backend/config/schema.py`.
2. `backend/providers/factory.py:select_provider()` constructs the one
   `DashboardProvider` the whole app will use for this run -- a
   `LiveProvider` normally, or a `DemoProvider` if `demo_mode: true`. This
   is the only place that branches on `demo_mode`; nothing downstream of
   it does. `LiveProvider` in turn builds one adapter instance per
   configured service (`backend/adapters/factory.py`) and drives
   `backend/collectors/hosts.py` for every entry under `hosts:`, through
   whichever of the three collection paths applies (local psutil, remote
   agent, or reachability-only) -- none of them is treated as more "real"
   than the others by the provider, API, or frontend.
3. The FastAPI app (`backend/api/main.py`) calls the provider and exposes
   REST endpoints for initial page loads and a WebSocket broadcast loop
   that pushes a fresh snapshot to all connected clients every ~2 seconds.
4. The broadcast loop also samples select metrics into
   `backend/persistence/history.py` (SQLite) at a lower frequency, for
   sparklines and the System/Network history charts. `GET
   /api/history/{series}` reads back through
   `DashboardProvider.get_history()` rather than that store directly --
   `LiveProvider` queries it, `DemoProvider` synthesizes a plausible
   backfilled series instead, so a chart looks fully populated at every
   selectable range even seconds after the demo process started.
5. Actions (start/stop/restart) go through
   `DashboardProvider.execute_service_action()`, which for `LiveProvider`
   calls `backend/actions/executor.py` -- validating the action is one the
   target adapter actually advertises before calling into it, and the
   adapter re-checks real state afterward rather than trusting the
   command succeeded. `DemoProvider` rejects every action outright: there
   is nothing real to change the state of.

## Failure isolation

Every collector/adapter call in the snapshot-assembly path
(`_services_snapshot` in `backend/api/main.py`) is wrapped so a single
broken integration — Docker socket missing, one systemd unit gone, one
dead HTTP endpoint — degrades that one service to `unknown`/`offline`
with a `FailureDetail`, without preventing the rest of the snapshot from
being assembled and served.

## Hosts

Every entry under `hosts:` produces a `HostInfo` and is rendered with
the exact same Home/System cards and Network entry — there is no
first-class "local host" special-cased anywhere above the collector
layer. `backend/collectors/hosts.py` picks one of three collection
strategies per host, all producing the same `HostInfo` shape:

- **Local** (`is_local: true`): native psutil collectors
  (`backend/collectors/system.py`), full metrics.
- **Remote with `agent_url`**: an HTTP GET to that URL, expected to
  return the same metrics contract as `GET /api/hosts/{id}` on this
  backend (same field names as `HostInfo.to_dict()`). Full metrics if
  reachable; `offline` with a `FailureDetail` if not.
- **Remote without `agent_url`**: reachability only, via the same TCP
  connect check used for services and network devices. Metric fields
  stay `None` (never fabricated) and render as "unavailable", exactly
  like a missing temperature sensor on the local host.

Hosts with an `address` are also reused on the Network page
automatically (`kind: "host"`) — no need to redeclare them under
`network.devices`, which is reserved for network-only things that
aren't full hosts (switches, sensors, IoT gadgets).

The header's overall status pill (`overallStatus` in the snapshot) is
the worst status across every host, not just the local one.

## The provider abstraction

`backend/api/main.py` never asks "is this demo mode?" -- it asks the one
`DashboardProvider` it was handed at startup (`provider` at module level)
for hosts, services, network state, logs, actions, history, and the fleet
summary, and doesn't know or care whether the answer came from real
collectors or `backend/demo/generator.py`. `LiveProvider` and
`DemoProvider` (`backend/providers/live.py` / `backend/providers/demo.py`)
both implement the exact same `backend/providers/base.py:DashboardProvider`
interface; `select_provider()` picks one, once, and a config-patch that
flips `demo_mode` at runtime rebuilds it (`backend/api/main.py:patch_config`).

This sits one level above `ServiceAdapter`: a `ServiceAdapter` is one
instance per configured *service* (chosen by `type:`); a
`DashboardProvider` is one instance for the *whole dashboard* (chosen by
`demo_mode` today). A future provider -- e.g. one that pulls an entire
fleet's metrics from a central Prometheus instead of per-host collectors
-- plugs in at `select_provider()` alone; nothing in `backend/api/main.py`
or the frontend has to change.

Errors are typed rather than HTTP-coded at the provider boundary
(`NotFoundError`, `ActionError`, `LogsUnsupportedError`, `LogsError` in
`backend/providers/base.py`), so both providers raise the same exceptions
for the same situations and `backend/api/main.py` maps them to status
codes in exactly one place per route, regardless of which provider is
live.

## Two-tier metrics: broadcast snapshot vs. on-demand detail

The 2-second broadcast loop assembles a full snapshot every tick, so
anything in it has to stay cheap on a Raspberry Pi. Deeper, more
expensive metrics (per-core CPU, per-partition disk usage, disk I/O
throughput) live in a separate on-demand tier instead: `GET
/api/hosts/{id}/detail`, backed by `HostInfo.metrics` (the same open
`Metric` list `Service` already used) rather than more fixed fields,
since the set of "deep" metrics varies far more than the always-shown
ones. The frontend only fetches this when a user expands "Detailed
Metrics" on the System page — never as part of the live snapshot poll.

## Logs as an adapter capability

`ServiceAdapter.supports_logs()`/`get_logs()` (`backend/adapters/base.py`)
follow the same pattern as `get_supported_actions()`: a capability an
adapter opts into, mirrored onto `Service.has_logs` so the frontend shows
a "View Logs" control only where it's meaningful, without special-casing
adapter types. Currently implemented by the Docker (`docker logs
--timestamps`) and systemd (`journalctl -u`) adapters.

## Authentication gate

A single shared password (`DASHBOARD_PASSWORD` env var), checked by
`backend/auth.py` via an HTTP middleware in front of every route except
`/api/health`, `/api/auth/login`, and `/api/auth/status` — plus a
WebSocket-handshake check in `ws_endpoint`, since ASGI HTTP middleware
does not run for the websocket scope. Disabled by default; see
`docs/security.md` for the full model, including the `auth.trusted_ips`
kiosk bypass and `guest_mode`.

## Guest mode: a stricter, orthogonal gate on top of auth

`guest_mode` (`AppConfig.guest_mode`) answers a different question than
the auth gate above: not "is viewing allowed?" but "is this specific
request allowed to *act*?" `backend/auth.py:is_admin()` is deliberately
narrower than `is_authenticated()` — it returns `True` only for a
session token that survives `verify_session_token()`, i.e. a real,
password-verified login. It does **not** treat `auth.trusted_ips` or "no
password configured" as admin, even though both of those count as
"authenticated" for viewing purposes. That asymmetry is the whole point:
a kiosk tablet on a trusted IP can view everything under guest mode, but
still can't click Restart without someone actually logging in on it
first.

Enforcement lives in the same `_auth_gate` middleware as the base auth
check (`backend/api/main.py`), as a second, later check: if `guest_mode`
is on, the method is mutating (`POST`/`PATCH`/`PUT`/`DELETE`), the path
isn't `/api/auth/login` or `/api/auth/logout`, and `is_admin()` is
`False`, the request is rejected with 403 before it reaches the route
handler — the same single-choke-point pattern the base auth gate already
uses, not a second parallel mechanism route handlers have to remember to
call. `GET /api/auth/status` exposes `guestMode`/`isAdmin` so the
frontend can hide or disable admin controls proactively, but the backend
never trusts the frontend's judgment — every mutating endpoint is
covered by the same gate regardless of what a client renders.

If no `DASHBOARD_PASSWORD` is configured at all, guest mode has nothing
to verify a login against, so it fails closed: actions stay blocked
permanently until a password is set (in the environment, not
`config.yml` — see `docs/security.md`) and someone actually logs in.
This is intentional — a kiosk-safety feature that could be defeated by
just not setting a password would not be a safety feature.

## Dashboard customization: widgets, theming, custom cards

The Home page layout is data, not code: `DashboardSettings.widgets`
(`backend/config/schema.py`) is an ordered list of `WidgetConfig`
entries, each naming a `type` (`host_overview`, `host_metric`,
`services_grid`, `fleet_overview`, `custom_card`) plus only the fields
that type actually needs (a `host_metric` widget needs `host_id` +
`metric` + `display`; a `services_grid` widget only optionally needs a
`group` filter; a validator on `DashboardSettings` in `schema.py`
enforces each type's required fields and rejects duplicate widget
`id`s). `frontend/src/pages/HomePage.tsx`'s `Widget` component is a
straight dispatch on `type` — adding a widget type means adding one
case there and one branch in the schema validator, not a generic
plugin system, matching this codebase's general preference for building
around what actually exists over speculative extensibility.

An **empty** `widgets` list is the default and is handled specially:
`HomePage.tsx` falls back to the exact pre-customization layout (one
`HostCard` per host, then the full services grid) rather than rendering
zero widgets — so a fresh install, or any install that never opens
Layout settings, looks unchanged. Settings' `LayoutSettings` panel
manages this list (add/remove/reorder via up/down buttons — no
drag-and-drop library was introduced, since a touch kiosk is this
app's least forgiving input target and up/down arrows can't misfire the
way a drag gesture can on a small screen) and, notably, builds its
host/service pickers from the live `snapshot.hosts`/`snapshot.services`
(server-computed `id`s) rather than raw `config.hosts`/`config.services`
(human-entered `name`s) — the two can differ once a name is slugified,
and a widget wired to the wrong id would silently render nothing.

`custom_card` widgets (`CustomCardWidget` in
`frontend/src/components/HomeWidgets.tsx`) are a shortcut, not a new
action mechanism: they point at an existing `target_type`/`target_id`/
`action_kind` (e.g. "restart the `plex` service") and reuse
`useActionDetails` — the same hook `AlertsPage` uses for its suggested
actions — to fetch the real `ConfirmableAction` (label, confirm text,
destructiveness) from the service/host's actual declared actions, so a
custom card's confirm dialog is never out of sync with what the action
really does.

Theme customization (`accent_color`, `density` on `DashboardSettings`)
is additive to the existing token system rather than a restructuring:
`frontend/src/api/color.ts` derives the `--color-primary`/
`-strong`/`-soft` custom properties from one hex value and applies them
via inline styles on the document root (`applyAccentColor`), and
`[data-density="comfortable"]` in `frontend/src/themes/tokens.css`
overrides the same spacing/font-size tokens components already
reference — no component needed to learn about "custom color" or
"density" as new concepts. Fixing these was also how a real pre-existing
bug surfaced: `main.tsx` hardcoded `data-theme="dark"` at boot and never
synced from config; `App.tsx`'s `Shell` component now applies
`data-theme`/`data-density`/accent color from the snapshot on every
update instead.

## Admin actions: audit log, simulated transitions, config/image state

Every action that changes something (`POST /api/services/{id}/actions/*`,
`PATCH /api/services/{id}/config`, `POST /api/hosts/{id}/actions/*`,
`POST /api/hosts/{id}/jobs/{job_id}/run`) is logged to
`backend/persistence/audit.py` -- who (the most specific identity
actually available today; see `backend/auth.py:describe_actor`), what,
which target, and the outcome, whether it succeeded or not. There's only
one operator today, but the schema doesn't change when real per-user
accounts exist later -- `actor` just starts holding a username.

`DemoProvider`'s actions are real state transitions, not instant
no-ops: `backend/demo/runtime.py` holds per-service status, restart
count, staged (pending) config, and image version, all as a
module-level singleton shared across requests (like
`docker_adapter.py`'s lazy `_client`) so a simulated stop/restart/update
persists for the life of the process. A running action sets `Status.
WARNING` immediately (visible to any concurrent poll of the services
list, not just the dialog that triggered it), sleeps a delay
proportional to what the real action would take, then settles -- no new
transitional status was introduced anywhere in the stack.

Config edits (env vars, resource limits, restart policy) never apply
immediately: `PATCH /api/services/{id}/config` stages a `pending`
`ContainerConfig` distinct from the currently-`applied` one, and it only
becomes applied when the service is next started or restarted --
because a real container would need recreating to pick up new env
vars/limits, "pending until restart" isn't a UI nicety, it reflects what
the underlying technology actually requires. The frontend computes the
before/after diff shown in the save-confirmation dialog itself
(`frontend/src/api/configDiff.ts`) from the two `ContainerConfig`
snapshots already in hand -- no dedicated diff endpoint.

Image update/rollback (`ActionKind.UPDATE`/`ROLLBACK`) follow the same
"only show the action when it currently applies" rule real adapters use
for start/stop/restart: `backend/providers/demo.py`'s overlay adds an
`update` action only when a newer version is available, and a
`rollback` action only once an update has actually been applied -- both
computed from `backend/demo/runtime.py`'s per-service `ImageState`, not
declared statically in `backend/demo/generator.py` (which can't know
what's currently true).

None of this exists yet for `LiveProvider`: real config editing and
image update/rollback need a container recreation this codebase doesn't
implement against Docker yet, so `LiveProvider.get_service_config()`/
`update_service_config()` raise `ConfigUnsupportedError` and no real
adapter sets `Service.has_config` -- honest rather than faked, the same
"never fabricate" rule as a missing temperature sensor.

## Host-level actions, scheduled jobs, backup tracking

A step up in blast radius from container actions -- a reboot or a
Docker daemon restart affects every service on a host at once -- so this
is deliberately a fixed whitelist, `HostActionKind`
(`backend/models/core.py`), never a free-form command: reboot, Docker
prune, restart the Docker daemon, clear the package cache, run a backup.
Each `HostInfo` carries its own `actions: list[HostAction]`, same
"render only what's actually present" rule as `Service.actions` -- a
reachability-only host with no agent gets none, since there's nothing to
execute anything through.

The two actions that can take down every service on a host at once
(reboot, restart-docker) set `HostAction.require_typed_confirmation` to
the host's own name -- `ConfirmDialog` (shared with every other
confirmation in this app, container or host) won't enable its confirm
button until that exact string is typed. This is a stronger version of
the same dialog everything else uses, not a separate mechanism.

`DemoProvider`'s host actions go through the exact same
`backend/demo/runtime.py` machinery as container actions -- a
transitional status, a realistic delay, then a settled outcome -- but
add two things container actions don't need:

- **A visible failure path.** Each action kind has a fixed chance of
  failing outright (`_HOST_ACTION_FAILURE_CHANCE`), and a reboot that
  fails leaves the host `Status.OFFLINE` with a `FailureDetail`-shaped
  result, not just a red toast that disappears -- `HostInfo.
  last_action_result` (an `ActionResult`) persists until the next action
  replaces it, and the frontend renders it as a dismissable banner, not
  an ephemeral one.
- **Scheduled jobs and backup status share the same execution path.**
  `GET /api/hosts/{id}/jobs` lists `ScheduledJob`s seeded with a
  plausible last/next run; "Run Now"
  (`POST /api/hosts/{id}/jobs/{job_id}/run`) doesn't have its own
  execution logic -- it looks up the job's `action_kind` and calls the
  identical `run_host_action` a direct button-click would, so a
  scheduled backup and a manually-triggered one are indistinguishable
  once they've run. `GET /api/hosts/{id}/backup` returns `null` (not an
  empty/zeroed object) for a host with no backup tracking configured at
  all -- distinct from a `BackupStatus` that's just never succeeded yet.

Like container config/image state, none of this exists for
`LiveProvider` yet: real reboot/prune/backup execution against a remote
host needs SSH or an agent this codebase doesn't have, so every
`LiveProvider` host action raises `ActionError` and `HostInfo.actions`
stays empty for every real host.

## Fleet overview

`GET /api/fleet` (`DashboardProvider.get_fleet_summary()`) aggregates
totals across every host/service this provider knows about -- cores,
memory, storage, containers running, power draw where available -- for
the System page's fleet-wide overview card. Every total is `Optional` and
omitted rather than fabricated when it can't be honestly computed (e.g.
`total_power_draw_w` stays `null` for `LiveProvider` until a real
power-sensing collector exists), the same "never fabricate" rule as
everywhere else in this codebase.

## Alerting and notifications

Deliberately **not** part of the `DashboardProvider` split -- threshold
evaluation (`backend/alerting/evaluator.py`) reads whatever `HostInfo`/
`Service` objects the current snapshot already contains and compares
them to configured thresholds, with no idea (or need to know) whether
they came from `LiveProvider` or `DemoProvider`. The only thing that
differs between real and simulated alerting is whether the metrics
*themselves* occasionally cross a threshold -- `backend/demo/
generator.py`'s host CPU/memory/temperature waves have deliberate
occasional larger spikes (`_with_spikes`, tuned so they cross the
90%/90%/70°C defaults a few percent of the time) specifically so the
full trigger -> notify -> history -> acknowledge lifecycle is exercisable
in demo mode without waiting on a real incident. Disk usage isn't spiked
the same way -- real disk usage doesn't move in transient bursts, so
faking that would be less realistic, not more.

A separate `_alerting_loop()` (backend/api/main.py) evaluates on a
15-second cadence -- deliberately slower than the 2-second broadcast
loop, since alert conditions don't need sub-second resolution and
duration-based ones are measured in minutes regardless. Re-evaluating an
already-active alert is silent; only a fingerprint's first transition
into "triggered" dispatches a notification, so one incident notifies
once, not every evaluation tick.

Each alert is deduplicated by a fingerprint
(`<target_type>:<target_id>:<metric>`, e.g. `host:ziri-mini:cpu_percent`)
enforced at the SQLite layer with a partial unique index (`backend/
persistence/alerts.py`) -- re-triggering the same condition updates the
existing row's value/timestamp rather than creating a new one, while a
resolved-then-retriggered condition correctly starts a new history
entry. Acknowledge/mute/snooze only ever change state a human explicitly
set; re-evaluation never touches them.

### Notifiers: a second, orthogonal provider-shaped abstraction

`backend/notifications/base.py` mirrors `backend/providers/base.py`'s
shape on purpose -- one `Notifier` ABC, one concrete class per real-world
integration (Discord, ntfy, Pushover, generic webhook), selected by
`NotifierConfig.type` through `build_notifier()`, the same "one factory
function maps a type string to a class" role `adapters/factory.py` and
`providers/factory.py` both play. It's a *separate* abstraction from
`DashboardProvider`, not a mode of it -- which notifiers exist is chosen
by what the operator configured, not by `demo_mode`, so real Discord
notifications (once implemented) should work identically whether the
underlying alert came from real or demo data.

None of the four concrete notifiers call out to a real service yet --
each one simulates a delay and a plausible outcome, and each class's
docstring says exactly what the real HTTP call would look like (a
Discord `{"content": ...}` POST, an ntfy plaintext POST with a Title
header, a Pushover `api.pushover.net/1/messages.json` POST, a generic
JSON webhook). Implementing one for real later is a change to that one
class alone -- the evaluator, the API routes, and the Settings UI
wouldn't need to change at all. Credentials are never in `config.yml`
itself, only the name of an environment variable holding them
(`docs/security.md`); a missing env var is reported back through the
same `NotifyResult(success=False, ...)` shape as a simulated failure,
not a crash.

## Extensibility

New integrations plug in at one of three points:

- **Adapters** for entirely new technologies (implement
  `backend.adapters.base.ServiceAdapter`, register in
  `backend/adapters/factory.py`).
- **Plugins** for a specific third-party service without touching core
  code (implement `backend.plugins.base.PluginAdapter`, register with
  `@register_plugin("name")`, reference it from `config.yml` with
  `type: custom` — see `docs/plugins.md`).
- **Providers** for an entirely different way of sourcing the whole
  dashboard's data at once (implement
  `backend.providers.base.DashboardProvider`, wire it into
  `backend/providers/factory.py:select_provider()`) — see "The provider
  abstraction" above.
