import React from "react";
import { LoginForm } from "../components/LoginForm";

/**
 * Shown in place of the whole app shell whenever the backend requires a
 * password and this browser hasn't provided one yet (see
 * hooks/AuthContext.tsx). A kiosk whose IP is in auth.trusted_ips never
 * sees this at all -- the backend reports `authenticated: true` for it
 * from the very first status check.
 */
export function LoginPage() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
      }}
    >
      <div className="card" style={{ width: 280, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Homelab Dashboard</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Enter the dashboard password to continue</div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
