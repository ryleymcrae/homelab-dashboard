import { describe, expect, it } from "vitest";
import { remapWidgets, removeHost, removeService, renameHost, renameService, widgetsReferencing } from "../src/pages/settings/configEdits";

const config = {
  hosts: [
    { name: "NAS", id: "nas" },
    { name: "Pi", id: "pi" },
  ],
  services: [
    { name: "Plex", id: "plex", host: "NAS" },
    { name: "Pihole", id: "pihole", host: "Pi" },
  ],
  alerting: {
    host_overrides: { NAS: { disk_percent: 95 }, Pi: { temp_c: null } },
    service_overrides: { Plex: { offline_minutes: 10 } },
  },
  dashboard: {
    widgets: [
      { id: "w1", type: "host_metric", host_id: "nas", metric: "cpu" },
      { id: "w2", type: "custom_card", target_type: "service", target_id: "plex" },
      { id: "w3", type: "custom_card", target_type: "host", target_id: "nas" },
    ],
  },
};

describe("renameHost", () => {
  it("carries the host's services and alert override along", () => {
    const patch: any = renameHost(config, "NAS", "Storage");
    expect(patch.hosts.map((h: any) => h.name)).toEqual(["Storage", "Pi"]);
    expect(patch.services.map((s: any) => s.host)).toEqual(["Storage", "Pi"]);
    expect(patch.alerting.host_overrides).toEqual({ Storage: { disk_percent: 95 }, Pi: { temp_c: null } });
  });
});

describe("removeHost", () => {
  it("drops its override but leaves its services in place", () => {
    const patch: any = removeHost(config, "NAS");
    expect(patch.hosts.map((h: any) => h.name)).toEqual(["Pi"]);
    expect(patch.services).toBeUndefined();
    expect(patch.alerting.host_overrides).toEqual({ Pi: { temp_c: null } });
  });
});

describe("renameService / removeService", () => {
  it("keeps the service override keyed to the service", () => {
    expect((renameService(config, "Plex", "Jellyfin") as any).alerting.service_overrides).toEqual({ Jellyfin: { offline_minutes: 10 } });
    expect((removeService(config, "Plex") as any).alerting.service_overrides).toEqual({});
  });
});

describe("remapWidgets", () => {
  it("points widgets at the new id read back from the saved config", () => {
    const saved = { ...config, hosts: [{ name: "Storage", id: "storage" }, config.hosts[1]] };
    const patch: any = remapWidgets(saved, "host", "nas", "Storage");
    expect(patch.dashboard.widgets.map((w: any) => w.host_id ?? w.target_id)).toEqual(["storage", "plex", "storage"]);
  });

  it("returns null when no widget refers to it", () => {
    const saved = { ...config, hosts: [config.hosts[0], { name: "Raspberry", id: "raspberry" }] };
    expect(remapWidgets(saved, "host", "pi", "Raspberry")).toBeNull();
  });

  it("counts the widgets a removal would orphan", () => {
    expect(widgetsReferencing(config, "host", "nas")).toBe(2);
    expect(widgetsReferencing(config, "service", "plex")).toBe(1);
  });
});
