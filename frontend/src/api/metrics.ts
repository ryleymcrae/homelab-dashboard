/**
 * How a host's headline metrics (CPU/Memory/Storage/Temperature) are
 * drawn -- one definition shared by the tile row (Home's HostCard and the
 * Devices page) and Home's `host_metric` widgets, so there is exactly one
 * place that decides "how CPU looks": `dashboard.metric_display`
 * (Settings > Appearance). A widget may override the *style* for its own
 * placement; the color always comes from metric_display.
 */
import { formatBytes, formatTemperature } from "./format";
import type { AlertThresholds, HostInfo } from "./types";

export type MetricKey = "cpu" | "mem" | "disk" | "temp";
export type MetricStyle = "numeric" | "sparkline" | "gauge" | "bar";

/** config.yml / snapshot shape: anything may be missing (older config). */
export type MetricDisplayPrefs = Partial<Record<MetricKey, { style?: MetricStyle | null; color?: string | null }>>;

export interface ResolvedDisplay {
  style: MetricStyle;
  color: string;
  /** The user picked this color (vs. the theme default). A plain number
   * is only tinted then -- temperature's default warning orange on a
   * normal reading would look like an alert. */
  custom?: boolean;
}

export const METRIC_KEYS: MetricKey[] = ["cpu", "mem", "disk", "temp"];

export const METRIC_LABEL: Record<MetricKey, string> = { cpu: "CPU", mem: "Memory", disk: "Storage", temp: "Temperature" };

export const STYLE_LABEL: Record<MetricStyle, string> = { numeric: "Number", sparkline: "Sparkline", gauge: "Radial", bar: "Bar" };

/** Mirrors backend/config/schema.py's per-metric Literal types. Only CPU
 * and memory have a history series to draw; temperature has no natural
 * 0-100 scale, so the tile row shows it as a number. */
export const TILE_STYLES: Record<MetricKey, MetricStyle[]> = {
  cpu: ["numeric", "sparkline", "gauge"],
  mem: ["numeric", "sparkline", "gauge"],
  disk: ["numeric", "gauge", "bar"],
  temp: ["numeric"],
};

/** A Home widget could always show temperature as a gauge (0-100 °C), so
 * that stays available there. */
export const WIDGET_STYLES: Record<MetricKey, MetricStyle[]> = { ...TILE_STYLES, temp: ["numeric", "gauge"] };

export const DEFAULT_STYLE: Record<MetricKey, MetricStyle> = { cpu: "sparkline", mem: "sparkline", disk: "bar", temp: "numeric" };

/** Theme tokens, so an unset color follows light/dark theme and accent. */
export const DEFAULT_COLOR: Record<MetricKey, string> = {
  cpu: "var(--chart-line-1)",
  mem: "var(--chart-line-2)",
  disk: "var(--color-primary)",
  temp: "var(--color-warning)",
};

/** A saved style a metric can't draw (e.g. an old Storage "sparkline"
 * widget, which only ever rendered empty) falls back rather than
 * breaking. */
export function resolveMetricDisplay(prefs: MetricDisplayPrefs | null | undefined, metric: MetricKey, widgetStyle?: MetricStyle | null): ResolvedDisplay {
  const p = prefs?.[metric] ?? {};
  const base = p.style && TILE_STYLES[metric].includes(p.style) ? p.style : DEFAULT_STYLE[metric];
  const style = widgetStyle && WIDGET_STYLES[metric].includes(widgetStyle) ? widgetStyle : base;
  return { style, color: p.color || DEFAULT_COLOR[metric], custom: !!p.color };
}

export interface MetricReading {
  /** Formatted headline value, e.g. "23%" or "54.3°C". */
  value: string;
  /** One line of context under it. */
  sub: string;
  /** 0-100 fill for a gauge/bar; null when unavailable. */
  percent: number | null;
}

const pct = (v?: number | null) => (v == null ? "—" : `${v}%`);

export function describeMetric(host: HostInfo, metric: MetricKey, thresholds?: AlertThresholds | null): MetricReading {
  switch (metric) {
    case "cpu":
      return {
        value: pct(host.cpuPercent),
        sub: `${host.cpuCores ?? "—"} cores @ ${host.cpuFreqMhz ? (host.cpuFreqMhz / 1000).toFixed(1) : "—"} GHz`,
        percent: host.cpuPercent ?? null,
      };
    case "mem":
      return { value: pct(host.memPercent), sub: `${formatBytes(host.memUsedBytes)} / ${formatBytes(host.memTotalBytes)}`, percent: host.memPercent ?? null };
    case "disk":
      return { value: pct(host.diskPercent), sub: `${formatBytes(host.diskUsedBytes)} / ${formatBytes(host.diskTotalBytes)}`, percent: host.diskPercent ?? null };
    case "temp": {
      const t = host.temperatureC;
      const limit = thresholds?.tempC;
      // Against the host's real alert threshold (defaults + its override),
      // not a hardcoded "hot" number.
      const sub =
        t == null ? "Sensor unavailable"
        : limit == null ? "No alert threshold"
        : t > limit ? `Over alert threshold (${formatTemperature(limit)})`
        : `Alert at ${formatTemperature(limit)}`;
      return { value: t == null ? "N/A" : formatTemperature(t), sub, percent: t ?? null };
    }
  }
}
