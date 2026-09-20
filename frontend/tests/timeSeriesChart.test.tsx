import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setDisplayPreferences } from "../src/api/format";
import { downsample, niceMax, timeTicks } from "../src/charts/timeAxis";
import { TimeSeriesChart } from "../src/charts/TimeSeriesChart";

afterEach(() => {
  cleanup();
  setDisplayPreferences({});
});

const HOUR = 3600_000;
const start = Date.UTC(2026, 0, 15, 6, 17); // 06:17 UTC

describe("timeTicks", () => {
  it("puts hourly ticks on the hour in the configured zone", () => {
    setDisplayPreferences({ timeZone: "UTC" });
    const ticks = timeTicks(start, start + 6 * HOUR, 6);
    expect(ticks.map((t) => new Date(t.ms).getUTCMinutes())).toEqual(ticks.map(() => 0));
    expect(ticks[0].label).toMatch(/07:00/);

    // India is UTC+5:30 -- its whole hours are at :30 UTC.
    setDisplayPreferences({ timeZone: "Asia/Kolkata" });
    const local = timeTicks(start, start + 6 * HOUR, 6);
    expect(local.every((t) => new Date(t.ms).getUTCMinutes() === 30)).toBe(true);
    expect(local[0].label).toMatch(/12:00/);
  });

  it("switches to date labels for multi-day ranges, on local midnight", () => {
    setDisplayPreferences({ timeZone: "America/New_York" });
    const ticks = timeTicks(start, start + 7 * 24 * HOUR, 7);
    expect(ticks.length).toBeGreaterThanOrEqual(6);
    expect(ticks[0].label).toMatch(/Jan 16/);
    expect(new Date(ticks[0].ms).getUTCHours()).toBe(5); // midnight EST
  });
});

describe("niceMax", () => {
  it("rounds up to a number whose quarters are round", () => {
    expect([100, 137, 45, 8.3, 0].map(niceMax)).toEqual([100, 200, 80, 10, 1]);
  });
});

describe("downsample", () => {
  it("thins a long series to min/max per bucket, keeping spikes and order", () => {
    const points = Array.from({ length: 10_000 }, (_, i) => ({ ts: i, value: i === 5_000 ? 99 : 10 }));
    const thin = downsample(points, 100);
    expect(thin.length).toBeLessThanOrEqual(200);
    expect(thin.some((p) => p.value === 99)).toBe(true);
    expect(thin.every((p, i) => i === 0 || p.ts > thin[i - 1].ts)).toBe(true);
    expect(downsample(points.slice(0, 50), 100)).toHaveLength(50);
  });
});

describe("TimeSeriesChart", () => {
  const t0 = Math.floor(start / 1000);
  const cpu = Array.from({ length: 13 }, (_, i) => ({ ts: t0 + i * 1800, value: 20 + i }));
  const mem = Array.from({ length: 13 }, (_, i) => ({ ts: t0 + i * 1800, value: 8 * 1024 ** 3 }));
  const props = {
    left: { max: 100, format: (v: number) => `${Math.round(v)}%`, color: "#3b82f6" },
    right: { max: 16 * 1024 ** 3, format: (v: number) => `${Math.round(v / 1024 ** 3)} GB`, color: "#34d399" },
    series: [
      { name: "CPU", color: "#3b82f6", points: cpu },
      { name: "Memory", color: "#34d399", points: mem, axis: "right" as const },
    ],
  };

  it("labels a left CPU axis and a right memory axis in their series' colors", () => {
    setDisplayPreferences({ timeZone: "UTC" });
    const { container } = render(<TimeSeriesChart {...props} />);
    const text = (fill: string) => Array.from(container.querySelectorAll(`text[fill="${fill}"]`)).map((t) => t.textContent);
    expect(text("#3b82f6")).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(text("#34d399")).toEqual(["0 GB", "4 GB", "8 GB", "12 GB", "16 GB"]);
    const timeLabels = text("var(--color-text-muted)");
    expect(timeLabels.length).toBeGreaterThan(1);
    expect(timeLabels.every((l) => /\d\d:\d\d/.test(l ?? ""))).toBe(true); // 12h or 24h, per locale
  });

  it("draws the grid only when asked, and toggles it from its own button", () => {
    const onGridChange = vi.fn();
    const { container, rerender } = render(<TimeSeriesChart {...props} grid onGridChange={onGridChange} />);
    const gridLines = () => container.querySelectorAll('line[stroke="var(--chart-grid)"]').length;
    expect(gridLines()).toBeGreaterThan(5);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(onGridChange).toHaveBeenCalledWith(false);
    rerender(<TimeSeriesChart {...props} grid={false} onGridChange={onGridChange} />);
    expect(gridLines()).toBe(0);
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reads out every series' value where it's tapped", () => {
    const { container } = render(<TimeSeriesChart {...props} />);
    fireEvent.pointerDown(container.querySelector('rect[fill="transparent"]')!, { clientX: 0, pointerType: "touch" });
    const readout = screen.getByRole("status");
    expect(readout.textContent).toMatch(/CPU \d+%/);
    expect(readout.textContent).toMatch(/Memory 8 GB/);
  });

  it("says so when there's nothing to draw", () => {
    render(<TimeSeriesChart {...props} series={[{ name: "CPU", color: "#fff", points: [] }]} />);
    expect(screen.getByText("No history for this range yet.")).toBeTruthy();
  });
});
