"""
The real-data provider: everything that talks to psutil, Docker, systemd,
HTTP/TCP/Prometheus adapters, and the network collector. This is exactly
the collection logic that lived directly in backend/api/main.py before the
provider abstraction existed -- moved here unchanged, not rewritten.
"""
from __future__ import annotations

import asyncio
import logging

from backend.actions.executor import ActionValidationError
from backend.actions.executor import execute_service_action as _run_adapter_action
from backend.adapters.base import AdapterError, ServiceAdapter
from backend.adapters.factory import build_all_adapters
from backend.collectors import hosts as host_collector
from backend.collectors import network as net_collector
from backend.config.loader import ConfigStore
from backend.models.core import BackupStatus, FleetSummary, HostInfo, LogLine, Metric, ScheduledJob, Service, Status
from backend.persistence.history import HistoryStore
from backend.providers.base import (
    ActionError,
    ConfigUnsupportedError,
    DashboardProvider,
    LogsError,
    LogsUnsupportedError,
    NetworkSnapshot,
    NotFoundError,
    ServiceConfigState,
)

logger = logging.getLogger("dashboard")


class LiveProvider(DashboardProvider):
    def __init__(self, config_store: ConfigStore, history: HistoryStore):
        self._config_store = config_store
        self._history = history
        self.adapters: dict[str, ServiceAdapter] = build_all_adapters(config_store.config)

    def rebuild_adapters(self) -> None:
        """Called after a config change (PATCH /api/config) so adapters
        reflect the new service list without restarting the process --
        exactly what backend/api/main.py used to do to its module-level
        `adapters` dict directly."""
        self.adapters = build_all_adapters(self._config_store.config)

    async def get_hosts(self) -> list[HostInfo]:
        return await host_collector.build_all_hosts(self._config_store.config.hosts)

    async def get_host_detail(self, host_id: str) -> list[Metric]:
        cfg = next(
            (h for h in self._config_store.config.hosts if host_collector.host_id(h) == host_id),
            None,
        )
        if cfg is None:
            raise NotFoundError(f"Host '{host_id}' not found")
        return await host_collector.get_host_detail(cfg)

    async def get_services(self) -> list[Service]:
        async def _safe_status(adapter: ServiceAdapter) -> Service | None:
            try:
                return await adapter.get_status()
            except Exception:  # noqa: BLE001 - one bad adapter must not break the page
                logger.exception("adapter %s failed", adapter.service_id)
                return None

        results = await asyncio.gather(*(_safe_status(a) for a in self.adapters.values()))
        return [s for s in results if s is not None]

    async def get_service(self, service_id: str) -> Service:
        adapter = self.adapters.get(service_id)
        if not adapter:
            raise NotFoundError(f"Service '{service_id}' not found")
        return await adapter.get_status()

    async def get_service_logs(self, service_id: str, lines: int) -> list[LogLine]:
        adapter = self.adapters.get(service_id)
        if not adapter:
            raise NotFoundError(f"Service '{service_id}' not found")
        if not adapter.supports_logs():
            raise LogsUnsupportedError("This service does not support log viewing")
        try:
            return await adapter.get_logs(lines=lines)
        except AdapterError as exc:
            raise LogsError(str(exc)) from exc

    async def execute_service_action(self, service_id: str, action_kind: str) -> Service:
        adapter = self.adapters.get(service_id)
        if not adapter:
            raise NotFoundError(f"Service '{service_id}' not found")
        try:
            return await _run_adapter_action(adapter, action_kind)
        except ActionValidationError as exc:
            raise ActionError(str(exc)) from exc

    async def get_network(self) -> NetworkSnapshot:
        cfg = self._config_store.config
        info = net_collector.get_local_network_info()
        targets = [await net_collector.check_internet(cfg.network.internet_target)]
        targets.append(await net_collector.check_gateway(cfg.network.gateway_override))
        for h in cfg.hosts:
            # The local host's status is already front-and-center on Home/System;
            # every other configured host is reused here so it doesn't need to
            # be redeclared under `network.devices` to get a reachability check.
            if h.is_local or not h.address:
                continue
            targets.append(await net_collector.check_host(h.name, h.address, h.icon))
        for device in cfg.network.devices:
            targets.append(await net_collector.check_device(device.name, device.address, device.icon))
        return NetworkSnapshot(
            targets=targets,
            traffic=net_collector.get_network_traffic(),
            local_address=info["local_address"],
            active_interface=info["active_interface"],
        )

    async def get_history(self, series: str, since_seconds: int) -> list[tuple[int, float]]:
        return self._history.query(series, since_seconds=since_seconds)

    async def get_fleet_summary(self) -> FleetSummary:
        hosts, services = await asyncio.gather(self.get_hosts(), self.get_services())
        containers = [s for s in services if s.type == "docker"]
        return FleetSummary(
            total_hosts=len(hosts),
            online_hosts=sum(1 for h in hosts if h.status == Status.ONLINE),
            total_cores=sum(h.cpu_cores or 0 for h in hosts) or None,
            total_mem_bytes=sum(h.mem_total_bytes or 0 for h in hosts) or None,
            used_mem_bytes=sum(h.mem_used_bytes or 0 for h in hosts) or None,
            total_disk_bytes=sum(h.disk_total_bytes or 0 for h in hosts) or None,
            used_disk_bytes=sum(h.disk_used_bytes or 0 for h in hosts) or None,
            # No power-sensing collector exists yet -- never fabricated;
            # a future LiveProvider enhancement can populate this once one
            # does, with no interface or frontend change required.
            total_power_draw_w=None,
            containers_running=sum(1 for s in containers if s.status == Status.ONLINE),
            containers_total=len(containers),
        )

    async def get_service_config(self, service_id: str) -> ServiceConfigState:
        if service_id not in self.adapters:
            raise NotFoundError(f"Service '{service_id}' not found")
        # No adapter sets Service.has_config yet -- config editing against
        # real Docker/systemd (which needs a container recreation, not
        # just a PATCH) is real follow-up work, not something to fake
        # here. The frontend never calls this for a service that didn't
        # advertise has_config, but a direct API call still needs an
        # honest answer.
        raise ConfigUnsupportedError("Config editing is not yet implemented for real services")

    async def update_service_config(self, service_id: str, patch: dict) -> ServiceConfigState:
        if service_id not in self.adapters:
            raise NotFoundError(f"Service '{service_id}' not found")
        raise ConfigUnsupportedError("Config editing is not yet implemented for real services")

    def _require_host(self, host_id: str) -> None:
        if not any(host_collector.host_id(h) == host_id for h in self._config_store.config.hosts):
            raise NotFoundError(f"Host '{host_id}' not found")

    async def execute_host_action(self, host_id: str, action_kind: str) -> HostInfo:
        self._require_host(host_id)
        # No host currently advertises any HostAction (see get_hosts/
        # HostInfo.actions default) -- real reboot/prune/backup execution
        # against a remote host (SSH, most likely) is real follow-up
        # work, not something to fake here. Mirrors get_service_config's
        # honesty about config editing above.
        raise ActionError(f"'{action_kind}' is not a supported action for host '{host_id}'")

    async def get_scheduled_jobs(self, host_id: str) -> list[ScheduledJob]:
        self._require_host(host_id)
        return []

    async def run_scheduled_job(self, host_id: str, job_id: str) -> ScheduledJob:
        self._require_host(host_id)
        raise NotFoundError(f"No scheduled job '{job_id}' for host '{host_id}'")

    async def get_backup_status(self, host_id: str) -> BackupStatus | None:
        self._require_host(host_id)
        return None
