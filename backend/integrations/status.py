"""
Tracks the live status of each configured integration (Settings >
Integrations): whether its last connection test succeeded, and when.

Deliberately in-memory only, not persisted to config.yml or a database --
this is derived, transient state, the same category as
backend/adapters/docker_adapter.py's lazy `_client` singleton, not
configuration. Restarting the backend resets every integration to
"not_configured" until it's tested again; that's expected, not a bug.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal, Optional

IntegrationStatus = Literal["connected", "error", "not_configured"]


@dataclass
class IntegrationState:
    status: IntegrationStatus = "not_configured"
    message: Optional[str] = None
    last_checked_at: Optional[float] = None
    last_success_at: Optional[float] = None


_states: dict[str, IntegrationState] = {}


def get(integration_id: str) -> IntegrationState:
    return _states.get(integration_id, IntegrationState())


def record_test(integration_id: str, success: bool, message: str) -> IntegrationState:
    now = time.time()
    prev = _states.get(integration_id, IntegrationState())
    state = IntegrationState(
        status="connected" if success else "error",
        message=message,
        last_checked_at=now,
        last_success_at=now if success else prev.last_success_at,
    )
    _states[integration_id] = state
    return state


def reset() -> None:
    """Test-only: this module is a singleton not reloaded between tests
    (unlike backend.api.main, which importlib.reload() re-executes per
    test) -- see backend/demo/runtime.py:reset() for the same issue."""
    _states.clear()
