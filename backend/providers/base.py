"""
The provider contract.

Every "where does the dashboard's data actually come from" question funnels
through one `DashboardProvider`. `backend/api/main.py` talks to exactly one
provider instance and never branches on `demo_mode` (or, later, on
Prometheus-vs-agent-vs-whatever) itself -- that decision is made once, when
the provider is constructed, in `backend/providers/factory.py:select_provider()`.

This sits one level above the existing per-service `ServiceAdapter`
(backend/adapters/base.py): a ServiceAdapter is one instance per configured
*service*, chosen by `type:` in config.yml. A DashboardProvider is one
instance for the *whole dashboard*, chosen by `demo_mode` today and
whatever else (a remote-fleet aggregator, a Prometheus-backed provider...)
later. `LiveProvider` is simply the thing that owns and drives the
adapters/collectors that already existed; `DemoProvider` wraps
backend/demo/generator.py. Adding a third provider later -- e.g. one that
reads an entire fleet's data from a central Prometheus rather than
per-host collectors -- never touches backend/api/main.py.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from backend.models.core import (
    BackupStatus,
    FleetSummary,
    HostInfo,
    LogLine,
    Metric,
    NetworkTarget,
    NetworkTraffic,
    ScheduledJob,
    Service,
)


class NotFoundError(Exception):
    """No host/service exists with the given id. Always maps to a 404."""


class ActionError(Exception):
    """An action could not be validated or executed. Always maps to a 400
    -- matches the pre-existing ActionValidationError contract, which
    covers both "not a supported action" and "the adapter tried and
    failed" under the same status code."""


class LogsUnsupportedError(Exception):
    """The target service exists but doesn't support log viewing. 400."""


class LogsError(Exception):
    """Logs are supported but retrieving them failed. 502 -- distinct from
    LogsUnsupportedError, which is a client error (wrong service), not a
    backend/adapter failure."""


class ConfigUnsupportedError(Exception):
    """The target service exists but doesn't support config editing --
    same shape as LogsUnsupportedError. 400."""


@dataclass
class ContainerConfig:
    """Env vars, resource limits, and restart policy for one container.
    Deliberately Docker-shaped (these three concepts don't map cleanly
    onto, say, an HTTP health check) -- only services that advertise
    `Service.has_config` expose this at all."""

    env: dict[str, str]
    cpu_limit: str | None  # e.g. "2" (cores) -- unit-less, matches `docker run --cpus`
    mem_limit: str | None  # e.g. "512m" -- matches `docker run --memory`
    restart_policy: str  # "no" | "on-failure" | "always" | "unless-stopped"

    def to_dict(self) -> dict:
        return {
            "env": self.env,
            "cpuLimit": self.cpu_limit,
            "memLimit": self.mem_limit,
            "restartPolicy": self.restart_policy,
        }


@dataclass
class ImageState:
    """Which image version a container is running, and what update/
    rollback is possible from here. Not returned by its own endpoint --
    it's expressed to the frontend entirely through Service.metrics
    ("image", "update_available") and Service.actions (update/rollback
    appear only when applicable), same as everything else in this
    codebase's "the frontend renders only the actions actually present"
    philosophy. Lives here rather than in generator.py or runtime.py
    alone because both need the shape: generator.py for the seed,
    runtime.py for the mutable current state."""

    current: str
    available: str | None  # a newer version exists to update to
    previous: str | None  # the version an update replaced -- rollback target


@dataclass
class ServiceConfigState:
    """What GET/PATCH /api/services/{id}/config returns: the config
    currently in effect, and -- if a change has been saved but not yet
    applied -- the staged version, so the frontend can show a "pending
    restart" indicator and a before/after diff without a second
    round-trip."""

    applied: ContainerConfig
    pending: ContainerConfig | None

    def to_dict(self) -> dict:
        return {
            "applied": self.applied.to_dict(),
            "pending": self.pending.to_dict() if self.pending else None,
        }


@dataclass
class NetworkSnapshot:
    """Bundles what `_network_snapshot` in backend/api/main.py needs, so
    the interface doesn't have to smuggle three loosely-related values
    through a tuple. `local_address`/`active_interface` are None where a
    provider has no such concept (e.g. demo data)."""

    targets: list[NetworkTarget]
    traffic: NetworkTraffic
    local_address: str | None
    active_interface: str | None


class DashboardProvider(ABC):
    """One instance for the whole app, selected once by `select_provider()`.
    Every method mirrors an existing REST concern in backend/api/main.py;
    none of them serialize to dict themselves -- that stays the API
    layer's job, same as ServiceAdapter returning a Service rather than
    JSON."""

    @abstractmethod
    async def get_hosts(self) -> list[HostInfo]:
        """Every configured host, in the cheap/broadcast-safe shape."""

    @abstractmethod
    async def get_host_detail(self, host_id: str) -> list[Metric]:
        """Deeper, on-demand metrics for one host. Raises NotFoundError if
        no host with that id is configured."""

    @abstractmethod
    async def get_services(self) -> list[Service]:
        """Every configured service. A single broken one must never raise
        out of this -- implementations are responsible for their own
        failure isolation (spec section 17), same as before this
        abstraction existed."""

    @abstractmethod
    async def get_service(self, service_id: str) -> Service:
        """Raises NotFoundError if no service with that id is configured."""

    @abstractmethod
    async def get_service_logs(self, service_id: str, lines: int) -> list[LogLine]:
        """Raises NotFoundError, or LogsUnsupportedError if the service
        exists but doesn't support log viewing, or LogsError if it does
        but retrieval failed."""

    @abstractmethod
    async def execute_service_action(self, service_id: str, action_kind: str) -> Service:
        """Raises NotFoundError, or ActionError if the action is invalid,
        unsupported, or failed to execute."""

    @abstractmethod
    async def get_network(self) -> NetworkSnapshot:
        """Internet/gateway/host/device reachability plus traffic."""

    @abstractmethod
    async def get_history(self, series: str, since_seconds: int) -> list[tuple[int, float]]:
        """(timestamp, value) points for one named series over the given
        window, oldest first. `series` names are the same dotted keys the
        broadcast loop already records (`host.<id>.cpu`, etc.) -- this
        doesn't validate the name against anything; an unknown series
        just yields no points, the same as it always has."""

    @abstractmethod
    async def get_fleet_summary(self) -> FleetSummary:
        """Aggregate totals across every host/service this provider knows
        about -- backs the Devices page's fleet-wide overview."""

    @abstractmethod
    async def get_service_config(self, service_id: str) -> ServiceConfigState:
        """Raises NotFoundError, or ConfigUnsupportedError if the service
        exists but doesn't support config editing."""

    @abstractmethod
    async def update_service_config(self, service_id: str, patch: dict) -> ServiceConfigState:
        """Stages a partial change (any subset of ContainerConfig's
        fields) as `pending` -- never applies it immediately. A real
        implementation would need a container recreation to actually pick
        up new env vars/limits, so "pending until next restart" isn't a
        UI nicety, it's what the underlying technology actually requires.
        Same raises as get_service_config."""

    @abstractmethod
    async def execute_host_action(self, host_id: str, action_kind: str) -> HostInfo:
        """Raises NotFoundError, or ActionError if the action isn't one
        the host currently advertises (HostInfo.actions) or failed to
        execute. Same contract as execute_service_action, one level up."""

    @abstractmethod
    async def get_scheduled_jobs(self, host_id: str) -> list[ScheduledJob]:
        """Raises NotFoundError if no host with that id is configured.
        An empty list means "no jobs configured", not "unsupported" --
        every host can have zero or more."""

    @abstractmethod
    async def run_scheduled_job(self, host_id: str, job_id: str) -> ScheduledJob:
        """Raises NotFoundError (unknown host or job id). Runs the job's
        underlying action immediately, same execution path "Run Now"
        and its schedule would both go through."""

    @abstractmethod
    async def get_backup_status(self, host_id: str) -> BackupStatus | None:
        """Raises NotFoundError if no host with that id is configured.
        Returns None if the host has no backup tracking configured at
        all -- distinct from a BackupStatus whose fields are None because
        it's simply never been backed up yet."""
