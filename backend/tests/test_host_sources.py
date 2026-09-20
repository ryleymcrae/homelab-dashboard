"""
A host's assigned data source (Settings > Devices, HostConfig.integration_id)
-- wired for `docker_api` connections: that host's docker services talk
to its Docker API, and a host with no agent gets its status and specs
from `docker info` (backend/collectors/hosts.py).
"""
import pytest

from backend.adapters.docker_adapter import DockerEndpoint
from backend.adapters.factory import build_adapter
from backend.collectors import hosts as host_collector
from backend.config.schema import AppConfig
from backend.models.core import Status

DOCKER_CONN = {"id": "pi-docker", "type": "docker_api", "name": "Pi Docker", "docker_url": "tcp://192.168.0.12:2375"}


def config(host: dict, conn: dict = DOCKER_CONN, **extra) -> AppConfig:
    return AppConfig.model_validate({"hosts": [host], "integrations": {"connections": [conn]}, **extra})


def test_only_an_enabled_docker_api_connection_is_used():
    assert config({"name": "pi", "integration_id": "pi-docker"}).docker_connection_for("pi").id == "pi-docker"
    assert config({"name": "pi", "integration_id": "pi-docker"}, {**DOCKER_CONN, "enabled": False}).docker_connection_for("pi") is None
    prom = {"id": "pi-docker", "type": "prometheus", "name": "P", "prometheus_url": "http://p"}
    assert config({"name": "pi", "integration_id": "pi-docker"}, prom).docker_connection_for("pi") is None
    assert config({"name": "pi"}).docker_connection_for("pi") is None
    assert config({"name": "pi"}).docker_connection_for(None) is None


def test_docker_services_on_that_host_use_its_api():
    cfg = config(
        {"name": "pi", "integration_id": "pi-docker"},
        services=[
            {"name": "Pihole", "type": "docker", "container": "pihole", "host": "pi"},
            {"name": "Plex", "type": "docker", "container": "plex", "host": "elsewhere"},
        ],
    )
    remote, local = (build_adapter(s, cfg) for s in cfg.services)
    assert remote.endpoint == DockerEndpoint("tcp://192.168.0.12:2375")
    assert local.endpoint == DockerEndpoint(cfg.integrations.docker_socket)


@pytest.mark.asyncio
async def test_a_host_without_an_agent_gets_its_specs_from_docker_info(monkeypatch):
    monkeypatch.setattr(
        host_collector.docker_adapter, "host_info",
        lambda endpoint: {"NCPU": 4, "MemTotal": 8 * 1024**3, "OperatingSystem": "Debian GNU/Linux 12 (bookworm)"},
    )
    [host] = await host_collector.build_all_hosts(config({"name": "pi", "integration_id": "pi-docker"}))
    assert host.status == Status.ONLINE
    assert (host.cpu_cores, host.mem_total_bytes, host.model) == (4, 8 * 1024**3, "Debian GNU/Linux 12 (bookworm)")
    # Docker doesn't report host usage, so none is invented.
    assert host.cpu_percent is None and host.mem_percent is None and host.temperature_c is None


@pytest.mark.asyncio
async def test_an_unreachable_docker_api_makes_the_host_offline_with_the_reason(monkeypatch):
    def unreachable(endpoint):
        raise ConnectionError("Connection refused")

    monkeypatch.setattr(host_collector.docker_adapter, "host_info", unreachable)
    [host] = await host_collector.build_all_hosts(config({"name": "pi", "integration_id": "pi-docker"}))
    assert host.status == Status.OFFLINE
    assert host.failure.reason == "docker_api_unreachable" and "Connection refused" in host.failure.message


@pytest.mark.asyncio
async def test_an_agent_still_supplies_the_vitals_when_docker_is_assigned(monkeypatch):
    called = {}

    async def agent(hid, cfg):
        called["agent"] = True
        return "agent host"

    monkeypatch.setattr(host_collector, "_agent_metrics", agent)
    monkeypatch.setattr(host_collector.docker_adapter, "host_info", lambda e: pytest.fail("docker info used instead of the agent"))
    [host] = await host_collector.build_all_hosts(config({"name": "pi", "agent_url": "http://pi:8081", "integration_id": "pi-docker"}))
    assert host == "agent host" and called["agent"]


@pytest.mark.asyncio
async def test_detail_adds_docker_facts(monkeypatch):
    monkeypatch.setattr(host_collector.docker_adapter, "host_info", lambda e: {"ServerVersion": "27.3.1", "ContainersRunning": 4, "Images": 12})
    cfg = config({"name": "pi", "integration_id": "pi-docker"})
    detail = await host_collector.get_host_detail(cfg.hosts[0], cfg.docker_connection_for("pi"))
    assert {m.key: m.value for m in detail} == {"docker_version": "27.3.1", "docker_containers_running": 4, "docker_images": 12}


def test_discovery_lists_the_chosen_hosts_containers(monkeypatch):
    import tempfile
    from pathlib import Path

    import yaml
    from fastapi.testclient import TestClient

    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "config.yml").write_text(yaml.safe_dump({"demo_mode": True, "hosts": [{"name": "pi", "integration_id": "pi-docker"}], "integrations": {"connections": [DOCKER_CONN]}}))
        monkeypatch.setenv("DASHBOARD_CONFIG", str(Path(tmp) / "config.yml"))
        for var in ("DASHBOARD_HISTORY_DB", "DASHBOARD_AUDIT_DB", "DASHBOARD_ALERTS_DB"):
            monkeypatch.setenv(var, str(Path(tmp) / f"{var}.sqlite3"))
        monkeypatch.setenv("DASHBOARD_ASSETS_DIR", str(Path(tmp) / "assets"))
        monkeypatch.delenv("DASHBOARD_PASSWORD", raising=False)
        import importlib

        import backend.api.main as main_module

        importlib.reload(main_module)
        seen = []
        monkeypatch.setattr(main_module, "list_discoverable_containers", lambda endpoint: seen.append(endpoint) or [])
        with TestClient(main_module.app) as client:
            client.get("/api/discovery/docker?host=pi")
            client.get("/api/discovery/docker")
        assert [e.url for e in seen] == ["tcp://192.168.0.12:2375", "unix:///var/run/docker.sock"]
