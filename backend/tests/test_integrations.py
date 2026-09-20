"""
Connection tests (backend/integrations/base.py) are real checks. HTTP
ones run against an httpx.MockTransport; Docker and SSH against fakes of
the one call each makes, so these cover how every outcome is reported.
"""
import stat

import httpx
import paramiko
import pytest

from backend.config.schema import IntegrationConfig
from backend.integrations import base as integ
from backend.integrations.base import build_integration


def conn(type_, **fields):
    return IntegrationConfig(id="c", type=type_, name="C", **fields)


def http(monkeypatch, handler):
    monkeypatch.setattr(integ, "HTTP_TRANSPORT", httpx.MockTransport(handler))


# --- Prometheus --------------------------------------------------------------

@pytest.mark.asyncio
async def test_prometheus_reports_version_and_targets(monkeypatch):
    def handler(request):
        if request.url.path == "/api/v1/status/buildinfo":
            return httpx.Response(200, json={"status": "success", "data": {"version": "2.53.0"}})
        assert request.url.params["query"] == "up"
        return httpx.Response(200, json={"data": {"result": [{"value": [1, "1"]}, {"value": [1, "1"]}, {"value": [1, "0"]}]}})

    http(monkeypatch, handler)
    result = await build_integration(conn("prometheus", prometheus_url="http://prom:9090/")).test_connection()
    assert result.success and result.message == "Prometheus 2.53.0 -- 2 of 3 scrape targets up."


@pytest.mark.asyncio
async def test_something_that_is_not_prometheus_fails(monkeypatch):
    http(monkeypatch, lambda r: httpx.Response(200, json={"hello": "world"}))
    result = await build_integration(conn("prometheus", prometheus_url="http://web:80")).test_connection()
    assert not result.success and "not like a Prometheus server" in result.message


@pytest.mark.asyncio
async def test_unreachable_prometheus_fails_with_the_reason(monkeypatch):
    def refuse(request):
        raise httpx.ConnectError("Connection refused")

    http(monkeypatch, refuse)
    result = await build_integration(conn("prometheus", prometheus_url="http://10.0.0.6:9090")).test_connection()
    assert not result.success and "Connection refused" in result.message


# --- node_exporter / Glances -------------------------------------------------

NODE_METRICS = """# HELP node_exporter_build_info A metric with a constant '1' value.
node_exporter_build_info{branch="HEAD",goversion="go1.22",revision="x",version="1.8.2"} 1
node_cpu_seconds_total{cpu="0",mode="idle"} 1234.5
node_memory_MemAvailable_bytes 1.2e+09
go_goroutines 7
"""


@pytest.mark.asyncio
async def test_node_exporter_is_recognized_by_its_metrics(monkeypatch):
    http(monkeypatch, lambda r: httpx.Response(200, text=NODE_METRICS, headers={"content-type": "text/plain; version=0.0.4"}))
    result = await build_integration(conn("node_exporter", metrics_url="http://pi:9100/metrics")).test_connection()
    assert result.success and result.message == "node_exporter 1.8.2 -- 3 node_* series."


@pytest.mark.asyncio
async def test_glances_is_recognized_by_its_api(monkeypatch):
    http(monkeypatch, lambda r: httpx.Response(200, json={"cpu": {"total": 3.1}, "mem": {}, "load": {}}))
    result = await build_integration(conn("node_exporter", metrics_url="http://pi:61208/api/4/all")).test_connection()
    assert result.success and result.message.startswith("Glances API")


@pytest.mark.asyncio
async def test_a_metrics_url_serving_something_else_fails(monkeypatch):
    http(monkeypatch, lambda r: httpx.Response(200, text="<html>router login</html>", headers={"content-type": "text/html"}))
    result = await build_integration(conn("node_exporter", metrics_url="http://router/")).test_connection()
    assert not result.success and "no node_* series" in result.message


# --- Docker API ---------------------------------------------------------------

class FakeDocker:
    closed = False

    def version(self):
        return {"Version": "27.3.1"}

    def info(self):
        return {"Name": "pi", "ContainersRunning": 4, "Containers": 6}

    def close(self):
        FakeDocker.closed = True


@pytest.mark.asyncio
async def test_docker_api_reports_version_and_containers(monkeypatch):
    seen = {}

    def connect(endpoint):
        seen["endpoint"] = endpoint
        return FakeDocker()

    monkeypatch.setattr(integ.docker_adapter, "connect", connect)
    result = await build_integration(conn("docker_api", docker_url="tcp://pi:2375")).test_connection()
    assert result.success and result.message == "Docker 27.3.1 on pi -- 4 of 6 containers running."
    assert seen["endpoint"].url == "tcp://pi:2375" and FakeDocker.closed


@pytest.mark.asyncio
async def test_docker_api_failure_names_the_url(monkeypatch):
    def connect(endpoint):
        raise ConnectionError("Connection refused")

    monkeypatch.setattr(integ.docker_adapter, "connect", connect)
    result = await build_integration(conn("docker_api", docker_url="tcp://pi:2375")).test_connection()
    assert not result.success and "tcp://pi:2375" in result.message and "Connection refused" in result.message


@pytest.mark.asyncio
async def test_docker_tls_files_must_exist(tmp_path):
    result = await build_integration(conn("docker_api", docker_url="tcp://pi:2376", docker_tls_cert_path=str(tmp_path / "cert.pem"))).test_connection()
    assert not result.success and "TLS certificate not found" in result.message


# --- SSH ------------------------------------------------------------------------

@pytest.fixture
def key_file(tmp_path):
    path = tmp_path / "id_ed25519"
    path.write_text("not really a key -- SSHClient is faked below")
    return str(path)


def fake_ssh(monkeypatch, *, raises=None, unknown_host=False):
    calls = {}

    class FakeTransport:
        def get_remote_server_key(self):
            return FakeKey()

    class FakeKey:
        def asbytes(self):
            return b"host-key-bytes"

    class FakeClient:
        def load_system_host_keys(self, *a):
            pass

        def set_missing_host_key_policy(self, policy):
            self.policy = policy

        def connect(self, host, **kw):
            calls.update(host=host, **kw)
            if raises:
                raise raises
            if unknown_host:
                self.policy.missing_host_key(self, host, FakeKey())

        def get_transport(self):
            return FakeTransport()

        def exec_command(self, *a, **kw):  # must never be called
            calls["exec"] = True

        def close(self):
            calls["closed"] = True

    monkeypatch.setattr(integ.paramiko, "SSHClient", FakeClient)
    return calls


def ssh_conn(key_file):
    return conn("ssh", ssh_host="pi", ssh_port=2222, ssh_username="monitor", ssh_key_path=key_file)


@pytest.mark.asyncio
async def test_ssh_authenticates_with_the_key_and_runs_nothing(monkeypatch, key_file):
    calls = fake_ssh(monkeypatch)
    result = await build_integration(ssh_conn(key_file)).test_connection()
    assert result.success and result.message == "Authenticated as monitor@pi:2222."
    assert calls["key_filename"] == key_file and calls["look_for_keys"] is False and calls["allow_agent"] is False
    assert "exec" not in calls and calls["closed"]


@pytest.mark.asyncio
async def test_ssh_reports_a_host_key_it_had_never_seen(monkeypatch, key_file):
    fake_ssh(monkeypatch, unknown_host=True)
    result = await build_integration(ssh_conn(key_file)).test_connection()
    assert result.success and "isn't in known_hosts yet" in result.message and "SHA256:" in result.message


@pytest.mark.asyncio
@pytest.mark.parametrize("error,expected", [
    (paramiko.PasswordRequiredException("encrypted"), "passphrase-protected"),
    (paramiko.BadHostKeyException("pi", paramiko.RSAKey.generate(1024), paramiko.RSAKey.generate(1024)), "doesn't match known_hosts"),
    (paramiko.AuthenticationException("denied"), "rejected the key"),
    (OSError("No route to host"), "No route to host"),
])
async def test_ssh_failures_are_explained(monkeypatch, key_file, error, expected):
    fake_ssh(monkeypatch, raises=error)
    result = await build_integration(ssh_conn(key_file)).test_connection()
    assert not result.success and expected in result.message


@pytest.mark.asyncio
async def test_ssh_key_must_exist_on_this_machine(tmp_path):
    result = await build_integration(ssh_conn(str(tmp_path / "missing"))).test_connection()
    assert not result.success and "Private key not found" in result.message


# --- Custom script ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_custom_script_is_checked_but_never_run(tmp_path):
    script = tmp_path / "status.sh"
    marker = tmp_path / "ran"
    script.write_text(f"#!/bin/sh\ntouch {marker}\n")
    result = await build_integration(conn("custom_script", script_path=str(script))).test_connection()
    assert not result.success and "isn't executable" in result.message

    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    result = await build_integration(conn("custom_script", script_path=str(script))).test_connection()
    assert result.success and not marker.exists()
    assert not (await build_integration(conn("custom_script", script_path="relative.sh")).test_connection()).success


def test_short_reason_digs_the_cause_out_of_library_wrapping():
    from backend.adapters.base import short_reason

    docker_style = RuntimeError(
        "Error while fetching server API version: HTTPConnectionPool(host='pi', port=2375): Max retries exceeded "
        "(Caused by NewConnectionError(\"...: Failed to establish a new connection: [Errno 111] Connection refused\"))"
    )
    assert short_reason(docker_style) == "Connection refused"
    assert short_reason(OSError("[Errno None] Unable to connect to port 22 on 10.0.0.9")) == "Unable to connect to port 22 on 10.0.0.9"
    assert short_reason(TimeoutError()) == "TimeoutError"
