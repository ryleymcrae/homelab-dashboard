import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A tiny in-memory stand-in for GET/PATCH /api/config with the backend's
// real merge semantics (backend/config/loader.py:_deep_merge -- dicts
// merge, lists and the alert override maps replace), slow enough that
// two saves can overlap.
let server: Record<string, any>;
const patchCalls: Record<string, unknown>[] = [];

const REPLACE = new Set(["alerting.host_overrides", "alerting.service_overrides"]);

function deepMerge(base: any, patch: any, path = ""): any {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const here = path ? `${path}.${k}` : k;
    const merge = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && !REPLACE.has(here);
    out[k] = merge ? deepMerge(out[k], v, here) : v;
  }
  return out;
}

vi.mock("../src/api/client", () => ({
  api: {
    getConfig: vi.fn(async () => structuredClone(server)),
    patchConfig: vi.fn(async (patch: Record<string, unknown>) => {
      patchCalls.push(patch);
      await new Promise((r) => setTimeout(r, 20));
      server = deepMerge(server, patch);
      return structuredClone(server);
    }),
    getIntegrationStatus: vi.fn(async () => []),
  },
}));
vi.mock("../src/hooks/SnapshotContext", () => ({ useSnapshot: () => ({ snapshot: null }) }));
vi.mock("../src/hooks/AuthContext", () => ({
  useAuth: () => ({ canAct: true, required: true, isAdmin: true, refresh: () => {} }),
}));

import { SettingsPage } from "../src/pages/SettingsPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  patchCalls.length = 0;
  server = {
    dashboard: { title: "Lab", theme: "dark", density: "compact", widgets: [] },
    hosts: [{ name: "nas", id: "nas" }],
    network: {},
    history: {},
    integrations: { connections: [] },
    auth: { trusted_ips: [] },
    alerting: {
      enabled: true,
      defaults: { temp_c: 70, disk_percent: 90 },
      host_overrides: { nas: { disk_percent: 95 } },
      notifiers: [
        { id: "a", type: "ntfy", name: "Alpha", enabled: false },
        { id: "b", type: "ntfy", name: "Bravo", enabled: false },
      ],
    },
    guest_mode: false,
  };
});

afterEach(cleanup);

describe("SettingsPage search", () => {
  it("jumps from a search result straight to that setting in another category", async () => {
    renderAt("/settings");
    await screen.findByDisplayValue("Lab"); // General loaded

    fireEvent.change(screen.getByLabelText("Search settings"), { target: { value: "heat" } });
    const result = await screen.findByRole("button", { name: /Temperature threshold/ });
    expect(result.textContent).toContain("Alerts › Thresholds");

    fireEvent.click(result);
    expect(screen.getByRole("heading", { name: /Alerts/ })).toBeTruthy();
    const row = document.getElementById("setting-alerting.temp_c");
    expect(row).not.toBeNull();
    expect(row!.querySelector(".setting-flash")).not.toBeNull();
  });

  it("opens a deep-linked setting's category from ?s= alone", async () => {
    renderAt("/settings?s=guest_mode");
    expect(await screen.findByRole("heading", { name: /Access & Security/ })).toBeTruthy();
  });

  it("stays on a deep-linked host's category after renaming that host", async () => {
    renderAt("/settings?s=host.nas");
    const name = await screen.findByLabelText("Name of nas");
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: "storage" } });
    fireEvent.blur(name);
    await waitFor(() => expect(server.hosts[0].name).toBe("storage"));
    expect(screen.getByRole("heading", { name: /Devices/ })).toBeTruthy();
    expect(screen.getByLabelText("Name of storage")).toBeTruthy(); // card kept open across the rename
  });
});

describe("SettingsPage saving", () => {
  it("saves a text field once on blur, not on every keystroke", async () => {
    renderAt("/settings?c=general");
    const title = await screen.findByLabelText("Dashboard title");
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "Rack" } });
    fireEvent.change(title, { target: { value: "Rack 2" } });
    expect(patchCalls).toHaveLength(0);

    fireEvent.blur(title);
    await waitFor(() => expect(server.dashboard.title).toBe("Rack 2"));
    expect(patchCalls).toEqual([{ dashboard: { title: "Rack 2" } }]);
  });

  // Both notifiers live in one list that PATCH replaces wholesale; the
  // second edit has to be computed from the result of the first, or it
  // would silently undo it.
  it("doesn't lose an edit when two list changes overlap", async () => {
    renderAt("/settings?c=alerts");
    const alpha = await screen.findByRole("switch", { name: "Alpha enabled" });
    const bravo = screen.getByRole("switch", { name: "Bravo enabled" });

    await act(async () => {
      fireEvent.click(alpha);
      fireEvent.click(bravo);
    });
    await waitFor(() => expect(patchCalls).toHaveLength(2));
    await waitFor(() => expect(server.alerting.notifiers.map((n: any) => n.enabled)).toEqual([true, true]));
  });

  it("moves an override field between default, off, and custom", async () => {
    renderAt("/settings?s=override.host.nas");
    // The deep link opens the card.
    const disk = await screen.findByRole("group", { name: "Disk usage threshold" });
    expect(within(disk).getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(disk).getByRole("button", { name: "Default (90%)" }));
    await waitFor(() => expect(server.alerting.host_overrides).toEqual({ nas: {} }));

    const temp = screen.getByRole("group", { name: "Temperature threshold" });
    fireEvent.click(within(temp).getByRole("button", { name: "Off" }));
    await waitFor(() => expect(server.alerting.host_overrides).toEqual({ nas: { temp_c: null } }));
  });
});
