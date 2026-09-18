"""
Picks the one DashboardProvider backend/api/main.py talks to. This is the
single place that knows `demo_mode` exists -- mirrors
backend/adapters/factory.py's role of being the one place that knows
`type:` strings map to adapter classes.
"""
from __future__ import annotations

from backend.config.loader import ConfigStore
from backend.persistence.history import HistoryStore
from backend.providers.base import DashboardProvider
from backend.providers.demo import DemoProvider
from backend.providers.live import LiveProvider


def select_provider(config_store: ConfigStore, history: HistoryStore) -> DashboardProvider:
    if config_store.config.demo_mode:
        return DemoProvider()
    return LiveProvider(config_store, history)
