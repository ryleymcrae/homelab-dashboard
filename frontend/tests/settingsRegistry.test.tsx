import React from "react";
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  CATEGORIES,
  STATIC_SETTINGS,
  dynamicSettings,
  searchSettings,
  type CategoryId,
} from "../src/pages/settings/registry";
import { GeneralSettings } from "../src/pages/settings/GeneralSettings";
import { AppearanceSettings } from "../src/pages/settings/AppearanceSettings";
import { BrandingSettings } from "../src/pages/settings/BrandingSettings";
import { LayoutSettings } from "../src/pages/settings/LayoutSettings";
import { DevicesSettings } from "../src/pages/settings/DevicesSettings";
import { ServicesSettings } from "../src/pages/settings/ServicesSettings";
import { AlertsSettings } from "../src/pages/settings/AlertsSettings";
import { NetworkSettings } from "../src/pages/settings/NetworkSettings";
import { IntegrationsSettings } from "../src/pages/settings/IntegrationsSettings";
import { AccessSettings } from "../src/pages/settings/AccessSettings";
import { AboutSettings } from "../src/pages/settings/AboutSettings";

const CONFIG = {
  dashboard: {
    title: "Lab",
    theme: "dark",
    density: "compact",
    widgets: [{ id: "w1", type: "host_metric", visible: true, host_id: "nas", metric: "cpu", display: "gauge" }],
  },
  hosts: [{ name: "nas", id: "nas", address: "10.0.0.2", integration_id: "prom-1" }],
  services: [{ name: "Plex", id: "plex", type: "docker", container: "plex", host: "nas" }],
  network: { internet_target: "1.1.1.1", devices: [{ name: "Core switch", address: "10.0.0.1" }] },
  history: { retention_days: 14 },
  integrations: { connections: [{ id: "prom-1", type: "prometheus", name: "Main Prometheus", enabled: true, prometheus_url: "http://p:9090" }] },
  auth: { trusted_ips: [] },
  alerting: {
    enabled: true,
    defaults: {},
    host_overrides: { nas: { disk_percent: 95 } },
    service_overrides: { Plex: { offline_minutes: 10 } },
    notifiers: [{ id: "discord-1", type: "discord", name: "Team Discord", enabled: true }],
  },
  guest_mode: false,
};

const noopSave = async () => true;
const props = { config: CONFIG, onSave: noopSave, disabled: false };

const SECTIONS: Record<CategoryId, React.ReactElement> = {
  general: <GeneralSettings {...props} />,
  appearance: <AppearanceSettings {...props} hosts={[]} />,
  branding: <BrandingSettings {...props} />,
  layout: <LayoutSettings {...props} hosts={[]} services={[]} />,
  devices: <DevicesSettings {...props} />,
  services: <ServicesSettings {...props} />,
  alerts: <AlertsSettings {...props} />,
  network: <NetworkSettings {...props} />,
  integrations: <IntegrationsSettings {...props} />,
  access: <AccessSettings {...props} passwordSet={false} isAdmin={false} onAuthChanged={() => {}} />,
  about: <AboutSettings {...props} />,
};

describe("settings registry", () => {
  it("has unique ids and only references real categories", () => {
    const ids = STATIC_SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categoryIds = new Set(CATEGORIES.map((c) => c.id));
    for (const s of STATIC_SETTINGS) expect(categoryIds.has(s.category)).toBe(true);
  });

  // The search box jumps to `#setting-<id>`; an entry whose section
  // doesn't render that anchor would be a result that goes nowhere.
  it.each(CATEGORIES.map((c) => c.id))("every %s entry has an anchor in its section", (category) => {
    const entries = [...STATIC_SETTINGS, ...dynamicSettings(CONFIG)].filter((e) => e.category === category);
    expect(entries.length).toBeGreaterThan(0);
    const { container } = render(<MemoryRouter>{SECTIONS[category]}</MemoryRouter>);
    for (const e of entries) {
      expect(container.querySelector(`[id="setting-${e.id}"]`), e.id).not.toBeNull();
    }
    cleanup();
  });

  it("adds an entry for everything the user created", () => {
    const labels = dynamicSettings(CONFIG).map((e) => `${e.category}:${e.label}`);
    expect(labels).toEqual([
      "devices:nas",
      "services:Plex",
      "network:Core switch",
      "alerts:nas thresholds",
      "alerts:Plex offline alert",
      "alerts:Team Discord",
      "integrations:Main Prometheus",
      "layout:Host metric · nas · CPU",
    ]);
    expect(dynamicSettings(null)).toEqual([]);
  });
});

describe("searchSettings", () => {
  const all = [...STATIC_SETTINGS, ...dynamicSettings(CONFIG)];
  const labels = (q: string) => searchSettings(all, q).map((e) => e.label);

  it("returns nothing for an empty query", () => {
    expect(searchSettings(all, "   ")).toEqual([]);
  });

  it("finds settings by synonym, not just by label", () => {
    expect(labels("dark mode")[0]).toBe("Theme");
    expect(labels("discord")).toContain("Team Discord");
  });

  it("ranks a label-prefix match above a keyword match", () => {
    // Both start with "temp", so both outrank keyword-only hits; ties keep screen order.
    expect(labels("temp").slice(0, 3)).toEqual(["Temperature unit", "Temperature color", "Temperature threshold"]);
    expect(labels("fahrenheit")).toEqual(["Temperature unit", "Temperature threshold"]);
    expect(labels("time")[0]).toBe("Time zone");
  });

  it("requires every term to match somewhere", () => {
    expect(labels("cpu thresh")).toEqual(["CPU usage threshold"]);
    expect(labels("cpu nonsense")).toEqual([]);
  });

  it("matches an individual setting across categories, not just category names", () => {
    expect(labels("disk")[0]).toBe("Disk usage threshold");
    expect(labels("plex")).toEqual(["Plex", "Plex offline alert"]);
    expect(searchSettings(all, "prometheus").map((r) => r.category)).toContain("integrations");
  });
});
