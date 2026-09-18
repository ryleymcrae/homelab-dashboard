import React from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

/** Minimal inline sparkline for the System page's metric cards. Pure SVG,
 * no charting library needed for something this small (keeps the JS
 * bundle light, per spec section 35). */
export function Sparkline({ values, width = 120, height = 32, color = "var(--color-primary)" }: SparklineProps) {
  if (values.length < 2) {
    return <svg width={width} height={height} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
