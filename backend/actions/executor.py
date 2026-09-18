"""
Action executor.

The only place in the backend that turns an incoming "restart service X"
request into a real state change. Validates that the target service is
one that's actually configured (never an arbitrary identifier) and that
the requested action is one the adapter actually advertises, before
calling into the adapter (spec section 29: no arbitrary control surface).
"""
from __future__ import annotations

from backend.adapters.base import AdapterError, ServiceAdapter
from backend.models.core import Service


class ActionValidationError(Exception):
    pass


async def execute_service_action(adapter: ServiceAdapter, action_kind: str) -> Service:
    supported = {a.kind.value for a in adapter.get_supported_actions()}
    if action_kind not in supported:
        raise ActionValidationError(
            f"'{action_kind}' is not a supported action for service '{adapter.name}' "
            f"(supported: {sorted(supported) or 'none'})"
        )
    try:
        return await adapter.execute_action(action_kind)
    except AdapterError as exc:
        raise ActionValidationError(str(exc)) from exc
