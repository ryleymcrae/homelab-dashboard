import React, { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ServiceIcon } from "../../components/ServiceIcon";
import type { IntegrationConfig } from "../../api/types";
import { removeHost, remapWidgets, renameHost, widgetsReferencing } from "./configEdits";
import { INTEGRATION_TYPE_LABEL } from "./IntegrationsSettings";
import {
  Banner,
  IconField,
  ItemCard,
  SelectField,
  SettingBlock,
  SettingRow,
  TextField,
  Toggle,
  useExpanded,
  type SectionProps,
} from "./controls";

/** How backend/collectors/hosts.py will collect this host by default --
 * the same three paths docs/architecture.md#hosts describes. */
export function defaultCollection(host: { is_local?: boolean; agent_url?: string | null; address?: string | null }): string {
  if (host.is_local) return "This machine -- full metrics";
  if (host.agent_url) return "Remote agent -- full metrics";
  if (host.address) return "Reachability only";
  return "No address -- nothing to check";
}

/** The assigned connection, if it's one that actually feeds host data
 * (backend/config/schema.py:AppConfig.docker_connection_for). */
function activeDocker(host: any, connections: IntegrationConfig[]): IntegrationConfig | null {
  const conn = connections.find((c) => c.id === host.integration_id);
  return conn && conn.enabled && conn.type === "docker_api" ? conn : null;
}

function collectionSummary(host: any, connections: IntegrationConfig[]): string {
  if (!host.is_local && !host.agent_url && activeDocker(host, connections)) return "Docker API -- status and specs";
  return defaultCollection(host);
}

function sourceDescription(host: any, connections: IntegrationConfig[]): string {
  const fallback = "Default: " + defaultCollection(host).toLowerCase() + ".";
  const conn = connections.find((c) => c.id === host.integration_id);
  if (!conn) return fallback;
  if (conn.type !== "docker_api") return `Saved, but ${INTEGRATION_TYPE_LABEL[conn.type]} connections don't supply host data yet -- only Docker API does so far.`;
  if (!conn.enabled) return `${conn.name} is turned off (Integrations), so this host uses its default: ${defaultCollection(host).toLowerCase()}.`;
  const vitals = host.is_local || host.agent_url ? "" : " With no agent, its status, CPU count, and memory size come from Docker too.";
  return `Docker services on this host are monitored and controlled through ${conn.name}, and its Detailed Metrics include Docker's.${vitals}`;
}

interface HostDraft {
  name: string;
  address: string;
  model: string;
  is_local: boolean;
  agent_url: string;
}

const EMPTY_DRAFT: HostDraft = { name: "", address: "", model: "", is_local: false, agent_url: "" };

/**
 * Every `hosts:` entry, each editable in full. `integration_id` lives here
 * rather than under Integrations because the question it answers is about
 * the device ("where does this machine's data come from?"); each
 * Integrations card links back here instead. Renames and removals go
 * through configEdits.ts so services, alert overrides, and widgets that
 * refer to the host follow along.
 */
export function DevicesSettings({ config, onSave, disabled }: SectionProps) {
  const hosts: any[] = config?.hosts ?? [];
  const connections: IntegrationConfig[] = config?.integrations?.connections ?? [];
  const expanded = useExpanded("host.");
  const [draft, setDraft] = useState<HostDraft | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);

  const update = (name: string, patch: Record<string, unknown>) =>
    onSave((latest) => ({ hosts: (latest.hosts ?? []).map((h: any) => (h.name === name ? { ...h, ...patch } : h)) }));

  // Only one host can be the machine running this backend.
  const setLocal = (name: string, is_local: boolean) =>
    onSave((latest) => ({
      hosts: (latest.hosts ?? []).map((h: any) => (h.name === name ? { ...h, is_local } : is_local ? { ...h, is_local: false } : h)),
    }));

  const rename = async (host: any, to: string) => {
    to = to.trim();
    if (!to) return false;
    if (to === host.name) return;
    expanded.rename(host.name, to);
    if (!(await onSave((latest) => renameHost(latest, host.name, to)))) {
      expanded.rename(to, host.name);
      return;
    }
    onSave((latest) => remapWidgets(latest, "host", host.id, to));
  };

  const addDraft = async () => {
    if (!draft?.name.trim()) return;
    const host: Record<string, unknown> = { name: draft.name.trim(), is_local: draft.is_local };
    if (draft.address.trim()) host.address = draft.address.trim();
    if (draft.model.trim()) host.model = draft.model.trim();
    if (!draft.is_local && draft.agent_url.trim()) host.agent_url = draft.agent_url.trim();
    const ok = await onSave((latest) => ({
      hosts: [...(latest.hosts ?? []).map((h: any) => (draft.is_local ? { ...h, is_local: false } : h)), host],
    }));
    if (ok) {
      expanded.toggle(draft.name.trim());
      setDraft(null);
    }
  };

  const removalBody = (host: any): string => {
    const services = (config?.services ?? []).filter((s: any) => s.host === host.name).length;
    const widgets = widgetsReferencing(config, "host", host.id);
    return [
      `${host.name} will no longer be monitored.`,
      services > 0 && `${services} service${services === 1 ? "" : "s"} assigned to it will move to "Other Services".`,
      config?.alerting?.host_overrides?.[host.name] && "Its alert threshold overrides will be removed.",
      widgets > 0 && `${widgets} Home widget${widgets === 1 ? "" : "s"} will need a different host.`,
    ]
      .filter(Boolean)
      .join(" ");
  };

  return (
    <>
      {config?.demo_mode && (
        <Banner tone="info">
          Demo mode is on, so the dashboard is showing simulated hosts rather than these. Changes here are saved and
          take effect once demo mode is turned off (Integrations).
        </Banner>
      )}
      <SettingRow id="devices.hosts" label={`Monitored hosts (${hosts.length})`} description="Every machine the dashboard watches. Tap one to edit it." />

      {hosts.map((h) => (
        <ItemCard
          key={h.name}
          id={`host.${h.name}`}
          open={expanded.isOpen(h.name)}
          onToggle={() => expanded.toggle(h.name)}
          icon={<ServiceIcon icon={h.icon} size={32} />}
          title={h.name}
          subtitle={[collectionSummary(h, connections), h.address].filter(Boolean).join(" · ")}
          badge={h.is_local ? <span className="chip">This machine</span> : undefined}
        >
          <SettingRow label="Name">
            <TextField label={`Name of ${h.name}`} value={h.name} disabled={disabled} onCommit={(to) => rename(h, to)} />
          </SettingRow>
          <SettingRow label="Address" description="IP or hostname. Also used for its reachability check on the Network page.">
            <TextField label="Address" mono value={h.address} placeholder="192.168.1.20" disabled={disabled} onCommit={(v) => update(h.name, { address: v.trim() || null })} />
          </SettingRow>
          <SettingRow label="Model" description="Free-text hardware description.">
            <TextField label="Model" value={h.model} placeholder="Raspberry Pi 5" disabled={disabled} onCommit={(v) => update(h.name, { model: v.trim() || null })} />
          </SettingRow>
          <SettingRow label="Icon">
            <IconField label="Icon" value={h.icon} disabled={disabled} onCommit={(v) => update(h.name, { icon: v.trim() || null })} />
          </SettingRow>
          <SettingRow label="This machine" description="The machine running the dashboard -- collected locally with full metrics. Only one host can be this machine.">
            <Toggle label="This machine" checked={!!h.is_local} disabled={disabled} onChange={(on) => setLocal(h.name, on)} />
          </SettingRow>
          {!h.is_local && (
            <SettingRow label="Agent URL" description="A remote agent serving this dashboard's host metrics contract. Blank means reachability checks only.">
              <TextField label="Agent URL" mono value={h.agent_url} placeholder="http://192.168.1.20:8081/api/hosts/pi" disabled={disabled} onCommit={(v) => update(h.name, { agent_url: v.trim() || null })} />
            </SettingRow>
          )}
          <SettingRow label="Data source" description={sourceDescription(h, connections)}>
            <SelectField label={`Data source for ${h.name}`} value={h.integration_id ?? ""} disabled={disabled} onChange={(v) => update(h.name, { integration_id: v || null })}>
              <option value="">Default</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({INTEGRATION_TYPE_LABEL[c.type]})
                </option>
              ))}
            </SelectField>
          </SettingRow>
          <div className="settings-item__actions">
            <button className="btn btn--danger-ghost" disabled={disabled} onClick={() => setRemoving(h)}>
              Remove host
            </button>
          </div>
        </ItemCard>
      ))}

      {draft ? (
        <div className="card settings-item settings-item--draft">
          <div className="settings-item__title">New host</div>
          <SettingRow label="Name *">
            <input className="field" aria-label="New host name" value={draft.name} placeholder="nas" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </SettingRow>
          <SettingRow label="Address">
            <input className="field" aria-label="New host address" value={draft.address} placeholder="192.168.1.20" onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          </SettingRow>
          <SettingRow label="Model">
            <input className="field" aria-label="New host model" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          </SettingRow>
          <SettingRow label="This machine">
            <Toggle label="New host is this machine" checked={draft.is_local} onChange={(is_local) => setDraft({ ...draft, is_local })} />
          </SettingRow>
          {!draft.is_local && (
            <SettingRow label="Agent URL">
              <input className="field" aria-label="New host agent URL" value={draft.agent_url} placeholder="optional" onChange={(e) => setDraft({ ...draft, agent_url: e.target.value })} />
            </SettingRow>
          )}
          <div className="settings-item__actions">
            <button className="btn btn--primary" disabled={disabled || !draft.name.trim()} onClick={addDraft}>
              Add host
            </button>
            <button className="btn btn--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <SettingBlock id="devices.add" className="settings-item__actions">
          <button className="btn btn--ghost" disabled={disabled} onClick={() => setDraft(EMPTY_DRAFT)}>
            + Add host
          </button>
        </SettingBlock>
      )}

      {removing && (
        <ConfirmDialog
          targetName={removing.name}
          action={{ kind: "remove", label: "Remove", destructive: true, confirmTitle: `Remove ${removing.name}?`, confirmBody: removalBody(removing) }}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const name = removing.name;
            setRemoving(null);
            onSave((latest) => removeHost(latest, name));
          }}
        />
      )}
    </>
  );
}
