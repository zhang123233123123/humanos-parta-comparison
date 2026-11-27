"""Event writes on a caller-owned transaction."""
import sqlite3


class EventRepository:
    def recovery_feedback(self, user_id):
        return self.connection.execute(
            "SELECT type,payload_json,created_at FROM events WHERE user_id=? AND type IN ('help_decide_recommendation_feedback','execution_feedback_saved') ORDER BY created_at DESC",
            (user_id,)).fetchall()

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def insert(self, *, event_id: str, user_id: str, event_type: str,
               payload_json: str, timestamp: int) -> None:
        self.connection.execute(
            'INSERT INTO events (id,user_id,type,payload_json,created_at) VALUES (?,?,?,?,?)',
            (event_id, user_id, event_type, payload_json, timestamp))
