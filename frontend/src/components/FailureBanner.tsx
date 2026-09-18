import React from "react";
import type { FailureDetail } from "../api/types";

interface FailureBannerProps {
  title: string;
  failure: FailureDetail;
}

/**
 * Renders a distinct, informative failure state (spec section 17): never
 * collapses every problem to a generic "Offline" -- shows the specific
 * reason, message, and any diagnostic context the adapter/collector
 * provided (e.g. gateway/internet still up while a single host is down).
 */
export function FailureBanner({ title, failure }: FailureBannerProps) {
  const contextEntries = Object.entries(failure.context || {});

  return (
    <div
      className="card"
      style={{ borderColor: "var(--color-danger)", background: "var(--color-danger-soft)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span className="status-dot status-dot--offline" />
        <div style={{ fontWeight: 700, color: "var(--color-danger)" }}>{title}</div>
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text)", marginBottom: contextEntries.length ? 12 : 0 }}>
        {failure.message}
      </div>
      {contextEntries.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: "var(--text-xs)" }}>
          {failure.lastSeen && (
            <>
              <span style={{ color: "var(--color-text-muted)" }}>Last seen</span>
              <span>{failure.lastSeen}</span>
            </>
          )}
          {contextEntries.map(([key, value]) => (
            <React.Fragment key={key}>
              <span style={{ color: "var(--color-text-muted)", textTransform: "capitalize" }}>{key}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {String(value) === "online" || String(value) === "failed" ? (
                  <span className={`status-dot status-dot--${value === "online" ? "online" : "offline"}`} />
                ) : null}
                {String(value)}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
