import React from "react";
import { Bar } from "../charts/Bar";
import { Gauge } from "../charts/Gauge";
import { Sparkline } from "../charts/Sparkline";
import { METRIC_KEYS, METRIC_LABEL, describeMetric, resolveMetricDisplay, type MetricDisplayPrefs, type MetricKey, type ResolvedDisplay } from "../api/metrics";
import { useSnapshot } from "../hooks/SnapshotContext";
import type { HostInfo } from "../api/types";

/**
 * One CPU/Memory/Storage/Temperature tile in whichever style
 * dashboard.metric_display (or a widget's override) picked: a number, a
 * number + sparkline, a radial gauge, or a number + bar. The color tints
 * the graph -- or, for a plain number, the number itself if a color was
 * chosen.
 *
 * With `onSelect` the whole tile is a button (drill into that host's
 * detail); without it, a plain panel.
 */
export function HostMetricTile({
  label,
  value,
  sub,
  percent,
  history,
  display,
  onSelect,
}: {
  label: string;
  value: string;
  sub: string;
  percent: number | null;
  history?: number[];
  display: ResolvedDisplay;
  onSelect?: () => void;
}) {
  const { style, color, custom } = display;
  const body = (
    <>
      <div className="section-title" style={{ marginBottom: 0 }}>{label}</div>
      {style === "gauge" ? (
        <Gauge label="" value={percent} displayValue={value} size={76} color={color} unavailable={percent == null} />
      ) : (
        <div style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: style === "numeric" && custom ? color : undefined }}>{value}</div>
      )}
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{sub}</div>
      {style === "sparkline" && <Sparkline values={history ?? []} color={color} />}
      {style === "bar" && <Bar percent={percent} color={color} label={`${label} ${value}`} />}
    </>
  );

  if (!onSelect) {
    return <div className={`tile tile--${style}`}>{body}</div>;
  }
  return (
    <button type="button" className={`tile tile--${style} tile--button`} onClick={onSelect} aria-label={`${label} ${value}, ${sub} -- show details`}>
      {body}
    </button>
  );
}

/**
 * A host's full tile row -- the same four tiles on Home's HostCard and
 * the Devices page, so both present a host identically. `display`
 * overrides the snapshot's metric_display (Settings' live preview).
 */
export function HostMetricTiles({
  host,
  history,
  display,
  onSelect,
}: {
  host: HostInfo;
  history: { cpu: number[]; mem: number[] };
  display?: MetricDisplayPrefs;
  onSelect?: (metric: MetricKey) => void;
}) {
  const { snapshot } = useSnapshot();
  const prefs = display ?? snapshot?.dashboard.metricDisplay;
  const thresholds = snapshot?.alertThresholds?.[host.id];
  return (
    <div className="tile-row">
      {METRIC_KEYS.map((metric) => {
        const reading = describeMetric(host, metric, thresholds);
        return (
          <HostMetricTile
            key={metric}
            label={METRIC_LABEL[metric].toUpperCase()}
            {...reading}
            history={metric === "cpu" ? history.cpu : metric === "mem" ? history.mem : undefined}
            display={resolveMetricDisplay(prefs, metric)}
            onSelect={onSelect && (() => onSelect(metric))}
          />
        );
      })}
    </div>
  );
}

/** Whether a tile row with these prefs draws any sparkline at all. */
export function needsHistory(prefs: MetricDisplayPrefs | null | undefined): boolean {
  return resolveMetricDisplay(prefs, "cpu").style === "sparkline" || resolveMetricDisplay(prefs, "mem").style === "sparkline";
}
