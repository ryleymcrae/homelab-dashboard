# Plugin development

Plugins let you integrate a service the built-in adapters don't cover
(Docker, systemd, HTTP, TCP, Prometheus) without touching core backend
or frontend code.

## 1. Implement the adapter

```python
# backend/plugins/my_plugin.py
from backend.plugins.base import PluginAdapter, register_plugin
from backend.models.core import Action, ActionKind, Metric, MetricType, Service, Status

@register_plugin("my-plugin")
class MyPlugin(PluginAdapter):
    def __init__(self, service_id: str, name: str, some_option: str, **options):
        super().__init__(service_id, name, **options)
        self.some_option = some_option

    def get_supported_actions(self) -> list[Action]:
        return [Action(ActionKind.RESTART, "Restart", confirm_title=f"Restart {self.name}?")]

    async def get_status(self) -> Service:
        # Query whatever this plugin integrates with, then translate the
        # result into the generic Service/Metric model. Never raise for a
        # routine failure -- represent it as Status.OFFLINE/WARNING with
        # a FailureDetail instead (see backend/adapters/base.py).
        ...

    async def execute_action(self, action_kind: str) -> Service:
        # Perform the action, then re-check real state before returning
        # -- never report success just because a command didn't error.
        ...
```

See `backend/plugins/examples_game_server.py` for a complete worked
example that queries a JSON status endpoint for player count, world day,
and version.

## 2. Make sure it's imported

Plugins register themselves via the `@register_plugin` decorator when
their module is imported. Add an import line in
`backend/adapters/factory.py` alongside the existing example import:

```python
from backend.plugins import my_plugin  # noqa: F401
```

## 3. Reference it from config.yml

```yaml
services:
  - name: My Thing
    type: custom
    plugin: my-plugin
    plugin_options:
      some_option: some_value
```

Everything under `plugin_options` is passed as keyword arguments to your
adapter's `__init__`.

## Metric presentation metadata

Give the frontend enough to render your metric generically by choosing
an accurate `MetricType` (`percent`, `bytes`, `duration`, `latency_ms`,
`count`, `ratio`, `text`, `temperature_c`, `timestamp`, `boolean`) and
setting `secondary=True` on the one metric most useful for a compact
card (e.g. player count, response time).

## Rules plugins must follow

- Never fabricate a metric you can't actually measure.
- Never raise from `get_status()` for a routine failure — use
  `Status.OFFLINE`/`WARNING` + `FailureDetail`.
- `execute_action()` must verify the resulting state before returning,
  not just assume the command worked.
- Plugins run with the same privileges as the backend process — don't
  shell out to arbitrary user-supplied strings (see `docs/security.md`).
