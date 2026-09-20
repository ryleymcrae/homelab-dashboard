import React, { useState } from "react";
import { api } from "../api/client";
import { useNavigate } from "react-router-dom";
import { METRIC_LABEL, describeMetric, resolveMetricDisplay } from "../api/metrics";
import { HostMetricTile } from "./HostMetricTile";
import { useHostHistory } from "../hooks/useHostHistory";
import { useSnapshot } from "../hooks/SnapshotContext";
import { ServiceIcon } from "./ServiceIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { useActionDetails } from "../hooks/useActionDetails";
import { useAuth } from "../hooks/AuthContext";
import type { HostInfo, WidgetConfig } from "../api/types";

/**
 * A single host+metric tile -- the "per-widget configuration" piece of the
 * Home layout system. Drawn by the same HostMetricTile as the host tile
 * row, in the style dashboard.metric_display sets for that metric unless
 * this widget overrides it (`display`); the color is always
 * metric_display's (frontend/src/api/metrics.ts).
 */
export function HostMetricWidget({ host, metric, display }: { host: HostInfo; metric: WidgetConfig["metric"]; display: WidgetConfig["display"] }) {
  const { snapshot } = useSnapshot();
  const navigate = useNavigate();
  const resolved = metric ? resolveMetricDisplay(snapshot?.dashboard.metricDisplay, metric, display) : null;
  const history = useHostHistory(host.id, resolved?.style === "sparkline");

  if (!metric || !resolved) return null;
  const reading = describeMetric(host, metric, snapshot?.alertThresholds?.[host.id]);
  return (
    <div className="card" style={{ padding: "var(--space-2)" }}>
      <HostMetricTile
        label={`${METRIC_LABEL[metric].toUpperCase()} · ${host.name.toUpperCase()}`}
        {...reading}
        history={metric === "cpu" ? history.cpu : metric === "mem" ? history.mem : undefined}
        display={resolved}
        onSelect={() => navigate(`/devices?host=${encodeURIComponent(host.id)}`)}
      />
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
