"""
Two ways to get game-server metrics (player count, map/version) that
Docker/systemd can't tell you about themselves, since they only know
about the *process*, not what's happening inside it:

1. A JSON status endpoint (`ServiceConfig.status_url`) -- the same
   contract backend/plugins/examples_game_server.py has always
   expected: {"online": bool, "players": int, "max_players": int,
   "world_day": int, "version": str} (only "online" required).
2. The Source Engine Query Protocol / A2S (`ServiceConfig.a2s_port`) --
   what Valheim, Enshrouded, and most other Steam-listed dedicated
   servers speak natively for their Steam server-browser entry, even
   though they expose no JSON API of their own. See docs/configuration.md.

Both are factored out here so `docker`/`systemd` adapters don't each
duplicate this parsing, and both are deliberately status-agnostic:
neither ever decides online/offline for the service -- Docker/systemd
process state stays the single source of truth for that, these only
ever add metrics on top.
"""
from __future__ import annotations

from typing import Optional

import a2s
import httpx

from backend.models.core import Metric, MetricType


async def fetch_game_status(url: str, timeout: float = 3.0) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError):
        return None


def game_status_metrics(data: dict) -> list[Metric]:
    metrics: list[Metric] = []
    if "players" in data and "max_players" in data:
        metrics.append(
            Metric(
                "players", "Players", f"{data['players']} / {data['max_players']}",
                MetricType.RATIO, secondary=True,
            )
        )
    if "world_day" in data:
        metrics.append(Metric("world_day", "World Day", data["world_day"], MetricType.COUNT))
    if "version" in data:
        metrics.append(Metric("version", "Version", data["version"], MetricType.TEXT))
    return metrics


async def fetch_a2s_info(address: str, port: int, timeout: float = 3.0):
    try:
        return await a2s.ainfo((address, port), timeout=timeout)
    except Exception:  # noqa: BLE001 - a UDP query to third-party game server
        # code can fail in many ways (malformed reply, unsupported engine
        # version, firewall drop); never let that break the service's own
        # Docker/systemd status.
        return None


def a2s_status_metrics(info) -> list[Metric]:
    metrics: list[Metric] = []
    if info.max_players:
        metrics.append(
            Metric(
                "players", "Players", f"{info.player_count} / {info.max_players}",
                MetricType.RATIO, secondary=True,
            )
        )
    if info.map_name:
        metrics.append(Metric("map", "Map", info.map_name, MetricType.TEXT, secondary=True))
    if info.version:
        metrics.append(Metric("version", "Version", info.version, MetricType.TEXT))
    return metrics
