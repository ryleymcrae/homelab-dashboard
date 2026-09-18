"""
Example plugin: a simple game-server style adapter that queries a JSON
status endpoint for player counts, world day, and version. This is a
worked example for docs/plugins.md and examples/game-server-dashboard,
demonstrating that game servers are just one more service type -- not a
first-class concept in the core product (spec section 6/37).

Not registered by default; wired up only if referenced from config.yml
with `plugin: example-game-server`.
"""
from __future__ import annotations

import httpx

from backend.adapters.base import AdapterError, describe_exception
from backend.adapters.game_status import game_status_metrics
from backend.models.core import Action, ActionKind, FailureDetail, Service, Status
from backend.plugins.base import PluginAdapter, register_plugin


@register_plugin("example-game-server")
class ExampleGameServerPlugin(PluginAdapter):
    """Expects `plugin_options.status_url` to return JSON like:
    {"online": true, "players": 3, "max_players": 10, "world_day": 128, "version": "1.2.3"}
    """

    def __init__(self, service_id: str, name: str, status_url: str, **options):
        super().__init__(service_id, name, **options)
        self.status_url = status_url

    def get_supported_actions(self) -> list[Action]:
        return [
            Action(ActionKind.RESTART, "Restart", confirm_title=f"Restart {self.name}?",
                   confirm_body="Connected players will be disconnected.")
        ]

    async def get_status(self) -> Service:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(self.status_url)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            return Service(
                id=self.service_id,
                name=self.name,
                type="custom:example-game-server",
                status=Status.OFFLINE,
                icon=self.options.get("icon", "flame"),
                banner=self.options.get("banner"),
                failure=FailureDetail(reason="unreachable", message=describe_exception(exc)),
            )

        online = bool(data.get("online"))
        metrics = game_status_metrics(data)

        return Service(
            id=self.service_id,
            name=self.name,
            type="custom:example-game-server",
            status=Status.ONLINE if online else Status.OFFLINE,
            icon=self.options.get("icon", "flame"),
            banner=self.options.get("banner"),
            metrics=metrics,
            actions=self.get_supported_actions(),
            failure=None if online else FailureDetail(reason="server_offline", message="Server reports offline"),
        )

    async def execute_action(self, action_kind: str) -> Service:
        raise AdapterError("Example plugin does not implement restart; see docs/plugins.md")
