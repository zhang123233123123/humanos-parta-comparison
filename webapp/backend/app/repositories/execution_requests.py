"""User-scoped execution request replay records on the session transaction."""
import sqlite3
from .execution_sessions import ExecutionSessionRepository


class ExecutionRequestRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get(self, *, user_id: str, request_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            'SELECT * FROM execution_requests WHERE user_id=? AND request_id=?',
            (user_id, request_id)).fetchone()

    def replay(self, *, user_id: str, request_id: str | None) -> sqlite3.Row | None:
        if not request_id:
            return None
        row = self.connection.execute(
            'SELECT execution_session_id FROM execution_requests WHERE user_id=? AND request_id=?',
            (user_id, request_id)).fetchone()
        return ExecutionSessionRepository(self.connection).get(session_id=row['execution_session_id'], user_id=user_id) if row else None

    def record(self, *, user_id: str, request_id: str | None, session_id: str,
               action: str, timestamp: int) -> None:
        if request_id:
            self.connection.execute(
                'INSERT OR IGNORE INTO execution_requests (request_id,user_id,execution_session_id,action,created_at) VALUES (?,?,?,?,?)',
                (request_id, user_id, session_id, action, timestamp))
