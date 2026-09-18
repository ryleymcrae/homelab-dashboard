import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../api/types";
import { api } from "../api/client";

/**
 * Subscribes to /ws for live snapshot updates, falling back to a single
 * REST fetch (and periodic REST polling) if the socket cannot connect --
 * e.g. behind a proxy that blocks WebSocket upgrades. Never leaves the UI
 * blank: shows the last-known-good snapshot while reconnecting instead of
 * flickering to a loading state (spec section 23: avoid flicker).
 */
export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPollingFallback = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const data = await api.getSnapshot();
          if (!cancelled) {
            setSnapshot(data);
            setError(null);
          }
        } catch (err) {
          if (!cancelled) setError((err as Error).message);
        }
      }, 5000);
    };

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        setError(null);
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Snapshot;
          if (!cancelled) setSnapshot(data);
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        startPollingFallback();
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    // Prime with an immediate REST fetch so the first paint isn't empty.
    api
      .getSnapshot()
      .then((data) => !cancelled && setSnapshot(data))
      .catch((err) => !cancelled && setError((err as Error).message));

    connect();

    return () => {
      cancelled = true;
      ws?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  return { snapshot, connected, error };
}
