/** Small, dependency-free helpers for deriving the accent-color token
 * family (--color-primary / --color-primary-strong / --color-primary-soft)
 * from a single hex value someone picks in Settings, so accent-color
 * customization is additive to the existing token set (tokens.css)
 * rather than requiring every component to know about a "custom" color. */

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

/** Mixes toward black (negative) or white (positive) by `amount` (0-1). */
export function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const [r, g, b] = rgb.map((c) => c + (target - c) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function isValidHexColor(hex: string): boolean {
  return hexToRgb(hex) !== null;
}

/** Applies (or clears) the accent-color override on the document root.
 * Additive to the existing dark/light token sets in tokens.css -- this
 * only ever overrides the three --color-primary* custom properties,
 * never restructures how components reference them. */
export function applyAccentColor(hex: string | null | undefined): void {
  const root = document.documentElement.style;
  if (!hex || !isValidHexColor(hex)) {
    root.removeProperty("--color-primary");
    root.removeProperty("--color-primary-strong");
    root.removeProperty("--color-primary-soft");
    return;
  }
  root.setProperty("--color-primary", hex);
  root.setProperty("--color-primary-strong", shade(hex, -0.15));
  root.setProperty("--color-primary-soft", toRgba(hex, 0.16));
}
