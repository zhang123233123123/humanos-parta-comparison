"""Context checkpoint persistence on a caller-owned connection."""
import sqlite3


class ContextDumpRepository:
    def latest_for_task(self, *, user_id: str, task_id: str):
        return self.connection.execute(
            "SELECT * FROM context_dumps WHERE user_id=? AND task_id=? ORDER BY created_at DESC LIMIT 1",
            (user_id, task_id)).fetchone()

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def find_request(self, *, user_id: str, request_id: str):
        return self.connection.execute(
            "SELECT * FROM context_dumps WHERE user_id=? AND request_id=?",
            (user_id, request_id)).fetchone()

    def insert(self, record: dict) -> None:
        columns = ("id", "user_id", "task_id", "execution_session_id", "plan_revision",
                   "request_id", "checkpoint_type", "supersedes_dump_id", "metadata_json",
                   "progress", "open_questions", "next_action", "stop_reason", "materials", "created_at")
        if set(record) != set(columns):
            raise ValueError("context dump record must match persistence columns")
        self.connection.execute(
            f"INSERT INTO context_dumps ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            [record[column] for column in columns])
