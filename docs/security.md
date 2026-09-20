# Security

This application is designed for **trusted LAN use**. It is not hardened
for direct exposure to the public Internet, and this document does not
claim otherwise — if you expose it externally, put it behind a VPN or an
authenticating reverse proxy that you control, and understand that
you're taking on that risk yourself.

## The Docker socket mount

Monitoring/controlling Docker containers requires mounting
`/var/run/docker.sock` into the backend container. This is a privileged
grant: a process with access to the Docker socket can, in general,
control any container on the host and, through container mounts, can
often affect the host filesystem. Only mount it if you actually use
`type: docker` services, and understand that you're trusting this
codebase (and anything you extend it with) with that access.

The backend itself never accepts arbitrary Docker commands from the
frontend — only start/stop/restart on containers you've explicitly named
in `config.yml`.

## Authentication

There is no user system, by design — this is a single-operator LAN
tool, not a multi-tenant service. Login is **off by default**, matching
every previous release: set the `DASHBOARD_PASSWORD` environment
variable (in `docker-compose.yml`/systemd unit environment, never in
`config.yml`, which is meant to be shareable/version-controllable) to
require it. Once set, every client must either present a valid session
cookie (issued by `POST /api/auth/login`) or connect from an IP/CIDR
listed under `auth.trusted_ips` in `config.yml` — meant for a kiosk
touchscreen that should never show a login prompt. Session tokens are
HMAC-signed with a key derived from the password itself (see
`backend/auth.py`), so changing the password immediately invalidates
every existing session with no separate secret to rotate or leak.

Treat `trusted_ips` the same way you'd treat an unauthenticated admin
port: never list a broad range there (a match-everything `0.0.0.0/0` or
`::/0` is rejected outright, and every entry must parse as an address or
range), and remember that anything on the
listed IP (or able to spoof it on your LAN) gets full access, including
start/stop/restart actions. `X-Forwarded-For` is only trusted because
the shipped `deploy/nginx.conf` is the sole thing that can reach the
backend container on the internal Docker network and sets it — if you
put another reverse proxy in front instead, make sure *it* also
overwrites (not appends to) that header, or trusted-IP matching can be
spoofed by any client.

The list is editable from Settings → Access & Security, but once a
password is set, `PATCH /api/config` refuses any change to `auth` unless
the request carries a real password login (`backend/auth.py:is_admin()`,
checked in `patch_config` in `backend/api/main.py`). Without that, a
client on a trusted IP -- which otherwise has full access -- could
quietly add some other machine to the list and keep passwordless access
from it. With no password set the list has no effect yet, so it's
editable freely.

This covers authentication (who can act at all), not fine-grained
authorization — there remain no user roles or per-service permissions;
one password, or none, is the whole model.

## Guest mode (`guest_mode`)

A separate, stricter switch on top of the authentication model above,
meant specifically for putting the dashboard on a kiosk/wall tablet that
anyone walking by can see but shouldn't be able to control. Where
`trusted_ips` grants an IP full access without a login prompt,
`guest_mode` does the opposite for that same IP: viewing keeps working
exactly as `auth`/`trusted_ips` already allow, but every mutating
request (service/host actions, config edits, alert acknowledge/mute/
snooze, `PATCH /api/config` itself) is rejected with 403 unless the
request carries a session cookie from an actual `POST /api/auth/login`
with the real password — `trusted_ips` membership is explicitly **not**
sufficient to act under guest mode, only to view. `backend/auth.py:
is_admin()` is the one function this enforcement is built on, and it
checks nothing but a verified session token.

If `DASHBOARD_PASSWORD` is unset, there is no real login for `is_admin()`
to ever grant, so guest mode fails closed: actions stay blocked
permanently, not silently open. This is intentional, not an oversight —
a "kiosk safety" toggle that quietly disables itself when you forget to
also set a password would be worse than no toggle at all. Recovering
from that state requires either setting `DASHBOARD_PASSWORD` and logging
in, or editing `config.yml` directly to set `guest_mode: false` — the UI
has no self-service escape hatch for a config that has locked itself out
of the UI, by design. What the UI does do is ask for confirmation before
turning guest mode on (Settings → Access & Security), with the lockout
spelled out when no password is set.

Like `trusted_ips`, this is enforced in the backend middleware
(`_auth_gate` in `backend/api/main.py`), not just hidden in the
frontend — a request crafted directly against the API is checked the
same way a button click is.

## Audit log

Every admin action -- start/stop/restart, config change, image update/
rollback -- is recorded to a local SQLite audit log
(`backend/persistence/audit.py`, `DASHBOARD_AUDIT_DB`), including
attempts that failed or were rejected. There's no per-user login today
(a single shared password, if any), so the "who" is the most specific
thing actually available: the client IP plus how it authenticated (e.g.
`trusted:192.168.1.50`, `session:192.168.1.20`). This is meant to survive
a move to real multi-user accounts later without a schema change -- see
`docs/architecture.md`.

## Image uploads

`POST /api/assets` is the one endpoint that writes user-supplied bytes to
disk (`backend/persistence/assets.py`), so it's deliberately narrow:

- The file's type is decided from its own leading bytes, never its name
  or the declared Content-Type — only PNG, JPEG, GIF, WebP, and ICO are
  accepted. **SVG is refused**: an SVG served from the dashboard's own
  origin can carry script. A script or HTML file renamed `logo.png` is
  refused the same way.
- The stored name is derived from the content hash; the client never
  chooses a filename or path, and `GET /api/assets/<name>` only serves
  names matching that exact pattern, so there's nothing to traverse.
  Files are written via temp file + rename, like `config.yml`.
- 2 MB per file, checked from `Content-Length` before the multipart body
  is parsed (the backend's port can be reachable without nginx's own
  limit in front of it); the shipped `deploy/nginx.conf` allows 3 MB on
  `/api/` since nginx's 1 MB default would refuse uploads first. A
  separately managed nginx needs the same `client_max_body_size`.
- Served with `X-Content-Type-Options: nosniff` and a `default-src
  'none'` Content-Security-Policy, so a browser won't reinterpret one as
  anything but an image.
- Upload and delete are mutating requests: covered by the auth gate and
  guest mode like every other admin action, and recorded in the audit log
  (`asset_upload`/`asset_delete`), including rejected uploads.

## Connection tests and notifications

Settings' "Test Connection" and notifier "Send Test" reach out from the
backend for real. Neither is a way to run anything elsewhere: an SSH
test authenticates with the configured key and runs no command, a
custom script is checked for permissions but never executed, and HTTP
checks are plain GETs. SSH refuses a host key that contradicts
`known_hosts` and reports — rather than trusts — one it hasn't seen.
Notifier secrets are read from the environment at send time and kept
out of every result message and log line; a Discord webhook URL is
redacted even from network-error text, since the URL is the credential.

## No arbitrary execution surface

- The systemd adapter validates unit names against an allow-list of
  characters before ever passing them to `systemctl`, and always invokes
  `systemctl` as an argument list (never a shell string), so it cannot
  become a command-injection point.
- The action executor (`backend/actions/executor.py`) only ever
  dispatches an action that the specific service's adapter has already
  advertised as supported — you cannot send an arbitrary action kind or
  target an unconfigured service ID and have anything happen.
- Host-level actions (reboot, Docker prune, Docker daemon restart,
  package cache clear, run backup) are a fixed enum,
  `HostActionKind` (`backend/models/core.py`) — never a free-form
  command, and never something a config file or a plugin can extend
  with an arbitrary string. Each one has one specific, fully-defined
  implementation; there is no "run this command on the host" path
  anywhere, mock or real. `LiveProvider` doesn't implement any of them
  yet (see `docs/architecture.md`) — today they only exist in
  `DemoProvider`'s simulation.
- The two most destructive host actions — reboot and restarting the
  Docker daemon, both of which affect every service on a host at once —
  require the frontend to have the viewer type the exact hostname
  before the confirm button enables at all
  (`HostAction.require_typed_confirmation`, enforced client-side in
  `ConfirmDialog`). This is a stronger bar than the plain confirmation
  dialog every other action gets -- though, like every confirmation in
  this app, it's a UI safeguard against misclicks, not an
  authorization check: the API itself executes on request from anyone
  already authenticated (or exempted via `trusted_ips`), the same trust
  boundary as every other endpoint.
- There is no generic "run a shell command" endpoint anywhere in the API.

## Configuration writes

Settings changes from the UI go through the same Pydantic validation as
`config.yml` itself (`backend/config/loader.py`), and are written
atomically (temp file + rename) — a rejected or interrupted write can
never leave `config.yml` corrupted or partially applied.

## Secrets

Nothing in this application is designed to store credentials on your
behalf. If a plugin or Prometheus query needs a credential, keep it out
of `config.yml`'s version-controlled parts (e.g. use environment
variables and reference them from your own plugin code) — do not commit
secrets to your fork/repo.

Two concrete conventions this codebase follows for its own config:

- **Single-value secrets** (webhook URLs, API tokens — e.g.
  `NotifierConfig.url_env`/`pushover_api_token_env`) are referenced by
  the *name* of an environment variable, never by value, in
  `config.yml`.
- **File-based credentials** (an integration's SSH private key, a Docker
  TLS client cert/key — `IntegrationConfig.ssh_key_path`/
  `docker_tls_cert_path`/`docker_tls_key_path`/`docker_tls_ca_path`, see
  `docs/configuration.md`) extend the same principle to secrets that are
  inherently files: `config.yml` stores only an absolute filesystem
  path, never file content. The key/cert file must already exist on
  disk, readable by the backend's service user (`chmod 600`, owned by
  that user), and kept outside `config.yml`/version control — the same
  trust boundary as any SSH key you'd manage by hand.

Both conventions exist for the same reason: `config.yml` is meant to be
safe to share, diff, or version-control on its own, and neither a
credential's value nor its file content should ever end up in it.

## Reporting a vulnerability

Open a GitHub issue marked security-sensitive, or see
`CONTRIBUTING.md` for a private disclosure contact if one is configured
for this repository.
