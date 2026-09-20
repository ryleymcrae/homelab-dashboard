/**
 * Every Settings category and every individual setting, as data -- the
 * search box (SettingsPage.tsx) jumps to a setting by `id`, and each
 * section component renders a <SettingRow id=...> (settings/controls.tsx)
 * with that same id as its scroll/highlight anchor. Adding a setting means
 * adding an entry here *and* a row in its section;
 * frontend/tests/settingsRegistry.test.ts renders every section and fails
 * if the two ever drift apart (an entry with no row would be a search
 * result that jumps nowhere).
 *
 * Glyphs are limited to ones DejaVu Sans covers, the default font on the
 * Raspberry Pi kiosk image this app targets (docs/kiosk.md) -- the same
 * reason BottomNav/ServiceIcon use plain Unicode rather than an icon font.
 */

export type CategoryId =
  | "general"
  | "appearance"
  | "branding"
  | "layout"
  | "devices"
  | "services"
  | "alerts"
  | "network"
  | "integrations"
  | "access"
  | "about";

export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
  description: string;
}

export const CATEGORIES: Category[] = [
  { id: "general", label: "General", icon: "⚙", description: "Dashboard name, time zone, and temperature unit." },
  { id: "appearance", label: "Appearance", icon: "◧", description: "Theme, colors, spacing, and how metrics are drawn." },
  { id: "branding", label: "Branding", icon: "✦", description: "Logo, browser tab icon, navigation icons, and uploaded images." },
  { id: "layout", label: "Home Layout", icon: "▦", description: "Which widgets the Home page shows, and in what order." },
  { id: "devices", label: "Devices", icon: "▣", description: "Every monitored host: its address, icon, and where its data comes from." },
  { id: "services", label: "Services", icon: "▤", description: "Every container, unit, and endpoint the dashboard checks and controls." },
  { id: "alerts", label: "Alerts", icon: "⚠", description: "When to raise an alert, and where to send notifications." },
  { id: "network", label: "Network", icon: "◈", description: "Internet and gateway checks, and network-only devices." },
  { id: "integrations", label: "Integrations", icon: "⇆", description: "Demo mode, the local Docker socket, and connections to other data sources." },
  { id: "access", label: "Access & Security", icon: "◉", description: "Guest (read-only) mode, login, and trusted kiosk IPs." },
  { id: "about", label: "About", icon: "ℹ", description: "Version, license, and how much metric history is kept." },
];

export interface SettingEntry {
  /** Anchor id: SettingRow renders `id="setting-<id>"`, and ?s=<id> jumps to it. */
  id: string;
  category: CategoryId;
  label: string;
  /** Sub-heading within the category, shown as a breadcrumb in results. */
  section?: string;
  /** Other words someone might search for ("dark mode" -> Theme). */
  keywords?: string[];
}

export const STATIC_SETTINGS: SettingEntry[] = [
  // General
  { id: "dashboard.title", category: "general", label: "Dashboard title", keywords: ["name", "heading", "header", "top bar"] },
  { id: "dashboard.tagline", category: "general", label: "Tagline", keywords: ["subtitle", "subheading", "header", "top bar"] },
  { id: "dashboard.timezone", category: "general", section: "Time & units", label: "Time zone", keywords: ["clock", "time", "date", "tz", "utc", "timestamps"] },
  { id: "dashboard.temperature_unit", category: "general", section: "Time & units", label: "Temperature unit", keywords: ["celsius", "fahrenheit", "°c", "°f", "units", "degrees"] },

  // Appearance
  { id: "dashboard.theme", category: "appearance", section: "Look & feel", label: "Theme", keywords: ["dark mode", "light mode"] },
  { id: "dashboard.accent_color", category: "appearance", section: "Look & feel", label: "Accent color", keywords: ["primary color", "highlight", "brand"] },
  { id: "dashboard.chart_grid", category: "appearance", section: "Look & feel", label: "Chart grid", keywords: ["grid lines", "history", "graph", "background"] },
  { id: "metric_display.cpu", category: "appearance", section: "Metric display", label: "CPU display", keywords: ["chart", "graph", "sparkline", "gauge", "radial", "color", "tile", "processor"] },
  { id: "metric_display.mem", category: "appearance", section: "Metric display", label: "Memory display", keywords: ["chart", "graph", "sparkline", "gauge", "radial", "color", "tile", "ram"] },
  { id: "metric_display.disk", category: "appearance", section: "Metric display", label: "Storage display", keywords: ["chart", "graph", "bar", "gauge", "radial", "color", "tile", "disk"] },
  { id: "metric_display.temp", category: "appearance", section: "Metric display", label: "Temperature color", keywords: ["color", "tile", "heat"] },
  { id: "dashboard.density", category: "appearance", section: "Look & feel", label: "Density", keywords: ["spacing", "compact", "comfortable", "touch", "font size", "bigger"] },

  // Branding
  { id: "dashboard.logo", category: "branding", section: "Top bar & browser tab", label: "Logo", keywords: ["brand", "top bar", "header", "image", "icon"] },
  { id: "dashboard.favicon", category: "branding", section: "Top bar & browser tab", label: "Favicon", keywords: ["tab icon", "browser", "bookmark", "icon"] },
  { id: "dashboard.nav_icons", category: "branding", section: "Navigation", label: "Navigation icons", keywords: ["bottom bar", "tabs", "menu", "nav", "icon"] },
  { id: "branding.images", category: "branding", section: "Uploaded images", label: "Uploaded images", keywords: ["upload", "pictures", "files", "gallery", "icons", "banners"] },

  // Home Layout
  { id: "dashboard.widgets", category: "layout", label: "Home page widgets", keywords: ["layout", "cards", "reorder", "home", "tiles"] },
  { id: "layout.add_widget", category: "layout", label: "Add a widget", keywords: ["shortcut", "custom card", "host metric", "services grid", "fleet"] },

  // Devices
  { id: "devices.hosts", category: "devices", label: "Monitored hosts", keywords: ["machines", "servers", "data source", "monitoring", "agent", "address", "this machine"] },
  { id: "devices.add", category: "devices", label: "Add a host", keywords: ["new host", "machine", "server"] },

  // Services
  { id: "services.list", category: "services", label: "Monitored services", keywords: ["docker", "container", "systemd", "unit", "http", "tcp", "prometheus", "plugin", "game server", "banner"] },
  { id: "services.add", category: "services", label: "Add a service", keywords: ["new service", "container", "discover"] },

  // Alerts
  { id: "alerting.enabled", category: "alerts", label: "Alerting enabled", keywords: ["turn off", "disable", "pause", "silence"] },
  { id: "alerting.cpu_percent", category: "alerts", section: "Thresholds", label: "CPU usage threshold", keywords: ["processor", "load"] },
  { id: "alerting.mem_percent", category: "alerts", section: "Thresholds", label: "Memory usage threshold", keywords: ["ram"] },
  { id: "alerting.disk_percent", category: "alerts", section: "Thresholds", label: "Disk usage threshold", keywords: ["storage", "space", "full"] },
  { id: "alerting.temp_c", category: "alerts", section: "Thresholds", label: "Temperature threshold", keywords: ["heat", "hot", "celsius", "fahrenheit"] },
  { id: "alerting.offline_minutes", category: "alerts", section: "Thresholds", label: "Offline duration", keywords: ["down", "unreachable", "debounce"] },
  { id: "alerting.host_overrides", category: "alerts", section: "Overrides", label: "Host overrides", keywords: ["per-host", "exception", "threshold"] },
  { id: "alerting.service_overrides", category: "alerts", section: "Overrides", label: "Service overrides", keywords: ["per-service", "exception", "offline"] },
  { id: "alerting.notifiers", category: "alerts", section: "Notifications", label: "Notifications", keywords: ["discord", "ntfy", "pushover", "webhook", "notify", "push"] },

  // Network
  { id: "network.internet_target", category: "network", section: "Health checks", label: "Internet check target", keywords: ["ping", "connectivity", "wan", "1.1.1.1"] },
  { id: "network.gateway_override", category: "network", section: "Health checks", label: "Gateway address", keywords: ["router", "default gateway"] },
  { id: "network.devices", category: "network", section: "Network-only devices", label: "Network-only devices", keywords: ["switch", "sensor", "iot", "access point"] },
  { id: "network.add_device", category: "network", section: "Network-only devices", label: "Add a network device", keywords: ["switch", "sensor", "iot", "new device"] },

  // Integrations
  { id: "demo_mode", category: "integrations", label: "Demo mode", keywords: ["simulated", "sample data", "try", "fake", "demo"] },
  { id: "integrations.docker_socket", category: "integrations", label: "Local Docker socket", keywords: ["docker.sock", "unix socket", "docker host"] },
  { id: "integrations.connections", category: "integrations", section: "Connections", label: "Data source connections", keywords: ["docker api", "prometheus", "node_exporter", "glances", "ssh", "script", "remote"] },

  // Access & Security
  { id: "guest_mode", category: "access", label: "Guest mode", keywords: ["read-only", "kiosk", "lock", "admin", "login", "wall tablet"] },
  { id: "auth.password", category: "access", label: "Dashboard password", keywords: ["login", "DASHBOARD_PASSWORD", "authentication", "sign in"] },
  { id: "auth.trusted_ips", category: "access", label: "Trusted IPs", keywords: ["kiosk", "skip login", "allowlist", "whitelist", "cidr"] },

  // About
  { id: "about.version", category: "about", label: "Version", keywords: ["release", "update"] },
  { id: "about.license", category: "about", label: "License", keywords: ["mit"] },
  { id: "about.source", category: "about", label: "Source code", keywords: ["github", "repository"] },
  { id: "history.retention_days", category: "about", section: "Stored history", label: "History retention", keywords: ["data", "storage", "days", "database", "sqlite", "keep"] },
  { id: "history.sample_interval_seconds", category: "about", section: "Stored history", label: "History sample interval", keywords: ["data", "resolution", "seconds", "frequency"] },
  { id: "history.max_rows_per_series", category: "about", section: "Stored history", label: "History size limit", keywords: ["rows", "samples", "cap", "database", "disk space"] },
];

const WIDGET_TYPE_LABEL: Record<string, string> = {
  host_overview: "Host overview",
  host_metric: "Host metric",
  services_grid: "Services grid",
  fleet_overview: "Fleet overview",
  custom_card: "Custom card",
};

export function widgetLabel(w: { type: string; host_id?: string | null; metric?: string | null; name?: string | null; group?: string | null }): string {
  const base = WIDGET_TYPE_LABEL[w.type] ?? w.type;
  const detail =
    w.type === "custom_card" ? w.name
    : w.type === "host_metric" ? [w.host_id, w.metric?.toUpperCase()].filter(Boolean).join(" · ")
    : w.type === "host_overview" ? w.host_id
    : w.type === "services_grid" ? w.group
    : null;
  return detail ? `${base} · ${detail}` : base;
}

/** Entries for things the user created (hosts, services, devices,
 * overrides, notifiers, connections, widgets), so "discord" finds the
 * Discord notifier card itself and a host's name finds that host -- not
 * just the section they live in. */
export function dynamicSettings(config: Record<string, any> | null): SettingEntry[] {
  if (!config) return [];
  const entries: SettingEntry[] = [];
  for (const h of config.hosts ?? []) {
    entries.push({ id: `host.${h.name}`, category: "devices", section: "Hosts", label: h.name, keywords: ["host", "icon", "data source", h.model, h.address].filter(Boolean) });
  }
  for (const s of config.services ?? []) {
    entries.push({ id: `service.${s.name}`, category: "services", section: s.host || "Other services", label: s.name, keywords: ["service", "icon", "banner", s.type, s.container, s.unit, s.group].filter(Boolean) });
  }
  for (const d of config.network?.devices ?? []) {
    entries.push({ id: `netdevice.${d.name}`, category: "network", section: "Network-only devices", label: d.name, keywords: ["device", "icon", d.address].filter(Boolean) });
  }
  for (const name of Object.keys(config.alerting?.host_overrides ?? {})) {
    entries.push({ id: `override.host.${name}`, category: "alerts", section: "Overrides", label: `${name} thresholds`, keywords: ["override", "host"] });
  }
  for (const name of Object.keys(config.alerting?.service_overrides ?? {})) {
    entries.push({ id: `override.service.${name}`, category: "alerts", section: "Overrides", label: `${name} offline alert`, keywords: ["override", "service"] });
  }
  for (const n of config.alerting?.notifiers ?? []) {
    entries.push({ id: `notifier.${n.id}`, category: "alerts", section: "Notifications", label: n.name, keywords: [n.type, "notifier"] });
  }
  for (const c of config.integrations?.connections ?? []) {
    entries.push({ id: `integration.${c.id}`, category: "integrations", section: "Connections", label: c.name, keywords: [c.type.replace(/_/g, " "), "connection"] });
  }
  for (const w of config.dashboard?.widgets ?? []) {
    entries.push({ id: `widget.${w.id}`, category: "layout", section: "Widgets", label: widgetLabel(w), keywords: ["widget"] });
  }
  return entries;
}

export function categoryOf(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id)!;
}

/**
 * Every whitespace-separated term has to match somewhere (label, section,
 * category, or keywords) -- "cpu thr" finds "CPU usage threshold", "disk"
 * finds both the threshold and the Disk widget. Ranked by where the match
 * landed: a label that starts with the query beats one that merely
 * contains it, which beats a keyword/section hit. Ties keep registry
 * order, so results read in the same order the settings appear on screen.
 */
export function searchSettings(entries: SettingEntry[], query: string): SettingEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: { entry: SettingEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = entry.label.toLowerCase();
    const context = [entry.section, categoryOf(entry.category).label].filter(Boolean).join(" ").toLowerCase();
    const keywords = (entry.keywords ?? []).join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) {
      let termScore = 0;
      if (label === term) termScore = 100;
      else if (label.startsWith(term)) termScore = 80;
      else if (label.split(/[\s·]+/).some((word) => word.startsWith(term))) termScore = 60;
      else if (label.includes(term)) termScore = 40;
      else if (keywords.includes(term)) termScore = 20;
      else if (context.includes(term)) termScore = 10;
      if (termScore === 0) return;
      score += termScore;
    }
    scored.push({ entry, score, index });
  });

  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.entry);
}
