"""
Optional Prometheus adapter.

Prometheus is never required (spec section 4/29). When a service is
configured with type: prometheus, this adapter runs a configured instant
query against a Prometheus HTTP API and surfaces the result as a metric.
It is intentionally simple: one query -> one metric. Anything more
elaborate belongs in a custom plugin.
"""
from __future__ import annotations

import httpx

from backend.adapters.base import AdapterError, ServiceAdapter, describe_exception
from backend.models.core import FailureDetail, Metric, MetricType, Service, Status


class PrometheusAdapter(ServiceAdapter):
    def __init__(
        self,
        service_id: str,
        name: str,
        prometheus_url: str,
        prometheus_query: str,
        **options,
    ):
        super().__init__(service_id, name, **options)
        self.prometheus_url = prometheus_url.rstrip("/")
        self.query = prometheus_query

    def get_supported_actions(self):
        return []

    async def get_status(self) -> Service:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{self.prometheus_url}/api/v1/query", params={"query": self.query}
                )
            resp.raise_for_status()
            data = resp.json()
            result = data.get("data", {}).get("result", [])
            if not result:
                return Service(
                    id=self.service_id,
                    name=self.name,
                    type="prometheus",
                    status=Status.UNKNOWN,
                    icon=self.options.get("icon", "activity"),
                    banner=self.options.get("banner"),
                    failure=FailureDetail(
                        reason="empty_result", message=f"Query returned no series: {self.query}"
                    ),
                )
            value = float(result[0]["value"][1])
            return Service(
                id=self.service_id,
                name=self.name,
                type="prometheus",
                status=Status.ONLINE,
                icon=self.options.get("icon", "activity"),
                banner=self.options.get("banner"),
                metrics=[Metric("value", "Value", value, MetricType.COUNT)],
                actions=[],
            )
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            return Service(
                id=self.service_id,
                name=self.name,
                type="prometheus",
                status=Status.UNKNOWN,
                icon=self.options.get("icon", "activity"),
                banner=self.options.get("banner"),
                failure=FailureDetail(reason="prometheus_error", message=describe_exception(exc)),
            )

    async def execute_action(self, action_kind: str) -> Service:
        raise AdapterError("Prometheus adapter does not support actions")
