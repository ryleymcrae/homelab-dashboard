import React, { useEffect, useState } from "react";
import { formatClock, formatDateShort } from "../api/format";
import type { Status } from "../api/types";
import { StatusPill } from "./StatusPill";
import { useAuth } from "../hooks/AuthContext";
import { AdminLoginDialog } from "./AdminLoginDialog";

interface HeaderProps {
  title: string;
  subtitle: string;
  overallStatus: Status;
}

export function Header({ title, subtitle, overallStatus }: HeaderProps) {
  const [now, setNow] = useState(new Date());
  const { required, guestMode, isAdmin, logout } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--color-bg-elevated)",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            background: "var(--color-primary-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-primary)",
            fontWeight: 700,
          }}
        >
          ▲
        </div>
        <div>
          <div style={{ fontSize: "var(--text-base)", fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{subtitle}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{formatDateShort(now)}</div>
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{formatClock(now)}</div>
        </div>
        <StatusPill status={overallStatus} />
        {guestMode && !isAdmin && (
          <button
            className="btn btn--ghost"
            onClick={() => setShowLogin(true)}
            style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}
            title="Log in to make changes"
          >
            Log In
          </button>
        )}
        {(required || isAdmin) && (
          <button
            className="btn btn--ghost"
            onClick={() => logout().then(() => window.location.reload())}
            style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}
            title="Log out"
          >
            Log Out
          </button>
        )}
      </div>
      {showLogin && <AdminLoginDialog onClose={() => setShowLogin(false)} />}
    </header>
  );
}
