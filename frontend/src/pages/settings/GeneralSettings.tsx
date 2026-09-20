import React, { useEffect, useState } from "react";
import { browserTimeZone, formatClock, formatDateShort } from "../../api/format";
import { SectionHeader, Segmented, SelectField, SettingRow, TextField, type SectionProps } from "./controls";

const DEFAULT_TITLE = "My Homelab";

// Intl.supportedValuesOf is ES2022; every browser this targets has it,
// but degrade to a free-text field rather than an empty list if not.
const ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];

export function GeneralSettings({ config, onSave, disabled }: SectionProps) {
  const dashboard = config?.dashboard ?? {};
  const zone: string | null = dashboard.timezone ?? null;
  const automatic = browserTimeZone();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const saveZone = (value: string) => onSave({ dashboard: { timezone: value.trim() || null } });

  return (
    <>
      <SectionHeader title="TOP BAR" />
      <SettingRow id="dashboard.title" label="Dashboard title" description="Shown in the top bar on every page. Clearing it restores the default.">
        <TextField
          label="Dashboard title"
          value={dashboard.title}
          placeholder={DEFAULT_TITLE}
          disabled={disabled}
          onCommit={(title) => onSave({ dashboard: { title: title.trim() || DEFAULT_TITLE } })}
        />
      </SettingRow>
      <SettingRow id="dashboard.tagline" label="Tagline" description="Shown under the title. Leave blank to show the current page's name there instead.">
        <TextField
          label="Tagline"
          value={dashboard.tagline}
          placeholder="Current page name"
          disabled={disabled}
          onCommit={(tagline) => onSave({ dashboard: { tagline: tagline.trim() || null } })}
        />
      </SettingRow>

      <SectionHeader title="TIME & UNITS" />
      <SettingRow
        id="dashboard.timezone"
        label="Time zone"
        description={
          <>
            Every clock and timestamp on the dashboard. Automatic uses each viewing device's own zone (this one is{" "}
            {automatic}).
            <br />
            Now: {formatDateShort(now, zone ?? automatic)}, {formatClock(now, zone ?? automatic)}
          </>
        }
      >
        {ZONES.length > 0 ? (
          <SelectField label="Time zone" value={zone ?? ""} disabled={disabled} onChange={saveZone}>
            <option value="">Automatic ({automatic})</option>
            {zone && !ZONES.includes(zone) && <option value={zone}>{zone}</option>}
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField label="Time zone" mono value={zone} placeholder="Automatic" disabled={disabled} onCommit={saveZone} />
        )}
      </SettingRow>
      <SettingRow
        id="dashboard.temperature_unit"
        label="Temperature unit"
        description="Everywhere a temperature is shown, including alert thresholds."
      >
        <Segmented
          label="Temperature unit"
          value={dashboard.temperature_unit ?? "celsius"}
          disabled={disabled}
          options={[
            { value: "celsius", label: "°C" },
            { value: "fahrenheit", label: "°F" },
          ]}
          onChange={(temperature_unit) => onSave({ dashboard: { temperature_unit } })}
        />
      </SettingRow>
    </>
  );
}
