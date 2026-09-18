import React, { useState } from "react";
import { useAuth } from "../hooks/AuthContext";

/**
 * The password form itself, shared by the full-page gate (LoginPage,
 * shown when viewing requires login) and AdminLoginDialog (a modal,
 * shown when viewing is open but guest mode requires login to act).
 */
export function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const { login, error } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    const ok = await login(password);
    setBusy(false);
    if (ok) onSuccess?.();
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <input
        type="password"
        autoFocus
        value={password}
        disabled={busy}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        style={{
          padding: "10px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface-2)",
          color: "var(--color-text)",
          fontSize: "var(--text-base)",
        }}
      />
      {error && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-danger)" }}>{error}</div>}
      <button type="submit" className="btn btn--primary" disabled={busy || !password}>
        {busy ? "Checking…" : "Log In"}
      </button>
    </form>
  );
}
