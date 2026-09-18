"""
The adapter contract.

Every integration -- Docker, systemd, HTTP, TCP, Prometheus, or a
third-party plugin -- implements this interface. The API layer and the
frontend only ever interact with Service objects produced by adapters;
they never import docker/systemd/httpx directly. This is what lets the
same ServiceCard/ServiceDetail components render a container, a unit, an
endpoint, or a game server identically.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from backend.models.core import Action, LogLine, Service


def describe_exception(exc: BaseException) -> str:
    """Human-readable cause for a FailureDetail message.

    Several of the exceptions adapters catch carry no message at all --
    asyncio.TimeoutError and httpx's timeout types are the common ones --
    so interpolating str(exc) directly yields a dangling colon and tells
    the user nothing about why a service is down. Fall back to the
    exception type when there is no text to show."""
    text = str(exc).strip()
    if text:
        return text
    return type(exc).__name__


class AdapterError(Exception):
    """Raised when an action cannot be executed. Never silently ignored --
    the API translates this into a 4xx/5xx response so the frontend never
    reports an action as successful before it is confirmed."""


class ServiceAdapter(ABC):
    """One instance per configured service."""

    def __init__(self, service_id: str, name: str, **options):
        self.service_id = service_id
        self.name = name
        self.options = options

    @abstractmethod
    async def get_status(self) -> Service:
        """Return a fully-populated Service, including current metrics and
        available actions. Must never raise for a routine health failure --
        represent that as Status.OFFLINE / Status.WARNING with a
        FailureDetail instead. Only truly unexpected errors should raise,
        and even those must be caught by the collector loop so one broken
        adapter cannot take down others (spec section 17: failure
        isolation)."""

    def get_supported_actions(self) -> list[Action]:
        """Static list of actions this adapter type could ever support.
        get_status() decides, per-instance, which of these are currently
        applicable (e.g. no 'start' action for an already-running unit if
        the adapter chooses not to expose it)."""
        return []

    @abstractmethod
    async def execute_action(self, action_kind: str) -> Service:
        """Perform a state-changing action and return the refreshed Service
        state. Must verify the actual resulting state before returning --
        never report success just because a command was issued without
        error (spec section 37: 'do not report actions successful before
        validating result')."""

    def supports_logs(self) -> bool:
        """Whether get_logs() is meaningful for this adapter. Checked by the
        API layer before ever calling get_logs(), and mirrored onto
        Service.has_logs so the frontend knows to show a "View Logs"
        control without special-casing adapter types."""
        return False

    async def get_logs(self, lines: int = 200) -> list[LogLine]:
        """Return up to `lines` most recent log lines, oldest first. Only
        called when supports_logs() is True. Default: unsupported."""
        return []
