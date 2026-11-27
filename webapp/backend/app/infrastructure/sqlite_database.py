"""Connection lifecycle and re-entrant transactions, independent of HumanOS services."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3
import threading


class SQLiteDatabase:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.transaction_state = threading.local()

    @contextmanager
    def connect(self):
        ambient = getattr(self.transaction_state, 'connection', None)
        if ambient is not None:
            yield ambient
            return
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def atomic(self):
        # Nested operations join the outer transaction, not separate savepoints.
        existing = getattr(self.transaction_state, 'connection', None)
        if existing is not None:
            yield existing
            return
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        self.transaction_state.connection = conn
        try:
            conn.execute('BEGIN IMMEDIATE')
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self.transaction_state.connection = None
            conn.close()
