import React from "react";
import { NavLink } from "react-router-dom";
import { useSnapshot } from "../hooks/SnapshotContext";

const TABS = [
  { to: "/", label: "Home", icon: "⌂" },
  { to: "/services", label: "Services", icon: "▤" },
  { to: "/network", label: "Network", icon: "◈" },
  { to: "/system", label: "System", icon: "▣" },
  { to: "/alerts", label: "Alerts", icon: "⚠" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function BottomNav() {
  const { snapshot } = useSnapshot();
  const alertsActive = snapshot?.alertsActive ?? 0;

  return (
    <nav
      style={{
        display: "flex",
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          style={({ isActive }) => ({
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            padding: "8px 0",
            minHeight: "var(--touch-target)",
            color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
            textDecoration: "none",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            position: "relative",
          })}
        >
          <span style={{ position: "relative", fontSize: 16, lineHeight: 1 }}>
            {tab.icon}
            {tab.to === "/alerts" && alertsActive > 0 && (
              <span
                aria-label={`${alertsActive} active alerts`}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -8,
                  minWidth: 14,
                  height: 14,
                  padding: "0 3px",
                  borderRadius: 7,
                  background: "var(--color-danger)",
                  color: "white",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                {alertsActive > 9 ? "9+" : alertsActive}
              </span>
            )}
          </span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
