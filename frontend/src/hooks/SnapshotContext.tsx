import React, { createContext, useContext } from "react";
import { useLiveSnapshot } from "./useLiveSnapshot";
import type { Snapshot } from "../api/types";

interface SnapshotContextValue {
  snapshot: Snapshot | null;
  connected: boolean;
  error: string | null;
}

const SnapshotContext = createContext<SnapshotContextValue | null>(null);

/**
 * Owns the single WebSocket connection (+ REST fallback) for the whole
 * app. Mounted once, above the router, so switching tabs re-renders
 * pages against data that's already there instead of tearing down the
 * connection and starting over from a blank "Loading…" state.
 */
export function SnapshotProvider({ children }: { children: React.ReactNode }) {
  const value = useLiveSnapshot();
  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot(): SnapshotContextValue {
  const ctx = useContext(SnapshotContext);
  if (!ctx) {
    throw new Error("useSnapshot must be used within a SnapshotProvider");
  }
  return ctx;
}
