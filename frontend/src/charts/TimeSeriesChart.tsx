import React from "react";

interface Series {
  name: string;
  color: string;
  points: { ts: number; value: number }[];
}

interface TimeSeriesChartProps {
  series: Series[];
  height?: number;
  yMax?: number;
}

/** Multi-series time chart for System page history (CPU & Memory), styled
 * to match the reference: gridlines, thin lines, small legend dots, muted
 * axis labels. */
export function TimeSeriesChart({ series, height = 160, yMax = 100 }: TimeSeriesChartProps) {
  const width = 700;
  const padding = 28;
  const allTs = series.flatMap((s) => s.points.map((p) => p.ts));
  const minTs = allTs.length ? Math.min(...allTs) : 0;
  const maxTs = allTs.length ? Math.max(...allTs) : 1;
  const spanTs = maxTs - minTs || 1;

  const xFor = (ts: number) => padding + ((ts - minTs) / spanTs) * (width - padding * 2);
  const yFor = (v: number) => height - padding - (Math.min(v, yMax) / yMax) * (height - padding * 2);

  const gridLines = [0, 25, 50, 75, 100];

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
        {series.map((s) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block" }} />
            {s.name}
          </div>
        ))}
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {gridLines.map((g) => (
          <line
            key={g}
            x1={padding}
            x2={width - padding}
            y1={yFor(g)}
            y2={yFor(g)}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}
        {series.map((s) => {
          if (s.points.length < 2) return null;
          const path = s.points.map((p) => `${xFor(p.ts)},${yFor(p.value)}`).join(" ");
          return (
            <polyline
              key={s.name}
              points={path}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </div>
  );
}
