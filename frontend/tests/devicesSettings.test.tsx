import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DevicesSettings } from "../src/pages/settings/DevicesSettings";
import { SettingsUiContext } from "../src/pages/settings/controls";

afterEach(cleanup);

const docker = { id: "d", type: "docker_api", name: "Pi Docker", enabled: true, docker_url: "tcp://pi:2375" };

function renderHost(host: Record<string, unknown>, connections: Record<string, unknown>[]) {
  render(
    <MemoryRouter>
      <SettingsUiContext.Provider value={{ focusId: "host.pi", focusNonce: 1, revision: 0 }}>
        <DevicesSettings config={{ hosts: [{ name: "pi", id: "pi", ...host }], integrations: { connections } }} onSave={async () => true} disabled={false} />
      </SettingsUiContext.Provider>
    </MemoryRouter>
  );
}

describe("Devices data source", () => {
  it("says what a Docker API supplies, including vitals for a host with no agent", () => {
    renderHost({ integration_id: "d" }, [docker]);
    expect(screen.getByText(/monitored and controlled through Pi Docker/).textContent).toMatch(/With no agent, its status, CPU count, and memory size come from Docker too/);
    expect(screen.getByText(/Docker API -- status and specs/)).toBeTruthy();
  });

  it("keeps an agent as the source of vitals", () => {
    renderHost({ integration_id: "d", agent_url: "http://pi:8081" }, [docker]);
    expect(screen.getByText(/monitored and controlled through Pi Docker/).textContent).not.toMatch(/With no agent/);
  });

  it("is honest about a disabled or not-yet-wired connection", () => {
    renderHost({ integration_id: "d", address: "10.0.0.2" }, [{ ...docker, enabled: false }]);
    expect(screen.getByText(/Pi Docker is turned off/)).toBeTruthy();
    cleanup();
    renderHost({ integration_id: "d" }, [{ ...docker, type: "prometheus" }]);
    expect(screen.getByText(/Prometheus connections don't supply host data yet/)).toBeTruthy();
  });
});
