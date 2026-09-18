# Services

A "service" is anything the dashboard monitors and, optionally, controls
— a Docker container, a systemd unit, an HTTP endpoint, a raw TCP port,
a Prometheus-derived value, or a custom plugin. See
`docs/configuration.md#services` for the full field reference per type.

## The capability model

Different service types expose different metrics and actions, and that's
intentional (spec principle: capabilities over service-specific UI). A
Docker container might show CPU/memory/ports/health; an HTTP check shows
status code and latency; a TCP check shows only latency. The frontend
never assumes a field exists — it renders exactly the `metrics` and
`actions` the adapter reports for that specific service.

This also means: **a service never shows a fabricated or placeholder
field.** If latency can't be measured, no latency row appears. If a
service has no controllable lifecycle (HTTP/TCP checks by default), no
action buttons appear.

## Grouping

Set `group:` on any service to cluster them on the Services page (e.g.
`Media`, `Infrastructure`, `Games`). Ungrouped services fall under a
generic "Services" heading.

## Visibility

`visible: false` keeps a service configured (and monitored, for its own
detail page and history) without showing it on Home/Services — useful
for services you want data on but not a permanent card.

## Game servers are not special

Nothing in the core product treats game servers as a first-class
concept. `examples/game-server-dashboard/` and the bundled
`example-game-server` plugin show that a Minecraft/Dragonwilds/Terraria
server is just a `tcp` or `custom` service like any other — see
`docs/plugins.md` for how the plugin exposes players/world-day/version.
