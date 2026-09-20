import React from "react";
import type { HostInfo, Service, WidgetConfig, WidgetType } from "../../api/types";
import { widgetLabel } from "./registry";
import { STYLE_LABEL, WIDGET_STYLES, resolveMetricDisplay, type MetricKey } from "../../api/metrics";
import { IconField, Note, SelectField, SettingBlock, SettingRow, TextField, Toggle, type SectionProps } from "./controls";

const WIDGET_TYPES: { type: WidgetType; label: string }[] = [
  { type: "host_overview", label: "+ Host Overview" },
  { type: "host_metric", label: "+ Host Metric" },
  { type: "services_grid", label: "+ Services Grid" },
  { type: "fleet_overview", label: "+ Fleet Overview" },
  { type: "custom_card", label: "+ Custom Card" },
];

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
export function LayoutSettings({
  config, onSave, disabled, hosts, services,
}: SectionProps & { hosts: HostInfo[]; services: Service[] }) {
  const widgets: WidgetConfig[] = config?.dashboard?.widgets ?? [];
  const metricDisplay = config?.dashboard?.metric_display;

  const saveWidgets = (change: (current: WidgetConfig[]) => WidgetConfig[]) =>
    onSave((latest) => ({ dashboard: { widgets: change(latest.dashboard?.widgets ?? []) } }));
  const update = (id: string, patch: Partial<WidgetConfig>) =>
    saveWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const remove = (id: string) => saveWidgets((ws) => ws.filter((w) => w.id !== id));
  const move = (id: string, dir: -1 | 1) =>
    saveWidgets((ws) => {
      const index = ws.findIndex((w) => w.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= ws.length) return ws;
      const next = [...ws];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const addWidget = (type: WidgetType) => {
    const widget: WidgetConfig = { id: `${type}-${Date.now()}`, type, visible: true };
    if (type === "host_overview" || type === "host_metric") widget.host_id = hosts[0]?.id;
    if (type === "host_metric") widget.metric = "cpu"; // style: follow Appearance
    if (type === "custom_card") {
      widget.name = "New Shortcut";
      widget.target_type = "service";
      widget.target_id = services[0]?.id;
      widget.action_kind = services[0]?.actions[0]?.kind;
      widget.icon = services[0]?.icon ?? undefined;
    }
    saveWidgets((ws) => [...ws, widget]);
  };

  // A widget can outlive what it points at (a host/service removed or
  // renamed in config.yml by hand) -- show that rather than letting the
  // <select> silently display its first option instead.
  const missing = (id: string | null | undefined, pool: { id: string }[]) =>
    !!id && pool.length > 0 && !pool.some((x) => x.id === id) ? (
      <option value={id}>⚠ {id} (not found)</option>
    ) : null;

  const actionsFor = (w: WidgetConfig): { kind: string; label: string }[] => {
    if (w.target_type === "host") return hosts.find((h) => h.id === w.target_id)?.actions ?? [];
    return services.find((s) => s.id === w.target_id)?.actions ?? [];
  };

  return (
    <>
      <SettingRow
        id="dashboard.widgets"
        label="Home page widgets"
        description={
          widgets.length === 0
            ? "Using the built-in layout (one card per host, then all services) -- add a widget below to start customizing."
            : "Reorder with the arrows, toggle visibility, or remove. Changes apply immediately on the Home page."
        }
      />

      {widgets.map((w, i) => (
        <SettingBlock key={w.id} id={`widget.${w.id}`} className="card settings-item">
          <div className="settings-item__header">
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn btn--ghost btn--icon" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(w.id, -1)}>
                ▲
              </button>
              <button
                className="btn btn--ghost btn--icon"
                aria-label="Move down"
                disabled={disabled || i === widgets.length - 1}
                onClick={() => move(w.id, 1)}
              >
                ▼
              </button>
            </div>
            <div className="settings-item__title">{widgetLabel(w)}</div>
            <Toggle label="Visible" checked={w.visible} disabled={disabled} onChange={(visible) => update(w.id, { visible })} />
            <button className="btn btn--ghost" disabled={disabled} onClick={() => remove(w.id)}>
              Remove
            </button>
          </div>

          {(w.type === "host_overview" || w.type === "host_metric") && (
            <SettingRow label="Host">
              <SelectField label="Host" value={w.host_id ?? ""} disabled={disabled} onChange={(host_id) => update(w.id, { host_id })}>
                {missing(w.host_id, hosts)}
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </SelectField>
            </SettingRow>
          )}
          {w.type === "host_metric" && (
            <>
              <SettingRow label="Metric">
                <SelectField
                  label="Metric"
                  value={w.metric ?? "cpu"}
                  disabled={disabled}
                  onChange={(value) => {
                    const metric = value as MetricKey;
                    // A style the new metric can't draw goes back to following Appearance.
                    const display = w.display && WIDGET_STYLES[metric].includes(w.display) ? w.display : null;
                    update(w.id, { metric, display });
                  }}
                >
                  {(["cpu", "mem", "disk", "temp"] as const).map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </SelectField>
              </SettingRow>
              <SettingRow label="Style" description="Color always follows Appearance > Metric display.">
                <SelectField
                  label="Style"
                  value={w.display && WIDGET_STYLES[w.metric ?? "cpu"].includes(w.display) ? w.display : ""}
                  disabled={disabled}
                  onChange={(display) => update(w.id, { display: (display || null) as WidgetConfig["display"] })}
                >
                  <option value="">Default ({STYLE_LABEL[resolveMetricDisplay(metricDisplay, w.metric ?? "cpu").style]}, from Appearance)</option>
                  {WIDGET_STYLES[w.metric ?? "cpu"].map((d) => (
                    <option key={d} value={d}>
                      {STYLE_LABEL[d]}
                    </option>
                  ))}
                </SelectField>
              </SettingRow>
            </>
          )}
          {w.type === "services_grid" && (
            <SettingRow label="Group filter">
              <TextField label="Group filter" value={w.group} placeholder="all groups" width={160} disabled={disabled} onCommit={(group) => update(w.id, { group: group || null })} />
            </SettingRow>
          )}
          {w.type === "custom_card" && (
            <>
              <SettingRow label="Name">
                <TextField label="Name" value={w.name} width={180} disabled={disabled} onCommit={(name) => (name.trim() ? update(w.id, { name }) : false)} />
              </SettingRow>
              <SettingRow label="Icon">
                <IconField label="Card icon" value={w.icon} disabled={disabled} onCommit={(icon) => update(w.id, { icon: icon || null })} />
              </SettingRow>
              <SettingRow label="Target type">
                <SelectField
                  label="Target type"
                  value={w.target_type ?? "service"}
                  disabled={disabled}
                  onChange={(value) => {
                    const target_type = value as WidgetConfig["target_type"];
                    const first = target_type === "host" ? hosts[0] : services[0];
                    update(w.id, { target_type, target_id: first?.id, action_kind: first?.actions[0]?.kind });
                  }}
                >
                  <option value="service">Service</option>
                  <option value="host">Host</option>
                </SelectField>
              </SettingRow>
              <SettingRow label="Target">
                <SelectField
                  label="Target"
                  value={w.target_id ?? ""}
                  disabled={disabled}
                  onChange={(target_id) => {
                    const pool = w.target_type === "host" ? hosts : services;
                    const target = pool.find((t) => t.id === target_id);
                    update(w.id, { target_id, action_kind: target?.actions[0]?.kind });
                  }}
                >
                  {missing(w.target_id, w.target_type === "host" ? hosts : services)}
                  {(w.target_type === "host" ? hosts : services).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </SelectField>
              </SettingRow>
              <SettingRow label="Action">
                <SelectField label="Action" value={w.action_kind ?? ""} disabled={disabled} onChange={(action_kind) => update(w.id, { action_kind })}>
                  {actionsFor(w).length === 0 && <option value="">No actions available</option>}
                  {actionsFor(w).map((a) => (
                    <option key={a.kind} value={a.kind}>
                      {a.label}
                    </option>
                  ))}
                </SelectField>
              </SettingRow>
            </>
          )}
        </SettingBlock>
      ))}

      <SettingBlock id="layout.add_widget" style={{ marginTop: 12 }}>
        <Note>Add a widget:</Note>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {WIDGET_TYPES.map(({ type, label }) => (
            <button key={type} className="btn btn--ghost" disabled={disabled} onClick={() => addWidget(type)}>
              {label}
            </button>
          ))}
        </div>
      </SettingBlock>
    </>
  );
}
