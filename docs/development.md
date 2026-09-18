# Development

## Backend

```bash
cd homelab-dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-dev.txt

cp config.example.yml config.yml
# Quickest path to a working dev loop: set demo_mode: true in config.yml
# so you don't need real Docker/systemd/network access.

export DASHBOARD_CONFIG=$(pwd)/config.yml
# The history DB defaults to /data/history.sqlite3, which the Docker and
# systemd deploy paths provision for you but a plain local user can't
# write to -- point it somewhere writable for a dev run:
export DASHBOARD_HISTORY_DB=$(pwd)/data/history.sqlite3
# Same deal for the audit log (backend/persistence/audit.py):
export DASHBOARD_AUDIT_DB=$(pwd)/data/audit.sqlite3
uvicorn backend.api.main:app --reload --port 8080
```

Run tests:

```bash
pytest backend/tests -v
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` and `/ws` to `http://localhost:8080` (see
`frontend/vite.config.ts`) — run the backend first, ideally with
`demo_mode: true` for a UI dev loop that doesn't depend on real
hardware/services.

Run frontend tests:

```bash
npm test
```

## Project layout

See the top-level tree in `README.md` and the walkthrough in
`docs/architecture.md`.

## Adding a new adapter type

1. Implement `backend.adapters.base.ServiceAdapter` in
   `backend/adapters/`.
2. Add a branch for it in `backend/adapters/factory.py`.
3. Add the type-specific fields + validation to
   `backend/config/schema.py`.
4. Document it in `docs/configuration.md`.

For a one-off integration that doesn't belong in core, write a plugin
instead — see `docs/plugins.md`.

## Adding a new frontend page/component

Only use the design tokens in `frontend/src/themes/tokens.css` — never
hard-code a color. Components should render generically off the
`Service`/`HostInfo`/`NetworkTarget` shapes in `frontend/src/api/types.ts`;
avoid branching on `service.type` for layout decisions (branch on which
`metrics`/`actions` are present instead, matching what the backend
already decided to expose).

## Visual acceptance

The canonical target is 800×480. Before submitting a UI change, check it
at 480×320, 800×480, 1024×600, and a typical desktop/mobile viewport —
see `docs/architecture.md` and the project's design reference image for
what "correct" looks like at each size.

## Releasing

Tag a version, update `docs/about` version string surfaced in Settings →
About, and build/push the Docker images per `deploy/*.Dockerfile`.
