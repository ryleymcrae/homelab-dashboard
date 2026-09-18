import type { ContainerConfig } from "./types";

export interface ConfigDiffRow {
  field: string;
  before: string;
  after: string;
}

const EMPTY = "—";

/**
 * A simple before/after list of what changed between two ContainerConfig
 * snapshots -- not a full git-style diff, just enough for a confirmation
 * dialog to show what's about to be staged. Env vars are broken out
 * per-key (added/removed/changed) rather than shown as one opaque blob.
 */
export function computeConfigDiff(before: ContainerConfig, after: ContainerConfig): ConfigDiffRow[] {
  const rows: ConfigDiffRow[] = [];

  if ((before.cpuLimit ?? null) !== (after.cpuLimit ?? null)) {
    rows.push({ field: "CPU Limit", before: before.cpuLimit || EMPTY, after: after.cpuLimit || EMPTY });
  }
  if ((before.memLimit ?? null) !== (after.memLimit ?? null)) {
    rows.push({ field: "Memory Limit", before: before.memLimit || EMPTY, after: after.memLimit || EMPTY });
  }
  if (before.restartPolicy !== after.restartPolicy) {
    rows.push({ field: "Restart Policy", before: before.restartPolicy, after: after.restartPolicy });
  }

  const keys = new Set([...Object.keys(before.env), ...Object.keys(after.env)]);
  for (const key of Array.from(keys).sort()) {
    const beforeVal = before.env[key];
    const afterVal = after.env[key];
    if (beforeVal === afterVal) continue;
    rows.push({
      field: `env.${key}`,
      before: beforeVal ?? EMPTY,
      after: afterVal ?? EMPTY,
    });
  }

  return rows;
}
