import { GLYPHS, isCustomImage } from "./icons";

export const DEFAULT_LOGO_GLYPH = "▲";

/**
 * The browser tab icon for dashboard.favicon: an image URL as-is, or a
 * glyph drawn into an SVG in the current accent color -- the default
 * being the same ▲ as the top-bar logo. Colors are read from the live
 * theme tokens rather than hard-coded, so an accent change carries over.
 */
export function faviconHref(icon: string | null | undefined): string {
  if (isCustomImage(icon)) return icon;
  const glyph = (icon && GLYPHS[icon]) || DEFAULT_LOGO_GLYPH;
  const styles = getComputedStyle(document.documentElement);
  const fg = styles.getPropertyValue("--color-primary").trim() || "#3b82f6";
  const bg = styles.getPropertyValue("--color-bg-elevated").trim() || "#131b28";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="45" font-size="38" text-anchor="middle" fill="${fg}" font-family="DejaVu Sans, sans-serif">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyFavicon(icon: string | null | undefined): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const href = faviconHref(icon);
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
