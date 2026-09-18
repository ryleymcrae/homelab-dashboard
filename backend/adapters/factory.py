"""
Builds a ServiceAdapter instance for each configured service. This is the
single place that maps `type:` strings in config.yml to concrete adapter
classes -- the rest of the backend (API, collector loop) only ever deals
with the abstract ServiceAdapter/Service types.
"""
from __future__ import annotations

from backend.adapters.base import ServiceAdapter
from backend.adapters.docker_adapter import DockerAdapter
from backend.adapters.http_adapter import HttpAdapter
from backend.adapters.prometheus_adapter import PrometheusAdapter
from backend.adapters.systemd_adapter import SystemdAdapter
from backend.adapters.tcp_adapter import TcpAdapter
from backend.config.schema import AppConfig, ServiceConfig
from backend.plugins.base import get_plugin_class

# Import built-in example plugins so their @register_plugin decorators run.
from backend.plugins import examples_game_server  # noqa: F401


def _service_id(cfg: ServiceConfig) -> str:
    return cfg.name.lower().replace(" ", "-")


def build_adapter(cfg: ServiceConfig, app_config: AppConfig) -> ServiceAdapter:
    sid = _service_id(cfg)

    if cfg.type == "docker":
        return DockerAdapter(
            sid, cfg.name, container=cfg.container,
            socket_url=app_config.integrations.docker_socket, icon=cfg.icon, banner=cfg.banner,
            status_url=cfg.status_url, a2s_port=cfg.a2s_port, a2s_address=cfg.a2s_address,
        )
    if cfg.type == "systemd":
        return SystemdAdapter(
            sid, cfg.name, unit=cfg.unit, icon=cfg.icon, banner=cfg.banner, status_url=cfg.status_url,
            a2s_port=cfg.a2s_port, a2s_address=cfg.a2s_address,
        )
    if cfg.type == "http":
        return HttpAdapter(
            sid, cfg.name, url=cfg.url, expected_status=cfg.expected_status,
            timeout_seconds=cfg.health_check.timeout_seconds, icon=cfg.icon, banner=cfg.banner,
        )
    if cfg.type == "tcp":
        return TcpAdapter(
            sid, cfg.name, host=cfg.tcp_host, port=cfg.port,
            timeout_seconds=cfg.health_check.timeout_seconds, icon=cfg.icon, banner=cfg.banner,
        )
    if cfg.type == "prometheus":
        return PrometheusAdapter(
            sid, cfg.name, prometheus_url=cfg.prometheus_url, prometheus_query=cfg.prometheus_query,
            icon=cfg.icon, banner=cfg.banner,
        )
    if cfg.type == "custom":
        plugin_cls = get_plugin_class(cfg.plugin)
        if plugin_cls is None:
            raise ValueError(
                f"service '{cfg.name}': unknown plugin '{cfg.plugin}'. "
                "Make sure it is imported/registered -- see docs/plugins.md"
            )
        return plugin_cls(sid, cfg.name, icon=cfg.icon, banner=cfg.banner, **cfg.plugin_options)

    raise ValueError(f"service '{cfg.name}': unsupported type '{cfg.type}'")


def build_all_adapters(app_config: AppConfig) -> dict[str, ServiceAdapter]:
    adapters: dict[str, ServiceAdapter] = {}
    for cfg in app_config.services:
        try:
            adapter = build_adapter(cfg, app_config)
            adapters[adapter.service_id] = adapter
        except ValueError:
            # A single misconfigured service must not prevent the rest of
            # the dashboard from loading (failure isolation, spec 17/32).
            continue
    return adapters
