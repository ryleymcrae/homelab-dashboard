import React, { useState } from "react";
import { api } from "../../api/client";
import { celsiusToDisplay, displayToCelsius, temperatureSymbol, type TemperatureUnit } from "../../api/format";
import {
  ItemCard,
  Note,
  NumberField,
  SectionHeader,
  Segmented,
  SelectField,
  SettingBlock,
  SettingRow,
  TextField,
  Toggle,
  useExpanded,
  type SectionProps,
} from "./controls";

const NOTIFIER_TYPES = ["discord", "ntfy", "pushover", "webhook"] as const;

const THRESHOLDS: { field: string; label: string; suffix: string }[] = [
  { field: "cpu_percent", label: "CPU usage threshold", suffix: "%" },
  { field: "mem_percent", label: "Memory usage threshold", suffix: "%" },
  { field: "disk_percent", label: "Disk usage threshold", suffix: "%" },
  { field: "temp_c", label: "Temperature threshold", suffix: "°C" },
  { field: "offline_minutes", label: "Offline duration", suffix: "min" },
];

type OverrideKind = "host_overrides" | "service_overrides";
type Override = Record<string, number | null>;

// The evaluator only applies offline_minutes to services
// (backend/alerting/evaluator.py) -- resource thresholds are per host.
const OVERRIDE_FIELDS: Record<OverrideKind, typeof THRESHOLDS> = {
  host_overrides: THRESHOLDS,
  service_overrides: THRESHOLDS.filter((t) => t.field === "offline_minutes"),
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * `temp_c` is stored in Celsius whatever the display unit
 * (backend/config/schema.py) -- converted here on the way in and out, so
 * a Fahrenheit user sees and types Fahrenheit. Rounded to 0.1° both
 * ways, which round-trips exactly for whole-degree values.
 */
function thresholdUnits(unit: TemperatureUnit) {
  const isTemp = (field: string) => field === "temp_c";
  return {
    suffix: (field: string, suffix: string) => (isTemp(field) ? temperatureSymbol(unit) : suffix),
    show: (field: string, v: number | null | undefined) => (isTemp(field) && v != null ? round1(celsiusToDisplay(v, unit)) : v),
    store: (field: string, v: number | null | undefined) => (isTemp(field) && v != null ? round1(displayToCelsius(v, unit)) : v),
  };
}

function formatThreshold(value: number | null | undefined, suffix: string): string {
  return value == null ? "off" : `${value}${suffix === "min" ? " min" : suffix}`;
}

/**
 * One threshold inside an override, in the three states the evaluator
 * distinguishes (backend/alerting/evaluator.py:merge_thresholds): key
 * absent = follow the global default, `null` = this check off for this
 * target, a number = its own threshold.
 */
function OverrideRow({
  label, suffix, override, field, globalValue, disabled, onChange,
}: {
  label: string;
  suffix: string;
  override: Override;
  field: string;
  globalValue: number | null | undefined;
  disabled: boolean;
  onChange: (value: number | null | undefined) => unknown;
}) {
  const mode = !(field in override) ? "default" : override[field] === null ? "off" : "custom";
  return (
    <SettingRow label={label}>
      <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Segmented
          label={label}
          value={mode}
          disabled={disabled}
          options={[
            { value: "default", label: `Default (${formatThreshold(globalValue, suffix)})` },
            { value: "off", label: "Off" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(m) => onChange(m === "default" ? undefined : m === "off" ? null : globalValue ?? 0)}
        />
        {mode === "custom" && (
          <NumberField label={`${label} value`} value={override[field]} suffix={suffix} min={0} disabled={disabled} onCommit={(n) => (n == null ? false : onChange(n))} />
        )}
      </span>
    </SettingRow>
  );
}

export function AlertsSettings({ config, onSave, disabled }: SectionProps) {
  const alerting = config?.alerting ?? {};
  const defaults = alerting.defaults ?? {};
  const notifiers: any[] = alerting.notifiers ?? [];
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const saveNotifiers = (change: (current: any[]) => any[]) =>
    onSave((latest) => ({ alerting: { notifiers: change(latest.alerting?.notifiers ?? []) } }));
  const addNotifier = (type: string) =>
    saveNotifiers((ns) => [...ns, { id: `${type}-${Date.now()}`, type, name: `New ${type}`, enabled: true }]);
  const updateNotifier = (id: string, patch: Record<string, unknown>) =>
    saveNotifiers((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const removeNotifier = (id: string) => saveNotifiers((ns) => ns.filter((n) => n.id !== id));

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

  const enabled = alerting.enabled ?? true;
  const units = thresholdUnits(config?.dashboard?.temperature_unit ?? "celsius");

  const hostExpanded = useExpanded("override.host.");
  const serviceExpanded = useExpanded("override.service.");
  const [newOverride, setNewOverride] = useState<Record<OverrideKind, string>>({ host_overrides: "", service_overrides: "" });

  // Sent whole: the backend replaces override maps rather than merging
  // them (backend/config/loader.py), so a field can go back to "default"
  // and an override can be removed outright.
  const saveOverrides = (kind: OverrideKind, change: (current: Record<string, Override>) => Record<string, Override>) =>
    onSave((latest) => ({ alerting: { [kind]: change(latest.alerting?.[kind] ?? {}) } }));
  const setOverrideField = (kind: OverrideKind, name: string, field: string, value: number | null | undefined) =>
    saveOverrides(kind, (m) => {
      const next: Override = { ...(m[name] ?? {}) };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return { ...m, [name]: next };
    });

  const overrideSection = (kind: OverrideKind, title: string, candidates: string[]) => {
    const overrides: Record<string, Override> = alerting[kind] ?? {};
    const expanded = kind === "host_overrides" ? hostExpanded : serviceExpanded;
    const prefix = kind === "host_overrides" ? "override.host." : "override.service.";
    const available = candidates.filter((n) => !(n in overrides));
    const fields = OVERRIDE_FIELDS[kind];
    return (
      <>
        <SettingRow
          id={`alerting.${kind}`}
          label={`${title} (${Object.keys(overrides).length})`}
          description={kind === "host_overrides" ? "Different thresholds for one host." : "A different offline duration for one service."}
        />
        {Object.entries(overrides).map(([name, o]) => (
          <ItemCard
            key={name}
            id={`${prefix}${name}`}
            open={expanded.isOpen(name)}
            onToggle={() => expanded.toggle(name)}
            title={name}
            subtitle={
              fields
                .filter((f) => f.field in o)
                .map((f) => `${f.label.replace(/ (usage )?threshold$/, "")} ${formatThreshold(units.show(f.field, o[f.field]), units.suffix(f.field, f.suffix))}`)
                .join(" · ") || "Everything follows the defaults"
            }
          >
            {fields.map((f) => (
              <OverrideRow
                key={f.field}
                label={f.label}
                suffix={units.suffix(f.field, f.suffix)}
                override={Object.fromEntries(Object.entries(o).map(([k, v]) => [k, units.show(k, v) ?? null]))}
                field={f.field}
                globalValue={units.show(f.field, defaults[f.field])}
                disabled={disabled}
                onChange={(value) => setOverrideField(kind, name, f.field, units.store(f.field, value))}
              />
            ))}
            <div className="settings-item__actions">
              <button
                className="btn btn--danger-ghost"
                disabled={disabled}
                onClick={() => saveOverrides(kind, (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== name)))}
              >
                Remove override
              </button>
            </div>
          </ItemCard>
        ))}
        {available.length > 0 && (
          <SettingRow label="Add an override for">
            <span style={{ display: "inline-flex", gap: 8 }}>
              <SelectField
                label={`Add ${title.toLowerCase()} for`}
                value={newOverride[kind]}
                disabled={disabled}
                onChange={(v) => setNewOverride((s) => ({ ...s, [kind]: v }))}
              >
                <option value="">Choose…</option>
                {available.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </SelectField>
              <button
                className="btn btn--ghost"
                disabled={disabled || !newOverride[kind]}
                onClick={async () => {
                  const name = newOverride[kind];
                  if (await saveOverrides(kind, (m) => ({ ...m, [name]: {} }))) {
                    expanded.toggle(name);
                    setNewOverride((s) => ({ ...s, [kind]: "" }));
                  }
                }}
              >
                Add
              </button>
            </span>
          </SettingRow>
        )}
      </>
    );
  };

  return (
    <>
      <SettingRow id="alerting.enabled" label="Alerting enabled" description="When off, nothing is evaluated -- no new alerts and no notifications.">
        <Toggle label="Alerting enabled" checked={enabled} disabled={disabled} onChange={(on) => onSave({ alerting: { enabled: on } })} />
      </SettingRow>

      <SectionHeader
        title="THRESHOLDS"
        description="Applies to every host/service unless overridden in config.yml. Leave a field blank to turn that check off."
      />
      {THRESHOLDS.map(({ field, label, suffix }) => (
        <SettingRow key={field} id={`alerting.${field}`} label={label}>
          <NumberField
            label={label}
            value={units.show(field, defaults[field])}
            suffix={units.suffix(field, suffix)}
            nullable
            min={field === "temp_c" ? undefined : 0}
            disabled={disabled}
            onCommit={(value) => onSave({ alerting: { defaults: { [field]: units.store(field, value) } } })}
          />
        </SettingRow>
      ))}

      <SectionHeader
        title="OVERRIDES"
        description="Anything left on Default keeps following the thresholds above, including when you change them later."
      />
      {overrideSection("host_overrides", "Host overrides", (config?.hosts ?? []).map((h: any) => h.name))}
      {overrideSection("service_overrides", "Service overrides", (config?.services ?? []).map((s: any) => s.name))}

      <SectionHeader
        title="NOTIFICATIONS"
        description="Webhook URLs and API tokens stay in environment variables on the server running the dashboard -- config.yml only holds their names. Set the variable there, then use Send Test."
      />
      <SettingRow id="alerting.notifiers" label={`Notifiers (${notifiers.length})`} description={notifiers.length === 0 ? "No notifiers configured." : undefined} />
      {notifiers.map((n) => (
        <SettingBlock key={n.id} id={`notifier.${n.id}`} className="card settings-item">
          <div className="settings-item__header">
            <TextField label="Notifier name" value={n.name} width="100%" disabled={disabled} onCommit={(name) => (name.trim() ? updateNotifier(n.id, { name }) : false)} />
            <span className="settings-note" style={{ margin: 0, textTransform: "uppercase" }}>{n.type}</span>
            <Toggle label={`${n.name} enabled`} checked={n.enabled} disabled={disabled} onChange={(on) => updateNotifier(n.id, { enabled: on })} />
          </div>

          {(n.type === "discord" || n.type === "webhook") && (
            <SettingRow
              label="URL env var"
              description={
                n.type === "discord"
                  ? "Name of the environment variable holding the webhook URL (Discord: Server Settings → Integrations → Webhooks → Copy Webhook URL)."
                  : "Name of the environment variable holding the URL -- never the URL itself."
              }
            >
              <TextField label="URL env var" mono value={n.url_env} placeholder="DISCORD_WEBHOOK_URL" disabled={disabled} onCommit={(url_env) => updateNotifier(n.id, { url_env: url_env || null })} />
            </SettingRow>
          )}
          {n.type === "ntfy" && (
            <>
              <SettingRow label="Server">
                <TextField label="ntfy server" value={n.ntfy_server ?? "https://ntfy.sh"} disabled={disabled} onCommit={(ntfy_server) => updateNotifier(n.id, { ntfy_server: ntfy_server || "https://ntfy.sh" })} />
              </SettingRow>
              <SettingRow label="Topic">
                <TextField label="ntfy topic" value={n.ntfy_topic} disabled={disabled} onCommit={(ntfy_topic) => updateNotifier(n.id, { ntfy_topic: ntfy_topic || null })} />
              </SettingRow>
            </>
          )}
          {n.type === "pushover" && (
            <>
              <SettingRow label="User key env var">
                <TextField
                  label="User key env var"
                  mono
                  value={n.pushover_user_key_env}
                  placeholder="PUSHOVER_USER_KEY"
                  disabled={disabled}
                  onCommit={(v) => updateNotifier(n.id, { pushover_user_key_env: v || null })}
                />
              </SettingRow>
              <SettingRow label="API token env var">
                <TextField
                  label="API token env var"
                  mono
                  value={n.pushover_api_token_env}
                  placeholder="PUSHOVER_API_TOKEN"
                  disabled={disabled}
                  onCommit={(v) => updateNotifier(n.id, { pushover_api_token_env: v || null })}
                />
              </SettingRow>
            </>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn--ghost" onClick={() => testNotifierNow(n.id)} disabled={disabled || testingId === n.id}>
              {testingId === n.id ? "Sending…" : "Send Test"}
            </button>
            <button className="btn btn--ghost" onClick={() => removeNotifier(n.id)} disabled={disabled}>
              Remove
            </button>
            {testResults[n.id] && (
              <span style={{ fontSize: "var(--text-xs)", color: testResults[n.id].startsWith("✓") ? "var(--color-success)" : "var(--color-danger)" }}>
                {testResults[n.id]}
              </span>
            )}
          </div>
        </SettingBlock>
      ))}

      <Note>Add a notifier:</Note>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {NOTIFIER_TYPES.map((type) => (
          <button key={type} className="btn btn--ghost" style={{ textTransform: "capitalize" }} disabled={disabled} onClick={() => addNotifier(type)}>
            + {type}
          </button>
        ))}
      </div>
    </>
  );
}
