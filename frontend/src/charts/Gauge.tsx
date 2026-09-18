import React from "react";

interface GaugeProps {
  label: string;
  value: number | null; // 0-100 (or 0-max)
  displayValue: string;
  max?: number;
  size?: number;
  color?: string;
  unavailable?: boolean;
}

/**
 * SVG circular gauge styled to match the reference image's CPU/RAM/TEMP
 * dials: thin track, colored progress arc, bold centered value, small
 * label above. Shows a muted "N/A" rather than a fabricated 0% when a
 * sensor genuinely isn't available (spec section 10/21).
 */
export function Gauge({
  label,
  value,
  displayValue,
  max = 100,
  size = 88,
  color = "var(--color-primary)",
  unavailable = false,
}: GaugeProps) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const dash = circumference * pct;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}
        >
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
          {!unavailable && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.6s ease" }}
            />
          )}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--text-md)",
            fontWeight: 700,
            color: unavailable ? "var(--color-text-faint)" : "var(--color-text)",
          }}
        >
          {unavailable ? "N/A" : displayValue}
        </div>
      </div>
    </div>
  );
}
