"""
Pydantic models describing config.yml.

Nothing about a user's environment is hard-coded anywhere in this
application. Every host, service, network device, and display preference
is declared here and validated on load. See config.example.yml for the
canonical documented example.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class WidgetConfig(BaseModel):
    """One tile on the Home page. Every widget type is backed by a
    component that already existed before this settled into config --
    HostCard, the Gauge/Sparkline charts, the Fleet Overview tiles
    (originally System-page-only), ServiceCard -- this never introduces
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
    display: Optional[Literal["gauge", "sparkline", "numeric"]] = None
    # services_grid only: restrict to one `group:`; omitted shows all visible services.
    group: Optional[str] = None
    # custom_card only: a shortcut tile with one button wired to an
    # existing service/host action -- never a new action of its own.
    name: Optional[str] = None
    icon: Optional[str] = None
    target_type: Optional[Literal["service", "host"]] = None
    target_id: Optional[str] = None
    action_kind: Optional[str] = None


class DashboardSettings(BaseModel):
    title: str = "My Homelab"
    tagline: Optional[str] = None
    theme: Literal["dark", "light"] = "dark"
    accent_color: Optional[str] = Field(
        default=None,
        description="A hex color (e.g. '#3b82f6') overriding the theme's default accent. "
        "null uses the built-in blue.",
    )
    density: Literal["compact", "comfortable"] = "compact"
    widgets: list[WidgetConfig] = Field(
        default_factory=list,
        description="Home page layout. Empty (the default) means 'use the built-in layout' -- "
        "one host_overview per configured host plus one services_grid -- exactly what a fresh "
        "install already looked like before this existed, so nobody has to configure anything "
        "to get the current dashboard back.",
    )


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


class HealthCheckConfig(BaseModel):
    interval_seconds: int = 15
    timeout_seconds: int = 3


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
        description="A built-in glyph name (see frontend/src/components/ServiceIcon.tsx), "
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
    )
    a2s_address: Optional[str] = None

    # type == "http"
    url: Optional[str] = None
    expected_status: int = 200

    # type == "tcp"
    tcp_host: Optional[str] = Field(default=None, alias="host_address")
    port: Optional[int] = None

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


class NetworkDeviceConfig(BaseModel):
    name: str
    address: str
    icon: Optional[str] = None


class NetworkConfig(BaseModel):
    interface: Optional[str] = Field(
        default=None, description="Override auto-detected active interface"
    )
    internet_target: str = Field(
        default="1.1.1.1", description="Host used for internet connectivity checks"
    )
    gateway_override: Optional[str] = None
    devices: list[NetworkDeviceConfig] = Field(default_factory=list)


class HistoryConfig(BaseModel):
    retention_days: int = 14
    sample_interval_seconds: int = 30
    max_rows_per_series: int = 50_000


class DisplayConfig(BaseModel):
    brightness_supported: bool = False
    auto_dim: bool = True
    dim_delay_minutes: int = 5
    screen_timeout: Literal["never", "1m", "5m", "10m", "30m"] = "never"
    kiosk_url_path: str = "/"


class AuthConfig(BaseModel):
    trusted_ips: list[str] = Field(
        default_factory=list,
        description="IP addresses or CIDR ranges (e.g. 192.168.1.50 or "
        "192.168.1.0/24) that skip login entirely -- meant for a kiosk "
        "touchscreen that should never show a login prompt. Only takes "
        "effect when DASHBOARD_PASSWORD is set; never list a broad range "
        "like 0.0.0.0/0 here.",
    )


class IntegrationsConfig(BaseModel):
    docker_enabled: bool = True
    docker_socket: str = "unix:///var/run/docker.sock"
    systemd_enabled: bool = True
    prometheus_enabled: bool = False


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


class AppConfig(BaseModel):
    """Top-level config.yml document."""

    dashboard: DashboardSettings = Field(default_factory=DashboardSettings)
    hosts: list[HostConfig] = Field(default_factory=list)
    services: list[ServiceConfig] = Field(default_factory=list)
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    history: HistoryConfig = Field(default_factory=HistoryConfig)
    display: DisplayConfig = Field(default_factory=DisplayConfig)
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)
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

    @field_validator("services")
    @classmethod
    def validate_service_requirements(cls, services: list[ServiceConfig]):
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
