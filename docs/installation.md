# Installation

## Requirements

- A Linux host (Raspberry Pi, mini PC, NAS, Debian/Ubuntu server, or
  similar). No cloud account, and no internet access required beyond
  what your monitored services themselves need.
- Docker + Docker Compose (recommended path), **or** Python 3.12+ and
  Node 20+ for a native install (see `docs/development.md` and
  `deploy/systemd/install.sh`).

## Docker Compose (recommended)

```bash
git clone <repository-url> homelab-dashboard
cd homelab-dashboard
cp config.example.yml config.yml
# Edit config.yml to describe your hosts and services.
docker compose up -d
```

Visit `http://<server-ip>:8080`.

If you don't monitor any Docker containers, remove the
`/var/run/docker.sock` volume mount from `docker-compose.yml` — see
`docs/security.md` for why that mount is privileged and how to scope it.

## First run without any real services configured

Set `demo_mode: true` in `config.yml` to see the dashboard populated with
realistic simulated data before you've wired up anything real. Turn it
off once you've configured actual hosts/services — demo data is never
mixed with real collector output.

## Native (non-Docker) install

```bash
sudo ./deploy/systemd/install.sh
```

This installs the backend as a systemd service under
`/opt/homelab-dashboard`, with configuration at
`/etc/homelab-dashboard/config.yml`. Build the frontend separately
(`cd frontend && npm install && npm run build`) and serve `frontend/dist`
with any web server — `deploy/nginx.conf` is a ready-made reverse-proxy
config that also forwards `/api` and `/ws` to the backend. If you use
your own nginx config instead, give `/api/` a `client_max_body_size` of
at least `3m`: nginx's 1 MB default refuses image uploads (Settings →
Branding) before they reach the backend.

The install script also adds the service account to the `systemd-journal`
and (if present) `docker` groups, since without them `type: systemd` log
viewing and `type: docker` monitoring respectively fail outright for an
unprivileged user. If you already had the service running from before
this was added, apply it manually and restart:

```bash
sudo usermod -aG systemd-journal,docker homelab-dashboard
sudo systemctl restart homelab-dashboard
```

## Raspberry Pi touchscreen kiosk

See `docs/kiosk.md`. Short version:

```bash
./deploy/kiosk/install-kiosk.sh http://<dashboard-host>:8080
```

## Updating

Docker:

```bash
git pull
docker compose up -d --build
```

Configuration (`config.yml`) and history (the `dashboard-data` volume)
are untouched by an update.

Native (systemd) install — `deploy/systemd/deploy.sh` is `install.sh`'s
update counterpart: runs the test suite, builds the frontend, backs up
the current deployment, syncs the new backend/frontend in, reinstalls
Python deps only if `requirements.txt` changed, and restarts the
service:

```bash
git pull
./deploy/systemd/deploy.sh
```

Run it as your normal user (it calls `sudo` itself for the steps that
need it) from the repo root. `--dry-run` prints every step without
changing anything; `--skip-tests` skips the pytest/tsc/vitest gate for a
faster iteration loop. Every run backs up the previous deployment under
`/opt/homelab-dashboard-backups/<timestamp>` first, so a bad deploy is
one command away from undone:

```bash
./deploy/systemd/deploy.sh rollback            # most recent backup
./deploy/systemd/deploy.sh rollback 20260101-120000   # a specific one
```

`/etc/homelab-dashboard/config.yml` and `/data` — including uploaded
images in `/data/assets` — are never touched by either the deploy or the
rollback.

## Uninstalling

```bash
docker compose down -v   # -v also removes stored history
```
