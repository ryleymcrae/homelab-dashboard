import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";

interface AuthContextValue {
  loading: boolean;
  required: boolean;
  authenticated: boolean;
  guestMode: boolean;
  isAdmin: boolean;
  /** Whether this client can currently perform mutating actions --
   * always true unless guest mode is active and this client hasn't
   * logged in as admin. The backend enforces the real boundary (see
   * docs/security.md); this just tells the UI whether to bother showing
   * action controls at all. */
  canAct: boolean;
  error: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Mounted above everything else (including SnapshotProvider), so the app
 * never opens the WebSocket or fetches a snapshot before we know whether
 * a login is required -- see docs/security.md. Most installs never set
 * DASHBOARD_PASSWORD at all, in which case `required`/`guestMode` are
 * always false and this is invisible.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api
      .getAuthStatus()
      .then((status) => {
        setRequired(status.required);
        setAuthenticated(status.authenticated);
        setGuestMode(status.guestMode);
        setIsAdmin(status.isAdmin);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const login = async (password: string) => {
    setError(null);
    try {
      await api.login(password);
      refresh(); // re-checks isAdmin too, not just authenticated
      return true;
    } catch {
      setError("Incorrect password");
      return false;
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setAuthenticated(false);
    setIsAdmin(false);
  };

  const canAct = !guestMode || isAdmin;

  return (
    <AuthContext.Provider value={{ loading, required, authenticated, guestMode, isAdmin, canAct, error, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
