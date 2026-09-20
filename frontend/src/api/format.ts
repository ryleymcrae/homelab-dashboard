export type TemperatureUnit = "celsius" | "fahrenheit";

/**
 * How times and temperatures are shown -- set from the snapshot's
 * dashboard settings by App.tsx's Shell on every render, before any page
 * renders, so every formatter below agrees without each component having
 * to thread these through. The backend never converts anything: it
 * stores and sends Celsius and ISO/UTC timestamps, the same "backend is
 * the source of truth, frontend formats for display" split as bytes and
 * durations.
 */
interface DisplayPreferences {
  /** IANA zone; undefined = the browser's own (the default). */
  timeZone?: string;
  temperatureUnit: TemperatureUnit;
}

let prefs: DisplayPreferences = { temperatureUnit: "celsius" };

// An unknown zone would make every toLocale* call throw a RangeError and
// take the page down with it -- fall back to the browser's own instead.
function usableTimeZone(zone?: string | null): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

export function setDisplayPreferences(next: { timeZone?: string | null; temperatureUnit?: TemperatureUnit | null }): void {
  prefs = { timeZone: usableTimeZone(next.timeZone), temperatureUnit: next.temperatureUnit ?? "celsius" };
}

/** The zone the browser itself is in -- what "automatic" means. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Each takes an explicit unit for Settings, which previews a change
// before the next snapshot has carried it here; everything else uses the
// current preference.
export function celsiusToDisplay(celsius: number, unit: TemperatureUnit = prefs.temperatureUnit): number {
  return unit === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius;
}

export function displayToCelsius(value: number, unit: TemperatureUnit = prefs.temperatureUnit): number {
  return unit === "fahrenheit" ? ((value - 32) * 5) / 9 : value;
}

export function temperatureSymbol(unit: TemperatureUnit = prefs.temperatureUnit): string {
  return unit === "fahrenheit" ? "°F" : "°C";
}

/** A Celsius reading in the chosen unit. Whole degrees in Fahrenheit
 * (a converted 54.3°C is 129.74°F -- false precision); Celsius as
 * reported. */
export function formatTemperature(celsius?: number | null, unit: TemperatureUnit = prefs.temperatureUnit): string {
  if (celsius == null || Number.isNaN(celsius)) return "—";
  const value = unit === "fahrenheit" ? Math.round(celsiusToDisplay(celsius, unit)) : celsius;
  return `${value}${temperatureSymbol(unit)}`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Byte labels for a chart axis: one unit for the whole axis, picked from
 * its maximum, so it reads "0 GB, 4 GB ... 16 GB" rather than starting at
 * "0 B". */
export function bytesAxisFormatter(max: number): (bytes: number) => string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (max >= 1024 && i < units.length - 1) {
    max /= 1024;
    i++;
  }
  return (bytes) => {
    const n = bytes / 1024 ** i;
    return `${Number.isInteger(n) ? n : n.toFixed(1)} ${units[i]}`;
  };
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatMetricValue(value: string | number | boolean, type: string, unit?: string | null): string {
  if (value == null) return "—";
  switch (type) {
    case "bytes":
      // `unit` carries a rate suffix like "/s" for throughput metrics
      // (e.g. disk/network I/O) -- a plain byte count has no unit set.
      return formatBytes(Number(value)) + (unit ?? "");
    case "duration":
      return formatDuration(Number(value));
    case "percent":
      return `${value}%`;
    case "latency_ms":
      return `${value} ms`;
    case "temperature_c":
      return formatTemperature(Number(value));
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return unit ? `${value} ${unit}` : String(value);
  }
}

/** `zone` overrides the preference (Settings' preview of a zone it hasn't saved yet). */
export function formatClock(date: Date = new Date(), zone?: string): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: zone ? usableTimeZone(zone) : prefs.timeZone });
}

export function formatDateShort(date: Date = new Date(), zone?: string): string {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: zone ? usableTimeZone(zone) : prefs.timeZone });
}

function toDate(when?: string | number | Date | null): Date | null {
  if (when == null || when === "") return null;
  const date = when instanceof Date ? when : new Date(when);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An ISO8601 string, epoch milliseconds, or Date -> a readable date/time
 * in the configured zone, for alert/job/backup/check-in timestamps.
 * `null`/`undefined` (never run yet) renders as "—" rather than "Invalid
 * Date". This (and formatLogTimestamp) is the only place a timestamp
 * gets its time zone applied. */
export function formatTimestamp(when?: string | number | Date | null): string {
  const date = toDate(when);
  if (!date) return "—";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: prefs.timeZone });
}

/** A chart axis label: time of day, or the date once ticks are a day or
 * more apart. */
export function formatAxisTime(ms: number, withDate: boolean): string {
  const date = new Date(ms);
  return withDate
    ? date.toLocaleDateString([], { month: "short", day: "numeric", timeZone: prefs.timeZone })
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: prefs.timeZone });
}

/** How far the display zone is ahead of UTC at `ms` -- what chart ticks
 * add before rounding, so "every hour" lands on :00 in *that* zone
 * (and :30 ticks in UTC for a +5:30 zone). */
export function zoneOffsetMs(ms: number): number {
  if (!prefs.timeZone) return -new Date(ms).getTimezoneOffset() * 60_000;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Log lines want seconds; anything unparseable is shown as it came. */
export function formatLogTimestamp(raw: string): string {
  const date = toDate(raw);
  if (!date) return raw;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: prefs.timeZone,
  });
}
