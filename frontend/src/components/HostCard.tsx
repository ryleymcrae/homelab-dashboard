import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusPill } from "./StatusPill";
import { FailureBanner } from "./FailureBanner";
import { ServiceIcon } from "./ServiceIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { HostActionsMenu } from "./HostActionsMenu";
import { HostMetricTiles, needsHistory } from "./HostMetricTile";
import { ServiceCard } from "./ServiceCard";
import { api } from "../api/client";
import { useAuth } from "../hooks/AuthContext";
import { useHostHistory } from "../hooks/useHostHistory";
import { useSnapshot } from "../hooks/SnapshotContext";
import { formatDuration } from "../api/format";
import type { HostAction, HostInfo, Service } from "../api/types";

/**
 * Renders one configured host -- local or remote -- identically. A host
 * monitored via reachability only (no agent_url) simply has null metric
 * fields, which HostMetricTile already renders as "—"/"N/A"; there is no
 * separate code path for "the local machine" vs. any other host.
 *
 * Uses the exact same CPU/Memory/Storage/Temperature tile row
 * (HostMetricTiles) as DevicesPage's per-host card, fetching its own short
 * CPU/memory history when a sparkline needs it -- Home is a compact entry
 * point into the same data Devices page shows in full, not a different
 * visualization of it. Tapping a tile goes there, to that host's
 * Detailed Metrics.
 *
 * One outer card holds identity, metrics, actions, and (when passed) the
 * services running on it together -- a control-panel-style grouping
 * rather than a separate floating card per concern, matching the same
 * consolidation Devices page's per-host section uses. `services` is
 * optional and caller-supplied rather than looked up here: which
 * services belong to a host is a matching decision (by `service.host`,
 * a name -- see HomePage.tsx) the caller already has to make once for
 * every host, not something this component should re-derive per host.
 */
export function HostCard({ host, services }: { host: HostInfo; services?: Service[] }) {
  const { canAct } = useAuth();
  const [pendingAction, setPendingAction] = useState<HostAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServices, setShowServices] = useState(false);
  const navigate = useNavigate();
  const { snapshot } = useSnapshot();
  const history = useHostHistory(host.id, needsHistory(snapshot?.dashboard.metricDisplay));

  if (host.status === "offline" && host.failure) {
    return <FailureBanner title={`${host.name.toUpperCase()} OFFLINE`} failure={host.failure} />;
  }

  const runAction = async (action: HostAction) => {
    setBusy(true);
    setError(null);
    try {
      await api.runHostAction(host.id, action.kind);
      setPendingAction(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showActions = canAct && host.actions.length > 0;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <ServiceIcon icon={host.icon ?? "server"} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "var(--text-md)" }}>{host.name}</div>
          {host.model && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{host.model}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <StatusPill status={host.status} />
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: 4 }}>
            Uptime {formatDuration(host.uptimeSeconds)}
          </div>
        </div>
        {showActions && <HostActionsMenu actions={host.actions} onSelect={setPendingAction} />}
      </div>

      <hr className="card-divider" />

      <HostMetricTiles host={host} history={history} onSelect={() => navigate(`/devices?host=${encodeURIComponent(host.id)}`)} />

      {error && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-danger)", marginTop: 8 }}>{error}</div>}

      {services && services.length > 0 && (
        <>
          <hr className="card-divider" />
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
            onClick={() => setShowServices((v) => !v)}
          >
            <div className="section-title" style={{ marginBottom: 0 }}>
              SERVICES ({services.length})
            </div>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{showServices ? "Hide ▲" : "Show ▼"}</span>
          </div>
          {showServices && (
            <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-2)" }}>
              {services.map((s) => (
                <ServiceCard key={s.id} service={s} compact />
              ))}
            </div>
          )}
        </>
      )}

      {pendingAction && (
        <ConfirmDialog
          action={pendingAction}
          targetName={host.name}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => runAction(pendingAction)}
        />
      )}
    </div>
  );
}
