# Homelab Dashboard

A self-hosted, open-source control panel for your homelab — Linux hosts,
Docker containers, systemd services, HTTP/TCP endpoints, and anything
else you can describe in YAML. Built for touchscreens as much as
desktops, with a 7" 800×480 Raspberry Pi kiosk display as the primary
design target.

No cloud account. No required Kubernetes/Redis/Postgres/Grafana/Prometheus.
Runs comfortably on a Raspberry Pi, a mini PC, a NAS, or any small Linux
server.

## Features

- **Real metrics, not mocks** — CPU, memory, storage, and temperature via
  psutil; network via live interface/gateway/traffic collection.
- **Generic service model** — Docker containers, systemd units, HTTP
  checks, TCP checks, optional Prometheus queries, and custom plugins all
  render through the same components. Nothing is hard-coded to a
  particular service.
- **Configuration over hard-coding** — your entire homelab is described
  in one `config.yml`; the UI is generated from it.
- **Live updates** over WebSocket, with historical sparklines/charts
  backed by a lightweight SQLite store with automatic retention.
- **Distinct failure states** — host unreachable, Docker unavailable,
  service offline, and collector errors are never collapsed into one
  generic "Offline."
- **Touch-first, information-dense UI** matching a purpose-built embedded
  console rather than a scaled-down desktop dashboard.
- **Raspberry Pi kiosk mode** — one script to boot a touchscreen straight
  into the dashboard.
- **Plugin system** for integrating anything not covered out of the box.

## Quick start

```bash
git clone https://github.com/ryleymcrae/homelab-dashboard homelab-dashboard
cd homelab-dashboard
cp config.example.yml config.yml
# edit config.yml to describe your hosts and services
docker compose up -d
```

Visit `http://<server-ip>:8080`.

Want to look around before configuring anything real? Set
`demo_mode: true` in `config.yml` first.

## Configuration example

```yaml
dashboard:
  title: "My Homelab"

hosts:
  - name: nas
    address: 192.168.1.20

services:
  - name: Plex
    type: docker
    container: plex

  - name: Home Assistant
    type: http
    url: http://192.168.1.15:8123

  - name: Minecraft
    type: tcp
    host_address: 192.168.1.30
    port: 25565
```

Full reference: `docs/configuration.md`. More worked examples in
`examples/` (basic Linux host, Docker host, NAS, Raspberry Pi, Home
Assistant, Plex/Jellyfin, a game server, HTTP/TCP services, and a
multi-host setup).

## Supported integrations

| Type | What it monitors | Actions |
|---|---|---|
| `docker` | Any Docker container | start / stop / restart |
| `systemd` | Any systemd unit | start / stop / restart |
| `http` | Any HTTP(S) endpoint | — |
| `tcp` | Any TCP host:port (SSH, game servers, databases...) | — |
| `prometheus` | An instant query against a Prometheus HTTP API | — |
| `custom` | Anything, via a documented plugin interface | plugin-defined |

Prometheus is optional and never required to run the dashboard.

## Touchscreen support

The default theme is designed around a 7" 800×480 display and avoids
page scrolling wherever practical at that resolution. Also verified at
480×320, 1024×600, and standard desktop/mobile viewports, which
simplify information density rather than just scaling the same layout.

## Architecture

```
Frontend (React/TS)
   │  REST + WebSocket
   ▼
Dashboard API (FastAPI)
   │
   ├── System collector (psutil)
   ├── Docker adapter
   ├── systemd adapter
   ├── HTTP / TCP checkers
   ├── Network collector
   ├── Prometheus adapter (optional)
   └── Custom plugins
```

The frontend never depends on Docker, systemd, psutil, or Prometheus
directly — everything is translated into a generic `Service`/`HostInfo`
model first. Full write-up: `docs/architecture.md`.

## Repository layout

```
homelab-dashboard/
├── backend/          FastAPI app, collectors, adapters, plugins, tests
├── frontend/          React/TS/Vite app
├── deploy/            Dockerfiles, systemd units, kiosk installer
├── examples/           Worked config.yml examples
├── docs/               Full documentation set
├── config.example.yml  Copy this to config.yml
└── docker-compose.yml
```

## Development

See `docs/development.md` for running the backend/frontend locally,
`docs/plugins.md` for extending the dashboard, and
`docs/architecture.md` for the full design rationale.

## Contributing

See `CONTRIBUTING.md`.

## Security

This is designed for trusted LAN use. See `docs/security.md` before
exposing it beyond your local network.

## License

MIT — see `LICENSE`.
