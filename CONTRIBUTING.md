# Contributing

Thanks for considering a contribution.

## Getting set up

See `docs/development.md` for running the backend and frontend locally.
`demo_mode: true` in `config.yml` gets you a working UI without any real
homelab hardware.

## Guidelines

- **Configuration over hard-coding.** Nothing service-, host-, or
  hardware-specific belongs in code. If you find yourself hard-coding a
  hostname, IP, or product name, it belongs in `config.yml` instead.
- **Capabilities over special cases.** New service types should expose
  their capabilities through `Metric`/`Action` on the generic `Service`
  model, not through new frontend branches on `service.type`.
- **Never fabricate data.** If a metric can't be measured, omit it —
  don't send a placeholder value.
- **Failure isolation.** A new collector/adapter must degrade to
  `unknown`/`offline` with a `FailureDetail` on error, never raise in a
  way that could take down the rest of the snapshot.
- **No arbitrary execution surfaces.** See `docs/security.md` before
  adding anything that shells out or accepts free-form input for an
  action.

## Pull requests

1. Add or update tests under `backend/tests/` (backend) or alongside the
   component (frontend) for any behavior change.
2. Run `pytest backend/tests` and `npm test` in `frontend/`.
3. For UI changes, check the affected page at 800×480 (the canonical
   target) and at least one smaller/larger viewport — see
   `docs/development.md#visual-acceptance`.
4. Update the relevant `docs/*.md` file if you changed configuration
   fields, adapter behavior, or deployment steps.
5. Keep PRs focused — one adapter, one page, one fix per PR is easier to
   review than a broad sweep.

## Reporting bugs

Open a GitHub issue with: your `config.yml` (redact addresses/hostnames
if you'd like), what you expected, what happened, and backend logs if
relevant (`docker compose logs backend`).

## Proposing new integrations

New built-in adapter types (beyond Docker/systemd/HTTP/TCP/Prometheus)
should have a clear case for why they belong in core rather than as a
plugin — see `docs/plugins.md` for the extension point most changes
should use instead.
