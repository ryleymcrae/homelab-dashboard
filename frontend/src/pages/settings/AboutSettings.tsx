import React from "react";
import { NumberField, SectionHeader, SettingRow, type SectionProps } from "./controls";

export function AboutSettings({ config, onSave, disabled }: SectionProps) {
  const history = config?.history ?? {};
  const saveHistory = (field: string, min: number) => (n: number | null) =>
    n == null || n < min ? false : onSave({ history: { [field]: Math.round(n) } });
  return (
    <>
      <SettingRow id="about.version" label="Application version">
        <span>0.1.0</span>
      </SettingRow>
      <SettingRow id="about.license" label="License">
        <span>MIT</span>
      </SettingRow>
      <SettingRow id="about.source" label="Source code">
        <a className="btn btn--ghost" style={{ textDecoration: "none" }} href="https://github.com/" target="_blank" rel="noreferrer">
          GitHub ›
        </a>
      </SettingRow>

      <SectionHeader title="STORED HISTORY" description="Metric history behind the CPU/memory and network charts." />
      <SettingRow id="history.retention_days" label="History retention" description="Older samples are deleted.">
        <NumberField label="History retention" value={history.retention_days} suffix="days" min={1} disabled={disabled} onCommit={saveHistory("retention_days", 1)} />
      </SettingRow>
      <SettingRow id="history.sample_interval_seconds" label="History sample interval" description="How often a point is stored. Live views still update every couple of seconds.">
        <NumberField label="History sample interval" value={history.sample_interval_seconds} suffix="s" min={2} disabled={disabled} onCommit={saveHistory("sample_interval_seconds", 2)} />
      </SettingRow>
      <SettingRow
        id="history.max_rows_per_series"
        label="History size limit"
        description="Most samples kept per metric, whatever their age. At the interval above, make sure this covers the retention period."
      >
        <NumberField label="History size limit" value={history.max_rows_per_series} min={100} disabled={disabled} onCommit={saveHistory("max_rows_per_series", 100)} />
      </SettingRow>
    </>
  );
}
