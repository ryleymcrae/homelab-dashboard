"""
Alert history/state store.

One row per fingerprint (`<target_type>:<target_id>:<metric>`) while it's
active -- re-triggering the same condition updates the existing row
rather than creating a new one, so "CPU high on ziri-mini" doesn't spam
a new alert every evaluation tick. Resolved alerts stay in the table
(spec: alert *history*, not just current state), so this is a small
persistent log like backend/persistence/audit.py, not a cache.
"""
from __future__ import annotations

import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from backend.models.core import Alert, AlertSeverity, AlertStatus

FALLBACK_DB_PATH = "/data/alerts.sqlite3"

_COLUMNS = (
    "id", "fingerprint", "severity", "status", "title", "message", "metric",
    "target_type", "target_id", "target_name", "value", "threshold",
    "triggered_at", "updated_at", "resolved_at", "acknowledged_at", "muted", "snoozed_until",
    "suggested_action",
)


def default_db_path() -> Path:
    """Resolve DASHBOARD_ALERTS_DB at call time -- mirrors every other
    store's default_db_path (history.py, audit.py)."""
    return Path(os.environ.get("DASHBOARD_ALERTS_DB", FALLBACK_DB_PATH))


_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS alerts (
    {", ".join(f"{c} TEXT" if c not in ("value", "threshold") else f"{c} REAL" for c in _COLUMNS if c != "muted")},
    muted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_fingerprint
    ON alerts (fingerprint) WHERE status != 'resolved';
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts (triggered_at);
"""


def _row_to_alert(row: tuple) -> Alert:
    values = dict(zip(_COLUMNS, row))
    return Alert(
        id=values["id"],
        fingerprint=values["fingerprint"],
        severity=AlertSeverity(values["severity"]),
        status=AlertStatus(values["status"]),
        title=values["title"],
        message=values["message"],
        metric=values["metric"],
        target_type=values["target_type"],
        target_id=values["target_id"],
        target_name=values["target_name"],
        value=values["value"],
        threshold=values["threshold"],
        triggered_at=values["triggered_at"],
        updated_at=values["updated_at"],
        resolved_at=values["resolved_at"],
        acknowledged_at=values["acknowledged_at"],
        muted=bool(values["muted"]),
        snoozed_until=values["snoozed_until"],
        suggested_action=values["suggested_action"],
    )


class AlertStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(str(self.path))
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def get_active(self, fingerprint: str) -> Optional[Alert]:
        """"Active" here means not resolved -- acknowledged/muted/snoozed
        alerts are still active, just quieter."""
        with self._conn() as conn:
            row = conn.execute(
                f"SELECT {', '.join(_COLUMNS)} FROM alerts WHERE fingerprint = ? AND status != 'resolved'",
                (fingerprint,),
            ).fetchone()
        return _row_to_alert(row) if row else None

    def trigger(
        self, fingerprint: str, severity: AlertSeverity, title: str, message: str, metric: str,
        target_type: str, target_id: str, target_name: str, value: Optional[float], threshold: Optional[float],
        suggested_action: Optional[str],
    ) -> Alert:
        """Creates a new active alert for this fingerprint, or refreshes
        an existing one's value/message/updated_at if it's still firing.
        Never touches acknowledged/muted/snoozed state -- re-triggering
        isn't the same as a human dismissing it."""
        existing = self.get_active(fingerprint)
        now = _now_iso()
        if existing:
            with self._conn() as conn:
                conn.execute(
                    "UPDATE alerts SET value = ?, message = ?, updated_at = ? WHERE id = ?",
                    (value, message, now, existing.id),
                )
            existing.value = value
            existing.message = message
            existing.updated_at = now
            return existing

        alert = Alert(
            id=str(uuid.uuid4()),
            fingerprint=fingerprint,
            severity=severity,
            status=AlertStatus.ACTIVE,
            title=title,
            message=message,
            metric=metric,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            value=value,
            threshold=threshold,
            triggered_at=now,
            updated_at=now,
            suggested_action=suggested_action,
        )
        with self._conn() as conn:
            conn.execute(
                f"INSERT INTO alerts ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' for _ in _COLUMNS)})",
                (
                    alert.id, alert.fingerprint, alert.severity.value, alert.status.value, alert.title,
                    alert.message, alert.metric, alert.target_type, alert.target_id, alert.target_name,
                    alert.value, alert.threshold, alert.triggered_at, alert.updated_at, alert.resolved_at,
                    alert.acknowledged_at, int(alert.muted), alert.snoozed_until, alert.suggested_action,
                ),
            )
        return alert

    def resolve(self, fingerprint: str) -> None:
        """No-op if there's no active alert for this fingerprint --
        called on every evaluation tick for every metric that's currently
        fine, so this has to be cheap and quiet, not an error."""
        now = _now_iso()
        with self._conn() as conn:
            conn.execute(
                "UPDATE alerts SET status = 'resolved', resolved_at = ?, updated_at = ? "
                "WHERE fingerprint = ? AND status != 'resolved'",
                (now, now, fingerprint),
            )

    def get(self, alert_id: str) -> Optional[Alert]:
        with self._conn() as conn:
            row = conn.execute(f"SELECT {', '.join(_COLUMNS)} FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        return _row_to_alert(row) if row else None

    def acknowledge(self, alert_id: str) -> Alert:
        now = _now_iso()
        with self._conn() as conn:
            conn.execute(
                "UPDATE alerts SET status = 'acknowledged', acknowledged_at = ?, updated_at = ? WHERE id = ?",
                (now, now, alert_id),
            )
        return self.get(alert_id)

    def set_muted(self, alert_id: str, muted: bool) -> Alert:
        with self._conn() as conn:
            conn.execute("UPDATE alerts SET muted = ?, updated_at = ? WHERE id = ?", (int(muted), _now_iso(), alert_id))
        return self.get(alert_id)

    def snooze(self, alert_id: str, until_iso: str) -> Alert:
        with self._conn() as conn:
            conn.execute(
                "UPDATE alerts SET snoozed_until = ?, updated_at = ? WHERE id = ?", (until_iso, _now_iso(), alert_id)
            )
        return self.get(alert_id)

    def count_active(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'active'").fetchone()[0]

    def list(self, status: Optional[str] = None, limit: int = 200) -> list[Alert]:
        query = f"SELECT {', '.join(_COLUMNS)} FROM alerts"
        params: tuple = ()
        if status:
            query += " WHERE status = ?"
            params = (status,)
        query += " ORDER BY triggered_at DESC LIMIT ?"
        params = params + (limit,)
        with self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
        return [_row_to_alert(r) for r in rows]


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
