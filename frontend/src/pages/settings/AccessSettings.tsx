import React, { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SettingRow, Toggle, type SectionProps } from "./controls";

/**
 * Guest mode is enforced in the backend (docs/security.md); this page
 * only adds a confirmation in front of turning it on, because with no
 * DASHBOARD_PASSWORD set that's a lock the UI can't undo -- every
 * setting, including this toggle, starts returning 403 until someone
 * edits config.yml by hand.
 */
export function AccessSettings({
  config, onSave, disabled, passwordSet, isAdmin, onAuthChanged,
}: SectionProps & { passwordSet: boolean; isAdmin: boolean; onAuthChanged: () => void }) {
  const guestMode = !!config?.guest_mode;
  const trustedIps: string[] = config?.auth?.trusted_ips ?? [];
  const [confirming, setConfirming] = useState(false);
  const [newIp, setNewIp] = useState("");
  // Mirrors the backend rule (backend/api/main.py:patch_config): with a
  // password set, only a real login can change who skips it.
  const ipsLocked = disabled || (passwordSet && !isAdmin);

  const saveIps = (change: (current: string[]) => string[]) =>
    onSave((latest) => ({ auth: { trusted_ips: change(latest.auth?.trusted_ips ?? []) } }));
  const addIp = async () => {
    const entry = newIp.trim();
    if (!entry) return;
    if (await saveIps((ips) => (ips.includes(entry) ? ips : [...ips, entry]))) setNewIp("");
  };

  const setGuestMode = async (on: boolean) => {
    setConfirming(false);
    // /api/auth/status reports guestMode too -- refresh it so every other
    // control in the app picks up the new canAct right away.
    if (await onSave({ guest_mode: on })) onAuthChanged();
  };

  return (
    <>
      <SettingRow
        id="guest_mode"
        label="Guest mode"
        description="Anyone can view; every action and setting needs a password login. Meant for a kiosk or wall tablet."
      >
        <Toggle label="Guest mode" checked={guestMode} disabled={disabled} onChange={(on) => (on ? setConfirming(true) : setGuestMode(false))} />
      </SettingRow>
      <SettingRow
        id="auth.password"
        label="Dashboard password"
        description="Set with the DASHBOARD_PASSWORD environment variable on the server -- deliberately never stored in config.yml or editable from here."
      >
        <span style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: passwordSet ? "var(--color-success)" : "var(--color-text-muted)" }}>
          {passwordSet ? "Set" : "Not set"}
        </span>
      </SettingRow>
      <SettingRow
        id="auth.trusted_ips"
        label="Trusted IPs"
        description={
          (passwordSet
            ? "Addresses or ranges (e.g. a kiosk's IP) that skip the login screen -- they still can't act under guest mode."
            : "Addresses or ranges that will skip the login screen once a password is set. No effect until then.") +
          (passwordSet && !isAdmin ? " Log in with the password to change this list." : "")
        }
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {trustedIps.length === 0 && <span className="settings-note" style={{ margin: 0 }}>None</span>}
          {trustedIps.map((ip) => (
            <span key={ip} className="chip" style={{ fontFamily: "var(--font-mono)", paddingRight: 0 }}>
              {ip}
              <button
                className="chip__remove"
                aria-label={`Remove ${ip}`}
                disabled={ipsLocked}
                onClick={() => saveIps((ips) => ips.filter((x) => x !== ip))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Add a trusted IP" description="A single address (192.168.1.50) or a range (192.168.1.0/24). Keep ranges as narrow as you can.">
        <span style={{ display: "inline-flex", gap: 8 }}>
          <input
            className="field"
            aria-label="New trusted IP"
            style={{ width: 170, fontFamily: "var(--font-mono)" }}
            value={newIp}
            placeholder="192.168.1.50"
            disabled={ipsLocked}
            onChange={(e) => setNewIp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addIp()}
          />
          <button className="btn btn--ghost" disabled={ipsLocked || !newIp.trim()} onClick={addIp}>
            Add
          </button>
        </span>
      </SettingRow>

      {confirming && (
        <ConfirmDialog
          targetName="guest mode"
          action={{
            kind: "enable_guest_mode",
            label: "Turn On",
            destructive: !passwordSet,
            confirmTitle: "Turn on guest mode?",
            confirmBody: passwordSet
              ? isAdmin
                ? "Viewers who aren't logged in will no longer be able to run actions or change settings."
                : "You're not logged in, so after this you'll need to log in (top right) to change anything -- including turning this back off."
              : "No DASHBOARD_PASSWORD is set, so there's no way to log in. This will block every action and every setting -- including this toggle -- until someone edits config.yml by hand to set guest_mode: false.",
          }}
          onCancel={() => setConfirming(false)}
          onConfirm={() => setGuestMode(true)}
        />
      )}
    </>
  );
}
