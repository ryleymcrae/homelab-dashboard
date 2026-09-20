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
   `backend/persistence/history.py` (SQLite) at a lower frequency
   (`history.sample_interval_seconds`; `_record_history` in
   `backend/api/main.py`), for
   sparklines and the Devices/Network history charts. `GET
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
the exact same Home/Devices cards and Network entry — there is no
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

### Which host runs which service

`Service.host` (a host's `name`, matching `HostConfig.name` -- not
`HostInfo.id`, which is a server-computed slug) is what the Home page's
default layout uses to consolidate a host's services into its own card
(`frontend/src/pages/HomePage.tsx:servicesForHost`), rather than a
separate flat services list -- generically, by matching the configured
`host:` field, never by assuming which host "usually" runs a given
service. No adapter (Docker/systemd/HTTP/TCP/Prometheus) sets this field
itself -- each one only knows about the thing it's monitoring, not which
`hosts:` entry it happens to run on -- so `LiveProvider.get_services()`/
`get_service()` overlay it centrally from `ServiceConfig.host`, the one
place this mapping is applied, the same "one factory/one overlay point"
pattern used throughout this codebase. `DemoProvider`'s hand-written
fixtures (`backend/demo/generator.py`) set it directly since there's no
adapter layer to overlay onto. A service whose `host` doesn't match any
configured host (unset, typo, or a host since renamed/removed) is never
dropped -- it shows up in a separate "Other Services" section instead.

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
Metrics" on the Devices page — never as part of the live snapshot poll.

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
Layout settings, looks unchanged. Settings' Home Layout panel
(`frontend/src/pages/settings/LayoutSettings.tsx`)
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

How a host's CPU/Memory/Storage/Temperature are drawn is decided in one
place, `dashboard.metric_display` (`MetricDisplaySettings`), and read
through one module, `frontend/src/api/metrics.ts`: which styles each
metric supports (mirroring the per-metric `Literal` types in
`backend/config/schema.py`), the defaults, and `resolveMetricDisplay()`.
The host tile row -- `HostMetricTiles`, shared by Home's `HostCard` and
the Devices page instead of each building its own -- and Home's
`host_metric` widgets both render through the same `HostMetricTile`. A
widget's `display` can override the *style* for that one placement, never
the color, so there aren't two places configuring "how CPU looks". Every
tile is a button: it opens that host's Detailed Metrics on the Devices
page (`/devices?host=<id>`). The snapshot carries each host's effective
alert thresholds (`alertThresholds`, from
`backend/alerting/evaluator.py:merge_thresholds`), so the temperature
tile states the real limit rather than a hardcoded "hot" number.

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

### History charts

`frontend/src/charts/TimeSeriesChart.tsx` draws the Devices page's CPU &
Memory chart and the Network page's traffic chart. It renders at the
container's real pixel width (a stretched viewBox would distort the axis
text), with a left value axis and an optional right one for a series in
different units -- on the Devices page, CPU in % on the left and memory
converted from its stored percentage to bytes of the host's RAM on the
right, each labelled in its line's color (the Metric display colors).
Time ticks come from `charts/timeAxis.ts`, rounded and aligned in the
configured time zone (hourly on :00 local, daily on local midnight).
Before drawing, each series is reduced to a min/max pair per couple of
pixels, so a month of 30-second samples (~86k points) stays cheap on a Pi
without averaging away the spikes. Tap or hover shows the exact values at
that moment; the grid follows `dashboard.chart_grid`.

### Time zone and temperature unit: render-time only

`dashboard.timezone` and `dashboard.temperature_unit` never change what
the backend stores or sends -- timestamps stay ISO/UTC and temperatures
stay Celsius everywhere in the API, including alert messages and the
`temp_c` thresholds. `frontend/src/api/format.ts` is the one place both
are applied: App.tsx's `Shell` hands it the snapshot's preferences
during render (before any page formats anything), and every timestamp
and temperature on screen goes through its formatters -- the header
clock, alert/job/backup/check-in times, log lines, host tiles, Home
widgets. A temperature alert's message is re-rendered from its numeric
`value`/`threshold` rather than shown as the backend's Celsius string.
An unknown zone falls back to the browser's own instead of throwing.

### Branding and uploaded images

The logo, favicon, and nav tab icons (`dashboard.logo`/`favicon`/
`nav_icons`) are ordinary icon references, the same value type every
host/service icon already used: a glyph name, a URL, or a `/`-path.
Uploads didn't change that -- `POST /api/assets` stores the file in
`/data/assets` and returns `/api/assets/<content-hash>.<ext>`, which is
just another path, so nothing that renders icons needed to learn about
uploads. One picker (`frontend/src/components/IconPicker.tsx`) sets every
icon field. `GET /api/assets` reports where each image is referenced by
walking the config generically (`assets.references`), which is also what
blocks deleting an image still in use -- including from fields added
later. The favicon is set by App.tsx's `Shell` alongside theme and
accent (a glyph is drawn into an SVG in the accent color), and the
bottom nav's tab list (`NAV_TABS` in `BottomNav.tsx`) is the same list
Settings > Branding offers icons for.

## The Settings page

`frontend/src/pages/SettingsPage.tsx` is a shell -- search, category nav,
save queue -- around one component per category in
`frontend/src/pages/settings/`. Three conventions every new setting
follows:

- **Every setting is registered.** `settings/registry.ts` lists each
  category and each individual setting (`id`, label, synonyms), plus
  entries generated from config for things the user created (hosts,
  notifiers, connections, widgets). The search box ranks these, and the
  section component renders a `SettingRow`/`SettingBlock` with the same
  `id` as its scroll-and-highlight anchor. `frontend/tests/
  settingsRegistry.test.tsx` renders every category and fails if an entry
  has no matching anchor, so the two can't drift.
- **Settings are addressable.** Category and setting live in the URL
  (`#/settings?c=alerts&s=alerting.temp_c`, or just `?s=` -- the category
  is looked up), so any page can link straight to the setting that
  controls what it shows; the search box navigates the same way.
- **Saves are queued, and list edits are computed late.** Every change is
  still one `PATCH /api/config`, but they run one at a time, and an edit
  to a list (widgets, notifiers, connections, hosts) passes a function of
  the latest saved config rather than a precomputed list -- `PATCH`
  replaces lists wholesale, so two quick edits to the same list would
  otherwise have the second silently undo the first. Text/number fields
  keep a local draft and save once on blur/Enter, since each `PATCH`
  rewrites `config.yml` and rebuilds the provider.

- **Edits that span config go through one module.** A host or service is
  referenced elsewhere by `name` (a service's `host:`, the alert override
  maps) and by its derived `id` (Home widgets), so renames and removals
  are built by `settings/configEdits.ts` rather than inline: renaming a
  host moves its services and override along, then a second save
  re-points widgets at the new `id` -- read back from the saved config
  (`HostConfig.id`/`ServiceConfig.id`, computed server-side by
  `backend/config/schema.py:slug`), never re-derived in JS.

Every `config.yml` field is editable here; the only thing that isn't is
the password, which by design lives in the environment. Category
placement follows what a setting is *about*: identity (General), look
(Appearance), identity images and the upload library (Branding), the Home page (Home Layout), one machine (Devices --
including which integration feeds it), one service (Services),
thresholds, overrides, and notifiers (Alerts), network checks (Network),
demo mode and data-source connections (Integrations), who can act
(Access & Security), and version/stored history (About). A config field
that nothing reads doesn't get a control -- it gets removed (the old
`display:` section, `network.interface`, `health_check.interval_seconds`,
`integrations.*_enabled`), so every control on the page does what it
says.

### Config writes: what "set" means

`ConfigStore.update()` (`backend/config/loader.py`) merges a patch into
the fields that were actually *set* -- loaded from `config.yml` or
patched since -- not a full dump with defaults filled in, and writes
back only those. Pydantic's `model_fields_set` is load-bearing here: an
alert override replaces just the fields it names
(`backend/alerting/evaluator.py:merge_thresholds`), so a full dump
round-trip would pin every override's other fields to the built-in
defaults on the first unrelated save. For the same reason nulls aren't
blanket-dropped on write -- `temp_c: null` is how a threshold is turned
off, and dropping it would quietly turn it back on after a restart --
only nulls that restate a `None` default are. The override maps are
also serialized as only-set-fields (`AlertingConfig._overrides_as_set`),
so `GET /api/config` shows the UI which fields inherit, and are replaced
whole rather than merged on `PATCH` so an override or one of its fields
can actually be removed.

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
the Devices page's fleet-wide overview card. Every total is `Optional` and
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
by what the operator configured, not by `demo_mode`, so notifications
go out identically whether the underlying alert came from real or demo
data (a demo instance with a Discord notifier configured *will* post its
simulated alerts).

Each notifier makes one real HTTP request: a Discord webhook POST
(`{"content": ...}` with `allowed_mentions` emptied, so a host named
"@everyone" can't ping a server), an ntfy JSON publish to the server
root, a Pushover `api.pushover.net/1/messages.json` POST, or a generic
JSON webhook. Credentials are never in `config.yml` itself, only the
name of an environment variable holding them (`docs/security.md`), read
at send time; a missing variable, a refused request, or a network error
comes back as `NotifyResult(success=False, ...)` with a specific reason
-- never a crash, and never the webhook URL itself, since for Discord
the URL *is* the credential.

## Integrations: user-managed data source connections

A separate, newer concept from `integrations.docker_socket`, which
remains exactly what it was: the one always-available local Docker path
(systemd likewise always means the local host). `integrations.connections`
(`IntegrationConfig` in `backend/config/schema.py`) is instead a list of
explicit, user-managed connections — primarily for reaching a *remote*
host's data that those fixed flags can't: a remote host's own Docker API,
a Prometheus server, a node_exporter/Glances endpoint, or a host reached
over SSH. Managed entirely from Settings > Integrations (add/edit/remove/
test), the same way `alerting.notifiers` is managed from Settings >
Alerts.

`backend/integrations/base.py` mirrors `backend/notifications/base.py`'s
shape deliberately: one `Integration` ABC, one concrete class per `type`
(`DockerApiIntegration`, `PrometheusIntegration`, `NodeExporterIntegration`,
`SshIntegration`, `CustomScriptIntegration`), selected by
`build_integration()`. Every `test_connection()` is a real check from
the machine running the dashboard that changes nothing on the other end:
the Docker API is pinged and asked for its version, Prometheus for its
build info, a node_exporter/Glances URL is fetched and recognized by
what it returns, SSH authenticates with the key and runs no command
(`paramiko`), and a custom script is checked for existence and
permissions but never executed. `POST /api/integrations/{id}/test` calls it and records the
outcome; `GET /api/integrations` returns each connection's live status
(`connected`/`error`/`not_configured`) plus its last successful check-in
time, tracked in `backend/integrations/status.py` — deliberately
in-memory only, not persisted, since it's derived/transient state, the
same category as `docker_adapter.py`'s lazy `_client` singleton. The
connections themselves (type, name, per-type fields) are read/written
through the existing `GET`/`PATCH /api/config`, not a dedicated CRUD
endpoint — same convention as widgets and notifiers.

A host can optionally set `integration_id` (`HostConfig`, chosen per host
under Settings > Devices) to one of these connections — validated at the
`AppConfig` level (a `field_validator` on `integrations` with
`validate_default=True`, so the check still runs even when
`integrations:` itself is omitted) to ensure it references a connection
that actually exists. `docker_api` is the type wired so far, resolved in
one place (`AppConfig.docker_connection_for`) and supplying what Docker
actually knows rather than replacing everything:

- every `type: docker` service on that host is monitored and controlled
  through that API instead of the local socket
  (`backend/adapters/factory.py`), and container discovery for the host
  lists its containers;
- the host's Detailed Metrics add Docker's version, container counts,
  images, OS, and kernel;
- a host with **no agent** gets its status, CPU count, memory size, and
  OS from `docker info` instead of a bare ping. A local or agent host
  keeps those as its vitals source -- they measure usage, which Docker
  can't -- and nothing Docker doesn't report is filled in.

`backend/adapters/docker_adapter.py` keeps one client per endpoint
(`DockerEndpoint`: URL plus optional TLS files), dropped and reconnected
after a failed call. An assignment to any other type, or to a disabled
connection, is saved but leaves the host on its default collection --
Settings > Devices says which. A host or
integration removed while still referenced by the other is rejected by
this same validator, so `config.yml` can never end up with a dangling
reference — the Settings UI surfaces that rejection as a dismissable
error banner rather than silently discarding the change.

Wiring the remaining types into host data (querying Prometheus or
node_exporter for a host's vitals, SSH for host actions) is an addition
to `backend/collectors/hosts.py` and `LiveProvider`, not an architectural
change.

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
