"""HTTP adapter: availability, status code, latency for a configured URL."""
from __future__ import annotations

import datetime
import time

import httpx

from backend.adapters.base import AdapterError, ServiceAdapter, describe_exception
from backend.models.core import FailureDetail, Metric, MetricType, Service, Status


class HttpAdapter(ServiceAdapter):
    def __init__(
        self,
        service_id: str,
        name: str,
        url: str,
        expected_status: int = 200,
        timeout_seconds: float = 3.0,
        **options,
    ):
        super().__init__(service_id, name, **options)
        self.url = url
        self.expected_status = expected_status
        self.timeout_seconds = timeout_seconds
        self._last_success: str | None = None

    def get_supported_actions(self):
        return []  # HTTP services are observed only; no lifecycle control

    async def get_status(self) -> Service:
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True) as client:
                resp = await client.get(self.url)
            latency_ms = (time.monotonic() - start) * 1000

            if resp.status_code == self.expected_status:
                status = Status.ONLINE
                self._last_success = datetime.datetime.now(datetime.timezone.utc).isoformat()
                failure = None
            else:
                status = Status.WARNING
                failure = FailureDetail(
                    reason="unexpected_status",
                    message=f"Expected HTTP {self.expected_status}, got {resp.status_code}",
                    last_seen=self._last_success,
                )

            metrics = [
                Metric("url", "URL", self.url, MetricType.TEXT),
                Metric("status_code", "Response status", resp.status_code, MetricType.COUNT),
                Metric("latency", "Latency", round(latency_ms, 1), MetricType.LATENCY_MS, unit="ms", secondary=True),
            ]
            if self._last_success:
                metrics.append(Metric("last_success", "Last successful check", self._last_success, MetricType.TIMESTAMP))

            return Service(
                id=self.service_id,
                name=self.name,
                type="http",
                status=status,
                icon=self.options.get("icon", "globe"),
                banner=self.options.get("banner"),
                metrics=metrics,
                actions=[],
                failure=failure,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            return Service(
                id=self.service_id,
                name=self.name,
                type="http",
                status=Status.OFFLINE,
                icon=self.options.get("icon", "globe"),
                banner=self.options.get("banner"),
                metrics=[Metric("url", "URL", self.url, MetricType.TEXT)],
                actions=[],
                failure=FailureDetail(
                    reason="unreachable",
                    message=f"Could not reach {self.url}: {describe_exception(exc)}",
                    last_seen=self._last_success,
                ),
            )

    async def execute_action(self, action_kind: str) -> Service:
        raise AdapterError("HTTP adapter does not support actions")
