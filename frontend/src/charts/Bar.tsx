import React from "react";

/** A horizontal percent-filled meter -- Storage's default in the host
 * tile row. `percent` null (metric unavailable) shows an empty track,
 * never a fabricated 0% fill. */
export function Bar({ percent, color = "var(--color-primary)", label }: { percent: number | null; color?: string; label: string }) {
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      {percent != null && <div className="meter__fill" style={{ width: `${clamped}%`, background: color }} />}
    </div>
  );
}
