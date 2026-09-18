import React from "react";

/**
 * Shown on a service's detail page whenever a config change has been
 * saved but not yet applied (backend/providers/base.py:ServiceConfigState
 * .pending) -- env vars/resource limits/restart policy all require a
 * restart (a real container needs recreating) to take effect, so this
 * stays visible until one happens. Same card-with-tinted-border language
 * as FailureBanner, in warning rather than danger colors since nothing
 * is actually wrong.
 */
export function PendingRestartBanner({ onRestartNow }: { onRestartNow: () => void }) {
  return (
    <div
      className="card"
      style={{
        borderColor: "var(--color-warning)",
        background: "var(--color-warning-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="status-dot status-dot--warning" />
        <div style={{ fontSize: "var(--text-sm)" }}>
          Configuration changed — restart to apply.
        </div>
      </div>
      <button className="btn btn--primary" onClick={onRestartNow}>
        Restart Now
      </button>
    </div>
  );
}
