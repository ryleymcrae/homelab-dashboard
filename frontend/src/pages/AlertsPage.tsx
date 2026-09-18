import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatTimestamp } from "../api/format";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useActionDetails } from "../hooks/useActionDetails";
import { useAuth } from "../hooks/AuthContext";
import type { Alert, AlertSeverity } from "../api/types";

const STATUS_TABS = ["active", "acknowledged", "resolved", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const SNOOZE_OPTIONS = [
  { label: "1h", minutes: 60 },
  { label: "8h", minutes: 480 },
  { label: "24h", minutes: 1440 },
];

function severityColor(severity: AlertSeverity): string {
  if (severity === "critical") return "var(--color-danger)";
  if (severity === "warning") return "var(--color-warning)";
  return "var(--color-primary)";
}

function isSnoozed(alert: Alert): boolean {
  return !!alert.snoozedUntil && new Date(alert.snoozedUntil).getTime() > Date.now();
}

function AlertCard({ alert, onChanged }: { alert: Alert; onChanged: () => void }) {
  const { canAct } = useAuth();
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const suggestedAction = useActionDetails(alert.targetType, alert.targetId, alert.suggestedAction);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const runSuggestedAction = () =>
    run(async () => {
      if (alert.targetType === "service") await api.runAction(alert.targetId, alert.suggestedAction!);
      else await api.runHostAction(alert.targetId, alert.suggestedAction!);
      setConfirming(false);
    });

  return (
    <div className="card" style={{ borderLeft: `4px solid ${severityColor(alert.severity)}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{alert.title}</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", marginTop: 2 }}>{alert.message}</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", marginTop: 6 }}>
            {formatTimestamp(alert.triggeredAt)} · {alert.targetName}
          </div>
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "right", textTransform: "capitalize" }}>
          {alert.status}
          {alert.muted && " · muted"}
          {isSnoozed(alert) && " · snoozed"}
        </div>
      </div>

      {!canAct && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: 8 }}>
          Guest mode is active -- log in to acknowledge, mute, snooze, or act on alerts.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", position: "relative" }}>
        {canAct && alert.status === "active" && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => api.acknowledgeAlert(alert.id))}>
            Acknowledge
          </button>
        )}
        {canAct && alert.status !== "resolved" && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => api.muteAlert(alert.id, !alert.muted))}>
            {alert.muted ? "Unmute" : "Mute"}
          </button>
        )}
        {canAct && alert.status !== "resolved" && (
          <>
            <button className="btn btn--ghost" disabled={busy} onClick={() => setSnoozeOpen((v) => !v)}>
              Snooze
            </button>
            {snoozeOpen && (
              <div
                className="card"
                style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 10, display: "flex", flexDirection: "column", minWidth: 100 }}
              >
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.minutes}
                    className="btn btn--ghost"
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => {
                      setSnoozeOpen(false);
                      run(() => api.snoozeAlert(alert.id, opt.minutes));
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {canAct && suggestedAction && (
          <button className="btn btn--primary" disabled={busy} onClick={() => setConfirming(true)}>
            {suggestedAction.label}
          </button>
        )}
      </div>

      {confirming && suggestedAction && (
        <ConfirmDialog
          action={suggestedAction}
          targetName={alert.targetName}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={runSuggestedAction}
        />
      )}
    </div>
  );
}

export function AlertsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusTab>("active");
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getAlerts(statusFilter === "all" ? undefined : statusFilter)
      .then((data) => {
        setAlerts(data);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  };

  useEffect(() => {
    setAlerts(null);
    load();
    // Matches the alerting loop's own evaluation cadence
    // (backend/api/main.py:_ALERT_EVAL_INTERVAL_SECONDS) -- no point
    // polling faster than new alerts could possibly appear.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="page">
      <div style={{ display: "flex", gap: 4 }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            className="btn"
            onClick={() => setStatusFilter(tab)}
            style={{
              padding: "6px 14px",
              fontSize: "var(--text-sm)",
              textTransform: "capitalize",
              background: statusFilter === tab ? "var(--color-primary-soft)" : "transparent",
              color: statusFilter === tab ? "var(--color-primary)" : "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {error && <div style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{error}</div>}
      {!alerts && !error && <div style={{ color: "var(--color-text-muted)" }}>Loading…</div>}
      {alerts && alerts.length === 0 && (
        <div className="card" style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
          No {statusFilter === "all" ? "" : statusFilter} alerts.
        </div>
      )}
      {alerts?.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onChanged={load} />
      ))}
    </div>
  );
}
