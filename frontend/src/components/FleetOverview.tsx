import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatBytes } from "../api/format";
import type { FleetSummary } from "../api/types";

function FleetStatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="section-title" style={{ marginBottom: 0 }}>{label}</div>
      <div style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{sub}</div>}
    </div>
  );
}

/**
 * Totals across every configured host/service -- backed by GET
 * /api/fleet (backend/providers/base.py:get_fleet_summary). Polled
 * independently of the live snapshot since it's a cheap aggregate, not
 * something that needs to move every 2 seconds. Originally System-page-
 * only; pulled out to its own file so a Home page `fleet_overview`
 * widget can render the exact same thing rather than a re-implementation.
 */
export function FleetOverview() {
  const [summary, setSummary] = useState<FleetSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.getFleetSummary().then((s) => !cancelled && setSummary(s)).catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!summary) return null;

  return (
    <div className="card">
      <div className="section-title">FLEET OVERVIEW</div>
      <div className="tile-row">
        <FleetStatTile label="HOSTS ONLINE" value={`${summary.onlineHosts} / ${summary.totalHosts}`} />
        <FleetStatTile label="TOTAL CORES" value={summary.totalCores != null ? String(summary.totalCores) : "—"} />
        <FleetStatTile
          label="TOTAL MEMORY"
          value={summary.totalMemBytes != null ? formatBytes(summary.totalMemBytes) : "—"}
          sub={summary.usedMemBytes != null ? `${formatBytes(summary.usedMemBytes)} used` : undefined}
        />
        <FleetStatTile
          label="TOTAL STORAGE"
          value={summary.totalDiskBytes != null ? formatBytes(summary.totalDiskBytes) : "—"}
          sub={summary.usedDiskBytes != null ? `${formatBytes(summary.usedDiskBytes)} used` : undefined}
        />
        <FleetStatTile label="CONTAINERS RUNNING" value={`${summary.containersRunning} / ${summary.containersTotal}`} />
        <FleetStatTile
          label="POWER DRAW"
          value={summary.totalPowerDrawW != null ? `${summary.totalPowerDrawW} W` : "N/A"}
          sub={summary.totalPowerDrawW == null ? "No power sensors available" : undefined}
        />
      </div>
    </div>
  );
}
