import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { applyAccentColor } from "../api/color";
import { useSnapshot } from "../hooks/SnapshotContext";
import { useAuth } from "../hooks/AuthContext";
import type { HostInfo, Service, WidgetConfig, WidgetType } from "../api/types";

const CATEGORIES = ["Display", "Layout", "System", "Network", "Alerting", "Integrations", "About"] as const;
type Category = (typeof CATEGORIES)[number];

export function SettingsPage() {
  const [active, setActive] = useState<Category>("Display");
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);
  const { snapshot } = useSnapshot();
  const { canAct } = useAuth();

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const updated = await api.patchConfig(patch);
      setConfig(updated);
    } finally {
      setSaving(false);
    }
  };

  // Every settings field is a mutating PATCH /api/config -- the backend
  // already rejects these outright under guest mode (docs/security.md);
  // disabling them here too is purely so the UI doesn't show a control
  // that would just fail, not the actual enforcement boundary.
  const disabled = saving || !canAct;

  return (
    <div className="page" style={{ flexDirection: "row", gap: "var(--space-4)" }}>
      <div style={{ width: 160, display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className="btn"
            style={{
              justifyContent: "flex-start",
              background: active === cat ? "var(--color-primary-soft)" : "transparent",
              color: active === cat ? "var(--color-primary)" : "var(--color-text)",
              border: "none",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="card" style={{ flex: 1, overflowY: "auto" }}>
        {!canAct && (
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-warning)",
              background: "var(--color-warning-soft)",
              border: "1px solid var(--color-warning)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px",
              marginBottom: 12,
            }}
          >
            Guest mode is active -- log in (top right) to change settings.
          </div>
        )}
        {active === "Display" && <DisplaySettings config={config} onSave={save} saving={disabled} />}
        {active === "Layout" && (
          <LayoutSettings config={config} onSave={save} saving={disabled} hosts={snapshot?.hosts ?? []} services={snapshot?.services ?? []} />
        )}
        {active === "System" && <SystemSettings config={config} onSave={save} saving={disabled} />}
        {active === "Network" && <NetworkSettings config={config} />}
        {active === "Alerting" && <AlertingSettings config={config} onSave={save} saving={disabled} />}
        {active === "Integrations" && <IntegrationsSettings config={config} />}
        {active === "About" && <AboutSettings />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
      <span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function DisplaySettings({ config, onSave, saving }: { config: any; onSave: (p: any) => void; saving: boolean }) {
  const display = config?.display ?? {};
  return (
    <div>
      <div className="section-title">DISPLAY</div>
      <Row label="Auto-dim">
        <input
          type="checkbox"
          checked={!!display.auto_dim}
          disabled={saving}
          onChange={(e) => onSave({ display: { auto_dim: e.target.checked } })}
        />
      </Row>
      <Row label="Dim delay">
        <span>{display.dim_delay_minutes ?? "—"} minutes</span>
      </Row>
      <Row label="Screen timeout">
        <select
          value={display.screen_timeout ?? "never"}
          disabled={saving}
          onChange={(e) => onSave({ display: { screen_timeout: e.target.value } })}
        >
          {["never", "1m", "5m", "10m", "30m"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Theme">
        <select
          value={config?.dashboard?.theme ?? "dark"}
          disabled={saving}
          onChange={(e) => {
            onSave({ dashboard: { theme: e.target.value } });
            document.documentElement.setAttribute("data-theme", e.target.value);
          }}
        >
          <option value="dark">Dark (Default)</option>
          <option value="light">Light</option>
        </select>
      </Row>
      <Row label="Accent color">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="color"
            value={config?.dashboard?.accent_color ?? "#3b82f6"}
            disabled={saving}
            onChange={(e) => {
              onSave({ dashboard: { accent_color: e.target.value } });
              applyAccentColor(e.target.value);
            }}
            style={{ width: 36, height: 28, padding: 0, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "none" }}
          />
          {config?.dashboard?.accent_color && (
            <button
              className="btn btn--ghost"
              disabled={saving}
              onClick={() => {
                onSave({ dashboard: { accent_color: null } });
                applyAccentColor(null);
              }}
            >
              Reset
            </button>
          )}
        </div>
      </Row>
      <Row label="Density">
        <select
          value={config?.dashboard?.density ?? "compact"}
          disabled={saving}
          onChange={(e) => {
            onSave({ dashboard: { density: e.target.value } });
            document.documentElement.setAttribute("data-density", e.target.value);
          }}
        >
          <option value="compact">Compact (Default)</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </Row>
    </div>
  );
}

const WIDGET_TYPES: { type: WidgetType; label: string }[] = [
  { type: "host_overview", label: "+ Host Overview" },
  { type: "host_metric", label: "+ Host Metric" },
  { type: "services_grid", label: "+ Services Grid" },
  { type: "fleet_overview", label: "+ Fleet Overview" },
  { type: "custom_card", label: "+ Custom Card" },
];

const selectStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-2)",
  color: "var(--color-text)",
  fontSize: "var(--text-sm)",
};

/**
 * Widget host/target ids here are deliberately the *snapshot's* ids
 * (HostInfo.id / Service.id), not raw config.yml names -- those are what
 * HomePage.tsx actually matches widgets against
 * (frontend/src/pages/HomePage.tsx), and they're already correctly
 * slugified server-side (backend/collectors/hosts.py:host_id). Building
 * this from `config.hosts`/`config.services` instead would require
 * re-deriving that slug in JS and could drift from the backend's own
 * logic.
 */
function LayoutSettings({
  config, onSave, saving, hosts, services,
}: { config: any; onSave: (p: any) => void; saving: boolean; hosts: HostInfo[]; services: Service[] }) {
  const widgets: WidgetConfig[] = config?.dashboard?.widgets ?? [];

  const saveWidgets = (updated: WidgetConfig[]) => onSave({ dashboard: { widgets: updated } });
  const update = (id: string, patch: Partial<WidgetConfig>) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const remove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target], next[index]];
    saveWidgets(next);
  };

  const addWidget = (type: WidgetType) => {
    const id = `${type}-${Date.now()}`;
    const widget: WidgetConfig = { id, type, visible: true };
    if (type === "host_overview" || type === "host_metric") widget.host_id = hosts[0]?.id;
    if (type === "host_metric") {
      widget.metric = "cpu";
      widget.display = "gauge";
    }
    if (type === "custom_card") {
      widget.name = "New Shortcut";
      widget.target_type = "service";
      widget.target_id = services[0]?.id;
      widget.action_kind = services[0]?.actions[0]?.kind;
      widget.icon = services[0]?.icon ?? undefined;
    }
    saveWidgets([...widgets, widget]);
  };

  const actionsFor = (w: WidgetConfig): { kind: string; label: string }[] => {
    if (w.target_type === "host") return hosts.find((h) => h.id === w.target_id)?.actions ?? [];
    return services.find((s) => s.id === w.target_id)?.actions ?? [];
  };

  return (
    <div>
      <div className="section-title">HOME PAGE LAYOUT</div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginBottom: 10 }}>
        {widgets.length === 0
          ? "Using the built-in layout (one card per host, then all services) -- add a widget below to start customizing."
          : "Reorder with the arrows, toggle visibility, or remove. Changes apply immediately on the Home page."}
      </div>

      {widgets.map((w, i) => (
        <div key={w.id} className="card" style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <button className="btn btn--ghost" style={{ padding: "0 6px", minHeight: 18, fontSize: 10 }} disabled={saving || i === 0} onClick={() => move(i, -1)}>
                ▲
              </button>
              <button
                className="btn btn--ghost"
                style={{ padding: "0 6px", minHeight: 18, fontSize: 10 }}
                disabled={saving || i === widgets.length - 1}
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
            </div>
            <div style={{ flex: 1, fontWeight: 600, fontSize: "var(--text-sm)", textTransform: "capitalize" }}>
              {w.type.replace(/_/g, " ")}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              <input type="checkbox" checked={w.visible} disabled={saving} onChange={(e) => update(w.id, { visible: e.target.checked })} />
              Visible
            </label>
            <button className="btn btn--ghost" disabled={saving} onClick={() => remove(w.id)}>
              Remove
            </button>
          </div>

          {(w.type === "host_overview" || w.type === "host_metric") && (
            <Row label="Host">
              <select style={selectStyle} value={w.host_id ?? ""} disabled={saving} onChange={(e) => update(w.id, { host_id: e.target.value })}>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Row>
          )}
          {w.type === "host_metric" && (
            <>
              <Row label="Metric">
                <select style={selectStyle} value={w.metric ?? "cpu"} disabled={saving} onChange={(e) => update(w.id, { metric: e.target.value as WidgetConfig["metric"] })}>
                  {(["cpu", "mem", "disk", "temp"] as const).map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Display">
                <select style={selectStyle} value={w.display ?? "gauge"} disabled={saving} onChange={(e) => update(w.id, { display: e.target.value as WidgetConfig["display"] })}>
                  {(["gauge", "sparkline", "numeric"] as const).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
          {w.type === "services_grid" && (
            <Row label="Group filter">
              <input
                style={{ ...selectStyle, width: 140 }}
                value={w.group ?? ""}
                placeholder="all groups"
                disabled={saving}
                onChange={(e) => update(w.id, { group: e.target.value || null })}
              />
            </Row>
          )}
          {w.type === "custom_card" && (
            <>
              <Row label="Name">
                <input style={{ ...selectStyle, width: 160 }} value={w.name ?? ""} disabled={saving} onChange={(e) => update(w.id, { name: e.target.value })} />
              </Row>
              <Row label="Icon">
                <input
                  style={{ ...selectStyle, width: 160 }}
                  value={w.icon ?? ""}
                  placeholder="e.g. flame"
                  disabled={saving}
                  onChange={(e) => update(w.id, { icon: e.target.value })}
                />
              </Row>
              <Row label="Target type">
                <select
                  style={selectStyle}
                  value={w.target_type ?? "service"}
                  disabled={saving}
                  onChange={(e) => {
                    const target_type = e.target.value as WidgetConfig["target_type"];
                    const first = target_type === "host" ? hosts[0] : services[0];
                    update(w.id, { target_type, target_id: first?.id, action_kind: first?.actions[0]?.kind });
                  }}
                >
                  <option value="service">Service</option>
                  <option value="host">Host</option>
                </select>
              </Row>
              <Row label="Target">
                <select
                  style={selectStyle}
                  value={w.target_id ?? ""}
                  disabled={saving}
                  onChange={(e) => {
                    const pool = w.target_type === "host" ? hosts : services;
                    const target = pool.find((t) => t.id === e.target.value);
                    update(w.id, { target_id: e.target.value, action_kind: target?.actions[0]?.kind });
                  }}
                >
                  {(w.target_type === "host" ? hosts : services).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Action">
                <select style={selectStyle} value={w.action_kind ?? ""} disabled={saving} onChange={(e) => update(w.id, { action_kind: e.target.value })}>
                  {actionsFor(w).length === 0 && <option value="">No actions available</option>}
                  {actionsFor(w).map((a) => (
                    <option key={a.kind} value={a.kind}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {WIDGET_TYPES.map(({ type, label }) => (
          <button key={type} className="btn btn--ghost" disabled={saving} onClick={() => addWidget(type)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SystemSettings({ config, onSave, saving }: { config: any; onSave: (p: any) => void; saving: boolean }) {
  const hosts: any[] = config?.hosts ?? [];
  const guestMode = !!config?.guest_mode;
  return (
    <div>
      <div className="section-title">SYSTEM</div>
      <Row label="Dashboard name">
        <span>{config?.dashboard?.title ?? "—"}</span>
      </Row>
      <Row label="History retention">
        <span>{config?.history?.retention_days ?? "—"} days</span>
      </Row>

      <div className="section-title" style={{ marginTop: 16 }}>
        GUEST / READ-ONLY MODE
      </div>
      <Row label="Enabled">
        <input
          type="checkbox"
          checked={guestMode}
          disabled={saving}
          onChange={(e) => onSave({ guest_mode: e.target.checked })}
        />
      </Row>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", padding: "4px 0 12px" }}>
        When on, every action (start/stop/restart, host actions, config edits, alert
        acknowledgment, these very settings) requires logging in -- viewing stays open to
        everyone. Meant for a kiosk/wall tablet.{" "}
        <strong style={{ color: "var(--color-text)" }}>
          Only meaningfully protected if you've also set the DASHBOARD_PASSWORD environment
          variable
        </strong>{" "}
        -- without one, turning this on blocks every action with no way to undo it from this
        page, since there's no password to log in with (see docs/security.md).
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        HOSTS ({hosts.length})
      </div>
      {hosts.length === 0 && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", padding: "8px 0" }}>
          No hosts configured -- see docs/configuration.md
        </div>
      )}
      {hosts.map((h) => (
        <Row key={h.name} label={h.name}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            {h.is_local ? "Local" : h.agent_url ? "Remote (agent)" : h.address ? "Remote (reachability only)" : "No address"}
            {h.model ? ` · ${h.model}` : ""}
          </span>
        </Row>
      ))}
    </div>
  );
}

function NetworkSettings({ config }: { config: any }) {
  return (
    <div>
      <div className="section-title">NETWORK</div>
      <Row label="Internet check target">
        <span>{config?.network?.internet_target ?? "—"}</span>
      </Row>
      <Row label="Monitored devices">
        <span>{config?.network?.devices?.length ?? 0}</span>
      </Row>
    </div>
  );
}

const NOTIFIER_TYPES = ["discord", "ntfy", "pushover", "webhook"] as const;

const numberInputStyle: React.CSSProperties = {
  width: 70,
  padding: "4px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-2)",
  color: "var(--color-text)",
  fontSize: "var(--text-sm)",
  textAlign: "right",
};

const textInputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-2)",
  color: "var(--color-text)",
  fontSize: "var(--text-sm)",
  width: "100%",
};

// A threshold field is `null` when disabled -- an empty input maps back
// to null rather than 0, since "0%" is a real (if silly) threshold and
// "disabled" has to stay reachable.
function ThresholdRow({
  label, value, onChange, disabled,
}: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; disabled: boolean }) {
  return (
    <Row label={label}>
      <input
        type="number"
        value={value ?? ""}
        disabled={disabled}
        placeholder="off"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={numberInputStyle}
      />
    </Row>
  );
}

function AlertingSettings({ config, onSave, saving }: { config: any; onSave: (p: any) => void; saving: boolean }) {
  const alerting = config?.alerting ?? {};
  const defaults = alerting.defaults ?? {};
  const notifiers: any[] = alerting.notifiers ?? [];
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const saveThreshold = (field: string, value: number | null) => onSave({ alerting: { defaults: { [field]: value } } });
  const saveNotifiers = (updated: any[]) => onSave({ alerting: { notifiers: updated } });

  const addNotifier = (type: string) => {
    saveNotifiers([...notifiers, { id: `${type}-${Date.now()}`, type, name: `New ${type}`, enabled: true }]);
  };
  const updateNotifier = (id: string, patch: Record<string, unknown>) =>
    saveNotifiers(notifiers.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const removeNotifier = (id: string) => saveNotifiers(notifiers.filter((n) => n.id !== id));

  const testNotifierNow = async (id: string) => {
    setTestingId(id);
    try {
      const result = await api.testNotifier(id);
      setTestResults((r) => ({ ...r, [id]: `${result.success ? "✓" : "✗"} ${result.message}` }));
    } catch (err) {
      setTestResults((r) => ({ ...r, [id]: `✗ ${(err as Error).message}` }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div>
      <div className="section-title">ALERT THRESHOLDS</div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginBottom: 8 }}>
        Applies to every host/service unless overridden in config.yml. Leave a field blank to disable that check.
      </div>
      <ThresholdRow label="CPU usage (%)" value={defaults.cpu_percent} disabled={saving} onChange={(v) => saveThreshold("cpu_percent", v)} />
      <ThresholdRow label="Memory usage (%)" value={defaults.mem_percent} disabled={saving} onChange={(v) => saveThreshold("mem_percent", v)} />
      <ThresholdRow label="Disk usage (%)" value={defaults.disk_percent} disabled={saving} onChange={(v) => saveThreshold("disk_percent", v)} />
      <ThresholdRow label="Temperature (°C)" value={defaults.temp_c} disabled={saving} onChange={(v) => saveThreshold("temp_c", v)} />
      <ThresholdRow
        label="Offline duration (minutes)"
        value={defaults.offline_minutes}
        disabled={saving}
        onChange={(v) => saveThreshold("offline_minutes", v)}
      />

      <div className="section-title" style={{ marginTop: 24 }}>
        NOTIFICATIONS
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginBottom: 8 }}>
        Sending is simulated for now (see docs/architecture.md) -- "Send Test" always reports a plausible outcome
        rather than reaching Discord/ntfy/Pushover for real.
      </div>
      {notifiers.length === 0 && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", padding: "8px 0" }}>No notifiers configured.</div>
      )}
      {notifiers.map((n) => (
        <div key={n.id} className="card" style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <input
              value={n.name}
              disabled={saving}
              onChange={(e) => updateNotifier(n.id, { name: e.target.value })}
              style={{ ...textInputStyle, fontWeight: 600, border: "none", background: "transparent", padding: 0 }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textTransform: "uppercase" }}>{n.type}</span>
              <input type="checkbox" checked={n.enabled} disabled={saving} onChange={(e) => updateNotifier(n.id, { enabled: e.target.checked })} />
            </div>
          </div>

          {(n.type === "discord" || n.type === "webhook") && (
            <Row label="URL env var">
              <input
                value={n.url_env ?? ""}
                placeholder="e.g. DISCORD_WEBHOOK_URL"
                disabled={saving}
                onChange={(e) => updateNotifier(n.id, { url_env: e.target.value })}
                style={textInputStyle}
              />
            </Row>
          )}
          {n.type === "ntfy" && (
            <>
              <Row label="Server">
                <input
                  value={n.ntfy_server ?? "https://ntfy.sh"}
                  disabled={saving}
                  onChange={(e) => updateNotifier(n.id, { ntfy_server: e.target.value })}
                  style={textInputStyle}
                />
              </Row>
              <Row label="Topic">
                <input
                  value={n.ntfy_topic ?? ""}
                  disabled={saving}
                  onChange={(e) => updateNotifier(n.id, { ntfy_topic: e.target.value })}
                  style={textInputStyle}
                />
              </Row>
            </>
          )}
          {n.type === "pushover" && (
            <>
              <Row label="User key env var">
                <input
                  value={n.pushover_user_key_env ?? ""}
                  placeholder="e.g. PUSHOVER_USER_KEY"
                  disabled={saving}
                  onChange={(e) => updateNotifier(n.id, { pushover_user_key_env: e.target.value })}
                  style={textInputStyle}
                />
              </Row>
              <Row label="API token env var">
                <input
                  value={n.pushover_api_token_env ?? ""}
                  placeholder="e.g. PUSHOVER_API_TOKEN"
                  disabled={saving}
                  onChange={(e) => updateNotifier(n.id, { pushover_api_token_env: e.target.value })}
                  style={textInputStyle}
                />
              </Row>
            </>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn--ghost" onClick={() => testNotifierNow(n.id)} disabled={saving || testingId === n.id}>
              {testingId === n.id ? "Sending…" : "Send Test"}
            </button>
            <button className="btn btn--ghost" onClick={() => removeNotifier(n.id)} disabled={saving}>
              Remove
            </button>
          </div>
          {testResults[n.id] && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: testResults[n.id].startsWith("✓") ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              {testResults[n.id]}
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        {NOTIFIER_TYPES.map((type) => (
          <button key={type} className="btn btn--ghost" style={{ textTransform: "capitalize" }} disabled={saving} onClick={() => addNotifier(type)}>
            + {type}
          </button>
        ))}
      </div>
    </div>
  );
}

function IntegrationsSettings({ config }: { config: any }) {
  const integ = config?.integrations ?? {};
  return (
    <div>
      <div className="section-title">INTEGRATIONS</div>
      <Row label="Docker">
        <span>{integ.docker_enabled ? "Enabled" : "Disabled"}</span>
      </Row>
      <Row label="systemd">
        <span>{integ.systemd_enabled ? "Enabled" : "Disabled"}</span>
      </Row>
      <Row label="Prometheus">
        <span>{integ.prometheus_enabled ? "Enabled" : "Disabled (optional)"}</span>
      </Row>
    </div>
  );
}

function AboutSettings() {
  return (
    <div>
      <div className="section-title">ABOUT</div>
      <Row label="Application version">
        <span>0.1.0</span>
      </Row>
      <Row label="License">
        <span>MIT</span>
      </Row>
      <Row label="Source">
        <a href="https://github.com/" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </Row>
    </div>
  );
}
