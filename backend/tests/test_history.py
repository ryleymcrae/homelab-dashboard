import tempfile
import time
from pathlib import Path

from backend.persistence.history import HistoryStore


def test_record_and_query_roundtrip():
    with tempfile.TemporaryDirectory() as tmp:
        store = HistoryStore(Path(tmp) / "history.sqlite3")
        store.record("host.local.cpu", 42.5)
        rows = store.query("host.local.cpu", since_seconds=60)
        assert len(rows) == 1
        assert rows[0][1] == 42.5


def test_query_excludes_old_rows_outside_window():
    with tempfile.TemporaryDirectory() as tmp:
        store = HistoryStore(Path(tmp) / "history.sqlite3")
        old_ts = int(time.time()) - 10_000
        store.record("s", 1.0, ts=old_ts)
        store.record("s", 2.0)
        rows = store.query("s", since_seconds=60)
        assert len(rows) == 1
        assert rows[0][1] == 2.0


def test_retention_deletes_old_rows():
    with tempfile.TemporaryDirectory() as tmp:
        store = HistoryStore(Path(tmp) / "history.sqlite3", retention_days=1)
        old_ts = int(time.time()) - (2 * 86400)
        store.record("s", 1.0, ts=old_ts)
        store.record("s", 2.0)
        store.cleanup()
        rows = store.query("s", since_seconds=10 * 86400)
        assert len(rows) == 1
        assert rows[0][1] == 2.0


def test_max_rows_per_series_enforced():
    with tempfile.TemporaryDirectory() as tmp:
        store = HistoryStore(Path(tmp) / "history.sqlite3", max_rows_per_series=5)
        base = int(time.time()) - 100
        for i in range(10):
            store.record("s", float(i), ts=base + i)
        store.cleanup()
        rows = store.query("s", since_seconds=1000)
        assert len(rows) == 5
        # the oldest rows should have been dropped, newest retained
        assert [v for _, v in rows] == [5.0, 6.0, 7.0, 8.0, 9.0]
