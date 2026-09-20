import React, { useEffect, useRef, useState } from "react";
import type { HostAction } from "../api/types";

function HamburgerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.2" width="12" height="1.6" rx="0.8" fill="currentColor" />
      <rect x="2" y="7.2" width="12" height="1.6" rx="0.8" fill="currentColor" />
      <rect x="2" y="11.2" width="12" height="1.6" rx="0.8" fill="currentColor" />
    </svg>
  );
}

/**
 * A hamburger menu for a host's admin actions (reboot, Docker prune,
 * restart Docker, clear package cache, run backup -- the fixed
 * HostActionKind whitelist, backend/models/core.py). Used wherever a
 * host's controls are shown (Home's HostCard, Devices page's per-host
 * panel) instead of a row of buttons, so a card's header stays compact
 * regardless of how many actions a given host advertises.
 */
export function HostActionsMenu({ actions, onSelect }: { actions: HostAction[]; onSelect: (action: HostAction) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="icon-btn" aria-label="Host actions" onClick={() => setOpen((v) => !v)}>
        <HamburgerIcon />
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            zIndex: 10,
            minWidth: 180,
            padding: 0,
            overflow: "hidden",
          }}
        >
          {actions.map((action) => (
            <button
              key={action.kind}
              className="menu-item"
              style={{ color: action.destructive ? "var(--color-danger)" : "var(--color-text)" }}
              onClick={() => {
                setOpen(false);
                onSelect(action);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
