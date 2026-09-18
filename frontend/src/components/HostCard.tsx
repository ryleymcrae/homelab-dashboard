import React from "react";
import { Gauge } from "../charts/Gauge";
import { StatusPill } from "./StatusPill";
import { FailureBanner } from "./FailureBanner";
import { ServiceIcon } from "./ServiceIcon";
import { formatDuration } from "../api/format";
import type { HostInfo } from "../api/types";

/**
 * Renders one configured host -- local or remote -- identically. A host
 * monitored via reachability only (no agent_url) simply has null metric
 * fields, which the Gauges already render as "unavailable"; there is no
 * separate code path for "the local machine" vs. any other host.
 */
export function HostCard({ host }: { host: HostInfo }) {
  if (host.status === "offline" && host.failure) {
    return <FailureBanner title={`${host.name.toUpperCase()} OFFLINE`} failure={host.failure} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
      </div>

      <div className="grid grid-4">
        <div className="card" style={{ display: "flex", justifyContent: "center" }}>
          <Gauge label="CPU" value={host.cpuPercent ?? null} displayValue={`${host.cpuPercent ?? "—"}%`} color="var(--color-primary)" unavailable={host.cpuPercent == null} />
        </div>
        <div className="card" style={{ display: "flex", justifyContent: "center" }}>
          <Gauge label="RAM" value={host.memPercent ?? null} displayValue={`${host.memPercent ?? "—"}%`} color="var(--color-success)" unavailable={host.memPercent == null} />
        </div>
        <div className="card" style={{ display: "flex", justifyContent: "center" }}>
          <Gauge
            label="TEMP"
            value={host.temperatureC ?? null}
            max={100}
            displayValue={`${host.temperatureC ?? "—"}°C`}
            color="var(--color-warning)"
            unavailable={host.temperatureC == null}
          />
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontWeight: 600 }}>MEMORY</div>
          <div style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>
            {host.memUsedBytes != null && host.memTotalBytes != null
              ? `${(host.memUsedBytes / 1024 ** 3).toFixed(1)} / ${(host.memTotalBytes / 1024 ** 3).toFixed(0)} GB`
              : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
