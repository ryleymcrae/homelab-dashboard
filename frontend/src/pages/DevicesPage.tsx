import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSnapshot } from "../hooks/SnapshotContext";
import { api } from "../api/client";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FleetOverview } from "../components/FleetOverview";
import { HostActionsMenu } from "../components/HostActionsMenu";
import { HostMetricTiles } from "../components/HostMetricTile";
import { resolveMetricDisplay } from "../api/metrics";
import { useChartGrid } from "../hooks/useChartGrid";
import { bytesAxisFormatter, formatBytes, formatMetricValue, formatTimestamp } from "../api/format";
import { useAuth } from "../hooks/AuthContext";
import type { BackupStatus, HostAction, HostInfo, Metric, ScheduledJob } from "../api/types";

const percentLabel = (v: number) => `${Math.round(v)}%`;

const RANGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "1H", hours: 1 },
  { label: "6H", hours: 6 },
  { label: "24H", hours: 24 },
  { label: "7D", hours: 24 * 7 },
  { label: "30D", hours: 24 * 30 },
];

function RangeSelector({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.hours}
          className="btn"
          onClick={() => onChange(opt.hours)}
          style={{
            padding: "4px 10px",
            fontSize: "var(--text-xs)",
            background: hours === opt.hours ? "var(--color-primary-soft)" : "transparent",
            color: hours === opt.hours ? "var(--color-primary)" : "var(--color-text-muted)",
            border: "1px solid var(--color-border)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The one show/hide pattern every collapsible sub-section of a host's
 * card uses -- a clickable title + "Show ▼ / Hide ▲" indicator, an
 * optional bit of header-right content (a range selector, a "Run Now"
 * button) that doesn't itself trigger the toggle, and lazy children:
 * mounted (so they fetch) only once actually opened. Reused instead of
 * hand-rolling this per section so every section behaves identically.
 */
/** `open`/`onToggle` make it controlled -- a tapped metric tile opens
 * Detailed Metrics from outside. */
function CollapsibleSection({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  extra,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const toggle = () => (onToggle ? onToggle(!open) : setUncontrolledOpen(!open));
  return (
    <>
      <hr className="card-divider" />
      {/* The toggle is its own button, beside `extra` rather than around
          it: a button can't contain other controls (like the range
          selector) without swallowing their labels and taps. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <button type="button" className="collapsible__toggle" aria-expanded={open} onClick={toggle}>
          <span className="section-title" style={{ marginBottom: 0, flex: 1 }}>
            {title}
          </span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", flexShrink: 0 }}>{open ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {extra}
      </div>
      {open && <div style={{ marginTop: "var(--space-3)" }}>{children}</div>}
    </>
  );
}

// Per-core CPU is the one "detail" metric dense enough to deserve its own
// compact visual instead of a label/value row -- everything else (swap,
// per-partition disk, I/O rate) renders generically below it.
function CoreBars({ cores }: { cores: Metric[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))", gap: 6 }}>
      {cores.map((core, i) => {
        const pct = Number(core.value);
        return (
          <div key={core.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div
              style={{
                width: "100%",
                height: 36,
                borderRadius: "var(--radius-sm)",
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-border)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `${Math.max(0, Math.min(100, pct))}%`,
                  background: pct > 85 ? "var(--color-danger)" : pct > 60 ? "var(--color-warning)" : "var(--color-primary)",
                  transition: "height 0.4s ease",
                }}
              />
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{i}</div>
          </div>
        );
      })}
    </div>
  );
}

function HostDetailPanel({ hostId }: { hostId: string }) {
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getHostDetail(hostId)
      .then((data) => !cancelled && setMetrics(data.metrics))
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [hostId]);

  if (error) {
    return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>Detailed metrics unavailable: {error}</div>;
  }
  if (!metrics) {
    return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>Loading…</div>;
  }

  const cores = metrics.filter((m) => m.key.startsWith("cpu_core_"));
  const rest = metrics.filter((m) => !m.key.startsWith("cpu_core_"));

  if (cores.length === 0 && rest.length === 0) {
    return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>No detailed metrics available for this host.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {cores.length > 0 && (
        <div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginBottom: 6 }}>PER-CORE CPU</div>
          <CoreBars cores={cores} />
        </div>
      )}
      {rest.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 8, columnGap: 16 }}>
          {rest.map((m) => (
            <React.Fragment key={m.key}>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>{m.label}</div>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, textAlign: "right" }}>
                {formatMetricValue(m.value, m.type, m.unit)}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function HostActionResultBanner({ result, onDismiss }: { result: NonNullable<HostInfo["lastActionResult"]>; onDismiss: () => void }) {
  return (
    <div
      className="card"
      style={{
        borderColor: result.success ? "var(--color-success)" : "var(--color-danger)",
        background: result.success ? "var(--color-success-soft)" : "var(--color-danger-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`status-dot status-dot--${result.success ? "online" : "offline"}`} />
        <div style={{ fontSize: "var(--text-sm)" }}>{result.message}</div>
      </div>
      <button className="btn btn--ghost" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

// Cron/scheduled-job viewer -- fetched on expand, like Detailed Metrics.
// "Run Now" goes through the exact same confirm-then-execute path as a
// direct host action, via `onRunNow` (backend/api/main.py:run_host_job
// dispatches to the identical execution as run_host_action).
function ScheduledJobsPanel({ hostId }: { hostId: string }) {
  const { canAct } = useAuth();
  const [jobs, setJobs] = useState<ScheduledJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingJob, setPendingJob] = useState<ScheduledJob | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .getHostJobs(hostId)
      .then(setJobs)
      .catch((err) => setError((err as Error).message));
  };

  useEffect(load, [hostId]);

  const runNow = async (job: ScheduledJob) => {
    setBusy(true);
    try {
      await api.runHostJob(hostId, job.id);
      setPendingJob(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-danger)" }}>{error}</div>;
  if (!jobs) return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>Loading…</div>;
  if (jobs.length === 0) {
    return <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>No scheduled jobs configured.</div>;
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {jobs.map((job) => (
          <div
            key={job.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{job.name}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{job.scheduleLabel}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ textAlign: "right", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                  Last: {formatTimestamp(job.lastRun)}
                  {job.lastStatus && <span className={`status-dot status-dot--${job.lastStatus === "success" ? "online" : "offline"}`} />}
                </div>
                <div>Next: {formatTimestamp(job.nextRun)}</div>
              </div>
              {canAct && (
                <button className="btn btn--ghost" onClick={() => setPendingJob(job)}>
                  Run Now
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {canAct && pendingJob && (
        <ConfirmDialog
          action={{
            kind: "run_job",
            label: "Run Now",
            destructive: false,
            confirmTitle: `Run "${pendingJob.name}" now?`,
            confirmBody: "This runs the job immediately, outside its normal schedule.",
          }}
          targetName={pendingJob.name}
          busy={busy}
          onCancel={() => setPendingJob(null)}
          onConfirm={() => runNow(pendingJob)}
        />
      )}
    </>
  );
}

// Omitted entirely (not just shown empty) for a host with no backup
// tracking configured -- GET /api/hosts/{id}/backup returns null for
// those, same "never fabricate" rule as a missing temperature sensor.
function BackupStatusPanel({ host, onRunBackup }: { host: HostInfo; onRunBackup: (action: HostAction) => void }) {
  const { canAct } = useAuth();
  const [status, setStatus] = useState<BackupStatus | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .getHostBackupStatus(host.id)
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [host.id]);

  if (!status) return null;

  const backupAction = canAct ? host.actions.find((a) => a.kind === "run_backup") : undefined;

  return (
    <CollapsibleSection
      title="BACKUP STATUS"
      defaultOpen
      extra={
        backupAction && (
          <button className="btn btn--ghost" onClick={() => onRunBackup(backupAction)}>
            Run Backup Now
          </button>
        )
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 8, columnGap: 16, fontSize: "var(--text-sm)" }}>
        <div style={{ color: "var(--color-text-muted)" }}>Last successful backup</div>
        <div style={{ textAlign: "right", fontWeight: 600 }}>{formatTimestamp(status.lastBackupAt)}</div>
        <div style={{ color: "var(--color-text-muted)" }}>Size</div>
        <div style={{ textAlign: "right", fontWeight: 600 }}>{status.sizeBytes != null ? formatBytes(status.sizeBytes) : "—"}</div>
        <div style={{ color: "var(--color-text-muted)" }}>Last attempt</div>
        <div style={{ textAlign: "right", fontWeight: 600, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
          {status.lastStatus && <span className={`status-dot status-dot--${status.lastStatus === "success" ? "online" : "offline"}`} />}
          {formatTimestamp(status.lastAttemptAt)}
        </div>
      </div>
    </CollapsibleSection>
  );
}

// Every host, local or remote, gets the same set of metric cards and the
// same CPU/memory history chart -- keyed off its own history series
// (`host.<id>.cpu` / `host.<id>.mem`), not a single hardcoded series.
function HostDeviceSection({ host, focused }: { host: HostInfo; focused: boolean }) {
  const { canAct } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<{ ts: number; value: number }[]>([]);
  const [memHistory, setMemHistory] = useState<{ ts: number; value: number }[]>([]);
  const [rangeHours, setRangeHours] = useState(6);
  const [pendingHostAction, setPendingHostAction] = useState<HostAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedResultAt, setDismissedResultAt] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const { snapshot } = useSnapshot();
  const [chartGrid, setChartGrid] = useChartGrid();
  // Same colors as the CPU/Memory tiles (Settings > Appearance > Metric display).
  const cpuColor = resolveMetricDisplay(snapshot?.dashboard.metricDisplay, "cpu").color;
  const memColor = resolveMetricDisplay(snapshot?.dashboard.metricDisplay, "mem").color;
  // History stores memory as a percentage; with the host's total known,
  // the right axis shows it in bytes -- a second 0-100% axis would just
  // repeat the left one.
  const memTotal = host.memTotalBytes ?? null;
  const chartSeries = useMemo(
    () => [
      { name: "CPU", color: cpuColor, points: cpuHistory },
      {
        name: "Memory",
        color: memColor,
        axis: "right" as const,
        points: memTotal ? memHistory.map((p) => ({ ts: p.ts, value: (p.value / 100) * memTotal })) : memHistory,
      },
    ],
    [cpuHistory, memHistory, memTotal, cpuColor, memColor]
  );

  // Drill-in from a metric tile (here, or on Home via ?host=): expand the
  // panel, open Detailed Metrics, and bring it into view once rendered.
  const openDetail = () => {
    setCollapsed(false);
    setDetailOpen(true);
    setScrollRequest((n) => n + 1);
  };
  useEffect(() => {
    if (focused) openDetail();
  }, [focused]);
  useEffect(() => {
    if (scrollRequest) detailRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [scrollRequest]);

  const runHostAction = async (action: HostAction) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.runHostAction(host.id, action.kind);
      setPendingHostAction(null);
      // The shared snapshot socket picks up the resulting status/
      // lastActionResult within a couple of seconds -- no separate
      // refetch needed here, same as every other page driven by it.
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [cpu, mem] = await Promise.all([
          api.getHistory(`host.${host.id}.cpu`, rangeHours),
          api.getHistory(`host.${host.id}.mem`, rangeHours),
        ]);
        if (!cancelled) {
          setCpuHistory(cpu.points);
          setMemHistory(mem.points);
        }
      } catch {
        // history endpoint may be empty on a fresh install -- non-fatal
      }
    };
    load();
    // A longer range doesn't need to re-poll every 30s to stay current --
    // one extra sample every 30s is invisible on a 7-30 day chart -- but
    // keeping one interval for all ranges is simpler than a variable
    // cadence, and the request is cheap either way.
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [host.id, rangeHours]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {host.lastActionResult && host.lastActionResult.timestamp !== dismissedResultAt && (
        <HostActionResultBanner
          result={host.lastActionResult}
          onDismiss={() => setDismissedResultAt(host.lastActionResult!.timestamp)}
        />
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setCollapsed((v) => !v)}>
          <div className="section-title" style={{ marginBottom: 0, flex: 1 }}>
            {host.name.toUpperCase()}
          </div>
          {canAct && (
            <div onClick={(e) => e.stopPropagation()}>
              <HostActionsMenu actions={host.actions} onSelect={setPendingHostAction} />
            </div>
          )}
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", flexShrink: 0 }}>{collapsed ? "Show ▼" : "Hide ▲"}</span>
        </div>

        <div style={{ marginTop: "var(--space-3)" }}>
          <HostMetricTiles host={host} history={{ cpu: cpuHistory.map((p) => p.value), mem: memHistory.map((p) => p.value) }} onSelect={openDetail} />
        </div>

        {actionError && <div style={{ fontSize: "var(--text-sm)", color: "var(--color-danger)", marginTop: 8 }}>{actionError}</div>}

        {!collapsed && (
          <>
            <CollapsibleSection title="CPU & MEMORY USAGE" defaultOpen extra={<RangeSelector hours={rangeHours} onChange={setRangeHours} />}>
              <TimeSeriesChart
                grid={chartGrid}
                onGridChange={setChartGrid}
                left={{ max: 100, format: percentLabel, color: cpuColor }}
                right={memTotal ? { max: memTotal, format: bytesAxisFormatter(memTotal), color: memColor } : { max: 100, format: percentLabel, color: memColor }}
                series={chartSeries}
              />
            </CollapsibleSection>

            <div ref={detailRef} style={{ scrollMarginTop: "var(--space-3)" }}>
              <CollapsibleSection title="DETAILED METRICS" open={detailOpen} onToggle={setDetailOpen}>
                <HostDetailPanel hostId={host.id} />
              </CollapsibleSection>
            </div>

            <BackupStatusPanel host={host} onRunBackup={setPendingHostAction} />

            {host.actions.length > 0 && (
              <CollapsibleSection title="SCHEDULED JOBS">
                <ScheduledJobsPanel hostId={host.id} />
              </CollapsibleSection>
            )}
          </>
        )}
      </div>

      {pendingHostAction && (
        <ConfirmDialog
          action={pendingHostAction}
          targetName={host.name}
          busy={actionBusy}
          onCancel={() => setPendingHostAction(null)}
          onConfirm={() => runHostAction(pendingHostAction)}
        />
      )}
    </div>
  );
}

export function DevicesPage() {
  const { snapshot } = useSnapshot();
  const [params] = useSearchParams();
  const focusedHost = params.get("host");
  if (!snapshot) return <div className="page">Loading…</div>;

  return (
    <div className="page">
      <FleetOverview />
      {snapshot.hosts.map((host) => (
        <HostDeviceSection key={host.id} host={host} focused={host.id === focusedHost} />
      ))}
    </div>
  );
}
