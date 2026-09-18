import { describe, expect, it } from "vitest";
import { computeConfigDiff } from "../src/api/configDiff";
import type { ContainerConfig } from "../src/api/types";

const base: ContainerConfig = {
  env: { TZ: "UTC", DEBUG: "false" },
  cpuLimit: "2",
  memLimit: "2g",
  restartPolicy: "unless-stopped",
};

describe("computeConfigDiff", () => {
  it("returns no rows when nothing changed", () => {
    expect(computeConfigDiff(base, { ...base, env: { ...base.env } })).toEqual([]);
  });

  it("reports a changed resource limit", () => {
    const after = { ...base, cpuLimit: "4" };
    expect(computeConfigDiff(base, after)).toEqual([{ field: "CPU Limit", before: "2", after: "4" }]);
  });

  it("reports a changed env var", () => {
    const after = { ...base, env: { ...base.env, DEBUG: "true" } };
    expect(computeConfigDiff(base, after)).toEqual([{ field: "env.DEBUG", before: "false", after: "true" }]);
  });

  it("reports an added env var", () => {
    const after = { ...base, env: { ...base.env, NEW_VAR: "hello" } };
    expect(computeConfigDiff(base, after)).toEqual([{ field: "env.NEW_VAR", before: "—", after: "hello" }]);
  });

  it("reports a removed env var", () => {
    const { TZ: _tz, ...rest } = base.env;
    const after = { ...base, env: rest };
    expect(computeConfigDiff(base, after)).toEqual([{ field: "env.TZ", before: "UTC", after: "—" }]);
  });

  it("reports multiple changes together", () => {
    const after: ContainerConfig = { ...base, cpuLimit: "4", restartPolicy: "always" };
    const rows = computeConfigDiff(base, after);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.field)).toEqual(["CPU Limit", "Restart Policy"]);
  });
});
