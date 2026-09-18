# Docker integration

## Enabling it

Mount the Docker socket into the backend container:

```yaml
# docker-compose.yml
services:
  backend:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

This is already present in the provided `docker-compose.yml`. Remove it
if you don't monitor any Docker containers — see `docs/security.md` for
what this mount grants.

## Discovery vs. monitoring

These are deliberately separate:

- **Discovery** (`GET /api/discovery/docker`) enumerates every
  container currently on the host, for a setup/picker UI. It never adds
  anything to the dashboard by itself.
- **Monitoring** happens only for containers explicitly listed under
  `services:` in `config.yml` with `type: docker`.

```yaml
services:
  - name: Plex
    type: docker
    container: plex
```

## Self-describing containers (optional)

A container can suggest its own dashboard metadata via labels, which the
discovery endpoint surfaces to the setup UI (it still won't be added
automatically):

```yaml
# in the target container's own compose/run config
labels:
  homelab.dashboard.enable: "true"
  homelab.dashboard.name: "Plex"
  homelab.dashboard.icon: "film"
```

## What's exposed

For each monitored container: running state, uptime, CPU%, memory usage,
published ports, and Docker's own health-check state if the image
defines one (surfaces as `warning` status when unhealthy). Actions:
start, stop, restart — each re-verifies the resulting container state
before reporting success.

## If Docker is unavailable

Every Docker-backed service degrades to `unknown` status with a
`FailureDetail` explaining why (socket missing, daemon down, permission
denied, container not found). It never crashes the rest of the
dashboard — see `docs/architecture.md#failure-isolation`.
