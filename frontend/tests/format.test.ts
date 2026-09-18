import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatMetricValue, formatTimestamp } from "../src/api/format";

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
