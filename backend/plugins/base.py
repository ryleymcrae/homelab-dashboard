"""
Plugin interface.

Third-party developers implement a subclass of `PluginAdapter` (which is
just a ServiceAdapter with a required `plugin_name` and a registration
decorator) without touching any core frontend or backend code. See
docs/plugins.md for a full walkthrough.

Minimal example (see plugins/examples/game_server_plugin.py for a
complete one):

    from backend.plugins.base import PluginAdapter, register_plugin

    @register_plugin("my-plugin")
    class MyPlugin(PluginAdapter):
        async def get_status(self) -> Service:
            ...
        async def execute_action(self, action_kind: str) -> Service:
            ...

Then in config.yml:

    services:
      - name: My Thing
        type: custom
        plugin: my-plugin
        plugin_options:
          some_key: some_value
"""
from __future__ import annotations

from backend.adapters.base import ServiceAdapter

_PLUGIN_REGISTRY: dict[str, type[ServiceAdapter]] = {}


def register_plugin(plugin_name: str):
    def decorator(cls: type[ServiceAdapter]):
        _PLUGIN_REGISTRY[plugin_name] = cls
        return cls

    return decorator


def get_plugin_class(plugin_name: str) -> type[ServiceAdapter] | None:
    return _PLUGIN_REGISTRY.get(plugin_name)


def list_registered_plugins() -> list[str]:
    return sorted(_PLUGIN_REGISTRY.keys())


class PluginAdapter(ServiceAdapter):
    """Convenience base class. Functionally identical to ServiceAdapter;
    exists so plugin authors have an obvious, documented entry point."""
