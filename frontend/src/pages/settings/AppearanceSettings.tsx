import React, { useState } from "react";
import { applyAccentColor } from "../../api/color";
import { DEFAULT_COLOR, DEFAULT_STYLE, METRIC_KEYS, METRIC_LABEL, STYLE_LABEL, TILE_STYLES, type MetricDisplayPrefs, type MetricKey } from "../../api/metrics";
import { HostMetricTiles, needsHistory } from "../../components/HostMetricTile";
import { useHostHistory } from "../../hooks/useHostHistory";
import type { HostInfo } from "../../api/types";
import { ColorField, SectionHeader, Segmented, SettingRow, Toggle, type SectionProps } from "./controls";

const DEFAULT_ACCENT = "#3b82f6";

const METRIC_HELP: Record<MetricKey, string> = {
  cpu: "Number, number + 6-hour sparkline, or a radial gauge.",
  mem: "Number, number + 6-hour sparkline, or a radial gauge.",
  disk: "Number, a radial gauge, or a fill bar.",
  temp: "Always a number -- the color tints it.",
};

/** <input type="color"> needs a literal hex; an unset metric color is a
 * theme token (DEFAULT_COLOR), so read what it currently resolves to. */
function tokenToHex(value: string): string {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  const resolved = name ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : value;
  return /^#[0-9a-fA-F]{6}$/.test(resolved) ? resolved : DEFAULT_ACCENT;
}

function MetricPreview({ host, display }: { host: HostInfo; display: MetricDisplayPrefs }) {
  const history = useHostHistory(host.id, needsHistory(display));
  return (
    <div className="card" style={{ marginTop: "var(--space-3)", padding: "var(--space-2)" }}>
      <div className="settings-note" style={{ margin: "0 0 4px 8px" }}>Preview · {host.name}</div>
      <HostMetricTiles host={host} history={history} display={display} />
    </div>
  );
}

export function AppearanceSettings({ config, onSave, disabled, hosts }: SectionProps & { hosts: HostInfo[] }) {
  const dashboard = config?.dashboard ?? {};
  const saved: MetricDisplayPrefs = dashboard.metric_display ?? {};
  // Colors while a picker is still being dragged -- the preview follows
  // along, but nothing is saved until the picker closes.
  const [draftColors, setDraftColors] = useState<Partial<Record<MetricKey, string>>>({});
  const previewDisplay: MetricDisplayPrefs = Object.fromEntries(
    METRIC_KEYS.map((m) => [m, { ...saved[m], color: draftColors[m] ?? saved[m]?.color }])
  );
  const saveMetric = (metric: MetricKey, patch: { style?: string; color?: string | null }) =>
    onSave({ dashboard: { metric_display: { [metric]: patch } } });

  return (
    <>
      <SectionHeader title="LOOK & FEEL" />
      <SettingRow id="dashboard.theme" label="Theme">
        <Segmented
          label="Theme"
          value={dashboard.theme ?? "dark"}
          disabled={disabled}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          onChange={(theme) => {
            onSave({ dashboard: { theme } });
            document.documentElement.setAttribute("data-theme", theme);
          }}
        />
      </SettingRow>
      <SettingRow id="dashboard.accent_color" label="Accent color" description="Buttons, highlights, and the active tab.">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ColorField
            label="Accent color"
            value={dashboard.accent_color ?? DEFAULT_ACCENT}
            disabled={disabled}
            onPreview={applyAccentColor}
            onCommit={(accent_color) => onSave({ dashboard: { accent_color } })}
          />
          {dashboard.accent_color && (
            <button
              className="btn btn--ghost"
              disabled={disabled}
              onClick={() => {
                onSave({ dashboard: { accent_color: null } });
                applyAccentColor(null);
              }}
            >
              Reset
            </button>
          )}
        </div>
      </SettingRow>
      <SettingRow id="dashboard.density" label="Density" description="Comfortable adds spacing and larger text for touch screens.">
        <Segmented
          label="Density"
          value={dashboard.density ?? "compact"}
          disabled={disabled}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
          ]}
          onChange={(density) => {
            onSave({ dashboard: { density } });
            document.documentElement.setAttribute("data-density", density);
          }}
        />
      </SettingRow>

      <SettingRow id="dashboard.chart_grid" label="Chart grid" description="Background grid lines on the CPU/Memory and network history charts. Each chart also has its own Grid button for this.">
        <Toggle label="Chart grid" checked={dashboard.chart_grid ?? true} disabled={disabled} onChange={(chart_grid) => onSave({ dashboard: { chart_grid } })} />
      </SettingRow>

      <SectionHeader
        title="METRIC DISPLAY"
        description="How each metric is drawn on the host cards (Home and Devices), and on Home metric widgets that don't pick their own style."
      />
      {METRIC_KEYS.map((m) => {
        const color = saved[m]?.color ?? null;
        return (
          <SettingRow key={m} id={`metric_display.${m}`} label={METRIC_LABEL[m]} description={METRIC_HELP[m]}>
            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              {TILE_STYLES[m].length > 1 && (
                <Segmented
                  label={`${METRIC_LABEL[m]} style`}
                  value={saved[m]?.style ?? DEFAULT_STYLE[m]}
                  disabled={disabled}
                  options={TILE_STYLES[m].map((s) => ({ value: s, label: STYLE_LABEL[s] }))}
                  onChange={(style) => saveMetric(m, { style })}
                />
              )}
              <ColorField
                label={`${METRIC_LABEL[m]} color`}
                value={color ?? tokenToHex(DEFAULT_COLOR[m])}
                disabled={disabled}
                onPreview={(hex) => setDraftColors((d) => ({ ...d, [m]: hex }))}
                onCommit={async (hex) => {
                  await saveMetric(m, { color: hex });
                  setDraftColors(({ [m]: _, ...rest }) => rest);
                }}
              />
              {color && (
                <button className="btn btn--ghost" disabled={disabled} onClick={() => saveMetric(m, { color: null })}>
                  Reset
                </button>
              )}
            </span>
          </SettingRow>
        );
      })}
      {hosts[0] && <MetricPreview host={hosts[0]} display={previewDisplay} />}
    </>
  );
}
