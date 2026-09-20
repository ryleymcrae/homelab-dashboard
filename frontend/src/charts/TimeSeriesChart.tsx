import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatTimestamp } from "../api/format";
import { downsample, timeTicks } from "./timeAxis";

export interface ChartAxis {
  /** Top of the scale (the bottom is 0), in this axis's units. */
  max: number;
  /** Label for a value in this axis's units -- ticks and the readout. */
  format: (value: number) => string;
  /** The color of the series drawn against it, so each axis reads as "its" line's. */
  color?: string;
}

export interface ChartSeries {
  name: string;
  color: string;
  /** `ts` in epoch seconds (as /api/history returns it); `value` in its axis's units. */
  points: { ts: number; value: number }[];
  axis?: "left" | "right";
}

interface TimeSeriesChartProps {
  series: ChartSeries[];
  left: ChartAxis;
  /** A second scale on the right, for a series in different units. */
  right?: ChartAxis;
  grid?: boolean;
  /** Shows a Grid toggle in the legend row when set. */
  onGridChange?: (on: boolean) => void;
  height?: number;
}

const AXIS_WIDTH = 50;
const TOP = 8;
const BOTTOM = 22;
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

function nearest(points: { ts: number; value: number }[], ts: number) {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ts < ts) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].ts - ts) <= Math.abs(points[hi].ts - ts) ? points[lo] : points[hi];
}

/**
 * History chart for the Devices page (CPU & Memory) and the Network page:
 * a left value axis, an optional right one for a series in other units
 * (each labelled in its line's color), time labels along the bottom in
 * the configured time zone, and an optional background grid. Tapping or
 * hovering reads out the exact values at that moment.
 *
 * Drawn at the container's real pixel width (not a stretched viewBox) so
 * text isn't distorted, and each series is thinned to a min/max pair per
 * couple of pixels before drawing -- a month of 30-second samples would
 * otherwise be ~86k points per line.
 */
export function TimeSeriesChart({ series, left, right, grid = true, onGridChange, height = 180 }: TimeSeriesChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [cursorTs, setCursorTs] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (el.clientWidth) setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry.contentRect.width && setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotLeft = AXIS_WIDTH;
  const plotRight = width - (right ? AXIS_WIDTH : 14);
  const plotBottom = height - BOTTOM;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = plotBottom - TOP;

  // reduce, not Math.min(...all): spreading ~86k arguments can overflow the stack.
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const s of series) {
    if (!s.points.length) continue;
    minTs = Math.min(minTs, s.points[0].ts);
    maxTs = Math.max(maxTs, s.points[s.points.length - 1].ts);
  }
  const hasData = Number.isFinite(minTs) && maxTs > minTs;
  const span = hasData ? maxTs - minTs : 1;

  const axisOf = (s: ChartSeries) => (s.axis === "right" && right ? right : left);
  const x = (ts: number) => plotLeft + ((ts - minTs) / span) * plotWidth;
  const y = (value: number, axis: ChartAxis) => plotBottom - Math.max(0, Math.min(1, value / (axis.max || 1))) * plotHeight;

  const drawn = useMemo(
    () => series.map((s) => ({ series: s, points: downsample(s.points, Math.ceil(plotWidth / 2)) })),
    [series, plotWidth]
  );
  const ticks = hasData ? timeTicks(minTs * 1000, maxTs * 1000, Math.max(2, Math.floor(plotWidth / 90))) : [];

  const pointerTs = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return minTs + ((e.clientX - rect.left) / (rect.width || 1)) * span;
  };
  const readout = cursorTs == null || !hasData ? [] : series.filter((s) => s.points.length).map((s) => ({ s, p: nearest(s.points, cursorTs) }));
  const snappedTs = readout[0]?.p.ts ?? null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        {series.map((s) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block" }} />
            {s.name}
          </div>
        ))}
        {onGridChange && (
          <button type="button" className="btn btn--ghost chart-toggle" aria-pressed={grid} onClick={() => onGridChange(!grid)}>
            Grid
          </button>
        )}
      </div>

      <div ref={box} style={{ position: "relative" }}>
        <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.name).join(" and ")} over time`} style={{ display: "block", overflow: "visible" }}>
          {grid &&
            FRACTIONS.map((f) => (
              <line key={`h${f}`} x1={plotLeft} x2={plotRight} y1={plotBottom - f * plotHeight} y2={plotBottom - f * plotHeight} stroke="var(--chart-grid)" strokeWidth={1} />
            ))}
          {grid && ticks.map((t) => <line key={`v${t.ms}`} x1={x(t.ms / 1000)} x2={x(t.ms / 1000)} y1={TOP} y2={plotBottom} stroke="var(--chart-grid)" strokeWidth={1} />)}
          <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="var(--color-border-strong)" strokeWidth={1} />

          <g style={{ fontSize: "var(--text-xs)" }}>
            {FRACTIONS.map((f) => (
              <text key={`l${f}`} x={plotLeft - 6} y={plotBottom - f * plotHeight} dy="0.35em" textAnchor="end" fill={left.color ?? "var(--color-text-muted)"}>
                {left.format(f * left.max)}
              </text>
            ))}
            {right &&
              FRACTIONS.map((f) => (
                <text key={`r${f}`} x={plotRight + 6} y={plotBottom - f * plotHeight} dy="0.35em" textAnchor="start" fill={right.color ?? "var(--color-text-muted)"}>
                  {right.format(f * right.max)}
                </text>
              ))}
            {ticks.map((t) => {
              const tx = x(t.ms / 1000);
              // Keep an edge label inside the plot instead of half cut off.
              const anchor = tx - plotLeft < 24 ? "start" : plotRight - tx < 24 ? "end" : "middle";
              return (
                <text key={`t${t.ms}`} x={tx} y={height - 6} textAnchor={anchor} fill="var(--color-text-muted)">
                  {t.label}
                </text>
              );
            })}
          </g>

          {drawn.map(({ series: s, points }) =>
            points.length < 2 ? null : (
              <polyline
                key={s.name}
                points={points.map((p) => `${x(p.ts)},${y(p.value, axisOf(s))}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )
          )}

          {snappedTs != null && (
            <g>
              <line x1={x(snappedTs)} x2={x(snappedTs)} y1={TOP} y2={plotBottom} stroke="var(--color-text-muted)" strokeDasharray="3 3" />
              {readout.map(({ s, p }) => (
                <circle key={s.name} cx={x(p.ts)} cy={y(p.value, axisOf(s))} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
              ))}
            </g>
          )}

          {hasData && (
            <rect
              x={plotLeft}
              y={TOP}
              width={plotWidth}
              height={plotHeight}
              fill="transparent"
              style={{ touchAction: "pan-y", cursor: "crosshair" }}
              onPointerDown={(e) => setCursorTs(pointerTs(e))}
              onPointerMove={(e) => (e.pointerType === "mouse" || e.buttons) && setCursorTs(pointerTs(e))}
              onPointerLeave={(e) => e.pointerType === "mouse" && setCursorTs(null)}
            />
          )}
        </svg>

        {!hasData && <div className="chart-empty">No history for this range yet.</div>}

        {snappedTs != null && (
          <div
            className="chart-readout"
            role="status"
            style={x(snappedTs) > width / 2 ? { right: width - x(snappedTs) + 8 } : { left: x(snappedTs) + 8 }}
            onClick={() => setCursorTs(null)}
          >
            <div className="chart-readout__time">{formatTimestamp(snappedTs * 1000)}</div>
            {readout.map(({ s, p }) => (
              <div key={s.name}>
                <span style={{ color: s.color }}>●</span> {s.name} {axisOf(s).format(p.value)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
