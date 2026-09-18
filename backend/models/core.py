"""
Generic domain models.

These types are the contract between the backend and the frontend. Every
collector and adapter, regardless of what technology it talks to (Docker,
systemd, HTTP, TCP, Prometheus, a custom plugin...), must translate its
data into these shapes. The frontend never knows or cares which adapter
produced a given Service or Metric -- it only understands this vocabulary.

This is the architectural boundary described in the spec: the frontend
depends on the Dashboard API and these models, never on Docker/systemd/
psutil/Prometheus directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class Status(str, Enum):
    """Universal health status. Every entity in the system (host, service,
    collector, network target) reports one of these -- nothing more, nothing
    less. UI color mapping is entirely driven by this enum."""

    ONLINE = "online"       # green
    OFFLINE = "offline"     # red
    WARNING = "warning"     # orange
    UNKNOWN = "unknown"     # muted gray -- collector could not determine


class MetricType(str, Enum):
    """Semantic type of a metric value, used by the frontend to choose a
    rendering widget without any service-specific knowledge."""

    PERCENT = "percent"          # rendered as gauge/progress
    BYTES = "bytes"               # auto-formatted (KB/MB/GB)
    DURATION = "duration"         # auto-formatted (s/m/h/d)
    LATENCY_MS = "latency_ms"
    COUNT = "count"
    RATIO = "ratio"                # e.g. "3 / 10 players"
    TEXT = "text"
    TEMPERATURE_C = "temperature_c"
    TIMESTAMP = "timestamp"
    BOOLEAN = "boolean"


@dataclass
class Metric:
    """A single named data point with enough presentation metadata for the
    frontend to render it generically -- no service-specific UI code."""

    key: str
    label: str
    value: Any
    type: MetricType = MetricType.TEXT
    unit: Optional[str] = None
    secondary: bool = False    # true = suitable for a card's secondary line
    sparkline_key: Optional[str] = None  # history series name, if tracked

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "value": self.value,
            "type": self.type.value,
            "unit": self.unit,
            "secondary": self.secondary,
            "sparklineKey": self.sparkline_key,
        }


class ActionKind(str, Enum):
    START = "start"
    STOP = "stop"
    RESTART = "restart"
    UPDATE = "update"
    ROLLBACK = "rollback"


@dataclass
class Action:
    """A capability a service adapter exposes. The frontend renders exactly
    the actions present here -- it never assumes start/stop/restart are
    always available."""

    kind: ActionKind
    label: str
    destructive: bool = False
    confirm_title: str = ""
    confirm_body: str = ""

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "label": self.label,
            "destructive": self.destructive,
            "confirmTitle": self.confirm_title,
            "confirmBody": self.confirm_body,
        }


class HostActionKind(str, Enum):
    """A fixed, whitelisted set -- never an arbitrary command. Every entry
    here must have a specific, fully-defined implementation (see
    backend/demo/runtime.py:run_host_action for the simulated one); there
    is no generic "run this string" path anywhere in this codebase."""

    REBOOT = "reboot"
    DOCKER_PRUNE = "docker_prune"
    RESTART_DOCKER = "restart_docker"
    CLEAR_PACKAGE_CACHE = "clear_package_cache"
    RUN_BACKUP = "run_backup"


@dataclass
class HostAction:
    """A whitelisted host-level capability -- same shape as `Action`, plus
    `require_typed_confirmation`: when set, the frontend must require the
    exact string (e.g. the hostname) to be typed before the confirm
    button enables at all. Reserved for actions materially more
    destructive than anything at the service level (a reboot or a Docker
    daemon restart affects every service on the host at once, not just
    one container)."""

    kind: HostActionKind
    label: str
    destructive: bool = False
    confirm_title: str = ""
    confirm_body: str = ""
    require_typed_confirmation: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "label": self.label,
            "destructive": self.destructive,
            "confirmTitle": self.confirm_title,
            "confirmBody": self.confirm_body,
            "requireTypedConfirmation": self.require_typed_confirmation,
        }


@dataclass
class ActionResult:
    """The outcome of the most recent host action, kept around (not just
    flashed as a toast) so a failed reboot/backup/prune stays visibly
    different from success until the next action replaces it -- spec:
    "not just a generic error toast"."""

    action: str
    success: bool
    message: str
    timestamp: str  # ISO8601

    def to_dict(self) -> dict:
        return {
            "action": self.action,
            "success": self.success,
            "message": self.message,
            "timestamp": self.timestamp,
        }


@dataclass
class ScheduledJob:
    """One entry in a host's cron/scheduled-job viewer. `action_kind` is
    set when "Run Now" maps onto an existing whitelisted HostAction
    (e.g. the nightly backup job runs the same RUN_BACKUP action a user
    could trigger manually) -- both paths go through the exact same
    execution, confirmation, and audit logging."""

    id: str
    name: str
    schedule_label: str  # human-readable, e.g. "Daily at 02:00"
    last_run: Optional[str]  # ISO8601, None if it has never run
    last_status: Optional[str]  # "success" | "failure", None if never run
    next_run: Optional[str]  # ISO8601
    action_kind: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "scheduleLabel": self.schedule_label,
            "lastRun": self.last_run,
            "lastStatus": self.last_status,
            "nextRun": self.next_run,
            "actionKind": self.action_kind,
        }


@dataclass
class BackupStatus:
    """Per-host backup tracking. `None` fields (rather than a whole
    missing object) mean "never backed up yet", not "unknown" -- a host
    genuinely without backup tracking configured gets no BackupStatus at
    all (get_backup_status returns None), same "never fabricate" rule as
    everywhere else."""

    last_backup_at: Optional[str]  # ISO8601, last *successful* completion
    last_attempt_at: Optional[str]  # ISO8601, last attempt regardless of outcome
    last_status: Optional[str]  # "success" | "failure", None if never attempted
    size_bytes: Optional[int]  # from the last successful backup
    in_progress: bool = False

    def to_dict(self) -> dict:
        return {
            "lastBackupAt": self.last_backup_at,
            "lastAttemptAt": self.last_attempt_at,
            "lastStatus": self.last_status,
            "sizeBytes": self.size_bytes,
            "inProgress": self.in_progress,
        }


@dataclass
class LogLine:
    """One line of log output. `ts` is carried separately from `text` only
    when the source naturally provides a parseable timestamp (Docker does;
    journalctl's short-iso format is left embedded in `text` rather than
    parsed, since it is already human-readable) -- never fabricated."""

    text: str
    ts: Optional[str] = None  # ISO8601, when available

    def to_dict(self) -> dict:
        return {"text": self.text, "ts": self.ts}


@dataclass
class FailureDetail:
    """Distinguishes *why* something is unhealthy, per spec section 17.
    Every offline/degraded state must carry a reason, not just a boolean."""

    reason: str                     # e.g. "host_unreachable", "docker_unavailable"
    message: str                    # human readable, e.g. "Cannot reach 192.168.1.20"
    last_seen: Optional[str] = None  # ISO8601
    context: dict = field(default_factory=dict)  # extra diagnostic key/values

    def to_dict(self) -> dict:
        return {
            "reason": self.reason,
            "message": self.message,
            "lastSeen": self.last_seen,
            "context": self.context,
        }


@dataclass
class Service:
    """A generic monitored/controllable thing: a Docker container, a
    systemd unit, an HTTP endpoint, a TCP port, a Prometheus-derived
    target, or a custom plugin service. The `type` field is informational
    only -- the frontend must render every service the same way, using
    only `metrics` and `actions`."""

    id: str
    name: str
    type: str                      # "docker" | "systemd" | "http" | "tcp" | "prometheus" | "custom:<plugin>"
    status: Status
    host: Optional[str] = None
    icon: Optional[str] = None
    group: Optional[str] = None
    description: Optional[str] = None
    banner: Optional[str] = None
    sort_order: int = 0
    visible: bool = True
    metrics: list[Metric] = field(default_factory=list)
    actions: list[Action] = field(default_factory=list)
    has_logs: bool = False
    has_config: bool = False
    failure: Optional[FailureDetail] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "status": self.status.value,
            "host": self.host,
            "icon": self.icon,
            "group": self.group,
            "description": self.description,
            "banner": self.banner,
            "sortOrder": self.sort_order,
            "visible": self.visible,
            "metrics": [m.to_dict() for m in self.metrics],
            "actions": [a.to_dict() for a in self.actions],
            "hasLogs": self.has_logs,
            "hasConfig": self.has_config,
            "failure": self.failure.to_dict() if self.failure else None,
        }


@dataclass
class HostInfo:
    """A monitored machine -- the local host or a remote one."""

    id: str
    name: str
    address: Optional[str]
    status: Status
    model: Optional[str] = None
    icon: Optional[str] = None
    uptime_seconds: Optional[int] = None
    cpu_percent: Optional[float] = None
    cpu_cores: Optional[int] = None
    cpu_freq_mhz: Optional[float] = None
    mem_percent: Optional[float] = None
    mem_used_bytes: Optional[int] = None
    mem_total_bytes: Optional[int] = None
    disk_percent: Optional[float] = None
    disk_used_bytes: Optional[int] = None
    disk_total_bytes: Optional[int] = None
    temperature_c: Optional[float] = None
    is_local: bool = False
    # Deeper, more expensive metrics (per-core CPU, per-partition disk,
    # disk I/O throughput...) that don't belong in the every-2-seconds
    # broadcast snapshot. Always empty there; populated only by the
    # on-demand GET /api/hosts/{id}/detail endpoint (see
    # backend/collectors/hosts.py:get_host_detail). Uses the same open
    # Metric bag as Service, rather than more named fields, because the
    # set of "deep" metrics varies a lot more than the fixed always-shown
    # ones above.
    metrics: list[Metric] = field(default_factory=list)
    # Whitelisted host-level admin actions this host currently exposes --
    # empty for every real host today (see backend/providers/live.py):
    # real reboot/prune/backup execution against Docker/systemd doesn't
    # exist yet, so nothing is fabricated here. Same shape/spirit as
    # Service.actions.
    actions: list[HostAction] = field(default_factory=list)
    last_action_result: Optional[ActionResult] = None
    failure: Optional[FailureDetail] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "address": self.address,
            "status": self.status.value,
            "model": self.model,
            "icon": self.icon,
            "uptimeSeconds": self.uptime_seconds,
            "cpuPercent": self.cpu_percent,
            "cpuCores": self.cpu_cores,
            "cpuFreqMhz": self.cpu_freq_mhz,
            "memPercent": self.mem_percent,
            "memUsedBytes": self.mem_used_bytes,
            "memTotalBytes": self.mem_total_bytes,
            "diskPercent": self.disk_percent,
            "diskUsedBytes": self.disk_used_bytes,
            "diskTotalBytes": self.disk_total_bytes,
            "temperatureC": self.temperature_c,
            "isLocal": self.is_local,
            "metrics": [m.to_dict() for m in self.metrics],
            "actions": [a.to_dict() for a in self.actions],
            "lastActionResult": self.last_action_result.to_dict() if self.last_action_result else None,
            "failure": self.failure.to_dict() if self.failure else None,
        }


@dataclass
class NetworkTarget:
    """A monitored network entity: internet, gateway, a configured device,
    or a host reused from the host list."""

    id: str
    name: str
    kind: str          # "internet" | "gateway" | "host" | "device"
    address: Optional[str]
    status: Status
    icon: Optional[str] = None
    latency_ms: Optional[float] = None
    failure: Optional[FailureDetail] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "address": self.address,
            "status": self.status.value,
            "icon": self.icon,
            "latencyMs": self.latency_ms,
            "failure": self.failure.to_dict() if self.failure else None,
        }


@dataclass
class FleetSummary:
    """Aggregate totals across every configured host/service -- backs the
    System page's fleet-wide overview. Every numeric total is Optional and
    simply omitted (never fabricated) when not every host can report the
    underlying figure -- e.g. `total_power_draw_w` stays None on real
    hardware until a power-sensing collector exists, exactly like a
    missing temperature sensor renders as unavailable elsewhere."""

    total_hosts: int
    online_hosts: int
    total_cores: Optional[int] = None
    total_mem_bytes: Optional[int] = None
    used_mem_bytes: Optional[int] = None
    total_disk_bytes: Optional[int] = None
    used_disk_bytes: Optional[int] = None
    total_power_draw_w: Optional[float] = None
    containers_running: int = 0
    containers_total: int = 0

    def to_dict(self) -> dict:
        return {
            "totalHosts": self.total_hosts,
            "onlineHosts": self.online_hosts,
            "totalCores": self.total_cores,
            "totalMemBytes": self.total_mem_bytes,
            "usedMemBytes": self.used_mem_bytes,
            "totalDiskBytes": self.total_disk_bytes,
            "usedDiskBytes": self.used_disk_bytes,
            "totalPowerDrawW": self.total_power_draw_w,
            "containersRunning": self.containers_running,
            "containersTotal": self.containers_total,
        }


@dataclass
class NetworkTraffic:
    download_mbps: float
    upload_mbps: float
    total_downloaded_bytes: int
    total_uploaded_bytes: int
    period_label: str  # e.g. "since boot", "last 24h"

    def to_dict(self) -> dict:
        return {
            "downloadMbps": self.download_mbps,
            "uploadMbps": self.upload_mbps,
            "totalDownloadedBytes": self.total_downloaded_bytes,
            "totalUploadedBytes": self.total_uploaded_bytes,
            "periodLabel": self.period_label,
        }


class AlertSeverity(str, Enum):
    """Fixed by which threshold fired, never configured per-threshold
    (spec decision): resource thresholds are WARNING, a service/host
    being down is CRITICAL. INFO exists for future use (nothing raises
    it yet) rather than being unreachable by design."""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertStatus(str, Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


@dataclass
class Alert:
    """One alert's full lifecycle in a single row -- triggered, possibly
    acknowledged/muted/snoozed, and eventually resolved when the
    underlying condition clears on its own (there is no manual
    "resolve"; resolution reflects reality, not a click). `fingerprint`
    (`<target_type>:<target_id>:<metric>`) is what deduplicates repeated
    evaluations of the same condition into one row instead of a new
    alert every evaluation tick -- see backend/alerting/evaluator.py."""

    id: str
    fingerprint: str
    severity: AlertSeverity
    status: AlertStatus
    title: str
    message: str
    metric: str  # "cpu_percent" | "mem_percent" | "disk_percent" | "temp_c" | "service_down" | "host_unreachable"
    target_type: str  # "host" | "service"
    target_id: str
    target_name: str
    value: Optional[float]
    threshold: Optional[float]
    triggered_at: str  # ISO8601 -- when this fingerprint first fired
    updated_at: str  # ISO8601 -- last time it was re-evaluated while still active
    resolved_at: Optional[str] = None
    acknowledged_at: Optional[str] = None
    muted: bool = False
    snoozed_until: Optional[str] = None
    # An ActionKind/HostActionKind value the frontend can offer a button
    # for directly on the alert (e.g. "restart" for a down service) --
    # None when there's no obviously-relevant action (e.g. high CPU).
    suggested_action: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "fingerprint": self.fingerprint,
            "severity": self.severity.value,
            "status": self.status.value,
            "title": self.title,
            "message": self.message,
            "metric": self.metric,
            "targetType": self.target_type,
            "targetId": self.target_id,
            "targetName": self.target_name,
            "value": self.value,
            "threshold": self.threshold,
            "triggeredAt": self.triggered_at,
            "updatedAt": self.updated_at,
            "resolvedAt": self.resolved_at,
            "acknowledgedAt": self.acknowledged_at,
            "muted": self.muted,
            "snoozedUntil": self.snoozed_until,
            "suggestedAction": self.suggested_action,
        }
