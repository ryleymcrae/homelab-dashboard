"""
Lightweight SQLite history store.

Stores time-series samples (cpu/mem/disk/temp/network per host, and
selected service metrics) at a configurable interval. Enforces retention
by deleting old rows and downsampling, so the database does not grow
unbounded over months of operation (spec section 24).
"""
from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

FALLBACK_DB_PATH = "/data/history.sqlite3"


def default_db_path() -> Path:
    """Resolve DASHBOARD_HISTORY_DB at call time (mirrors
    backend.config.loader.default_config_path). Without an override this
    stays /data/history.sqlite3, which the Docker and systemd deploy paths
    both provision -- but a bare `uvicorn backend.api.main:app` dev run as
    a non-root user has no write access to `/`, so local development needs
    a way to point this somewhere writable."""
    return Path(os.environ.get("DASHBOARD_HISTORY_DB", FALLBACK_DB_PATH))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_series_ts ON samples (series, ts);
"""


class HistoryStore:
    def __init__(self, path: str | Path | None = None, retention_days: int = 14, max_rows_per_series: int = 50_000):
        self.path = Path(path) if path is not None else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.retention_days = retention_days
        self.max_rows_per_series = max_rows_per_series
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

    def record(self, series: str, value: float, ts: int | None = None) -> None:
        ts = ts if ts is not None else int(time.time())
        with self._conn() as conn:
            conn.execute("INSERT INTO samples (series, ts, value) VALUES (?, ?, ?)", (series, ts, value))

    def record_many(self, samples: dict[str, float], ts: int | None = None) -> None:
        ts = ts if ts is not None else int(time.time())
        with self._conn() as conn:
            conn.executemany(
                "INSERT INTO samples (series, ts, value) VALUES (?, ?, ?)",
                [(series, ts, value) for series, value in samples.items()],
            )

    def query(self, series: str, since_seconds: int) -> list[tuple[int, float]]:
        cutoff = int(time.time()) - since_seconds
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT ts, value FROM samples WHERE series = ? AND ts >= ? ORDER BY ts ASC",
                (series, cutoff),
            ).fetchall()
        return rows

    def cleanup(self) -> None:
        """Retention + row cap enforcement. Call periodically (e.g. once an
        hour) from the collector loop, not on every write."""
        cutoff = int(time.time()) - self.retention_days * 86400
        with self._conn() as conn:
            conn.execute("DELETE FROM samples WHERE ts < ?", (cutoff,))
            series_list = [r[0] for r in conn.execute("SELECT DISTINCT series FROM samples").fetchall()]
            for series in series_list:
                count = conn.execute(
                    "SELECT COUNT(*) FROM samples WHERE series = ?", (series,)
                ).fetchone()[0]
                if count > self.max_rows_per_series:
                    excess = count - self.max_rows_per_series
                    conn.execute(
                        "DELETE FROM samples WHERE id IN ("
                        "SELECT id FROM samples WHERE series = ? ORDER BY ts ASC LIMIT ?)",
                        (series, excess),
                    )
