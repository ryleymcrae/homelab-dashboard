import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describeMetric, resolveMetricDisplay } from "../src/api/metrics";
import { setDisplayPreferences } from "../src/api/format";
import type { HostInfo } from "../src/api/types";

let snapshot: any = null;
vi.mock("../src/hooks/SnapshotContext", () => ({ useSnapshot: () => ({ snapshot }) }));

import { HostMetricTile, HostMetricTiles } from "../src/components/HostMetricTile";

const host: HostInfo = {
  id: "nas",
  name: "nas",
  status: "online",
  isLocal: true,
  cpuPercent: 23,
  cpuCores: 4,
  cpuFreqMhz: 2400,
  memPercent: 61,
  memUsedBytes: 4 * 1024 ** 3,
  memTotalBytes: 8 * 1024 ** 3,
  diskPercent: 42,
  diskUsedBytes: 100 * 1024 ** 3,
  diskTotalBytes: 250 * 1024 ** 3,
  temperatureC: 55,
  metrics: [],
  actions: [],
};

afterEach(() => {
  cleanup();
  snapshot = null;
  setDisplayPreferences({});
});

describe("resolveMetricDisplay", () => {
  it("uses the defaults and theme colors when nothing is configured", () => {
    expect(resolveMetricDisplay(null, "cpu")).toEqual({ style: "sparkline", color: "var(--chart-line-1)", custom: false });
    expect(resolveMetricDisplay(undefined, "disk")).toEqual({ style: "bar", color: "var(--color-primary)", custom: false });
    expect(resolveMetricDisplay({}, "temp").style).toBe("numeric");
  });

  it("follows the global setting, including its color", () => {
    expect(resolveMetricDisplay({ mem: { style: "gauge", color: "#ff0000" } }, "mem")).toEqual({ style: "gauge", color: "#ff0000", custom: true });
  });

  it("lets a widget override the style but never the color", () => {
    const prefs = { cpu: { style: "numeric" as const, color: "#00ff00" } };
    expect(resolveMetricDisplay(prefs, "cpu", "gauge")).toEqual({ style: "gauge", color: "#00ff00", custom: true });
  });

  it("falls back when a saved style can't be drawn for that metric", () => {
    // An old Storage "sparkline" widget only ever rendered an empty chart.
    expect(resolveMetricDisplay({ disk: { style: "gauge" } }, "disk", "sparkline").style).toBe("gauge");
    expect(resolveMetricDisplay({ cpu: { style: "bar" as any } }, "cpu").style).toBe("sparkline");
    expect(resolveMetricDisplay(null, "temp", "gauge").style).toBe("gauge"); // widgets could always gauge temperature
  });
});

describe("describeMetric temperature", () => {
  it("reports against the host's real alert threshold", () => {
    expect(describeMetric(host, "temp", { tempC: 70 }).sub).toBe("Alert at 70°C");
    expect(describeMetric(host, "temp", { tempC: 50 }).sub).toBe("Over alert threshold (50°C)");
    expect(describeMetric(host, "temp", { tempC: null }).sub).toBe("No alert threshold");
    expect(describeMetric(host, "temp", undefined).sub).toBe("No alert threshold");
    expect(describeMetric({ ...host, temperatureC: null }, "temp", { tempC: 70 })).toEqual({ value: "N/A", sub: "Sensor unavailable", percent: null });
  });

  it("follows the temperature unit", () => {
    setDisplayPreferences({ temperatureUnit: "fahrenheit" });
    expect(describeMetric(host, "temp", { tempC: 70 })).toMatchObject({ value: "131°F", sub: "Alert at 158°F", percent: 55 });
  });

  it("shows a missing percentage as a dash, not '—%'", () => {
    expect(describeMetric({ ...host, cpuPercent: null }, "cpu").value).toBe("—");
  });
});

describe("HostMetricTile", () => {
  const reading = { label: "STORAGE", value: "42%", sub: "100 GB / 250 GB", percent: 42 };

  it("draws a bar filled to the percentage", () => {
    render(<HostMetricTile {...reading} display={{ style: "bar", color: "#123456" }} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("42");
    expect((meter.firstChild as HTMLElement).style.width).toBe("42%");
  });

  it("tints a plain number only with a color the user chose", () => {
    const { rerender } = render(<HostMetricTile {...reading} display={{ style: "numeric", color: "var(--color-warning)" }} />);
    expect(screen.getByText("42%").style.color).toBe("");
    rerender(<HostMetricTile {...reading} display={{ style: "numeric", color: "#123456", custom: true }} />);
    expect(screen.getByText("42%").style.color).toBe("rgb(18, 52, 86)");
  });

  it("draws a radial gauge and a sparkline", () => {
    const { container, rerender } = render(<HostMetricTile {...reading} display={{ style: "gauge", color: "#123456" }} />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    rerender(<HostMetricTile {...reading} history={[1, 5, 3]} display={{ style: "sparkline", color: "#123456" }} />);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("is a button that drills in when it has somewhere to go", () => {
    const onSelect = vi.fn();
    render(<HostMetricTile {...reading} display={{ style: "bar", color: "#123456" }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /STORAGE 42%/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe("HostMetricTiles", () => {
  it("draws the row from the snapshot's metric_display and thresholds", () => {
    snapshot = { dashboard: { metricDisplay: { cpu: { style: "gauge" } } }, alertThresholds: { nas: { tempC: 80 } } };
    const onSelect = vi.fn();
    const { container } = render(<HostMetricTiles host={host} history={{ cpu: [], mem: [1, 2] }} onSelect={onSelect} />);
    expect(Array.from(container.querySelectorAll(".tile")).map((t) => t.className.match(/tile--(\w+)/)![1])).toEqual([
      "gauge",
      "sparkline",
      "bar",
      "numeric",
    ]);
    expect(screen.getByText("Alert at 80°C")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /TEMPERATURE/ }));
    expect(onSelect).toHaveBeenCalledWith("temp");
  });
});
