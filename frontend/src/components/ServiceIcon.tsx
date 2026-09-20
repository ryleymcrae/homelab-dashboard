import React, { useState } from "react";
import { GLYPHS, isCustomImage } from "../api/icons";

export { GLYPHS, isCustomImage };

/**
 * An icon value rendered bare -- no box -- for the top bar and bottom
 * nav. `fallback` is the literal glyph shown when `icon` is unset,
 * unknown, or an image that fails to load.
 */
export function IconGlyph({ icon, fallback, size = 16 }: { icon?: string | null; fallback: string; size?: number }) {
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  if (isCustomImage(icon) && imageFailed !== icon) {
    return <img src={icon} alt="" width={size} height={size} style={{ objectFit: "contain", display: "block" }} onError={() => setImageFailed(icon)} />;
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{(icon && GLYPHS[icon]) || fallback}</span>;
}

export function ServiceIcon({ icon, size = 36 }: { icon?: string | null; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  const useImage = isCustomImage(icon) && !imageFailed;

  const boxStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "var(--radius-sm)",
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size * 0.45,
    color: "var(--color-primary)",
    flexShrink: 0,
    overflow: "hidden",
  };

  if (useImage) {
    return (
      <div aria-hidden style={boxStyle}>
        <img
          src={icon!}
          alt=""
          onError={() => setImageFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  const glyph = (icon && GLYPHS[icon]) || "▢";
  return (
    <div aria-hidden style={boxStyle}>
      {glyph}
    </div>
  );
}
