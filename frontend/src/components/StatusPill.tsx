import React from "react";
import type { Status } from "../api/types";

const LABELS: Record<Status, string> = {
  online: "Online",
  offline: "Offline",
  warning: "Warning",
  unknown: "Unknown",
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      <span className={`status-dot status-dot--${status}`} />
      {LABELS[status]}
    </span>
  );
}
