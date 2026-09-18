// Types mirror backend/models/core.py exactly. The frontend never invents
// its own shapes for service/host/network data -- it only renders what
// the API sends, generically.

export type Status = "online" | "offline" | "warning" | "unknown";

export type MetricType =
  | "percent"
  | "bytes"
  | "duration"
  | "latency_ms"
  | "count"
  | "ratio"
  | "text"
  | "temperature_c"
  | "timestamp"
  | "boolean";

export interface Metric {
  key: string;
  label: string;
  value: string | number | boolean;
  type: MetricType;
  unit?: string | null;
  secondary: boolean;
  sparklineKey?: string | null;
}

export type ActionKind = "start" | "stop" | "restart" | "update" | "rollback";

// Shared shape ConfirmDialog renders generically -- both a container
// action and a host action satisfy it, so one dialog serves both without
// caring which kind of thing is being confirmed.
export interface ConfirmableAction {
  kind: string;
  label: string;
  destructive: boolean;
  confirmTitle: string;
  confirmBody: string;
  /** When set, the confirm button stays disabled until the viewer types
   * this exact string (e.g. the hostname) -- reserved for actions more
   * destructive than a container restart, like a host reboot. */
  requireTypedConfirmation?: string | null;
}

export interface ServiceAction extends ConfirmableAction {
  kind: ActionKind;
}

export type HostActionKind = "reboot" | "docker_prune" | "restart_docker" | "clear_package_cache" | "run_backup";

export interface HostAction extends ConfirmableAction {
  kind: HostActionKind;
}

export interface ActionResult {
  action: string;
  success: boolean;
  message: string;
  timestamp: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  scheduleLabel: string;
  lastRun?: string | null;
  lastStatus?: "success" | "failure" | null;
  nextRun?: string | null;
  actionKind?: string | null;
}

export interface BackupStatus {
  lastBackupAt?: string | null;
  lastAttemptAt?: string | null;
  lastStatus?: "success" | "failure" | null;
  sizeBytes?: number | null;
  inProgress: boolean;
}

export interface FailureDetail {
  reason: string;
  message: string;
  lastSeen?: string | null;
  context: Record<string, unknown>;
}

export interface LogLine {
  text: string;
  ts?: string | null;
}

export interface Service {
  id: string;
  name: string;
  type: string;
  status: Status;
  host?: string | null;
  icon?: string | null;
  group?: string | null;
  description?: string | null;
  banner?: string | null;
  sortOrder: number;
  visible: boolean;
  metrics: Metric[];
  actions: ServiceAction[];
  hasLogs: boolean;
  hasConfig: boolean;
  failure?: FailureDetail | null;
}

export interface ContainerConfig {
  env: Record<string, string>;
  cpuLimit?: string | null;
  memLimit?: string | null;
  restartPolicy: string;
}

export interface ServiceConfigState {
  applied: ContainerConfig;
  pending: ContainerConfig | null;
}

export interface HostInfo {
  id: string;
  name: string;
  address?: string | null;
  status: Status;
  model?: string | null;
  icon?: string | null;
  uptimeSeconds?: number | null;
  cpuPercent?: number | null;
  cpuCores?: number | null;
  cpuFreqMhz?: number | null;
  memPercent?: number | null;
  memUsedBytes?: number | null;
  memTotalBytes?: number | null;
  diskPercent?: number | null;
  diskUsedBytes?: number | null;
  diskTotalBytes?: number | null;
  temperatureC?: number | null;
  isLocal: boolean;
  metrics: Metric[];
  actions: HostAction[];
  lastActionResult?: ActionResult | null;
  failure?: FailureDetail | null;
}

export interface NetworkTarget {
  id: string;
  name: string;
  kind: "internet" | "gateway" | "host" | "device";
  address?: string | null;
  status: Status;
  icon?: string | null;
  latencyMs?: number | null;
  failure?: FailureDetail | null;
}

export interface NetworkTraffic {
  downloadMbps: number;
  uploadMbps: number;
  totalDownloadedBytes: number;
  totalUploadedBytes: number;
  periodLabel: string;
}

export interface NetworkSnapshot {
  targets: NetworkTarget[];
  traffic: NetworkTraffic;
  localAddress?: string | null;
  activeInterface?: string | null;
}

export interface FleetSummary {
  totalHosts: number;
  onlineHosts: number;
  totalCores?: number | null;
  totalMemBytes?: number | null;
  usedMemBytes?: number | null;
  totalDiskBytes?: number | null;
  usedDiskBytes?: number | null;
  totalPowerDrawW?: number | null;
  containersRunning: number;
  containersTotal: number;
}

export interface Snapshot {
  hosts: HostInfo[];
  overallStatus: Status;
  services: Service[];
  network: NetworkSnapshot;
  dashboard: {
    title: string;
    tagline?: string | null;
    theme: "dark" | "light";
    accentColor?: string | null;
    density: "compact" | "comfortable";
  };
  alertsActive: number;
  timestamp: number;
}

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

// This one domain shape (from backend/persistence/alerts.py via
// Alert.to_dict()) is camelCase like every other hand-written to_dict().
// The alerting *settings* (thresholds, notifiers) are a different story
// -- they live inside AppConfig and travel through GET/PATCH /api/config,
// which dumps Pydantic's own (snake_case) field names, matching every
// other Settings-page field already handled that way -- so those are
// deliberately left as loosely-typed objects in SettingsPage.tsx rather
// than given a strict, mismatched-casing interface here.
export interface Alert {
  id: string;
  fingerprint: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  metric: string;
  targetType: "host" | "service";
  targetId: string;
  targetName: string;
  value?: number | null;
  threshold?: number | null;
  triggeredAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  acknowledgedAt?: string | null;
  muted: boolean;
  snoozedUntil?: string | null;
  suggestedAction?: string | null;
}

// Home page layout. Snake-case like every other config-sourced shape
// (see the note on Alert above) -- this comes from GET/PATCH
// /api/config, not a hand-written to_dict().
export type WidgetType = "host_overview" | "host_metric" | "services_grid" | "fleet_overview" | "custom_card";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  visible: boolean;
  host_id?: string | null;
  metric?: "cpu" | "mem" | "disk" | "temp" | null;
  display?: "gauge" | "sparkline" | "numeric" | null;
  group?: string | null;
  name?: string | null;
  icon?: string | null;
  target_type?: "service" | "host" | null;
  target_id?: string | null;
  action_kind?: string | null;
}
