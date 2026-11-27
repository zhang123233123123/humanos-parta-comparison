"""Feedback records; no business policy or independent commits."""
import sqlite3


class ExecutionFeedbackRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def find_request(self, *, user_id: str, request_id: str):
        return self.connection.execute(
            "SELECT * FROM execution_feedback WHERE user_id=? AND request_id=?",
            (user_id, request_id)).fetchone()

    def insert(self, record: dict) -> None:
        columns = ("id", "user_id", "task_id", "trigger", "task_evaluation_json",
                   "state_evaluation_json", "recommendation_evaluation_json",
                   "execution_session_id", "request_id", "research_context_revision",
                   "profile_trait_refs_json", "execution_context_json", "created_at")
        if set(record) != set(columns):
            raise ValueError("execution feedback record must match persistence columns")
        self.connection.execute(
            f"INSERT INTO execution_feedback ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            [record[column] for column in columns])
