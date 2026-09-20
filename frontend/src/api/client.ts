import type {
  Alert,
  AssetInfo,
  BackupStatus,
  ContainerConfig,
  FleetSummary,
  HostInfo,
  IntegrationStatusEntry,
  LogLine,
  Metric,
  NetworkSnapshot,
  ScheduledJob,
  Service,
  ServiceConfigState,
  Snapshot,
} from "./types";

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...init,
  });
  if (res.status === 401) {
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/** FastAPI's `{"detail": ...}` as a readable message (and, for a 409 on
 * an image still in use, where it's used). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public usedBy: string[] = []) {
    super(message);
    this.name = "ApiError";
  }
}

async function assetRequest<T>(path: string, init: RequestInit): Promise<T> {
  // No Content-Type here: a FormData body sets its own multipart boundary.
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const message = typeof detail === "string" ? detail : detail?.message ?? `${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status, detail?.usedBy ?? []);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSnapshot: () => request<Snapshot>("/api/snapshot"),
  getHosts: () => request<HostInfo[]>("/api/hosts"),
  getHost: (id: string) => request<HostInfo>(`/api/hosts/${id}`),
  getServices: () => request<Service[]>("/api/services"),
  getService: (id: string) => request<Service>(`/api/services/${id}`),
  runAction: (id: string, kind: string) =>
    request<Service>(`/api/services/${id}/actions/${kind}`, { method: "POST" }),
  getNetwork: () => request<NetworkSnapshot>("/api/network"),
  getHistory: (series: string, hours = 6) =>
    request<{ series: string; points: { ts: number; value: number }[] }>(
      `/api/history/${encodeURIComponent(series)}?hours=${hours}`
    ),
  getFleetSummary: () => request<FleetSummary>("/api/fleet"),
  getServiceConfig: (id: string) => request<ServiceConfigState>(`/api/services/${id}/config`),
  updateServiceConfig: (id: string, patch: Partial<ContainerConfig>) =>
    request<ServiceConfigState>(`/api/services/${id}/config`, { method: "PATCH", body: JSON.stringify(patch) }),
  getConfig: () => request<Record<string, unknown>>("/api/config"),
  patchConfig: (patch: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/config", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  /** Containers on `host`'s Docker (its assigned Docker API, else the local socket). */
  discoverDocker: (host?: string | null) =>
    request<Record<string, unknown>[]>(host ? `/api/discovery/docker?host=${encodeURIComponent(host)}` : "/api/discovery/docker"),
  getHostDetail: (id: string) => request<{ metrics: Metric[] }>(`/api/hosts/${id}/detail`),
  getServiceLogs: (id: string, lines = 200) =>
    request<{ lines: LogLine[] }>(`/api/services/${id}/logs?lines=${lines}`),
  runHostAction: (id: string, kind: string) =>
    request<HostInfo>(`/api/hosts/${id}/actions/${kind}`, { method: "POST" }),
  getHostJobs: (id: string) => request<ScheduledJob[]>(`/api/hosts/${id}/jobs`),
  runHostJob: (id: string, jobId: string) =>
    request<ScheduledJob>(`/api/hosts/${id}/jobs/${jobId}/run`, { method: "POST" }),
  getHostBackupStatus: (id: string) => request<BackupStatus | null>(`/api/hosts/${id}/backup`),
  getAlerts: (status?: string) => request<Alert[]>(status ? `/api/alerts?status=${status}` : "/api/alerts"),
  acknowledgeAlert: (id: string) => request<Alert>(`/api/alerts/${id}/acknowledge`, { method: "POST" }),
  muteAlert: (id: string, muted: boolean) =>
    request<Alert>(`/api/alerts/${id}/mute`, { method: "POST", body: JSON.stringify({ muted }) }),
  snoozeAlert: (id: string, minutes: number) =>
    request<Alert>(`/api/alerts/${id}/snooze`, { method: "POST", body: JSON.stringify({ minutes }) }),
  testNotifier: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/notifiers/${id}/test`, { method: "POST" }),
  getIntegrationStatus: () => request<IntegrationStatusEntry[]>("/api/integrations"),
  testIntegration: (id: string) =>
    request<{ success: boolean; message: string } & IntegrationStatusEntry>(`/api/integrations/${id}/test`, {
      method: "POST",
    }),
  listAssets: () => request<AssetInfo[]>("/api/assets"),
  uploadAsset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return assetRequest<{ name: string; url: string }>("/api/assets", { method: "POST", body: form });
  },
  deleteAsset: (name: string) => assetRequest<{ ok: boolean }>(`/api/assets/${encodeURIComponent(name)}`, { method: "DELETE" }),
  getAuthStatus: () =>
    request<{ required: boolean; authenticated: boolean; guestMode: boolean; isAdmin: boolean }>("/api/auth/status"),
  login: (password: string) =>
    request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
};
