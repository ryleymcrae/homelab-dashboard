import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { Gauge } from "../charts/Gauge";
import { Sparkline } from "../charts/Sparkline";
import { ServiceIcon } from "./ServiceIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { useActionDetails } from "../hooks/useActionDetails";
import { useAuth } from "../hooks/AuthContext";
import type { HostInfo, WidgetConfig } from "../api/types";

const METRIC_INFO: Record<
  NonNullable<WidgetConfig["metric"]>,
  { label: string; unit: string; color: string; historySeries: string | null; value: (h: HostInfo) => number | null | undefined }
> = {
  cpu: { label: "CPU", unit: "%", color: "var(--color-primary)", historySeries: "cpu", value: (h) => h.cpuPercent },
  mem: { label: "MEMORY", unit: "%", color: "var(--color-success)", historySeries: "mem", value: (h) => h.memPercent },
  disk: { label: "STORAGE", unit: "%", color: "var(--color-primary)", historySeries: null, value: (h) => h.diskPercent },
  temp: { label: "TEMP", unit: "°C", color: "var(--color-warning)", historySeries: null, value: (h) => h.temperatureC },
};

/**
 * A single host+metric+display-style tile -- the "per-widget
 * configuration" piece of the Home layout system. Reuses the exact same
 * Gauge/Sparkline components System/HostCard already use; this never
 * introduces a new visualization, just a smaller, individually
 * placeable slice of the ones that already existed.
 */
export function HostMetricWidget({ host, metric, display }: { host: HostInfo; metric: WidgetConfig["metric"]; display: WidgetConfig["display"] }) {
  const [history, setHistory] = useState<number[]>([]);
  const info = metric ? METRIC_INFO[metric] : null;
  const value = info ? info.value(host) : null;

  useEffect(() => {
    if (display !== "sparkline" || !info?.historySeries) return;
    let cancelled = false;
    api
      .getHistory(`host.${host.id}.${info.historySeries}`, 6)
      .then((d) => !cancelled && setHistory(d.points.map((p) => p.value)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [display, host.id, info?.historySeries]);

  if (!info) return null;
  const displayValue = value != null ? `${value}${info.unit}` : "N/A";
  const title = `${info.label} · ${host.name.toUpperCase()}`;

  if (display === "numeric") {
    return (
      <div className="card">
        <div className="section-title">{title}</div>
        <div style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>{displayValue}</div>
      </div>
    );
  }

  if (display === "sparkline") {
    return (
      <div className="card">
        <div className="section-title">{title}</div>
        <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 6 }}>{displayValue}</div>
        <Sparkline values={history} color={info.color} />
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontWeight: 600 }}>{host.name.toUpperCase()}</div>
      <Gauge label={info.label} value={value ?? null} displayValue={displayValue} color={info.color} unavailable={value == null} />
    </div>
  );
}

/**
 * A shortcut tile wired to an existing service/host action -- e.g. "Stop
 * Valheim" or "Reboot NAS" -- one button, no new action of its own. Uses
 * the target's *real* declared action (useActionDetails) for the actual
 * confirm text, so it's exactly as safe as triggering that same action
 * from the service/host's own page: same confirmation, same typed-name
 * requirement for a reboot, same audit log entry.
 */
export function CustomCardWidget({ widget }: { widget: WidgetConfig }) {
  const { canAct } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useActionDetails(widget.target_type, widget.target_id, widget.action_kind);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (widget.target_type === "service") await api.runAction(widget.target_id!, widget.action_kind!);
      else await api.runHostAction(widget.target_id!, widget.action_kind!);
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ServiceIcon icon={widget.icon} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{widget.name}</div>
        {error && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-danger)" }}>{error}</div>}
      </div>
      {canAct && action && (
        <button className={`btn ${action.destructive ? "btn--danger" : "btn--primary"}`} onClick={() => setConfirming(true)}>
          {action.label}
        </button>
      )}
      {confirming && action && (
        <ConfirmDialog
          action={action}
          targetName={widget.name ?? ""}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={run}
        />
      )}
    </div>
  );
}
