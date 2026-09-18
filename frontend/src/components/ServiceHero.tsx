import React, { useState } from "react";
import type { Service, ServiceAction } from "../api/types";
import { ServiceIcon } from "./ServiceIcon";
import { StatusPill } from "./StatusPill";
import { formatMetricValue } from "../api/format";
import { useAuth } from "../hooks/AuthContext";

function actionClass(kind: string): string {
  return kind === "stop" ? "btn--danger" : kind === "start" ? "btn--success" : "btn--primary";
}

/**
 * Name/icon/status, plus player count when the service reports it (a
 * "players" metric -- e.g. a game server) -- always a plain full-width
 * row, whether or not this service has splash art below it.
 */
export function ServiceHeader({ service }: { service: Service }) {
  const hasBanner = !!service.banner;
  const playersMetric = service.metrics.find((m) => m.key === "players");
  const subtitle = `${service.type.replace("custom:", "")}${service.host ? ` · ${service.host}` : ""}`;

  const content = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ServiceIcon icon={service.icon} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "var(--text-md)" }}>{service.name}</div>
        {!hasBanner && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{subtitle}</div>
        )}
      </div>
      <StatusPill status={service.status} />
      {playersMetric && (
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: "var(--text-md)" }}>
            {formatMetricValue(playersMetric.value, playersMetric.type)}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Players</div>
        </div>
      )}
    </div>
  );

  // Bannerless services keep the exact plain identity card every service
  // has always had; a banner instead makes this row sit directly on the
  // page background, matching the splash-art layout below it.
  return hasBanner ? content : <div className="card">{content}</div>;
}

/**
 * Splash art (with the icon overlaid, bottom-left, on a gradient scrim)
 * plus action buttons in a left column, and the metrics table in a
 * right column -- or, without a banner, the same buttons/metrics simply
 * stacked full-width like before. Never a dead gap where art was
 * configured but failed to load: that just quietly drops back to the
 * stacked layout instead.
 */
export function ServiceBody({
  service,
  onAction,
  onViewLogs,
  onEditConfig,
}: {
  service: Service;
  onAction: (action: ServiceAction) => void;
  onViewLogs?: () => void;
  onEditConfig?: () => void;
}) {
  const { canAct } = useAuth();
  const [bannerFailed, setBannerFailed] = useState(false);
  const showBanner = !!service.banner && !bannerFailed;
  // "players" gets its own spot in the header; "update_available" is only
  // worth a row when true -- "no update available" is the default,
  // expected state and would just be noise in every service's metrics list.
  const tableMetrics = service.metrics.filter(
    (m) => m.key !== "players" && !(m.key === "update_available" && !m.value)
  );

  // View Logs stays available under guest mode -- it's read-only, not an
  // admin action (spec: guest mode "leaves only viewing"). Everything
  // else here mutates state, so it's gated on `canAct`.
  const actionsRow = ((canAct && service.actions.length > 0) || service.hasLogs || (canAct && service.hasConfig)) && (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {canAct &&
        service.actions.map((action) => (
          <button
            key={action.kind}
            className={`btn ${actionClass(action.kind)}`}
            style={{ flex: 1 }}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
      {service.hasLogs && (
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onViewLogs}>
          View Logs
        </button>
      )}
      {canAct && service.hasConfig && (
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onEditConfig}>
          Edit Config
        </button>
      )}
    </div>
  );

  const metricsCard = tableMetrics.length > 0 && (
    <div className="card">
      <div className="section-title">METRICS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 10, columnGap: 16 }}>
        {tableMetrics.map((m) => {
          const isUpdateFlag = m.key === "update_available" && !!m.value;
          return (
            <React.Fragment key={m.key}>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>{m.label}</div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  textAlign: "right",
                  color: isUpdateFlag ? "var(--color-warning)" : undefined,
                }}
              >
                {isUpdateFlag ? "⬆ Update available" : formatMetricValue(m.value, m.type, m.unit)}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );

  if (!service.banner) {
    return (
      <>
        {actionsRow}
        {metricsCard}
      </>
    );
  }

  return (
    <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: "3 1 320px", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {showBanner && (
          <div
            style={{
              position: "relative",
              aspectRatio: "16 / 9",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              background: "var(--color-surface-2)",
            }}
          >
            <img
              src={service.banner}
              alt=""
              onError={() => setBannerFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 55%)",
              }}
            />
            <div style={{ position: "absolute", left: 12, bottom: 12 }}>
              <ServiceIcon icon={service.icon} size={40} />
            </div>
          </div>
        )}
        {actionsRow}
      </div>
      <div style={{ flex: "2 1 220px" }}>{metricsCard}</div>
    </div>
  );
}
