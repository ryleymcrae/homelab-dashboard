import React, { useEffect, useState } from "react";
import { useSnapshot } from "../hooks/SnapshotContext";
import { api } from "../api/client";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import { niceMax } from "../charts/timeAxis";
import { useChartGrid } from "../hooks/useChartGrid";
import { StatusPill } from "../components/StatusPill";
import { ServiceIcon } from "../components/ServiceIcon";
import { formatBytes } from "../api/format";

export function NetworkPage() {
  const { snapshot } = useSnapshot();
  const [downHistory, setDownHistory] = useState<{ ts: number; value: number }[]>([]);
  const [upHistory, setUpHistory] = useState<{ ts: number; value: number }[]>([]);
  const [chartGrid, setChartGrid] = useChartGrid();

  useEffect(() => {
    const load = async () => {
      try {
        const [down, up] = await Promise.all([
          api.getHistory("network.download_mbps", 1),
          api.getHistory("network.upload_mbps", 1),
        ]);
        setDownHistory(down.points);
        setUpHistory(up.points);
      } catch {
        // non-fatal on a fresh install
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (!snapshot) return <div className="page">Loading…</div>;
  const { network } = snapshot;

  const internet = network.targets.find((t) => t.kind === "internet");
  const gateway = network.targets.find((t) => t.kind === "gateway");
  const rest = network.targets.filter((t) => t.kind !== "internet" && t.kind !== "gateway");
  let peakMbps = 0;
  for (const p of [...downHistory, ...upHistory]) peakMbps = Math.max(peakMbps, p.value);
  const maxMbps = niceMax(Math.max(10, peakMbps));

  return (
    <div className="page">
      <div className="grid grid-2">
        {internet && (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ServiceIcon icon="globe" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Internet</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                {internet.latencyMs != null ? `Ping ${internet.latencyMs} ms` : "—"}
              </div>
            </div>
            <StatusPill status={internet.status} />
          </div>
        )}
        {gateway && (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ServiceIcon icon="router" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Gateway</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                {gateway.address ?? "—"}
              </div>
            </div>
            <StatusPill status={gateway.status} />
          </div>
        )}
      </div>

      <div>
        <div className="section-title">CONFIGURED HOSTS / DEVICES</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rest.map((target) => (
            <div key={target.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <ServiceIcon icon={target.icon} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{target.name}</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{target.address}</div>
              </div>
              {target.latencyMs != null && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{target.latencyMs} ms</span>
              )}
              <StatusPill status={target.status} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-title">NETWORK TRAFFIC</div>
        <div style={{ display: "flex", gap: 20, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Download</div>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--chart-line-1)" }}>
              {network.traffic.downloadMbps} Mbps
            </div>
          </div>
          <div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Upload</div>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--chart-line-2)" }}>
              {network.traffic.uploadMbps} Mbps
            </div>
          </div>
        </div>
        <TimeSeriesChart
          grid={chartGrid}
          onGridChange={setChartGrid}
          left={{ max: maxMbps, format: (v) => `${Math.round(v)} Mbps` }}
          series={[
            { name: "Download", color: "var(--chart-line-1)", points: downHistory },
            { name: "Upload", color: "var(--chart-line-2)", points: upHistory },
          ]}
        />
      </div>

      <div className="card">
        <div className="section-title">TRANSFER TOTALS ({network.traffic.periodLabel.toUpperCase()})</div>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Total Download</div>
            <div style={{ fontWeight: 700 }}>{formatBytes(network.traffic.totalDownloadedBytes)}</div>
          </div>
          <div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Total Upload</div>
            <div style={{ fontWeight: 700 }}>{formatBytes(network.traffic.totalUploadedBytes)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
