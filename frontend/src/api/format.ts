export function formatBytes(bytes?: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatMetricValue(value: string | number | boolean, type: string, unit?: string | null): string {
  if (value == null) return "—";
  switch (type) {
    case "bytes":
      // `unit` carries a rate suffix like "/s" for throughput metrics
      // (e.g. disk/network I/O) -- a plain byte count has no unit set.
      return formatBytes(Number(value)) + (unit ?? "");
    case "duration":
      return formatDuration(Number(value));
    case "percent":
      return `${value}%`;
    case "latency_ms":
      return `${value} ms`;
    case "temperature_c":
      return `${value}°C`;
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return unit ? `${value} ${unit}` : String(value);
  }
}

export function formatClock(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateShort(date: Date = new Date()): string {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** ISO8601 -> a readable local date/time, for scheduled-job/backup/audit
 * timestamps. `null`/`undefined` (never run yet) renders as "—" rather
 * than "Invalid Date". */
export function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
