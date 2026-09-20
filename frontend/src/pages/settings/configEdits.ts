/**
 * Edits that touch more than one place in config.yml. A host or service
 * is referenced from elsewhere by its `name` (a service's `host:`, the
 * alerting override maps) and by its derived `id` (Home widgets), so
 * renaming or removing one without updating those would quietly detach
 * a service from its host card, drop an alert override, or leave a
 * widget pointing at nothing.
 *
 * Each function takes the latest saved config and returns a PATCH body
 * (see SaveFn in controls.tsx). Override maps are sent whole -- the
 * backend replaces them rather than merging (backend/config/loader.py),
 * which is the only way a key can be removed.
 */
import type { ConfigPatch, SettingsConfig } from "./controls";

type Named = { name: string; [key: string]: unknown };
type OverrideMap = Record<string, Record<string, number | null>>;

function renameKey(map: OverrideMap, from: string, to: string): OverrideMap {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k === from ? to : k, v]));
}

function withoutKey(map: OverrideMap, key: string): OverrideMap {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

export function renameHost(cfg: SettingsConfig, from: string, to: string): ConfigPatch {
  return {
    hosts: (cfg.hosts ?? []).map((h: Named) => (h.name === from ? { ...h, name: to } : h)),
    services: (cfg.services ?? []).map((s: Named) => (s.host === from ? { ...s, host: to } : s)),
    alerting: { host_overrides: renameKey(cfg.alerting?.host_overrides ?? {}, from, to) },
  };
}

/** Services that ran on it fall through to "Other Services" (the same as
 * a service naming a host that doesn't exist) -- they aren't deleted. */
export function removeHost(cfg: SettingsConfig, name: string): ConfigPatch {
  return {
    hosts: (cfg.hosts ?? []).filter((h: Named) => h.name !== name),
    alerting: { host_overrides: withoutKey(cfg.alerting?.host_overrides ?? {}, name) },
  };
}

export function renameService(cfg: SettingsConfig, from: string, to: string): ConfigPatch {
  return {
    services: (cfg.services ?? []).map((s: Named) => (s.name === from ? { ...s, name: to } : s)),
    alerting: { service_overrides: renameKey(cfg.alerting?.service_overrides ?? {}, from, to) },
  };
}

export function removeService(cfg: SettingsConfig, name: string): ConfigPatch {
  return {
    services: (cfg.services ?? []).filter((s: Named) => s.name !== name),
    alerting: { service_overrides: withoutKey(cfg.alerting?.service_overrides ?? {}, name) },
  };
}

/**
 * Points widgets at a renamed host/service's new id. Runs as a second
 * save, after the rename has landed, because the new id is derived
 * server-side (backend/config/schema.py:slug) and read back from the
 * saved config rather than re-derived here. `null` means nothing to do.
 */
export function remapWidgets(cfg: SettingsConfig, kind: "host" | "service", oldId: string, newName: string): ConfigPatch | null {
  const pool: { name: string; id: string }[] = kind === "host" ? cfg.hosts ?? [] : cfg.services ?? [];
  const newId = pool.find((x) => x.name === newName)?.id;
  const widgets: any[] = cfg.dashboard?.widgets ?? [];
  if (!newId || newId === oldId) return null;
  let changed = false;
  const next = widgets.map((w) => {
    const patch: Record<string, string> = {};
    if (kind === "host" && w.host_id === oldId) patch.host_id = newId;
    if (w.target_type === kind && w.target_id === oldId) patch.target_id = newId;
    if (Object.keys(patch).length === 0) return w;
    changed = true;
    return { ...w, ...patch };
  });
  return changed ? { dashboard: { widgets: next } } : null;
}

/** Widgets that would be left pointing at a host/service being removed. */
export function widgetsReferencing(cfg: SettingsConfig | null, kind: "host" | "service", id: string): number {
  return (cfg?.dashboard?.widgets ?? []).filter(
    (w: any) => (kind === "host" && w.host_id === id) || (w.target_type === kind && w.target_id === id)
  ).length;
}
