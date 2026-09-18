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
port: never list a broad range there, and remember that anything on the
listed IP (or able to spoof it on your LAN) gets full access, including
start/stop/restart actions. `X-Forwarded-For` is only trusted because
the shipped `deploy/nginx.conf` is the sole thing that can reach the
backend container on the internal Docker network and sets it — if you
put another reverse proxy in front instead, make sure *it* also
overwrites (not appends to) that header, or trusted-IP matching can be
spoofed by any client.

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
of the UI, by design.

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

## Reporting a vulnerability

Open a GitHub issue marked security-sensitive, or see
`CONTRIBUTING.md` for a private disclosure contact if one is configured
for this repository.
