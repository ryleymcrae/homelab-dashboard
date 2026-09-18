import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { computeConfigDiff } from "../api/configDiff";
import type { ContainerConfig, ServiceConfigState } from "../api/types";
import { Modal } from "./Modal";

const RESTART_POLICIES = ["no", "on-failure", "always", "unless-stopped"];

interface EnvRow {
  key: string;
  value: string;
}

function toEnvRows(env: Record<string, string>): EnvRow[] {
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

function fromEnvRows(rows: EnvRow[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) env[row.key.trim()] = row.value;
  }
  return env;
}

export function ConfigEditorDialog({
  serviceId,
  serviceName,
  onClose,
  onSaved,
}: {
  serviceId: string;
  serviceName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState<ServiceConfigState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [cpuLimit, setCpuLimit] = useState("");
  const [memLimit, setMemLimit] = useState("");
  const [restartPolicy, setRestartPolicy] = useState("no");

  useEffect(() => {
    api
      .getServiceConfig(serviceId)
      .then((data) => {
        setState(data);
        const baseline = data.pending ?? data.applied;
        setEnvRows(toEnvRows(baseline.env));
        setCpuLimit(baseline.cpuLimit ?? "");
        setMemLimit(baseline.memLimit ?? "");
        setRestartPolicy(baseline.restartPolicy);
      })
      .catch((err) => setError((err as Error).message));
  }, [serviceId]);

  if (error) {
    return (
      <Modal onClose={onClose} size="confirm">
        <div style={{ color: "var(--color-danger)", marginBottom: 16 }}>{error}</div>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </Modal>
    );
  }
  if (!state) {
    return (
      <Modal onClose={onClose} size="panel">
        <div style={{ color: "var(--color-text-muted)" }}>Loading…</div>
      </Modal>
    );
  }

  const baseline = state.pending ?? state.applied;
  const draft: ContainerConfig = {
    env: fromEnvRows(envRows),
    cpuLimit: cpuLimit || null,
    memLimit: memLimit || null,
    restartPolicy,
  };
  const diff = computeConfigDiff(baseline, draft);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateServiceConfig(serviceId, draft);
      setState(updated);
      setConfirming(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)",
    color: "var(--color-text)",
    fontSize: "var(--text-sm)",
    fontFamily: "var(--font-mono)",
  };

  return (
    <Modal onClose={onClose} size="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
        <div style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>{serviceName} — Configuration</div>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {confirming ? (
          <>
            <div className="card" style={{ borderColor: "var(--color-warning)", background: "var(--color-warning-soft)" }}>
              <div style={{ fontWeight: 700, color: "var(--color-warning)", marginBottom: 4 }}>Review changes</div>
              <div style={{ fontSize: "var(--text-sm)" }}>
                {serviceName} will need to be restarted for these changes to take effect.
              </div>
            </div>
            <div className="card">
              <div className="section-title">CHANGES</div>
              {diff.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>No changes.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", rowGap: 10, columnGap: 12, fontSize: "var(--text-sm)" }}>
                  <div style={{ color: "var(--color-text-muted)", fontWeight: 600 }}>Field</div>
                  <div style={{ color: "var(--color-text-muted)", fontWeight: 600 }}>Before</div>
                  <div style={{ color: "var(--color-text-muted)", fontWeight: 600 }}>After</div>
                  {diff.map((row) => (
                    <React.Fragment key={row.field}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{row.field}</div>
                      <div style={{ color: "var(--color-danger)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                        {row.before}
                      </div>
                      <div style={{ color: "var(--color-success)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                        {row.after}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="section-title">ENVIRONMENT VARIABLES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {envRows.map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <input
                      style={{ ...inputStyle, flex: "1 1 40%" }}
                      value={row.key}
                      placeholder="KEY"
                      onChange={(e) => setEnvRows((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                    />
                    <input
                      style={{ ...inputStyle, flex: "1 1 60%" }}
                      value={row.value}
                      placeholder="value"
                      onChange={(e) => setEnvRows((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                    />
                    <button
                      className="btn btn--ghost"
                      onClick={() => setEnvRows((rows) => rows.filter((_, j) => j !== i))}
                      aria-label="Remove variable"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="btn btn--ghost" style={{ alignSelf: "flex-start" }} onClick={() => setEnvRows((rows) => [...rows, { key: "", value: "" }])}>
                  + Add Variable
                </button>
              </div>
            </div>

            <div className="card">
              <div className="section-title">RESOURCE LIMITS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                  CPU limit (cores)
                  <input style={inputStyle} value={cpuLimit} placeholder="e.g. 2" onChange={(e) => setCpuLimit(e.target.value)} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                  Memory limit
                  <input style={inputStyle} value={memLimit} placeholder="e.g. 512m" onChange={(e) => setMemLimit(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="card">
              <div className="section-title">RESTART POLICY</div>
              <select style={inputStyle} value={restartPolicy} onChange={(e) => setRestartPolicy(e.target.value)}>
                {RESTART_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: "var(--space-3)", flexShrink: 0 }}>
        {confirming ? (
          <>
            <button className="btn" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={saving}>
              Back
            </button>
            <button className="btn btn--primary" style={{ flex: 1 }} onClick={save} disabled={saving || diff.length === 0}>
              {saving ? "Saving…" : "Confirm & Save"}
            </button>
          </>
        ) : (
          <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => setConfirming(true)} disabled={diff.length === 0}>
            Save Changes
          </button>
        )}
      </div>
    </Modal>
  );
}
