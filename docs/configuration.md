# Configuration reference

`config.yml` is the canonical source of truth for your dashboard. Copy
`config.example.yml` to get started — it includes a worked example of
every field below. The full schema lives in `backend/config/schema.py`
if you want the authoritative source.

## `dashboard`

| Field | Default | Description |
|---|---|---|
| `title` | `My Homelab` | Shown in the header. Set from Settings → General. |
| `tagline` | none | Shown as the header subtitle; when unset, the header shows the current page's name there instead. Set from Settings → General. |
| `theme` | `dark` | `dark` or `light`. |
| `accent_color` | none | A hex color (e.g. `#8855ff`) overriding the default blue accent everywhere `--color-primary` is used. `null`/unset keeps the built-in theme color. Set from Settings → Appearance; the input is a color picker, and validation just requires a well-formed 6-digit hex. |
| `logo` | none | Top-bar logo — an icon value (see "Icons" below). Unset keeps the built-in ▲. Set from Settings → Branding. |
| `favicon` | none | Browser tab icon — an image, or a built-in glyph drawn in your accent color. Unset uses the same ▲ as the logo. Set from Settings → Branding. |
| `nav_icons` | `{}` | Bottom-bar icon per tab, keyed by `home`, `services`, `network`, `devices`, `alerts`, `settings`. A tab left out keeps its built-in glyph. Set from Settings → Branding. |
| `density` | `compact` | `compact` (default) or `comfortable` — a layout-wide spacing/font-size bump for easier touch/kiosk use, applied additively via `[data-density]` CSS overrides rather than a second copy of every component's styles. |
| `metric_display` | see below | How each host metric is drawn on the host cards (Home and Devices) and on `host_metric` widgets that don't set their own `display`. Set from Settings → Appearance → Metric display. |
| `chart_grid` | `true` | Background grid lines on the history charts (Devices page CPU/Memory, Network traffic). Toggle from Settings → Appearance, or from the Grid button on either chart — both change this same setting. |
| `timezone` | none | An IANA time zone (e.g. `Europe/London`) every clock and timestamp is shown in. Unset means each viewer's own browser zone, so a fresh install needs no setup. Set from Settings → General. |
| `temperature_unit` | `celsius` | `celsius` or `fahrenheit` — display only. Everything stored or sent by the backend stays Celsius (host temperatures, alerting's `temp_c` thresholds); Settings shows and accepts thresholds in the chosen unit and converts on save. Set from Settings → General. |
| `widgets` | `[]` | Home page layout — see "Dashboard layout (`widgets`)" below. An empty list means "use the default layout," not "show nothing." |

### `metric_display`

One entry per metric — the single place that decides how that metric
looks everywhere:

```yaml
dashboard:
  metric_display:
    cpu:  { style: sparkline, color: null }   # numeric | sparkline | gauge
    mem:  { style: sparkline, color: null }   # numeric | sparkline | gauge
    disk: { style: bar,       color: null }   # numeric | gauge | bar
    temp: { color: null }                     # always a number
```

`gauge` is a radial (circular, percent-filled) gauge; `sparkline` is the
number plus the last 6 hours of history; `bar` is the number plus a
horizontal fill bar. Only CPU and memory have history to draw, and
temperature has no natural 0–100 scale, so each metric only accepts the
styles listed. `color` is a `#rrggbb` hex applied to whichever graph is
showing (for a plain number, to the number itself); `null` follows the
theme. Tapping any metric tile opens that host's Detailed Metrics on the
Devices page.

## Dashboard layout (`widgets`)

By default, Home shows one card per host plus every visible service in
one grid — the same layout this app has always had. Setting
`dashboard.widgets` replaces that with an explicit, ordered list of
widgets instead, managed from Settings → Home Layout (add/remove/reorder with
up/down buttons). Each widget needs an `id` (unique), a `type`, and only
the fields that type uses:

| `type` | Required fields | Optional fields | Renders |
|---|---|---|---|
| `host_overview` | `host_id` | — | The same full host card shown on Home/Devices, for one host. |
| `host_metric` | `host_id`, `metric` | `display` (`numeric` \| `sparkline` \| `gauge` \| `bar`) | One metric (`cpu`, `mem`, `disk`, or `temp`) for one host. Without `display` it follows `metric_display` for that metric; with it, that style for this widget only (temperature can also be a `gauge` here). The color always comes from `metric_display`. A style the metric can't draw falls back to the `metric_display` one. |
| `services_grid` | — | `group` | The services grid, optionally filtered to one `group:`. Omit `group` for every visible service. |
| `fleet_overview` | — | — | The fleet-wide totals card (same as Devices page). |
| `custom_card` | `name`, `target_type` (`service` \| `host`), `target_id`, `action_kind` | `icon` | A shortcut card with a name/icon and one button wired to an existing service/host action (e.g. restart a container) — reuses that action's real label/confirm text, it doesn't define a new one. |

Every widget also has `visible` (default `true`) so it can be toggled
off without losing its configuration, and an optional `group` used only
by `services_grid`. `host_id`/`target_id` must match the `id` a
host/service is actually assigned (the slugified form shown in the
snapshot, not necessarily its `name:` verbatim) — the Home Layout settings UI
populates its dropdowns from live snapshot data specifically so you
can't wire a widget to an id that doesn't exist. Duplicate widget `id`s
are rejected at validation time, same as any other config error.

## `hosts`

A list of machines to monitor. Every host gets its own card on
Home/Devices and its own entry on the Network page — there's nothing
special about any single one of them. Exactly one should have
`is_local: true` — that's the machine running the dashboard backend,
which gets full metrics via native collectors. Every other host is
monitored either through `agent_url` (full metrics) or, if that's unset,
through reachability checks only (see `docs/architecture.md#hosts`).
Add, edit, rename, or remove hosts from Settings → Devices.

| Field | Required | Description |
|---|---|---|
| `name` | yes | Display name. Also the host's identity everywhere else: its id (the name lowercased, spaces to hyphens — shown in `GET /api/config` as `id`) is what widgets, history, and alerts refer to, so two names that only differ by case or spaces are rejected. Renaming from Settings carries along the services assigned to it, its alert override, and Home widgets pointing at it. |
| `address` | no | IP/hostname, for remote hosts. Also used for the reachability check on the Network page. |
| `model` | no | Free-text hardware description. |
| `icon` | no | See "Icons" below. |
| `is_local` | no | Marks the local machine. |
| `agent_url` | no | URL of a lightweight remote agent exposing the same metrics contract as `GET /api/hosts/{id}`. If unset, the host is monitored via reachability only. |

Each host's detail metrics (per-core CPU, per-partition disk usage, swap,
disk I/O throughput) are available on demand via `GET
/api/hosts/{id}/detail` — surfaced in the UI as a collapsed "Detailed
Metrics" section on the Devices page, rather than being part of the
every-2-second broadcast snapshot (too expensive to sample that often on
a Pi). A remote host with `agent_url` is expected to expose the matching
`{agent_url}/detail` endpoint too if you want detail metrics for it —
same contract as `GET /api/hosts/{id}/detail` on this backend.

## `services`

Each entry becomes a card on Home/Services and a detail page. `type`
selects the adapter and determines which other fields are required:

| `type` | Required fields | What it does |
|---|---|---|
| `docker` | `container` | Monitors/controls a Docker container by name. |
| `systemd` | `unit` | Monitors/controls a systemd unit. |
| `http` | `url` | Polls a URL, checks status code + latency. |
| `tcp` | `host_address`, `port` | Checks raw TCP connectivity + latency. |
| `prometheus` | `prometheus_url`, `prometheus_query` | Runs an instant query, surfaces the result. |
| `custom` | `plugin` | Delegates to a registered plugin — see `docs/plugins.md`. |

Common optional fields on any service: `icon`, `banner` (splash art —
see below), `group`, `description`, `host` (name of a host from
`hosts:`), `visible` (default `true`), `sort_order`,
`health_check.timeout_seconds` (default `3`).

Add, edit, rename, or remove services from Settings → Services (adding a
`docker` one lists the containers found on the local Docker socket to
pick from). A service's `type` is fixed once it exists — each type needs
different fields, so remove and re-add it to change type. Names follow
the same uniqueness rule as host names.

Setting `host` also determines which host's card a service is
consolidated under on the Home page's default layout (and a `host_overview`
widget, if you've customized layout) — a service with no `host` set, or one
that doesn't match any configured host's name, shows up in a separate
"Other Services" section instead of under any host, rather than being
silently dropped.

### `docker`/`systemd` metrics

Both adapters report as much as their platform actually exposes, and
never fabricate the rest:

- **docker**: uptime, CPU%, memory, port mappings (adjacent unremapped
  ports collapse into a range, e.g. `2456~2457 udp`, rather than
  listing each one twice), container/health state.
- **systemd**: unit state, uptime, description, main PID, CPU% (derived
  from a delta between polls — the first poll after startup won't have
  one yet), memory, task count, restart count.

Both also support **log viewing** (`docker logs` / `journalctl -u`) —
their service detail page shows a "View Logs" button automatically;
nothing to configure. Under the hood this is `GET
/api/services/{id}/logs`, gated by `ServiceAdapter.supports_logs()`
(`backend/adapters/base.py`) so other adapter types simply don't show
the button rather than erroring.

### `status_url` — player counts for docker/systemd game servers

A `docker` or `systemd` service that's actually a game server has no
way to report players/world state through Docker or systemd themselves
— those only know about the *process*, not what's happening inside it.
Set `status_url` to a JSON endpoint using the same contract as the
custom game-server plugin (`docs/plugins.md`):

```yaml
services:
  - name: Dragonwilds
    type: systemd
    unit: dragonwilds.service
    status_url: http://127.0.0.1:8211/status   # only if your server exposes one
```

Expected response: `{"online": true, "players": 3, "max_players": 10, "world_day": 128, "version": "1.2.3"}`
(all fields but `online` optional — only present fields become metrics).
This is purely additive: `status_url`'s `online` field is never used to
decide the service's online/offline status, which stays based on the
actual Docker/systemd process state. If your server has no such
endpoint, just omit `status_url` — the player-count row simply won't
appear, same as any other metric that isn't available.

### `a2s_port` — player counts via the Steam/Source query protocol

Most Steam-listed dedicated servers (Valheim, Enshrouded, and most other
Source-engine or Source-query-compatible games) have no JSON status API
at all, but do speak the **A2S query protocol** — the same one Steam
itself uses to populate the in-game server browser and player count.
Set `a2s_port` to that server's query port (usually its game port + 1;
check the server's own docs) instead of `status_url`:

```yaml
services:
  - name: Valheim
    type: docker
    container: valheim
    a2s_port: 2457            # Valheim's query port (game port 2456 + 1)
    # a2s_address: 127.0.0.1  # default; only change if the port isn't on this machine

  - name: Enshrouded
    type: docker
    container: enshrouded
    a2s_port: 15637           # Enshrouded's queryPort (see enshrouded_server.json)
```

Adds `players` (`current / max`), `map`, and `version` metrics — whatever
the server's A2S response actually includes. Same rule as `status_url`:
purely additive, never affects online/offline status, and a server that
doesn't answer the query just doesn't get those metrics rather than
erroring.

## `network`

| Field | Default | Description |
|---|---|---|
| `internet_target` | `1.1.1.1` | Host used for the Internet health check. Editable from Settings → Network; takes effect on the next poll. |
| `gateway_override` | auto-detected | Override the default gateway address. Editable from Settings → Network. |
| `devices` | `[]` | List of `{name, address, icon}` for the Network page — for network-only things that aren't full hosts (switches, sensors, IoT gadgets). Hosts declared under `hosts:` with an `address` already appear here automatically. Managed from Settings → Network. |

## `history`

| Field | Default | Description |
|---|---|---|
| `retention_days` | `14` | Samples older than this are deleted (minimum 1). |
| `sample_interval_seconds` | `30` | How often a history sample is stored (minimum 2). Live views still update every ~2 s. |
| `max_rows_per_series` | `50000` | Hard cap per metric series, regardless of age (minimum 100). At the default interval, 50,000 samples is ~17 days — keep this covering `retention_days`, or the cap trims history first. |

All three are editable from Settings → About and apply immediately, no
restart needed.

A `display:` section (auto-dim, screen timeout, `kiosk_url_path`) from
older versions is ignored if present — none of it was ever applied, and
it was removed rather than exposed as settings that do nothing.

## `integrations`

| Field | Default | Description |
|---|---|---|
| `docker_socket` | `unix:///var/run/docker.sock` | The local Docker socket every `type: docker` service (and container discovery) talks to. Editable from Settings → Integrations. |
| `connections` | `[]` | User-managed data source connections — see below. Separate from `docker_socket`, which stays local-only. |

Older configs may still have `docker_enabled`/`systemd_enabled`/
`prometheus_enabled` here; they were never read and are now ignored.
Whether Docker/systemd/Prometheus is used is simply whether you
configure a service of that type.

### `integrations.connections` — managed data source connections

Added/edited/removed from Settings > Integrations, primarily for
reaching a *remote* host's data the fixed local integrations above can't.
Adding one opens an unsaved draft with that type's fields; it's only
written to `config.yml` once its required fields are filled in:

| `type` | Required fields | Optional fields | What it's for |
|---|---|---|---|
| `docker_api` | `docker_url` | `docker_tls_cert_path`, `docker_tls_key_path`, `docker_tls_ca_path` | A remote (or alternate local) Docker Engine API, e.g. `tcp://host:2376`. TLS fields only apply to a `tcp://` url secured with Docker's client-cert TLS scheme. |
| `prometheus` | `prometheus_url` | — | A Prometheus server to query. |
| `node_exporter` | `metrics_url` | — | A node_exporter or Glances metrics/API URL. |
| `ssh` | `ssh_host`, `ssh_username`, `ssh_key_path` | `ssh_port` (default `22`) | A remote host reached over SSH, for command execution (host-level actions) and/or metric collection. Key-based auth only — there's deliberately no password field. |
| `custom_script` | `script_path` | — | A local script the backend invokes, expected to emit this app's own status/metrics JSON contract on stdout. |

Each connection also has `id` (unique), `name`, and `enabled`. Duplicate
`id`s are rejected, same as widgets/notifiers.

**Test Connection** (Settings, or `POST /api/integrations/{id}/test`)
makes a real check from the machine running the dashboard, changing
nothing on the other end:

| `type` | Checks |
|---|---|
| `docker_api` | Pings the API; reports the Docker version and how many containers are running. TLS files must exist on this machine. |
| `prometheus` | Fetches `/api/v1/status/buildinfo`; reports the version and how many scrape targets are up. |
| `node_exporter` | Fetches the URL and recognizes node_exporter metrics (`node_*` series) or a Glances API (JSON). |
| `ssh` | Logs in with the key — no command is run. A host key that contradicts `known_hosts` is refused; one not in `known_hosts` yet is reported with its fingerprint, not silently trusted. The key can't be passphrase-protected. |
| `custom_script` | Checks the file exists and is executable by the dashboard's user. It isn't run. |

**Credentials that are files, not values** (an SSH private key, a Docker
TLS client cert/key) are set here as an absolute filesystem path, never
as file content — the file itself must already exist on disk, readable
by the backend's service user, kept outside `config.yml`/version control.
This extends the existing "store a reference, not the secret" rule
(`docs/security.md`) from env-var names to file paths, for secrets that
are inherently files.

### Assigning an integration to a host

Add `integration_id: <connection id>` to an entry under `hosts:` — set
per host from Settings > Devices ("Data source"); each connection's card
under Settings > Integrations lists and links to the hosts using it.
**`docker_api` is the type that feeds host data so far:** that host's
`type: docker` services are monitored and controlled through its API
instead of the local socket (and adding one lists that host's
containers), its Detailed Metrics include Docker's, and — if the host
has no `agent_url` and isn't local — its status, CPU count, memory size,
and OS come from `docker info`. Other types, or a disabled connection,
are saved but don't change the host's collection yet.
Validated to reference a real connection id; a connection still assigned
to a host can't be removed until the host is unassigned first (same
validator, same reasoning as the duplicate-id checks above). Leave unset
to keep a host's existing behavior unchanged — this is an additional way
to source a host, not a replacement for `is_local`/`agent_url`.

## `auth`

No login is required by default. Set the `DASHBOARD_PASSWORD`
environment variable (never `config.yml` — see `docs/security.md`) to
require one for every client except those listed here:

| Field | Default | Description |
|---|---|---|
| `trusted_ips` | `[]` | IPs/CIDRs that skip login entirely — e.g. a kiosk touchscreen's LAN IP. Only takes effect when `DASHBOARD_PASSWORD` is set. Editable from Settings → Access & Security; each entry must be a valid address or range, and a match-everything range (`0.0.0.0/0`, `::/0`) is rejected. Once a password is set, changing this list requires logging in with it — see `docs/security.md`. |

## `guest_mode`

`false` by default. When `true`, viewing stays exactly as it already is
(governed by `auth`/`trusted_ips` above, unchanged), but every
*mutating* request — service/host actions, config edits, alert
acknowledge/mute/snooze, everything — is rejected with a 403 unless the
request carries a real, password-verified login session. Critically,
`auth.trusted_ips` does **not** count as a login for this purpose: a
kiosk on a trusted IP can view freely under guest mode but still can't
act without someone logging in on it first. A "Log In" button appears
in the header specifically for this — logging in there doesn't change
what's shown, only what's allowed.

Toggle it from Settings → Access & Security, which asks for
confirmation first — and spells out the lockout below when no password
is set. If `DASHBOARD_PASSWORD` isn't set,
guest mode has no login to grant admin rights against and **permanently
blocks all actions** until a password is configured (as an environment
variable — never in `config.yml`, see `docs/security.md`) — this is
deliberate fail-closed behavior for a kiosk-safety feature, not a bug;
if you get locked out this way, edit `config.yml` directly to set
`guest_mode: false` and restart, or set `DASHBOARD_PASSWORD` and log in.
See `docs/architecture.md` for the enforcement details.

## `alerting`

Thresholds are evaluated every ~15s against whatever the current
snapshot already contains — real or demo data, the same way everywhere
else in this app doesn't care which. A resource threshold (CPU/mem/disk/
temp) fires the moment it's crossed; "offline" conditions (a service
reporting down, a host unreachable) debounce for `offline_minutes`
first, so one missed poll doesn't become an alert. Severity is fixed,
not configurable: resource thresholds are `warning`, offline conditions
are `critical`.

```yaml
alerting:
  enabled: true
  defaults:
    cpu_percent: 90
    mem_percent: 90
    disk_percent: 90
    temp_c: 70
    offline_minutes: 5
  host_overrides:
    nas: { disk_percent: 95 }        # keyed by the host's `name:`
  service_overrides:
    Plex: { offline_minutes: 10 }    # keyed by the service's `name:`
  notifiers:
    - id: discord-main
      type: discord                  # discord | ntfy | pushover | webhook
      name: "Discord"
      enabled: true
      url_env: DISCORD_WEBHOOK_URL   # the *name* of an env var, never the URL itself
```

Set any threshold field to `null` (or omit it in an override, which
inherits the global default) to disable that one check — a host with no
temperature sensor should have `temp_c: null` rather than a number that
can never be honestly compared against. `host_overrides`/`service_overrides`
only need to set the fields they're actually changing; everything else
falls back to `defaults`. Service overrides only use `offline_minutes` —
the resource thresholds are evaluated per host.

Everything here is editable from Settings → Alerts, including overrides:
each threshold in an override is **Default** (key omitted — follows
`defaults`, even when those change later), **Off** (`null`), or
**Custom** (a number).

Notifier credentials (Discord/generic webhook URLs, Pushover keys) are
never written to `config.yml` directly — only the name of an environment
variable holding the real value (`url_env`, `pushover_user_key_env`,
`pushover_api_token_env`), matching this project's existing rule of
keeping secrets out of version-controlled config (`docs/security.md`).
ntfy's server/topic aren't treated as secrets, since a topic is
obscurity, not authentication.

Every notifier sends for real — "Send Test" in Settings and triggered
alerts alike. The environment variables have to be set where the
dashboard's backend runs: an `Environment=`/`EnvironmentFile=` line in
the systemd unit (`deploy/systemd/homelab-dashboard.service`), or
`environment:` in `docker-compose.yml`, then restart it. For Discord,
create the webhook under the channel's **Server Settings → Integrations
→ Webhooks** and put its URL in the variable `url_env` names (e.g.
`DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/…`). Mentions in
alert text are disabled, so nothing in a host or service name can ping
the server.

## `demo_mode`

`true` routes the entire API to simulated data (`backend/demo/generator.py`)
instead of real collectors. Useful for development, screenshots, or
trying the dashboard before configuring anything real. Toggle it from
Settings → Integrations. The demo shows its own simulated hosts and
services, so edits under Settings → Devices/Services are saved but only
show up once demo mode is off.

## Icons

Everywhere an icon can be set — the logo, favicon, and nav tabs
(Settings → Branding), each host (Devices), each service (Services),
each network device (Network), and custom-card widgets (Home Layout) —
opens the same picker with three sources:

- **Your images** — upload a PNG, JPEG, GIF, WebP, or ICO file (up to
  2 MB) right from the picker. It's stored under `/data/assets/` (set
  `DASHBOARD_ASSETS_DIR` to move it) and referenced from `config.yml` as
  `/api/assets/<name>`, a name derived from the file's content — so
  `config.yml` still only holds a reference, never image data, and
  uploading the same file twice doesn't store it twice. Uploaded images
  are listed, with where each is used, under Settings → Branding →
  Uploaded images; an image can't be deleted while anything still uses
  it. SVG isn't accepted (see `docs/security.md`).
- **Built-in** — a keyword (`server`, `docker`, `film`, `home`, `flame`,
  `router`, `star`, ...) from a small glyph set in
  `frontend/src/api/icons.ts`. Unrecognized names fall back to a
  generic icon — nothing ever breaks from a typo.
- **A URL or path** — anything starting with `http://`, `https://`, or
  `/` is shown as an image. Paths into `frontend/public/` (e.g.
  `/icons/plex.png`) still work, but only once the frontend has been
  rebuilt and redeployed with the file in it — uploading avoids that.

If an image fails to load, a generic glyph is shown instead of a broken
image.

## Splash art (`banner`)

Each service can also declare a `banner` — an uploaded image, URL, or
`/`-rooted path (same picker as icons, minus the glyphs) to a wide
splash-art image. On that
service's detail page, the name/status/player-count sit in a plain
header row above it, and the image (with the icon overlaid bottom-left
on a gradient scrim) sits in a left column next to the metrics table,
with the action buttons underneath it. Services without a `banner` just
get the plain icon/name/status row and stacked buttons/metrics they
always had — a 16:9-ish aspect ratio (e.g. 960×540) crops most cleanly
for the image itself.

## Editing from the UI

Every field in this document is editable from the Settings page, via
`PATCH /api/config`. The one exception is deliberate: the password is an
environment variable (`DASHBOARD_PASSWORD`), never `config.yml` (see
`docs/security.md`). The search box finds any individual setting — or
any host, service, notifier, or override by name. Text and number fields
save once when you leave the field or press Enter, not on every
keystroke.

Every change is validated against the same schema before `config.yml`
is atomically rewritten — an invalid change is rejected and the file on
disk is never left partially written. The rewritten file keeps only what
was actually set (plus what you changed), under the names this document
uses (`host_address`, not its internal name), so a `null` that means
something — a disabled threshold — survives a restart. Under
`guest_mode`, `PATCH /api/config` is itself a mutating request and is
gated the same as any other admin action.

`PATCH` merges dictionaries and replaces lists. The two alert override
maps (`alerting.host_overrides`/`service_overrides`) and
`dashboard.nav_icons` are the exception: they're replaced whole, since
merging could never remove an entry — and `null` can't mean "remove" for
an override, it already means "disabled".
