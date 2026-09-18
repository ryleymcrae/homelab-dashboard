import React, { useState } from "react";

// Small, dependency-free glyph set so an icon name declared in config.yml
// (spec section 5: `icon: plex`) always renders something reasonable
// without requiring an icon library/network fetch. Unrecognized names
// fall back to a generic box glyph -- never a broken image.
const GLYPHS: Record<string, string> = {
  server: "▢",
  "hard-drive": "▤",
  cpu: "▣",
  film: "▶",
  home: "⌂",
  flame: "◆",
  tree: "♣",
  mountain: "▲",
  terminal: "▚",
  globe: "◎",
  router: "◈",
  plug: "⏚",
  cube: "◼",
  activity: "∿",
  microchip: "▦",
  cog: "⚙",
  docker: "▧",
};

// `icon` can also be a URL/path to a custom image (config.yml:
// `icon: /icons/plex.png` or a full https:// URL) instead of one of the
// glyph names above -- lets a service show its own logo/art rather than
// being limited to the built-in set.
function isCustomImage(icon: string): boolean {
  return !GLYPHS[icon] && (icon.startsWith("http://") || icon.startsWith("https://") || icon.startsWith("/"));
}

export function ServiceIcon({ icon, size = 36 }: { icon?: string | null; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  const useImage = !!icon && isCustomImage(icon) && !imageFailed;

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
