import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { formatTimestamp } from "../../api/format";
import type { IntegrationConfig, IntegrationStatus, IntegrationStatusEntry, IntegrationType } from "../../api/types";
import { Note, NumberField, SectionHeader, SettingBlock, SettingRow, TextField, Toggle, type SectionProps } from "./controls";

export const INTEGRATION_TYPE_LABEL: Record<IntegrationType, string> = {
  docker_api: "Docker API",
  prometheus: "Prometheus",
  node_exporter: "node_exporter / Glances",
  ssh: "SSH command runner",
  custom_script: "Custom script",
};

interface FieldDef {
  key: keyof IntegrationConfig;
  label: string;
  placeholder?: string;
  /** Mirrors backend/config/schema.py:validate_integrations -- a blank
   * required field would be rejected, so a cleared one keeps its value. */
  required?: boolean;
  number?: boolean;
}

const FIELDS: Record<IntegrationType, FieldDef[]> = {
  docker_api: [
    { key: "docker_url", label: "Docker URL", placeholder: "tcp://host:2376", required: true },
    { key: "docker_tls_cert_path", label: "TLS cert path", placeholder: "optional -- client-cert TLS only" },
    { key: "docker_tls_key_path", label: "TLS key path", placeholder: "optional" },
    { key: "docker_tls_ca_path", label: "TLS CA path", placeholder: "optional" },
  ],
  prometheus: [{ key: "prometheus_url", label: "Prometheus URL", placeholder: "http://host:9090", required: true }],
  node_exporter: [{ key: "metrics_url", label: "Metrics URL", placeholder: "http://host:9100/metrics", required: true }],
  ssh: [
    { key: "ssh_host", label: "Host", placeholder: "192.168.1.20", required: true },
    { key: "ssh_port", label: "Port", number: true },
    { key: "ssh_username", label: "Username", placeholder: "monitor", required: true },
    { key: "ssh_key_path", label: "Private key path", placeholder: "/etc/homelab-dashboard/keys/rpi", required: true },
  ],
  custom_script: [{ key: "script_path", label: "Script path", placeholder: "/opt/scripts/status.sh", required: true }],
};

function integrationStatusLabel(status: IntegrationStatus | undefined): { text: string; color: string } {
  if (status === "connected") return { text: "Connected", color: "var(--color-success)" };
  if (status === "error") return { text: "Error", color: "var(--color-danger)" };
  return { text: "Not configured", color: "var(--color-text-muted)" };
}

function formatCheckIn(ts?: number | null): string {
  return ts ? formatTimestamp(ts * 1000) : "Never";
}

/**
 * A connection's `id` here comes from config.yml (integrations.connections),
 * unlike widgets/custom cards, which deliberately match against the
 * *snapshot's* server-computed ids -- there's no separate derived id for
 * an integration, so the config id is the only id there is.
 *
 * Which host uses which connection is chosen per host under Settings >
 * Devices (DevicesSettings.tsx); each card here just links to the hosts
 * currently assigned to it.
 */
export function IntegrationsSettings({ config, onSave, disabled }: SectionProps) {
  const integ = config?.integrations ?? {};
  const connections: IntegrationConfig[] = integ.connections ?? [];
  const configHosts: any[] = config?.hosts ?? [];
  const [statusMap, setStatusMap] = useState<Record<string, IntegrationStatusEntry>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<IntegrationConfig | null>(null);

  useEffect(() => {
    api.getIntegrationStatus()
      .then((entries) => setStatusMap(Object.fromEntries(entries.map((e) => [e.id, e]))))
      .catch(() => {});
    // Re-fetch whenever the set of configured connections changes (e.g. after
    // adding one) so a freshly-added integration's "not configured" row shows up.
  }, [connections.map((c) => c.id).join(",")]);

  const saveConnections = (change: (current: IntegrationConfig[]) => IntegrationConfig[]) =>
    onSave((latest) => ({ integrations: { connections: change(latest.integrations?.connections ?? []) } }));
  const update = (id: string, patch: Partial<IntegrationConfig>) =>
    saveConnections((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id: string) => saveConnections((cs) => cs.filter((c) => c.id !== id));

  // New connections start as an unsaved draft: several types have
  // required fields with no sensible default (an SSH host, a script
  // path), and saving them blank is rejected by the backend.
  const startDraft = (type: IntegrationType) =>
    setDraft({ id: `${type}-${Date.now()}`, type, name: INTEGRATION_TYPE_LABEL[type], enabled: true, ...(type === "ssh" ? { ssh_port: 22 } : {}) });
  const draftComplete = !!draft && !!draft.name.trim() && FIELDS[draft.type].every((f) => !f.required || String(draft[f.key] ?? "").trim());
  const addDraft = async () => {
    if (!draft || !draftComplete) return;
    const conn = draft;
    if (await saveConnections((cs) => [...cs, conn])) setDraft(null);
  };

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result = await api.testIntegration(id);
      setTestMessage((m) => ({ ...m, [id]: `${result.success ? "✓" : "✗"} ${result.message}` }));
      setStatusMap((m) => ({ ...m, [id]: result }));
    } catch (err) {
      setTestMessage((m) => ({ ...m, [id]: `✗ ${(err as Error).message}` }));
    } finally {
      setTestingId(null);
    }
  };

  const fieldRow = (c: IntegrationConfig, f: FieldDef) => (
    <SettingRow key={f.key} label={f.label}>
      {f.number ? (
        <NumberField
          label={f.label}
          value={c[f.key] as number | undefined}
          min={1}
          max={65535}
          disabled={disabled}
          onCommit={(n) => n != null && update(c.id, { [f.key]: n })}
        />
      ) : (
        <TextField
          label={f.label}
          mono
          value={c[f.key] as string | null | undefined}
          placeholder={f.placeholder}
          disabled={disabled}
          onCommit={(v) => {
            if (f.required && !v.trim()) return false;
            return update(c.id, { [f.key]: v.trim() ? v : null });
          }}
        />
      )}
    </SettingRow>
  );

  return (
    <>
      <SettingRow
        id="demo_mode"
        label="Demo mode"
        description="Show simulated hosts and services instead of real data -- handy for trying the dashboard out. Nothing real is monitored or controlled while it's on."
      >
        <Toggle label="Demo mode" checked={!!config?.demo_mode} disabled={disabled} onChange={(demo_mode) => onSave({ demo_mode })} />
      </SettingRow>
      <SettingRow
        id="integrations.docker_socket"
        label="Local Docker socket"
        description="What every Docker service, and container discovery when adding one, talks to."
      >
        <TextField
          label="Local Docker socket"
          mono
          value={integ.docker_socket}
          placeholder="unix:///var/run/docker.sock"
          disabled={disabled}
          onCommit={(v) => onSave({ integrations: { docker_socket: v.trim() || "unix:///var/run/docker.sock" } })}
        />
      </SettingRow>

      <SectionHeader
        title="CONNECTIONS"
        description="Test Connection checks from the machine running the dashboard and never changes anything on the other end. Assign a Docker API connection to a host under Devices to monitor and control that host's containers through it."
      />
      <SettingRow
        id="integrations.connections"
        label={`Data source connections (${connections.length})`}
        description={
          connections.length === 0
            ? "None yet -- the local Docker socket and systemd keep working exactly as before. Add a connection to reach a remote host's Docker API, a Prometheus server, or a host over SSH."
            : "Choose which host uses a connection under Devices."
        }
      />

      {connections.map((c) => {
        const state = statusMap[c.id];
        const sl = integrationStatusLabel(state?.status);
        const usedBy = configHosts.filter((h) => h.integration_id === c.id);
        return (
          <SettingBlock key={c.id} id={`integration.${c.id}`} className="card settings-item">
            <div className="settings-item__header">
              <TextField label="Connection name" value={c.name} width="100%" disabled={disabled} onCommit={(name) => (name.trim() ? update(c.id, { name }) : false)} />
              <span className="settings-note" style={{ margin: 0, whiteSpace: "nowrap" }}>{INTEGRATION_TYPE_LABEL[c.type]}</span>
              <Toggle label={`${c.name} enabled`} checked={c.enabled} disabled={disabled} onChange={(enabled) => update(c.id, { enabled })} />
            </div>

            <SettingRow label="Status" description={`Last successful check-in: ${formatCheckIn(state?.lastSuccessAt)}`}>
              <span style={{ color: sl.color, fontWeight: 600, fontSize: "var(--text-sm)" }}>{sl.text}</span>
            </SettingRow>
            <SettingRow label="Used by">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {usedBy.length === 0 && <span className="settings-note" style={{ margin: 0 }}>No hosts</span>}
                {usedBy.map((h) => (
                  <Link key={h.name} className="chip" to={`/settings?c=devices&s=${encodeURIComponent(`host.${h.name}`)}`}>
                    {h.name} ›
                  </Link>
                ))}
              </div>
            </SettingRow>
            {FIELDS[c.type].map((f) => fieldRow(c, f))}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn--ghost" onClick={() => testConnection(c.id)} disabled={disabled || testingId === c.id}>
                {testingId === c.id ? "Testing…" : "Test Connection"}
              </button>
              <button className="btn btn--ghost" onClick={() => remove(c.id)} disabled={disabled}>
                Remove
              </button>
              {testMessage[c.id] && (
                <span style={{ fontSize: "var(--text-xs)", color: testMessage[c.id].startsWith("✓") ? "var(--color-success)" : "var(--color-danger)" }}>
                  {testMessage[c.id]}
                </span>
              )}
            </div>
          </SettingBlock>
        );
      })}

      {draft ? (
        <div className="card settings-item settings-item--draft">
          <div className="settings-item__header">
            <div className="settings-item__title">New {INTEGRATION_TYPE_LABEL[draft.type]} connection</div>
          </div>
          <SettingRow label="Name">
            <input className="field" aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </SettingRow>
          {FIELDS[draft.type].map((f) => (
            <SettingRow key={f.key} label={f.required ? `${f.label} *` : f.label}>
              <input
                className={f.number ? "field field--number" : "field"}
                aria-label={f.label}
                type={f.number ? "number" : "text"}
                style={f.number ? undefined : { fontFamily: "var(--font-mono)", width: 220, maxWidth: "100%" }}
                placeholder={f.placeholder}
                value={String(draft[f.key] ?? "")}
                onChange={(e) => setDraft({ ...draft, [f.key]: f.number ? Number(e.target.value) : e.target.value })}
              />
            </SettingRow>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn--primary" disabled={disabled || !draftComplete} onClick={addDraft}>
              Add connection
            </button>
            <button className="btn btn--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {!draftComplete && <span className="settings-note" style={{ margin: 0 }}>* required</span>}
          </div>
        </div>
      ) : (
        <>
          <Note>Add a connection:</Note>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(Object.keys(FIELDS) as IntegrationType[]).map((type) => (
              <button key={type} className="btn btn--ghost" disabled={disabled} onClick={() => startDraft(type)}>
                + {INTEGRATION_TYPE_LABEL[type]}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
