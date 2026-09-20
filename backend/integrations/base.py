"""
The integration contract.

Mirrors backend/notifications/base.py's shape deliberately: one abstract
interface, one concrete class per connection type (Docker API,
Prometheus, node_exporter/Glances, SSH, custom script), selected by
`IntegrationConfig.type` (backend/config/schema.py) through
`build_integration()` below -- the same "one factory function maps a
type string to a class" role `adapters/factory.py`,
`providers/factory.py`, and `notifications/base.py:build_notifier()` all
play.

Every `test_connection()` is a real check, made from the machine running
the dashboard, that never changes anything on the other end: the Docker
API is pinged and asked for its version, Prometheus for its build info,
the metrics endpoint is fetched and recognized, SSH authenticates with
the key and runs no command, and a custom script is checked for
existence and permissions but not executed.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx
import paramiko

from backend.adapters import docker_adapter
from backend.adapters.base import describe_exception, short_reason
from backend.adapters.docker_adapter import DockerEndpoint
from backend.config.schema import IntegrationConfig

TIMEOUT_SECONDS = 5.0
# Tests swap in an httpx.MockTransport; None means real network.
HTTP_TRANSPORT: httpx.AsyncBaseTransport | None = None


@dataclass
class TestResult:
    __test__ = False  # not a pytest test class, despite the name

    success: bool
    message: str


class Integration(ABC):
    def __init__(self, config: IntegrationConfig):
        self.config = config

    @abstractmethod
    async def test_connection(self) -> TestResult:
        """Attempt to reach this integration's data source. Never raises for
        a routine failure (unreachable host, bad credentials) -- returns
        TestResult(success=False, ...) instead, the same "represent failure
        as data, not an exception" rule ServiceAdapter.get_status() and
        Notifier.send() both follow."""


def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=HTTP_TRANSPORT, follow_redirects=True)


def _missing_file(label: str, path: str | None) -> str | None:
    """Credentials that are files (docs/security.md) have to exist on the
    machine running the dashboard -- say so plainly rather than surfacing
    a library's error about it."""
    if not path:
        return None
    if not os.path.isfile(path):
        return f"{label} not found at {path} (it must exist on the machine running the dashboard)."
    if not os.access(path, os.R_OK):
        return f"{label} at {path} isn't readable by the dashboard's user."
    return None


class DockerApiIntegration(Integration):
    async def test_connection(self) -> TestResult:
        c = self.config
        for label, path in (("TLS certificate", c.docker_tls_cert_path), ("TLS key", c.docker_tls_key_path), ("TLS CA", c.docker_tls_ca_path)):
            if problem := _missing_file(label, path):
                return TestResult(False, problem)

        def probe():
            client = docker_adapter.connect(DockerEndpoint.from_connection(c))
            try:
                return client.version(), client.info()
            finally:
                client.close()

        try:
            version, info = await asyncio.to_thread(probe)
        except Exception as exc:  # noqa: BLE001 - docker SDK errors vary
            return TestResult(False, f"Could not reach Docker at {c.docker_url}: {short_reason(exc)}")
        return TestResult(
            True,
            f"Docker {version.get('Version', '?')} on {info.get('Name', '?')} -- "
            f"{info.get('ContainersRunning', 0)} of {info.get('Containers', 0)} containers running.",
        )


class PrometheusIntegration(Integration):
    async def test_connection(self) -> TestResult:
        base = (self.config.prometheus_url or "").rstrip("/")
        try:
            async with _http() as client:
                resp = await client.get(f"{base}/api/v1/status/buildinfo")
                resp.raise_for_status()
                build = resp.json()
                if build.get("status") != "success":
                    return TestResult(False, f"{base} answered, but not like a Prometheus server.")
                version = build.get("data", {}).get("version", "?")
                # Informational only: a server that can't answer this still passed.
                targets = ""
                up = await client.get(f"{base}/api/v1/query", params={"query": "up"})
                if up.is_success:
                    results = up.json().get("data", {}).get("result", [])
                    healthy = sum(1 for r in results if r.get("value", [None, "0"])[1] == "1")
                    targets = f" -- {healthy} of {len(results)} scrape targets up"
        except ValueError:
            return TestResult(False, f"{base} answered, but not like a Prometheus server (no JSON API).")
        except httpx.HTTPError as exc:
            return TestResult(False, f"Could not query Prometheus at {base}: {short_reason(exc)}")
        return TestResult(True, f"Prometheus {version}{targets}.")


_BUILD_VERSION = re.compile(r'^node_exporter_build_info\{[^}]*version="([^"]+)"', re.MULTILINE)


class NodeExporterIntegration(Integration):
    """A node_exporter /metrics page (Prometheus text format with node_*
    series) or a Glances REST API (JSON) -- recognized by what comes back,
    not assumed from the URL."""

    async def test_connection(self) -> TestResult:
        url = self.config.metrics_url or ""
        try:
            async with _http() as client:
                resp = await client.get(url)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            return TestResult(False, f"Could not fetch {url}: {short_reason(exc)}")

        if "json" in resp.headers.get("content-type", ""):
            try:
                data = resp.json()
            except ValueError:
                return TestResult(False, f"{url} claims JSON but didn't send valid JSON.")
            if isinstance(data, dict) and ("cpu" in data or "mem" in data):
                return TestResult(True, f"Glances API -- {len(data)} plugins reporting.")
            if isinstance(data, list) and "cpu" in data:
                return TestResult(True, f"Glances API -- {len(data)} plugins available.")
            return TestResult(False, f"{url} returned JSON, but not a Glances API response.")

        series = [line for line in resp.text.splitlines() if line.startswith("node_")]
        if not series:
            return TestResult(False, f"{url} answered, but not with node_exporter metrics (no node_* series).")
        version = _BUILD_VERSION.search(resp.text)
        name = f"node_exporter {version.group(1)}" if version else "node_exporter"
        return TestResult(True, f"{name} -- {len(series)} node_* series.")


class _RecordUnknownHostKey(paramiko.MissingHostKeyPolicy):
    """A host key not in known_hosts is allowed for this one test, but
    remembered and reported -- neither silently trusted nor written to
    known_hosts. A key that *contradicts* known_hosts is still refused by
    paramiko (BadHostKeyException)."""

    def __init__(self):
        self.key: paramiko.PKey | None = None

    def missing_host_key(self, client, hostname, key):
        self.key = key


def _fingerprint(key: paramiko.PKey) -> str:
    return "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")


class SshIntegration(Integration):
    async def test_connection(self) -> TestResult:
        if problem := _missing_file("Private key", self.config.ssh_key_path):
            return TestResult(False, problem)
        return await asyncio.to_thread(self._probe)

    def _probe(self) -> TestResult:
        c = self.config
        target = f"{c.ssh_username}@{c.ssh_host}:{c.ssh_port}"
        client = paramiko.SSHClient()
        client.load_system_host_keys()
        if os.path.isfile("/etc/ssh/ssh_known_hosts"):
            client.load_system_host_keys("/etc/ssh/ssh_known_hosts")
        unknown = _RecordUnknownHostKey()
        client.set_missing_host_key_policy(unknown)
        try:
            # Authentication only: no exec_command, no shell, no forwarding.
            client.connect(
                c.ssh_host, port=c.ssh_port, username=c.ssh_username, key_filename=c.ssh_key_path,
                look_for_keys=False, allow_agent=False,
                timeout=TIMEOUT_SECONDS, banner_timeout=TIMEOUT_SECONDS, auth_timeout=TIMEOUT_SECONDS,
            )
            server_key = client.get_transport().get_remote_server_key()
        except paramiko.PasswordRequiredException:
            return TestResult(False, f"The key at {c.ssh_key_path} is passphrase-protected; the dashboard needs a key without one (keep it chmod 600).")
        except paramiko.BadHostKeyException:
            return TestResult(False, f"{c.ssh_host}'s host key doesn't match known_hosts -- refusing to connect (the host was reinstalled, or something is intercepting the connection).")
        except paramiko.AuthenticationException:
            return TestResult(False, f"{target} rejected the key at {c.ssh_key_path}.")
        except (paramiko.SSHException, OSError) as exc:
            return TestResult(False, f"Could not connect to {target}: {short_reason(exc)}")
        finally:
            client.close()

        message = f"Authenticated as {target}."
        if unknown.key is not None:
            message += (
                f" Its host key ({_fingerprint(server_key)}) isn't in known_hosts yet -- check it matches the "
                "server's before relying on this connection."
            )
        return TestResult(True, message)


class CustomScriptIntegration(Integration):
    async def test_connection(self) -> TestResult:
        path = self.config.script_path or ""
        if not os.path.isabs(path):
            return TestResult(False, f"'{path}' isn't an absolute path.")
        if not os.path.isfile(path):
            return TestResult(False, f"No file at {path} on the machine running the dashboard.")
        if not os.access(path, os.X_OK):
            return TestResult(False, f"{path} isn't executable by the dashboard's user (chmod +x).")
        return TestResult(True, f"{path} exists and is executable. (Testing doesn't run it.)")


_REGISTRY: dict[str, type[Integration]] = {
    "docker_api": DockerApiIntegration,
    "prometheus": PrometheusIntegration,
    "node_exporter": NodeExporterIntegration,
    "ssh": SshIntegration,
    "custom_script": CustomScriptIntegration,
}


def build_integration(config: IntegrationConfig) -> Integration:
    return _REGISTRY[config.type](config)
