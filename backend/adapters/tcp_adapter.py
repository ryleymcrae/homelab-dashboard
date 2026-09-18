"""TCP adapter: raw connectivity + latency for host:port targets (game
servers, SSH, databases, or anything else that just needs a socket
check)."""
from __future__ import annotations

import asyncio
import datetime
import time

from backend.adapters.base import AdapterError, ServiceAdapter, describe_exception
from backend.models.core import FailureDetail, Metric, MetricType, Service, Status


class TcpAdapter(ServiceAdapter):
    def __init__(
        self,
        service_id: str,
        name: str,
        host: str,
        port: int,
        timeout_seconds: float = 3.0,
        **options,
    ):
        super().__init__(service_id, name, **options)
        self.host = host
        self.port = port
        self.timeout_seconds = timeout_seconds
        self._last_success: str | None = None

    def get_supported_actions(self):
        return []  # plain TCP checks have no lifecycle control by default

    async def get_status(self) -> Service:
        start = time.monotonic()
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=self.timeout_seconds
            )
            latency_ms = (time.monotonic() - start) * 1000
            writer.close()
            await writer.wait_closed()

            self._last_success = datetime.datetime.now(datetime.timezone.utc).isoformat()
            metrics = [
                Metric("host", "Host", self.host, MetricType.TEXT),
                Metric("port", "Port", self.port, MetricType.COUNT),
                Metric("latency", "Latency", round(latency_ms, 1), MetricType.LATENCY_MS, unit="ms", secondary=True),
                Metric("last_success", "Last successful connection", self._last_success, MetricType.TIMESTAMP),
            ]
            return Service(
                id=self.service_id,
                name=self.name,
                type="tcp",
                status=Status.ONLINE,
                icon=self.options.get("icon", "plug"),
                banner=self.options.get("banner"),
                metrics=metrics,
                actions=[],
                failure=None,
            )
        except (OSError, asyncio.TimeoutError) as exc:
            return Service(
                id=self.service_id,
                name=self.name,
                type="tcp",
                status=Status.OFFLINE,
                icon=self.options.get("icon", "plug"),
                banner=self.options.get("banner"),
                metrics=[
                    Metric("host", "Host", self.host, MetricType.TEXT),
                    Metric("port", "Port", self.port, MetricType.COUNT),
                ],
                actions=[],
                failure=FailureDetail(
                    reason="connection_failed",
                    message=f"Could not connect to {self.host}:{self.port}: {describe_exception(exc)}",
                    last_seen=self._last_success,
                ),
            )

    async def execute_action(self, action_kind: str) -> Service:
        raise AdapterError("TCP adapter does not support actions")
