import React from "react";
import { Link } from "react-router-dom";
import { DEFAULT_LOGO_GLYPH, applyFavicon } from "../../api/favicon";
import { AssetGallery } from "../../components/IconPicker";
import { NAV_TABS } from "../../components/BottomNav";
import type { NavTab } from "../../api/types";
import { IconField, SectionHeader, SettingBlock, SettingRow, type SectionProps } from "./controls";

/**
 * The dashboard's own identity: logo, tab icon, nav icons, and the
 * uploaded-image library everything else picks from. A host's or
 * service's icon is edited with that host/service (Devices/Services),
 * next to everything else about it -- linked from here, not duplicated.
 */
export function BrandingSettings({ config, onSave, disabled }: SectionProps) {
  const dashboard = config?.dashboard ?? {};
  const navIcons: Partial<Record<NavTab, string>> = dashboard.nav_icons ?? {};

  // Sent whole (the backend replaces nav_icons rather than merging), so
  // clearing one tab removes its key and it falls back to the built-in.
  const setNavIcon = (tab: NavTab, value: string) =>
    onSave((latest) => {
      const next = { ...(latest.dashboard?.nav_icons ?? {}) };
      if (value.trim()) next[tab] = value.trim();
      else delete next[tab];
      return { dashboard: { nav_icons: next } };
    });

  return (
    <>
      <SectionHeader title="TOP BAR & BROWSER TAB" />
      <SettingRow id="dashboard.logo" label="Logo" description="Left of the dashboard title in the top bar.">
        <IconField label="Logo" value={dashboard.logo} fallback={DEFAULT_LOGO_GLYPH} disabled={disabled} onCommit={(v) => onSave({ dashboard: { logo: v || null } })} />
      </SettingRow>
      <SettingRow id="dashboard.favicon" label="Favicon" description="The icon in the browser tab and bookmarks. A built-in glyph is drawn in your accent color.">
        <IconField
          label="Favicon"
          value={dashboard.favicon}
          fallback={DEFAULT_LOGO_GLYPH}
          disabled={disabled}
          onCommit={async (v) => {
            if (await onSave({ dashboard: { favicon: v || null } })) applyFavicon(v || null);
          }}
        />
      </SettingRow>

      <SectionHeader title="NAVIGATION" />
      <SettingBlock id="dashboard.nav_icons">
        {NAV_TABS.map((tab) => (
          <SettingRow key={tab.key} label={`${tab.label} tab`}>
            <IconField label={`${tab.label} tab icon`} value={navIcons[tab.key]} fallback={tab.glyph} disabled={disabled} onCommit={(v) => setNavIcon(tab.key, v)} />
          </SettingRow>
        ))}
      </SettingBlock>

      <SectionHeader title="UPLOADED IMAGES" />
      <SettingBlock id="branding.images">
        <div className="settings-note">
          Images uploaded here (or from any icon picker) can be used for any icon or banner. PNG, JPEG, GIF, WebP, or
          ICO, up to 2 MB. An image can't be deleted while something still uses it. Host and service icons are set on
          each one under{" "}
          <Link to="/settings?c=devices">Devices</Link> and <Link to="/settings?c=services">Services</Link>.
        </div>
        <AssetGallery manage disabled={disabled} refreshKey={config} />
      </SettingBlock>
    </>
  );
}
