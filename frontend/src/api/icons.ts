// Small, dependency-free glyph set so an icon name declared in config.yml
// (spec section 5: `icon: plex`) always renders something reasonable
// without requiring an icon library/network fetch. Unrecognized names
// fall back to a generic box glyph -- never a broken image. Every glyph
// here is covered by DejaVu Sans, the kiosk image's default font.
export const GLYPHS: Record<string, string> = {
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
  alert: "⚠",
  star: "★",
  sparkle: "✦",
  music: "♪",
  target: "◉",
};

// `icon` can also be a URL/path to a custom image (config.yml:
// `icon: /icons/plex.png`, an uploaded `/api/assets/<name>`, or a full
// https:// URL) instead of one of the glyph names above -- lets a service
// show its own logo/art rather than being limited to the built-in set.
export function isCustomImage(icon?: string | null): icon is string {
  return !!icon && !GLYPHS[icon] && (icon.startsWith("http://") || icon.startsWith("https://") || icon.startsWith("/"));
}
