"""
Pydantic models describing config.yml.

Nothing about a user's environment is hard-coded anywhere in this
application. Every host, service, network device, and display preference
is declared here and validated on load. See config.example.yml for the
canonical documented example.
"""
from __future__ import annotations

import ipaddress
import zoneinfo
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationInfo, computed_field, field_serializer, field_validator


def slug(name: str) -> str:
    """The id a host/service is known by everywhere outside config.yml --
    snapshot `id`s, API paths, widget `host_id`/`target_id`, alert
    fingerprints, history series names."""
    return name.lower().replace(" ", "-")


HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]


def _duplicates(values: list[str]) -> list[str]:
    return sorted({v for v in values if values.count(v) > 1})


class WidgetConfig(BaseModel):
    """One tile on the Home page. Every widget type is backed by a
    component that already existed before this settled into config --
    HostCard, the Gauge/Sparkline charts, the Fleet Overview tiles
    (originally Devices-page-only), ServiceCard -- this never introduces
    a generic "arbitrary panel" concept. Only the fields a given `type`
    actually uses are meaningful; see validate_widgets below for exactly
    which ones each type requires."""

    id: str
    type: Literal["host_overview", "host_metric", "services_grid", "fleet_overview", "custom_card"]
    visible: bool = True

    # host_overview, host_metric: which host (by name, as under `hosts:`).
    host_id: Optional[str] = None
    # host_metric only: which metric, and how to render it.
    metric: Optional[Literal["cpu", "mem", "disk", "temp"]] = None
    # None = follow dashboard.metric_display for this metric; set = this
    # widget's own style (color always comes from metric_display).
    display: Optional[Literal["gauge", "sparkline", "numeric", "bar"]] = None
    # services_grid only: restrict to one `group:`; omitted shows all visible services.
    group: Optional[str] = None
    # custom_card only: a shortcut tile with one button wired to an
    # existing service/host action -- never a new action of its own.
    name: Optional[str] = None
    icon: Optional[str] = None
    target_type: Optional[Literal["service", "host"]] = None
    target_id: Optional[str] = None
    action_kind: Optional[str] = None


class TrendMetricDisplay(BaseModel):
    """CPU/memory: the two metrics with a history series to draw."""

    style: Literal["numeric", "sparkline", "gauge"] = "sparkline"
    color: Optional[HexColor] = None  # None = the theme's chart color


class StorageMetricDisplay(BaseModel):
    style: Literal["numeric", "gauge", "bar"] = "bar"
    color: Optional[HexColor] = None


class TemperatureMetricDisplay(BaseModel):
    # Always a number in the tile row -- no history series and no natural
    # 0-100 scale to fill a gauge or bar against.
    color: Optional[HexColor] = None


class MetricDisplaySettings(BaseModel):
    """How each metric is drawn in the host tile row (Home + Devices), and
    what an unconfigured `host_metric` widget falls back to. The one
    place "how CPU looks" is decided -- a widget can override the style,
    never the color (frontend/src/api/metrics.ts)."""

    cpu: TrendMetricDisplay = Field(default_factory=TrendMetricDisplay)
    mem: TrendMetricDisplay = Field(default_factory=TrendMetricDisplay)
    disk: StorageMetricDisplay = Field(default_factory=StorageMetricDisplay)
    temp: TemperatureMetricDisplay = Field(default_factory=TemperatureMetricDisplay)


class DashboardSettings(BaseModel):
    title: str = "My Homelab"
    tagline: Optional[str] = None
    theme: Literal["dark", "light"] = "dark"
    accent_color: Optional[HexColor] = Field(
        default=None,
        description="A hex color (e.g. '#3b82f6') overriding the theme's default accent. "
        "null uses the built-in blue.",
    )
    density: Literal["compact", "comfortable"] = "compact"
    # Icon references, like every other icon field: a built-in glyph name,
    # a URL, or a path -- including an uploaded image's /api/assets/<name>
    # (backend/persistence/assets.py). None keeps the built-in look.
    logo: Optional[str] = Field(default=None, description="Top-bar logo.")
    favicon: Optional[str] = Field(default=None, description="Browser tab icon.")
    nav_icons: dict[Literal["home", "services", "network", "devices", "alerts", "settings"], str] = Field(
        default_factory=dict, description="Bottom navigation icon per tab; a missing tab keeps its built-in glyph."
    )
    timezone: Optional[str] = Field(
        default=None,
        description="IANA time zone (e.g. 'Europe/London') every timestamp is shown in. null "
        "(the default) uses each viewer's own browser time zone, so a fresh install needs no setup.",
    )
    metric_display: MetricDisplaySettings = Field(default_factory=MetricDisplaySettings)
    chart_grid: bool = Field(default=True, description="Background grid lines on history charts.")
    temperature_unit: Literal["celsius", "fahrenheit"] = Field(
        default="celsius",
        description="Display only. Everything stored or sent by the backend stays Celsius "
        "(HostInfo.temperature_c, alerting temp_c thresholds); the frontend converts when rendering.",
    )
    widgets: list[WidgetConfig] = Field(
        default_factory=list,
        description="Home page layout. Empty (the default) means 'use the built-in layout' -- "
        "one host_overview per configured host plus one services_grid -- exactly what a fresh "
        "install already looked like before this existed, so nobody has to configure anything "
        "to get the current dashboard back.",
    )

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip() or None
        if v is None:
            return None
        try:
            zoneinfo.ZoneInfo(v)
        except zoneinfo.ZoneInfoNotFoundError:
            # Only authoritative when this machine has a tz database at all
            # -- a slim container image may not, and the browser is what
            # actually renders with it (and falls back safely if it can't).
            if zoneinfo.available_timezones():
                raise ValueError(f"dashboard.timezone: unknown time zone '{v}'") from None
        except ValueError:
            raise ValueError(f"dashboard.timezone: '{v}' is not a time zone name") from None
        return v


class HostConfig(BaseModel):
    name: str
    address: Optional[str] = None
    model: Optional[str] = None
    icon: Optional[str] = None
    is_local: bool = False
    agent_url: Optional[str] = Field(
        default=None,
        description="Optional URL of a lightweight remote agent exposing "
        "the same metrics contract as the local collector. If unset, the "
        "host is monitored via reachability/ping only.",
    )
    integration_id: Optional[str] = Field(
        default=None,
        description="Optional id of an entry in integrations.connections that provides this "
        "host's metrics and actions (e.g. an `ssh` connection for a remote host with no "
        "agent). Leave unset to keep the existing is_local/agent_url-based behavior -- this "
        "is an additional way to source a host, not a replacement for those.",
    )

    # Derived, never stored: included in GET /api/config so the Settings
    # UI can match a config entry to its snapshot/widget id without
    # re-implementing slug() in JS, ignored on the way back in.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def id(self) -> str:
        return slug(self.name)


class HealthCheckConfig(BaseModel):
    timeout_seconds: int = Field(default=3, ge=1)


class ServiceConfig(BaseModel):
    # `tcp_host` below has an alias ("host_address", the config.yml field
    # name) -- without this, PATCH /api/config breaks for any config with
    # a `type: tcp` service: ConfigStore.update() round-trips through
    # model_dump(mode="python") (field names, no by_alias) and then
    # model_validate() (which by default only accepts the alias),
    # rejecting its own dump. populate_by_name lets validation accept
    # either name, so the round trip works both ways.
    model_config = ConfigDict(populate_by_name=True)

    name: str
    type: Literal["docker", "systemd", "http", "tcp", "prometheus", "custom"]
    icon: Optional[str] = Field(
        default=None,
        description="A built-in glyph name (see frontend/src/api/icons.ts), "
        "or a URL/path to a custom image, e.g. /icons/plex.png.",
    )
    banner: Optional[str] = Field(
        default=None,
        description="URL/path to a splash-art image shown on this service's detail page. "
        "Local images can be dropped into frontend/public/ and referenced by path.",
    )
    group: Optional[str] = None
    description: Optional[str] = None
    host: Optional[str] = Field(
        default=None, description="Name of a host declared under `hosts:`"
    )
    visible: bool = True
    sort_order: int = 0
    health_check: HealthCheckConfig = Field(default_factory=HealthCheckConfig)

    # type == "docker"
    container: Optional[str] = None

    # type == "systemd"
    unit: Optional[str] = None

    # type == "docker" or "systemd", optional either way
    status_url: Optional[str] = Field(
        default=None,
        description="Optional JSON status endpoint for a docker/systemd service that's "
        "actually a game server -- same contract as the custom game-server plugin: "
        '{"online": bool, "players": int, "max_players": int, "world_day": int, '
        '"version": str}. Polled alongside the normal Docker/systemd health check to add '
        "player-count/world-day/version metrics. Never affects online/offline status, "
        "which stays purely process-based (Docker/systemd is the source of truth for that).",
    )
    a2s_port: Optional[int] = Field(
        default=None,
        description="UDP query port for a docker/systemd service that's a Source-engine/"
        "Steam game server (Valheim, Enshrouded, etc.) -- most of these have no JSON API "
        "but do speak the A2S query protocol for the Steam server browser. Adds "
        "player-count/map/version metrics the same way `status_url` does, queried at "
        "`a2s_address` (default 127.0.0.1, since a published Docker port is reachable on "
        "the machine running this backend). Never affects online/offline status.",
        ge=1,
        le=65535,
    )
    a2s_address: Optional[str] = None

    # type == "http"
    url: Optional[str] = None
    expected_status: int = Field(default=200, ge=100, le=599)

    # type == "tcp"
    tcp_host: Optional[str] = Field(default=None, alias="host_address")
    port: Optional[int] = Field(default=None, ge=1, le=65535)

    # type == "prometheus"
    prometheus_query: Optional[str] = None
    prometheus_url: Optional[str] = None

    # type == "custom"
    plugin: Optional[str] = None
    plugin_options: dict = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("service name must not be blank")
        return v

    @computed_field  # type: ignore[prop-decorator]
    @property
    def id(self) -> str:
        return slug(self.name)


class NetworkDeviceConfig(BaseModel):
    name: str
    address: str
    icon: Optional[str] = None


class NetworkConfig(BaseModel):
    internet_target: str = Field(
        default="1.1.1.1", description="Host used for internet connectivity checks"
    )
    gateway_override: Optional[str] = None
    devices: list[NetworkDeviceConfig] = Field(default_factory=list)


class HistoryConfig(BaseModel):
    retention_days: int = Field(default=14, ge=1)
    sample_interval_seconds: int = Field(
        default=30, ge=2, description="How often a history sample is stored. The live view updates every ~2 s regardless."
    )
    max_rows_per_series: int = Field(default=50_000, ge=100)


class AuthConfig(BaseModel):
    trusted_ips: list[str] = Field(
        default_factory=list,
        description="IP addresses or CIDR ranges (e.g. 192.168.1.50 or "
        "192.168.1.0/24) that skip login entirely -- meant for a kiosk "
        "touchscreen that should never show a login prompt. Only takes "
        "effect when DASHBOARD_PASSWORD is set; never list a broad range "
        "like 0.0.0.0/0 here.",
    )

    @field_validator("trusted_ips")
    @classmethod
    def valid_networks(cls, entries: list[str]) -> list[str]:
        for entry in entries:
            try:
                network = ipaddress.ip_network(entry.strip(), strict=False)
            except ValueError:
                raise ValueError(f"auth.trusted_ips: '{entry}' is not an IP address or CIDR range") from None
            if network.prefixlen == 0:
                # Would exempt every client from login -- the same as not
                # setting a password, but looking like it was set.
                raise ValueError(f"auth.trusted_ips: '{entry}' matches every address")
        return [e.strip() for e in entries]


class IntegrationConfig(BaseModel):
    """One configured connection to a real data source, managed from
    Settings > Integrations. This is deliberately a separate concept from
    the fixed docker_enabled/docker_socket/systemd_enabled/
    prometheus_enabled flags below (which stay as the single
    always-available local Docker/systemd path) -- a `connections` entry
    is an explicit, addressable thing you add/edit/remove/test, primarily
    for reaching a *remote* host's data (its own Docker API, or metrics
    collected over SSH) that the fixed local integrations can't reach.

    Credentials that are inherently files (an SSH private key, a Docker
    TLS client cert/key) are referenced here by absolute filesystem path,
    never by content -- the same "store a reference, not the secret
    itself" rule config.yml already applies to env-var-named secrets
    elsewhere (see docs/security.md), generalized to file-based
    credentials. The file itself must already exist on disk, readable by
    the backend's service user, outside of config.yml/version control."""

    id: str
    type: Literal["docker_api", "prometheus", "node_exporter", "ssh", "custom_script"]
    name: str
    enabled: bool = True

    # type == "docker_api": a Docker Engine API endpoint, local or remote.
    # "unix:///var/run/docker.sock" or "tcp://host:2376". TLS fields only
    # apply to a tcp:// url exposed with Docker's client-cert TLS scheme.
    docker_url: Optional[str] = None
    docker_tls_cert_path: Optional[str] = None
    docker_tls_key_path: Optional[str] = None
    docker_tls_ca_path: Optional[str] = None

    # type == "prometheus": base URL of the Prometheus server to query.
    prometheus_url: Optional[str] = None

    # type == "node_exporter": a node_exporter or Glances metrics/API URL.
    metrics_url: Optional[str] = None

    # type == "ssh": a remote host reached by SSH for command execution
    # (host-level actions) and/or metric collection. Key-based auth only
    # -- no password field, to keep this from becoming a place secrets
    # end up stored as plain values.
    ssh_host: Optional[str] = None
    ssh_port: int = Field(default=22, ge=1, le=65535)
    ssh_username: Optional[str] = None
    ssh_key_path: Optional[str] = None

    # type == "custom_script": a local script the backend invokes, expected
    # to emit this app's own metrics/status JSON contract on stdout.
    script_path: Optional[str] = None

    @field_validator("id")
    @classmethod
    def id_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("integration id must not be blank")
        return v


class IntegrationsConfig(BaseModel):
    docker_socket: str = Field(
        default="unix:///var/run/docker.sock",
        description="The local Docker Engine socket every `type: docker` service (and container "
        "discovery) talks to.",
    )
    connections: list[IntegrationConfig] = Field(
        default_factory=list,
        description="User-managed data source connections (Settings > Integrations). See "
        "IntegrationConfig for what each type requires.",
    )


class ThresholdConfig(BaseModel):
    """One set of alert thresholds. `null` on any field disables that
    particular check -- e.g. a host with no temperature sensor should
    have `temp_c: null` in its override rather than an unreachable
    number, the same "never fabricate/never fire on nothing" rule as
    everywhere else. Severity is fixed by which field fired (resource
    thresholds are always "warning", offline/down is always "critical")
    -- not configurable per threshold, to keep this from becoming its
    own sub-config to get wrong."""

    cpu_percent: Optional[float] = 90.0
    mem_percent: Optional[float] = 90.0
    disk_percent: Optional[float] = 90.0
    temp_c: Optional[float] = 70.0
    offline_minutes: Optional[float] = Field(
        default=5.0,
        description="A service reporting offline/warning, or a host unreachable, for at "
        "least this long triggers a critical alert. Debounces a single missed poll from "
        "becoming an alert.",
    )


class NotifierConfig(BaseModel):
    """One configured notification target. Secrets (webhook URLs, API
    tokens) are never stored here directly -- only the name of an
    environment variable holding them, so config.yml stays safe to
    share/version-control (see docs/security.md). Real sending isn't
    implemented yet (backend/notifications/); this only configures what
    a future real sender would use."""

    id: str
    type: Literal["discord", "ntfy", "pushover", "webhook"]
    name: str
    enabled: bool = True

    # discord, webhook: name of the env var holding the target URL.
    url_env: Optional[str] = None

    # ntfy: server + topic aren't secrets (a topic is obscurity, not
    # authentication) -- plain config fields, same as everything else.
    ntfy_server: str = "https://ntfy.sh"
    ntfy_topic: Optional[str] = None

    # pushover: both are credentials.
    pushover_user_key_env: Optional[str] = None
    pushover_api_token_env: Optional[str] = None


class AlertingConfig(BaseModel):
    enabled: bool = True
    defaults: ThresholdConfig = Field(default_factory=ThresholdConfig)
    host_overrides: dict[str, ThresholdConfig] = Field(
        default_factory=dict, description="Keyed by host name, as it appears under `hosts:`."
    )
    service_overrides: dict[str, ThresholdConfig] = Field(
        default_factory=dict, description="Keyed by service name, as it appears under `services:`."
    )
    notifiers: list[NotifierConfig] = Field(default_factory=list)

    @field_serializer("host_overrides", "service_overrides")
    def _overrides_as_set(self, overrides: dict[str, ThresholdConfig]) -> dict[str, dict]:
        # Only the fields an override actually sets -- the rest inherit
        # `defaults` (backend/alerting/evaluator.py:merge_thresholds), so
        # dumping them with built-in defaults filled in would both hide
        # that from GET /api/config and pin them on the next save.
        return {name: o.model_dump(exclude_unset=True) for name, o in overrides.items()}


class AppConfig(BaseModel):
    """Top-level config.yml document."""

    dashboard: DashboardSettings = Field(default_factory=DashboardSettings)
    hosts: list[HostConfig] = Field(default_factory=list)
    services: list[ServiceConfig] = Field(default_factory=list)
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    history: HistoryConfig = Field(default_factory=HistoryConfig)
    integrations: IntegrationsConfig = Field(
        default_factory=IntegrationsConfig,
        validate_default=True,  # so validate_integrations still checks HostConfig.integration_id
        # cross-references even when `integrations:` itself is omitted entirely.
    )
    auth: AuthConfig = Field(default_factory=AuthConfig)
    alerting: AlertingConfig = Field(default_factory=AlertingConfig)
    demo_mode: bool = False
    guest_mode: bool = Field(
        default=False,
        description="When true, every mutating endpoint (service/host actions, config edits, "
        "alert actions, notifier tests) requires an authenticated admin session -- viewing stays "
        "open. Meaningful only once DASHBOARD_PASSWORD is set; without one, this simply blocks "
        "every action with no way to unblock it except editing config.yml, since there is no "
        "password to authenticate against. See docs/security.md.",
    )

    def docker_connection_for(self, host_name: Optional[str]) -> Optional[IntegrationConfig]:
        """The enabled `docker_api` connection assigned to this host, if any
        -- the one answer to "which Docker does this host use?", shared by
        host collection (backend/collectors/hosts.py), docker services on
        that host (backend/adapters/factory.py), and container discovery."""
        host = next((h for h in self.hosts if h.name == host_name), None) if host_name else None
        if host is None or not host.integration_id:
            return None
        conn = next((c for c in self.integrations.connections if c.id == host.integration_id), None)
        return conn if conn is not None and conn.enabled and conn.type == "docker_api" else None

    @field_validator("dashboard")
    @classmethod
    def validate_widgets(cls, dashboard: DashboardSettings) -> DashboardSettings:
        ids = [w.id for w in dashboard.widgets]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"dashboard.widgets: duplicate id(s) {sorted(duplicates)}")
        for w in dashboard.widgets:
            if w.type == "host_overview" and not w.host_id:
                raise ValueError(f"widget '{w.id}': type=host_overview requires `host_id`")
            if w.type == "host_metric" and not (w.host_id and w.metric):
                raise ValueError(f"widget '{w.id}': type=host_metric requires `host_id` and `metric`")
            if w.type == "custom_card" and not (w.name and w.target_type and w.target_id and w.action_kind):
                raise ValueError(f"widget '{w.id}': type=custom_card requires `name`, `target_type`, `target_id`, `action_kind`")
        return dashboard

    @field_validator("hosts")
    @classmethod
    def validate_host_ids_unique(cls, hosts: list[HostConfig]) -> list[HostConfig]:
        # Two hosts slugging to the same id would silently share one card,
        # one history series, and one set of alerts.
        duplicates = _duplicates([h.id for h in hosts])
        if duplicates:
            raise ValueError(f"hosts: more than one host named {duplicates} (names must differ by more than case/spaces)")
        return hosts

    @field_validator("services")
    @classmethod
    def validate_service_requirements(cls, services: list[ServiceConfig]):
        duplicates = _duplicates([s.id for s in services])
        if duplicates:
            raise ValueError(f"services: more than one service named {duplicates} (names must differ by more than case/spaces)")
        for svc in services:
            if svc.type == "docker" and not svc.container:
                raise ValueError(f"service '{svc.name}': type=docker requires `container`")
            if svc.type == "systemd" and not svc.unit:
                raise ValueError(f"service '{svc.name}': type=systemd requires `unit`")
            if svc.type == "http" and not svc.url:
                raise ValueError(f"service '{svc.name}': type=http requires `url`")
            if svc.type == "tcp" and not (svc.tcp_host and svc.port):
                raise ValueError(f"service '{svc.name}': type=tcp requires `host_address` and `port`")
            if svc.type == "prometheus" and not svc.prometheus_query:
                raise ValueError(f"service '{svc.name}': type=prometheus requires `prometheus_query`")
            if svc.type == "custom" and not svc.plugin:
                raise ValueError(f"service '{svc.name}': type=custom requires `plugin`")
        return services

    @field_validator("alerting")
    @classmethod
    def validate_notifier_ids_unique(cls, alerting: AlertingConfig) -> AlertingConfig:
        ids = [n.id for n in alerting.notifiers]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"alerting.notifiers: duplicate id(s) {sorted(duplicates)} -- each notifier needs a unique id")
        return alerting

    @field_validator("integrations")
    @classmethod
    def validate_integrations(cls, integrations: IntegrationsConfig, info: ValidationInfo) -> IntegrationsConfig:
        connections = integrations.connections
        ids = [c.id for c in connections]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"integrations.connections: duplicate id(s) {sorted(duplicates)}")
        for c in connections:
            if c.type == "docker_api" and not c.docker_url:
                raise ValueError(f"integration '{c.id}': type=docker_api requires `docker_url`")
            if c.type == "prometheus" and not c.prometheus_url:
                raise ValueError(f"integration '{c.id}': type=prometheus requires `prometheus_url`")
            if c.type == "node_exporter" and not c.metrics_url:
                raise ValueError(f"integration '{c.id}': type=node_exporter requires `metrics_url`")
            if c.type == "ssh" and not (c.ssh_host and c.ssh_username and c.ssh_key_path):
                raise ValueError(f"integration '{c.id}': type=ssh requires `ssh_host`, `ssh_username`, `ssh_key_path`")
            if c.type == "custom_script" and not c.script_path:
                raise ValueError(f"integration '{c.id}': type=custom_script requires `script_path`")

        hosts: list[HostConfig] = info.data.get("hosts", [])
        for h in hosts:
            if h.integration_id and h.integration_id not in ids:
                raise ValueError(f"host '{h.name}': integration_id '{h.integration_id}' does not match any integrations.connections id")
        return integrations
