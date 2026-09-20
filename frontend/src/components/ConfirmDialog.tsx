import React, { useState } from "react";
import type { ConfirmableAction } from "../api/types";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  action: ConfirmableAction;
  targetName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * State-changing action confirmation, matching reference Page 08:
 * dark modal, title, warning body, Cancel / colored confirm button. The
 * confirm button's color is state-aware (spec section 18): destructive
 * actions are red, restart is blue, start is green. Shared by container
 * actions and host actions (backend/models/core.py: Action, HostAction)
 * -- when `requireTypedConfirmation` is set (reserved for actions more
 * destructive than a container restart, like a host reboot), the
 * confirm button stays disabled until the exact string is typed.
 */
export function ConfirmDialog({ action, targetName, busy, onCancel, onConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const confirmClass =
    action.kind === "stop" || action.kind === "remove" ? "btn--danger" : action.kind === "start" ? "btn--success" : "btn--primary";
  const requiredText = action.requireTypedConfirmation;
  const typedConfirmationOk = !requiredText || typed === requiredText;

  return (
    <Modal onClose={onCancel} size="confirm">
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 8 }}>
        {action.confirmTitle || `${action.label} ${targetName}?`}
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", marginBottom: requiredText ? 14 : 20, lineHeight: 1.5 }}>
        {action.confirmBody || `This will ${action.kind} ${targetName}.`}
      </div>
      {requiredText && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Type <strong style={{ color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>{requiredText}</strong> to confirm
            <input
              autoFocus
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface-2)",
                color: "var(--color-text)",
                fontSize: "var(--text-sm)",
                fontFamily: "var(--font-mono)",
              }}
            />
          </label>
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${confirmClass}`} style={{ flex: 1 }} onClick={onConfirm} disabled={busy || !typedConfirmationOk}>
          {busy ? "Working…" : action.label}
        </button>
      </div>
    </Modal>
  );
}
