# Configuration reference

`config.yml` is the canonical source of truth for your dashboard. Copy
`config.example.yml` to get started — it includes a worked example of
every field below. The full schema lives in `backend/config/schema.py`
if you want the authoritative source.

## `dashboard`

| Field | Default | Description |
|---|---|---|
| `title` | `My Homelab` | Shown in the header. |
| `tagline` | none | Shown as the header subtitle. |
| `theme` | `dark` | `dark` or `light`. |
| `accent_color` | none | A hex color (e.g. `#8855ff`) overriding the default blue accent everywhere `--color-primary` is used. `null`/unset keeps the built-in theme color. Set from Settings → Display; the input is a color picker, and validation just requires a well-formed 6-digit hex. |
| `density` | `compact` | `compact` (default) or `comfortable` — a layout-wide spacing/font-size bump for easier touch/kiosk use, applied additively via `[data-density]` CSS overrides rather than a second copy of every component's styles. |
| `widgets` | `[]` | Home page layout — see "Dashboard layout (`widgets`)" below. An empty list means "use the default layout," not "show nothing." |

## Dashboard layout (`widgets`)

By default, Home shows one card per host plus every visible service in
one grid — the same layout this app has always had. Setting
`dashboard.widgets` replaces that with an explicit, ordered list of
widgets instead, managed from Settings → Layout (add/remove/reorder with
up/down buttons). Each widget needs an `id` (unique), a `type`, and only
the fields that type uses:

| `type` | Required fields | Optional fields | Renders |
|---|---|---|---|
| `host_overview` | `host_id` | — | The same full host card shown on Home/System, for one host. |
| `host_metric` | `host_id`, `metric` | `display` (`gauge` \| `sparkline` \| `numeric`, default `gauge`) | One metric (`cpu`, `mem`, `disk`, or `temp`) for one host, in the chosen style. |
| `services_grid` | — | `group` | The services grid, optionally filtered to one `group:`. Omit `group` for every visible service. |
| `fleet_overview` | — | — | The fleet-wide totals card (same as System page). |
| `custom_card` | `name`, `target_type` (`service` \| `host`), `target_id`, `action_kind` | `icon` | A shortcut card with a name/icon and one button wired to an existing service/host action (e.g. restart a container) — reuses that action's real label/confirm text, it doesn't define a new one. |

Every widget also has `visible` (default `true`) so it can be toggled
off without losing its configuration, and an optional `group` used only
by `services_grid`. `host_id`/`target_id` must match the `id` a
host/service is actually assigned (the slugified form shown in the
snapshot, not necessarily its `name:` verbatim) — the Layout settings UI
populates its dropdowns from live snapshot data specifically so you
can't wire a widget to an id that doesn't exist. Duplicate widget `id`s
are rejected at validation time, same as any other config error.

## `hosts`

A list of machines to monitor. Every host gets its own card on
Home/System and its own entry on the Network page — there's nothing
special about any single one of them. Exactly one should have
`is_local: true` — that's the machine running the dashboard backend,
which gets full metrics via native collectors. Every other host is
monitored either through `agent_url` (full metrics) or, if that's unset,
through reachability checks only (see `docs/architecture.md#hosts`).

| Field | Required | Description |
|---|---|---|
| `name` | yes | Display name. |
| `address` | no | IP/hostname, for remote hosts. Also used for the reachability check on the Network page. |
| `model` | no | Free-text hardware description. |
| `icon` | no | See "Icons" below. |
| `is_local` | no | Marks the local machine. |
| `agent_url` | no | URL of a lightweight remote agent exposing the same metrics contract as `GET /api/hosts/{id}`. If unset, the host is monitored via reachability only. |

Each host's detail metrics (per-core CPU, per-partition disk usage, swap,
disk I/O throughput) are available on demand via `GET
/api/hosts/{id}/detail` — surfaced in the UI as a collapsed "Detailed
Metrics" section on the System page, rather than being part of the
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
`health_check.interval_seconds`, `health_check.timeout_seconds`.

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
| `interface` | auto-detected | Override the active network interface. |
| `internet_target` | `1.1.1.1` | Host used for the Internet health check. |
| `gateway_override` | auto-detected | Override the default gateway address. |
| `devices` | `[]` | List of `{name, address, icon}` for the Network page — for network-only things that aren't full hosts (switches, sensors, IoT gadgets). Hosts declared under `hosts:` with an `address` already appear here automatically. |

## `history`

| Field | Default | Description |
|---|---|---|
| `retention_days` | `14` | Samples older than this are deleted. |
| `sample_interval_seconds` | `30` | How often to persist a sample (live updates are more frequent). |
| `max_rows_per_series` | `50000` | Hard cap per metric series, regardless of age. |

## `display`

Kiosk/UI preferences — brightness, auto-dim, screen timeout, theme. See
the Settings page for the same options exposed in the UI.

## `integrations`

Toggle Docker/systemd/Prometheus support and set the Docker socket path.

## `auth`

No login is required by default. Set the `DASHBOARD_PASSWORD`
environment variable (never `config.yml` — see `docs/security.md`) to
require one for every client except those listed here:

| Field | Default | Description |
|---|---|---|
| `trusted_ips` | `[]` | IPs/CIDRs that skip login entirely — e.g. a kiosk touchscreen's LAN IP. Only takes effect when `DASHBOARD_PASSWORD` is set. |

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

Toggle it from Settings → System. If `DASHBOARD_PASSWORD` isn't set,
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
falls back to `defaults`.

Notifier credentials (Discord/generic webhook URLs, Pushover keys) are
never written to `config.yml` directly — only the name of an environment
variable holding the real value (`url_env`, `pushover_user_key_env`,
`pushover_api_token_env`), matching this project's existing rule of
keeping secrets out of version-controlled config (`docs/security.md`).
ntfy's server/topic aren't treated as secrets, since a topic is
obscurity, not authentication.

**Sending is simulated for now.** None of the four notifier types
actually call out to Discord/ntfy/Pushover/a webhook yet
(`backend/notifications/`) — "Send Test" in Settings, and a real
triggered alert, both report a plausible simulated outcome. See
`docs/architecture.md` for what a real implementation would look like
per type.

## `demo_mode`

`true` routes the entire API to simulated data (`backend/demo/generator.py`)
instead of real collectors. Useful for development, screenshots, or
trying the dashboard before configuring anything real.

## Icons

Icon names are simple keywords (`server`, `docker`, `film`, `home`,
`flame`, `router`, ...) mapped to a small built-in glyph set in
`frontend/src/components/ServiceIcon.tsx`. Unrecognized names fall back
to a generic icon — nothing ever breaks from a typo.

`icon` also accepts a URL or an absolute path to a custom image instead
of a glyph keyword — anything starting with `http://`, `https://`, or
`/` is rendered as an image rather than looked up in the glyph set. To
use your own local image without hosting it anywhere, drop it into
`frontend/public/` (e.g. `frontend/public/icons/plex.png`) and reference
it as `icon: /icons/plex.png` — Vite copies everything under `public/`
into the built `dist/` as-is, so it's served at that same path in
production. If the image fails to load, the service falls back to the
generic glyph rather than showing a broken image.

## Splash art (`banner`)

Each service can also declare a `banner` — a URL or `/`-rooted path (same
rules as a custom `icon`, above) to a wide splash-art image. On that
service's detail page, the name/status/player-count sit in a plain
header row above it, and the image (with the icon overlaid bottom-left
on a gradient scrim) sits in a left column next to the metrics table,
with the action buttons underneath it. Services without a `banner` just
get the plain icon/name/status row and stacked buttons/metrics they
always had — a 16:9-ish aspect ratio (e.g. 960×540) crops most cleanly
for the image itself.

## Editing from the UI

The Settings page can patch most of these fields (display preferences,
accent color/density, dashboard layout, guest mode, alerting) via `PATCH
/api/config`. Every change is validated against the same schema before
`config.yml` is atomically rewritten — an invalid change is rejected and
the file on disk is never left partially written. Under `guest_mode`,
`PATCH /api/config` is itself a mutating request and is gated the same
as any other admin action.
