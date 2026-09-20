import { afterEach, describe, expect, it } from "vitest";
import {
  celsiusToDisplay,
  displayToCelsius,
  bytesAxisFormatter,
  formatBytes,
  formatClock,
  formatDuration,
  formatLogTimestamp,
  formatMetricValue,
  formatTemperature,
  formatTimestamp,
  setDisplayPreferences,
} from "../src/api/format";

afterEach(() => setDisplayPreferences({}));

describe("formatBytes", () => {
  it("formats bytes into human-readable units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("returns an em dash for null/undefined", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats seconds into d/h/m", () => {
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3661)).toBe("1h 1m");
    expect(formatDuration(90000)).toBe("1d 1h");
  });

  it("returns an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatMetricValue", () => {
  it("formats percent metrics with a % suffix", () => {
    expect(formatMetricValue(42, "percent")).toBe("42%");
  });

  it("formats latency metrics with ms suffix", () => {
    expect(formatMetricValue(24, "latency_ms")).toBe("24 ms");
  });

  it("formats boolean metrics as Yes/No", () => {
    expect(formatMetricValue(true, "boolean")).toBe("Yes");
    expect(formatMetricValue(false, "boolean")).toBe("No");
  });

  it("passes through text metrics, appending a unit if given", () => {
    expect(formatMetricValue("1.2.3", "text")).toBe("1.2.3");
    expect(formatMetricValue(5, "count", "players")).toBe("5 players");
  });
});

describe("formatTimestamp", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(undefined)).toBe("—");
  });

  it("returns an em dash for an unparseable string", () => {
    expect(formatTimestamp("not-a-date")).toBe("—");
  });

  it("formats a valid ISO timestamp", () => {
    expect(formatTimestamp("2026-01-15T10:30:00Z")).not.toBe("—");
  });
});


describe("time zone preference", () => {
  const instant = "2026-01-15T12:30:00Z";

  it("renders every timestamp in the configured zone", () => {
    setDisplayPreferences({ timeZone: "Asia/Tokyo" });
    expect(formatTimestamp(instant)).toMatch(/09:30/);
    expect(formatClock(new Date(instant))).toMatch(/09:30/);
    setDisplayPreferences({ timeZone: "America/New_York" });
    expect(formatTimestamp(instant)).toMatch(/07:30/);
  });

  it("accepts epoch milliseconds and Dates as well as ISO strings", () => {
    setDisplayPreferences({ timeZone: "UTC" });
    expect(formatTimestamp(Date.parse(instant))).toBe(formatTimestamp(instant));
    expect(formatTimestamp(new Date(instant))).toBe(formatTimestamp(instant));
  });

  it("falls back to the browser's zone instead of throwing on an unknown one", () => {
    setDisplayPreferences({ timeZone: "Mars/Olympus_Mons" });
    expect(() => formatTimestamp(instant)).not.toThrow();
    expect(formatTimestamp(instant)).not.toBe("—");
  });

  it("lets a preview override the preference", () => {
    setDisplayPreferences({ timeZone: "UTC" });
    expect(formatClock(new Date(instant), "Asia/Tokyo")).toMatch(/09:30/);
  });

  it("shows log timestamps with seconds, and unparseable ones untouched", () => {
    setDisplayPreferences({ timeZone: "UTC" });
    expect(formatLogTimestamp("2026-01-15T12:30:45.123456789Z")).toMatch(/12:30:45/);
    expect(formatLogTimestamp("not a time")).toBe("not a time");
  });
});

describe("temperature unit preference", () => {
  it("shows Celsius as reported by default", () => {
    expect(formatTemperature(54.3)).toBe("54.3°C");
    expect(formatMetricValue(54.3, "temperature_c")).toBe("54.3°C");
    expect(formatTemperature(null)).toBe("—");
  });

  it("converts to whole degrees Fahrenheit when chosen", () => {
    setDisplayPreferences({ temperatureUnit: "fahrenheit" });
    expect(formatTemperature(54.3)).toBe("130°F");
    expect(formatMetricValue(100, "temperature_c")).toBe("212°F");
  });

  it("round-trips a threshold through the display unit", () => {
    for (const c of [0, 55, 70, 90]) {
      expect(displayToCelsius(celsiusToDisplay(c, "fahrenheit"), "fahrenheit")).toBeCloseTo(c);
    }
    expect(formatTemperature(70, "fahrenheit")).toBe("158°F");
  });
});

describe("bytesAxisFormatter", () => {
  it("labels a whole axis in the unit of its maximum", () => {
    const gb = bytesAxisFormatter(16 * 1024 ** 3);
    expect([0, 4, 8, 16].map((n) => gb(n * 1024 ** 3))).toEqual(["0 GB", "4 GB", "8 GB", "16 GB"]);
    expect(gb(6.3 * 1024 ** 3)).toBe("6.3 GB");
    expect(bytesAxisFormatter(512 * 1024 ** 2)(128 * 1024 ** 2)).toBe("128 MB");
  });
});
