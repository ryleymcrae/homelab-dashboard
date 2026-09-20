import React from "react";
import { Link } from "react-router-dom";
import type { Service } from "../api/types";
import { formatMetricValue } from "../api/format";
import { StatusPill } from "./StatusPill";
import { ServiceIcon } from "./ServiceIcon";

interface ServiceCardProps {
  service: Service;
  compact?: boolean;
}

/**
 * Renders ANY service -- Docker container, systemd unit, HTTP endpoint,
 * TCP target, or plugin -- identically. Never branches on `service.type`
 * for layout; only `metrics`/`actions` (already filtered by the adapter)
 * drive what's shown, per spec section 12 ("never show fake or
 * meaningless fields").
 */
export function ServiceCard({ service, compact }: ServiceCardProps) {
  const secondary = service.metrics.find((m) => m.secondary);

  return (
    <Link
      to={`/services/${service.id}`}
      className="list-row"
      style={{
        alignItems: "center",
        gap: 12,
        minHeight: compact ? 56 : 64,
      }}
    >
      <ServiceIcon icon={service.icon} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "var(--text-base)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {service.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <StatusPill status={service.status} />
          {secondary && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {formatMetricValue(secondary.value, secondary.type, secondary.unit)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
