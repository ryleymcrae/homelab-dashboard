import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ServiceIcon } from "../../components/ServiceIcon";
import { IconField, ItemCard, SectionHeader, SettingBlock, SettingRow, TextField, useExpanded, type SectionProps } from "./controls";

const DEFAULT_INTERNET_TARGET = "1.1.1.1";

export function NetworkSettings({ config, onSave, disabled }: SectionProps) {
  const network = config?.network ?? {};
  const devices: any[] = network.devices ?? [];
  const expanded = useExpanded("netdevice.");
  const [draft, setDraft] = useState<{ name: string; address: string } | null>(null);

  // network.devices is a list inside a dict -- PATCH replaces the list.
  const saveDevices = (change: (current: any[]) => any[]) =>
    onSave((latest) => ({ network: { devices: change(latest.network?.devices ?? []) } }));
  const update = (name: string, patch: Record<string, unknown>) =>
    saveDevices((ds) => ds.map((d) => (d.name === name ? { ...d, ...patch } : d)));

  const addDraft = async () => {
    if (!draft?.name.trim() || !draft.address.trim()) return;
    const device = { name: draft.name.trim(), address: draft.address.trim() };
    if (await saveDevices((ds) => [...ds, device])) setDraft(null);
  };

  return (
    <>
      <SectionHeader title="HEALTH CHECKS" />
      <SettingRow
        id="network.internet_target"
        label="Internet check target"
        description="The host pinged to decide whether the Internet is up. Clearing it restores the default."
      >
        <TextField
          label="Internet check target"
          mono
          width={180}
          value={network.internet_target}
          placeholder={DEFAULT_INTERNET_TARGET}
          disabled={disabled}
          onCommit={(target) => onSave({ network: { internet_target: target.trim() || DEFAULT_INTERNET_TARGET } })}
        />
      </SettingRow>
      <SettingRow id="network.gateway_override" label="Gateway address" description="Leave blank to use the default gateway this machine detects.">
        <TextField
          label="Gateway address"
          mono
          width={180}
          value={network.gateway_override}
          placeholder="auto-detect"
          disabled={disabled}
          onCommit={(v) => onSave({ network: { gateway_override: v.trim() || null } })}
        />
      </SettingRow>

      <SectionHeader title="NETWORK-ONLY DEVICES" />
      <SettingRow
        id="network.devices"
        label={`Devices (${devices.length})`}
        description="Switches, access points, sensors -- things that get a reachability check on the Network page but aren't full hosts. Hosts with an address appear there automatically."
      >
        <Link to="/network" className="btn btn--ghost" style={{ textDecoration: "none" }}>
          Network page ›
        </Link>
      </SettingRow>
      {devices.map((d) => (
        <ItemCard
          key={d.name}
          id={`netdevice.${d.name}`}
          open={expanded.isOpen(d.name)}
          onToggle={() => expanded.toggle(d.name)}
          icon={<ServiceIcon icon={d.icon} size={32} />}
          title={d.name}
          subtitle={d.address}
        >
          <SettingRow label="Name">
            <TextField
              label={`Name of ${d.name}`}
              value={d.name}
              disabled={disabled}
              onCommit={(to) => {
                to = to.trim();
                if (!to) return false;
                expanded.rename(d.name, to);
                return update(d.name, { name: to });
              }}
            />
          </SettingRow>
          <SettingRow label="Address">
            <TextField label="Address" mono value={d.address} disabled={disabled} onCommit={(v) => (v.trim() ? update(d.name, { address: v.trim() }) : false)} />
          </SettingRow>
          <SettingRow label="Icon">
            <IconField label="Icon" value={d.icon} disabled={disabled} onCommit={(v) => update(d.name, { icon: v.trim() || null })} />
          </SettingRow>
          <div className="settings-item__actions">
            <button className="btn btn--danger-ghost" disabled={disabled} onClick={() => saveDevices((ds) => ds.filter((x) => x.name !== d.name))}>
              Remove device
            </button>
          </div>
        </ItemCard>
      ))}
      {draft ? (
        <div className="card settings-item settings-item--draft">
          <div className="settings-item__title">New network device</div>
          <SettingRow label="Name *">
            <input className="field" aria-label="New device name" value={draft.name} placeholder="Core switch" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </SettingRow>
          <SettingRow label="Address *">
            <input className="field" aria-label="New device address" value={draft.address} placeholder="192.168.1.2" onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          </SettingRow>
          <div className="settings-item__actions">
            <button className="btn btn--primary" disabled={disabled || !draft.name.trim() || !draft.address.trim()} onClick={addDraft}>
              Add device
            </button>
            <button className="btn btn--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <SettingBlock id="network.add_device" className="settings-item__actions">
          <button className="btn btn--ghost" disabled={disabled} onClick={() => setDraft({ name: "", address: "" })}>
            + Add device
          </button>
        </SettingBlock>
      )}
    </>
  );
}
