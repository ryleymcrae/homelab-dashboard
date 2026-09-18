"""
Audit log.

Every admin action (start/stop/restart, config change, image update/
rollback...) gets one row here, regardless of whether it succeeded --
who attempted it, what it was, what it targeted, and the outcome. There
is only one operator today (a single shared password, if any), so
"who" is the most specific thing actually knowable right now -- the
client IP plus how it authenticated (see backend/auth.py:describe_actor)
-- rather than a username. The schema doesn't need to change when real
per-user accounts exist later; `actor` just starts holding a username
instead of an IP.

Separate from backend/persistence/history.py (that's metric time-series
for charts; this is a discrete event log) even though both are small
SQLite stores, because they have different retention needs and neither
should have to know about the other's schema.
"""
from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

FALLBACK_DB_PATH = "/data/audit.sqlite3"


def default_db_path() -> Path:
    """Resolve DASHBOARD_AUDIT_DB at call time -- mirrors
    backend.config.loader.default_config_path /
    backend.persistence.history.default_db_path."""
    return Path(os.environ.get("DASHBOARD_AUDIT_DB", FALLBACK_DB_PATH))


_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    result TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts);
"""


class AuditLogStore:
    def __init__(self, path: str | Path | None = None, max_rows: int = 100_000):
        self.path = Path(path) if path is not None else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.max_rows = max_rows
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

    def record(self, actor: str, action: str, target: str, result: str, detail: str = "") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO audit_log (ts, actor, action, target, result, detail) VALUES (?, ?, ?, ?, ?, ?)",
                (int(time.time()), actor, action, target, result, detail),
            )
            count = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
            if count > self.max_rows:
                excess = count - self.max_rows
                conn.execute(
                    "DELETE FROM audit_log WHERE id IN "
                    "(SELECT id FROM audit_log ORDER BY ts ASC LIMIT ?)",
                    (excess,),
                )

    def query(self, limit: int = 200) -> list[dict]:
        """Most recent first -- what an audit log viewer wants by default."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT ts, actor, action, target, result, detail FROM audit_log ORDER BY ts DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {"ts": ts, "actor": actor, "action": action, "target": target, "result": result, "detail": detail}
            for ts, actor, action, target, result, detail in rows
        ]
