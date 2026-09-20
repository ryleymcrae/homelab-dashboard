import React, { useEffect, useState } from "react";
import { api } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ServiceIcon } from "../../components/ServiceIcon";
import { remapWidgets, removeService, renameService, widgetsReferencing } from "./configEdits";
import {
  Banner,
  IconField,
  ItemCard,
  JsonField,
  Note,
  NumberField,
  Segmented,
  SelectField,
  SettingBlock,
  SettingRow,
  TextField,
  Toggle,
  useExpanded,
  type SectionProps,
} from "./controls";

type ServiceType = "docker" | "systemd" | "http" | "tcp" | "prometheus" | "custom";

const TYPE_LABEL: Record<ServiceType, string> = {
  docker: "Docker",
  systemd: "systemd",
  http: "HTTP",
  tcp: "TCP",
  prometheus: "Prometheus",
  custom: "Plugin",
};

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  description?: string;
  /** Mirrors backend/config/schema.py:validate_service_requirements. */
  required?: boolean;
  number?: boolean;
}

const GAME_SERVER_FIELDS: FieldDef[] = [
  { key: "status_url", label: "Status URL", placeholder: "http://127.0.0.1:8211/status", description: "Optional JSON endpoint for player counts (docs/configuration.md)." },
  { key: "a2s_port", label: "A2S query port", number: true, description: "Optional Steam query port for player counts." },
  { key: "a2s_address", label: "A2S address", placeholder: "127.0.0.1" },
];

const FIELDS: Record<ServiceType, FieldDef[]> = {
  docker: [{ key: "container", label: "Container", placeholder: "plex", required: true }, ...GAME_SERVER_FIELDS],
  systemd: [{ key: "unit", label: "Unit", placeholder: "plexmediaserver.service", required: true }, ...GAME_SERVER_FIELDS],
  http: [
    { key: "url", label: "URL", placeholder: "http://192.168.1.20:32400/web", required: true },
    { key: "expected_status", label: "Expected status", number: true },
  ],
  tcp: [
    { key: "tcp_host", label: "Address", placeholder: "192.168.1.30", required: true },
    { key: "port", label: "Port", number: true, required: true },
  ],
  prometheus: [
    { key: "prometheus_url", label: "Prometheus URL", placeholder: "http://host:9090" },
    { key: "prometheus_query", label: "Query", placeholder: "up{job=\"node\"}", required: true },
  ],
  custom: [{ key: "plugin", label: "Plugin", placeholder: "game_server", required: true, description: "A registered plugin name (docs/plugins.md)." }],
};

function target(s: any): string {
  if (s.type === "docker") return s.container;
  if (s.type === "systemd") return s.unit;
  if (s.type === "http") return s.url;
  if (s.type === "tcp") return `${s.tcp_host}:${s.port}`;
  if (s.type === "prometheus") return s.prometheus_query;
  return s.plugin;
}

interface Discovered {
  container: string;
  image: string;
  state: string;
  suggestedName: string;
  suggestedIcon?: string | null;
}

/**
 * Every `services:` entry, grouped under the host it runs on. The type is
 * fixed once a service exists (each type needs different fields; remove
 * and re-add to change it). Renames/removals go through configEdits.ts so
 * alert overrides and Home widgets follow along.
 */
export function ServicesSettings({ config, onSave, disabled }: SectionProps) {
  const services: any[] = config?.services ?? [];
  const hostNames: string[] = (config?.hosts ?? []).map((h: any) => h.name);
  const expanded = useExpanded("service.");
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const [discovered, setDiscovered] = useState<Discovered[] | null>(null);

  // The chosen host's containers -- through its Docker API when one is
  // assigned (Devices), the same Docker the new service would use.
  useEffect(() => {
    if (draft?.type !== "docker") return;
    let cancelled = false;
    setDiscovered(null);
    api.discoverDocker(draft.host)
      .then((list) => !cancelled && setDiscovered(list as unknown as Discovered[]))
      .catch(() => !cancelled && setDiscovered([]));
    return () => {
      cancelled = true;
    };
  }, [draft?.type, draft?.host]);

  const update = (name: string, patch: Record<string, unknown>) =>
    onSave((latest) => ({ services: (latest.services ?? []).map((s: any) => (s.name === name ? { ...s, ...patch } : s)) }));

  const rename = async (svc: any, to: string) => {
    to = to.trim();
    if (!to) return false;
    if (to === svc.name) return;
    expanded.rename(svc.name, to);
    if (!(await onSave((latest) => renameService(latest, svc.name, to)))) {
      expanded.rename(to, svc.name);
      return;
    }
    onSave((latest) => remapWidgets(latest, "service", svc.id, to));
  };

  const draftComplete =
    !!draft && !!String(draft.name ?? "").trim() && FIELDS[draft.type as ServiceType].every((f) => !f.required || String(draft[f.key] ?? "").trim());

  const addDraft = async () => {
    if (!draft || !draftComplete) return;
    const svc = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== "" && v != null));
    svc.name = String(svc.name).trim();
    const ok = await onSave((latest) => ({ services: [...(latest.services ?? []), svc] }));
    if (ok) {
      expanded.toggle(svc.name);
      setDraft(null);
    }
  };

  const fieldRow = (svc: any, f: FieldDef) => (
    <SettingRow key={f.key} label={f.label} description={f.description}>
      {f.number ? (
        <NumberField
          label={f.label}
          value={svc[f.key]}
          nullable={!f.required && f.key !== "expected_status"}
          disabled={disabled}
          onCommit={(n) => (n == null && f.required ? false : update(svc.name, { [f.key]: n }))}
        />
      ) : (
        <TextField
          label={f.label}
          mono
          value={svc[f.key]}
          placeholder={f.placeholder}
          disabled={disabled}
          onCommit={(v) => (f.required && !v.trim() ? false : update(svc.name, { [f.key]: v.trim() || null }))}
        />
      )}
    </SettingRow>
  );

  // Grouped under their host, in hosts: order; services naming no host
  // (or one that no longer exists) last -- the same split Home makes.
  const groups: { title: string; items: any[] }[] = [
    ...hostNames.map((name) => ({ title: name, items: services.filter((s) => s.host === name) })),
    { title: "Other services", items: services.filter((s) => !hostNames.includes(s.host)) },
  ].filter((g) => g.items.length > 0);

  const removalBody = (svc: any): string => {
    const widgets = widgetsReferencing(config, "service", svc.id);
    return [
      `${svc.name} will no longer be monitored or controllable from the dashboard. The ${TYPE_LABEL[svc.type as ServiceType]} target itself isn't touched.`,
      config?.alerting?.service_overrides?.[svc.name] && "Its alert override will be removed.",
      widgets > 0 && `${widgets} Home widget${widgets === 1 ? "" : "s"} will need a different target.`,
    ]
      .filter(Boolean)
      .join(" ");
  };

  const takenContainers = new Set(services.filter((s) => s.type === "docker").map((s) => s.container));

  return (
    <>
      {config?.demo_mode && (
        <Banner tone="info">
          Demo mode is on, so the dashboard is showing simulated services rather than these. Changes here are saved and
          take effect once demo mode is turned off (Integrations).
        </Banner>
      )}
      <SettingRow id="services.list" label={`Monitored services (${services.length})`} description="Containers, units, and endpoints the dashboard checks and controls. Tap one to edit it." />

      {groups.map((g) => (
        <div key={g.title}>
          <div className="section-title" style={{ margin: "16px 0 0" }}>{g.title.toUpperCase()}</div>
          {g.items
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
            .map((s) => (
              <ItemCard
                key={s.name}
                id={`service.${s.name}`}
                open={expanded.isOpen(s.name)}
                onToggle={() => expanded.toggle(s.name)}
                icon={<ServiceIcon icon={s.icon} size={32} />}
                title={s.name}
                subtitle={`${TYPE_LABEL[s.type as ServiceType]} · ${target(s) ?? ""}`}
                badge={s.visible === false ? <span className="chip">Hidden</span> : undefined}
              >
                <SettingRow label="Name">
                  <TextField label={`Name of ${s.name}`} value={s.name} disabled={disabled} onCommit={(to) => rename(s, to)} />
                </SettingRow>
                <SettingRow label="Host" description="Which host's card this service appears under.">
                  <SelectField label="Host" value={hostNames.includes(s.host) ? s.host : ""} disabled={disabled} onChange={(host) => update(s.name, { host: host || null })}>
                    <option value="">None (Other services)</option>
                    {hostNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </SelectField>
                </SettingRow>
                <SettingRow label="Shown on dashboard">
                  <Toggle label={`Show ${s.name}`} checked={s.visible !== false} disabled={disabled} onChange={(visible) => update(s.name, { visible })} />
                </SettingRow>
                <SettingRow label="Icon">
                  <IconField label="Icon" value={s.icon} disabled={disabled} onCommit={(v) => update(s.name, { icon: v.trim() || null })} />
                </SettingRow>
                <SettingRow label="Banner" description="Wide splash image on the service's detail page -- about 16:9 crops best.">
                  <IconField label="Banner" kind="image" value={s.banner} disabled={disabled} onCommit={(v) => update(s.name, { banner: v.trim() || null })} />
                </SettingRow>
                <SettingRow label="Group">
                  <TextField label="Group" value={s.group} placeholder="Media" width={160} disabled={disabled} onCommit={(v) => update(s.name, { group: v.trim() || null })} />
                </SettingRow>
                <SettingRow label="Description">
                  <TextField label="Description" value={s.description} disabled={disabled} onCommit={(v) => update(s.name, { description: v.trim() || null })} />
                </SettingRow>
                <SettingRow label="Sort order" description="Lower numbers come first within a host.">
                  <NumberField label="Sort order" value={s.sort_order ?? 0} step={1} disabled={disabled} onCommit={(n) => (n == null ? false : update(s.name, { sort_order: Math.round(n) }))} />
                </SettingRow>

                <div className="section-title" style={{ margin: "16px 0 0" }}>{TYPE_LABEL[s.type as ServiceType].toUpperCase()} CHECK</div>
                {FIELDS[s.type as ServiceType].map((f) => fieldRow(s, f))}
                {s.type === "custom" && (
                  <SettingRow label="Plugin options" description="Passed to the plugin as-is (JSON object).">
                    <JsonField label="Plugin options" value={s.plugin_options} disabled={disabled} onCommit={(plugin_options) => update(s.name, { plugin_options })} />
                  </SettingRow>
                )}
                <SettingRow label="Check timeout">
                  <NumberField
                    label="Check timeout"
                    value={s.health_check?.timeout_seconds ?? 3}
                    suffix="s"
                    min={1}
                    disabled={disabled}
                    onCommit={(n) => (n == null || n < 1 ? false : update(s.name, { health_check: { ...s.health_check, timeout_seconds: Math.round(n) } }))}
                  />
                </SettingRow>

                <div className="settings-item__actions">
                  <button className="btn btn--danger-ghost" disabled={disabled} onClick={() => setRemoving(s)}>
                    Remove service
                  </button>
                </div>
              </ItemCard>
            ))}
        </div>
      ))}

      {draft ? (
        <div className="card settings-item settings-item--draft">
          <div className="settings-item__title">New service</div>
          <SettingRow label="Type">
            <Segmented
              label="Service type"
              value={draft.type as ServiceType}
              options={(Object.keys(TYPE_LABEL) as ServiceType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
              onChange={(type) => setDraft({ name: draft.name, host: draft.host, type })}
            />
          </SettingRow>
          {draft.type === "docker" && discovered && discovered.some((d) => !takenContainers.has(d.container)) && (
            <SettingRow label="Pick a container" description="Containers on this host's Docker that aren't monitored yet.">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {discovered
                  .filter((d) => !takenContainers.has(d.container))
                  .map((d) => (
                    <button
                      key={d.container}
                      type="button"
                      className="btn btn--ghost"
                      aria-pressed={draft.container === d.container}
                      onClick={() => setDraft({ ...draft, container: d.container, name: draft.name || d.suggestedName, icon: d.suggestedIcon ?? draft.icon })}
                    >
                      {d.container}
                    </button>
                  ))}
              </div>
            </SettingRow>
          )}
          <SettingRow label="Name *">
            <input className="field" aria-label="New service name" value={draft.name ?? ""} placeholder="Plex" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </SettingRow>
          <SettingRow label="Host">
            <select className="field" aria-label="New service host" value={draft.host ?? ""} onChange={(e) => setDraft({ ...draft, host: e.target.value || null })}>
              <option value="">None (Other services)</option>
              {hostNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </SettingRow>
          {FIELDS[draft.type as ServiceType].map((f) => (
            <SettingRow key={f.key} label={f.required ? `${f.label} *` : f.label}>
              <input
                className={f.number ? "field field--number" : "field"}
                aria-label={`New service ${f.label}`}
                type={f.number ? "number" : "text"}
                style={f.number ? undefined : { fontFamily: "var(--font-mono)", width: 220, maxWidth: "100%" }}
                placeholder={f.placeholder}
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft({ ...draft, [f.key]: f.number ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })}
              />
            </SettingRow>
          ))}
          <div className="settings-item__actions">
            <button className="btn btn--primary" disabled={disabled || !draftComplete} onClick={addDraft}>
              Add service
            </button>
            <button className="btn btn--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {!draftComplete && <span className="settings-note" style={{ margin: 0 }}>* required</span>}
          </div>
        </div>
      ) : (
        <SettingBlock id="services.add" className="settings-item__actions">
          <button className="btn btn--ghost" disabled={disabled} onClick={() => setDraft({ type: "docker", name: "", host: hostNames[0] ?? null })}>
            + Add service
          </button>
        </SettingBlock>
      )}
      {services.length === 0 && !draft && <Note>No services yet.</Note>}

      {removing && (
        <ConfirmDialog
          targetName={removing.name}
          action={{ kind: "remove", label: "Remove", destructive: true, confirmTitle: `Remove ${removing.name}?`, confirmBody: removalBody(removing) }}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const name = removing.name;
            setRemoving(null);
            onSave((latest) => removeService(latest, name));
          }}
        />
      )}
    </>
  );
}
