import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { LogLine } from "../api/types";
import { Modal } from "./Modal";

const MAX_LINES = 1000;
const NEAR_BOTTOM_PX = 30;
const RECONNECT_DELAY_MS = 2000;

/**
 * Full-screen-ish modal showing log output for a service that advertises
 * `hasLogs` (Docker/systemd adapters -- see
 * backend/adapters/base.py:supports_logs). Follows by default over
 * /ws/logs/{id} -- a generic poll-and-diff channel that works the same
 * way for real or simulated logs (backend/api/main.py:logs_ws) -- with a
 * pause toggle that falls back to the plain REST fetch for a one-shot
 * refresh, and tail -f-style auto-scroll that gets out of the way the
 * moment you scroll up to read history.
 */
export function LogsDialog({ serviceId, serviceName, onClose }: { serviceId: string; serviceName: string; onClose: () => void }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(true);
  const [connected, setConnected] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const receivedInitialRef = useRef(false);
  const permanentErrorRef = useRef(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getServiceLogs(serviceId);
      setLines(data.lines);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Follow mode: a WebSocket per open dialog, matching the app's existing
  // live-snapshot pattern. The first message replaces the buffer with the
  // current tail; every message after that is new lines to append.
  useEffect(() => {
    if (!following) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    receivedInitialRef.current = false;
    permanentErrorRef.current = false;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/ws/logs/${encodeURIComponent(serviceId)}`);

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(event.data) as { lines?: LogLine[]; error?: string };
          if (data.error) {
            // The server won't retry this on its own -- e.g. "this
            // service doesn't support logs" or "insufficient permissions
            // to read the journal" will fail identically every 2s. Show
            // it and stop hammering a connection that isn't coming back.
            setError(data.error);
            permanentErrorRef.current = true;
            return;
          }
          const newLines = data.lines ?? [];
          if (!receivedInitialRef.current) {
            receivedInitialRef.current = true;
            setLines(newLines.slice(-MAX_LINES));
          } else if (newLines.length > 0) {
            setLines((prev) => [...prev, ...newLines].slice(-MAX_LINES));
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        if (permanentErrorRef.current) return;
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
      setConnected(false);
    };
  }, [serviceId, following]);

  // One-shot fetch when paused, so there's still a way to see the latest
  // without following.
  useEffect(() => {
    if (!following) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, following]);

  // tail -f-style auto-scroll: stick to the bottom as lines arrive, but
  // only while the viewer hasn't scrolled up to read something older.
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  return (
    <Modal onClose={onClose} size="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>{serviceName} — Logs</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                display: "inline-block",
                background: !following
                  ? "var(--color-text-faint)"
                  : error
                  ? "var(--color-danger)"
                  : connected
                  ? "var(--color-success)"
                  : "var(--color-warning)",
              }}
            />
            {!following ? "Paused" : error ? "Error" : connected ? "Live" : "Reconnecting…"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {following ? (
            <button className="btn btn--ghost" onClick={() => setFollowing(false)}>
              Pause
            </button>
          ) : (
            <>
              <button className="btn btn--ghost" onClick={refresh} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <button className="btn btn--ghost" onClick={() => setFollowing(true)}>
                Resume Following
              </button>
            </>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--space-3)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {error && <div style={{ color: "var(--color-danger)" }}>{error}</div>}
        {!error && lines.length === 0 && <div style={{ color: "var(--color-text-muted)" }}>No log output.</div>}
        {!error &&
          lines.map((line, i) => (
            <div key={i}>
              {line.ts && <span style={{ color: "var(--color-text-faint)" }}>{line.ts} </span>}
              {line.text}
            </div>
          ))}
      </div>
    </Modal>
  );
}
