"""Memory persistence on a caller-owned SQLite connection."""
import sqlite3


class MemoryRepository:
    def insert(self, *, memory_id: str, user_id: str, source_type: str,
               source_id: str, task_id: str | None, text: str, metadata_json: str,
               embedding_json: str, created_at: int) -> None:
        self.connection.execute(
            "INSERT INTO memories (id,user_id,source_type,source_id,task_id,text,metadata_json,embedding_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (memory_id, user_id, source_type, source_id, task_id, text, metadata_json, embedding_json, created_at))

    def recent_for_user(self, *, user_id: str):
        return self.connection.execute(
            "SELECT * FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 200",
            (user_id,)).fetchall()

    def refresh_embeddings(self, *, user_id: str, records: list[tuple]) -> None:
        self.connection.executemany(
            "UPDATE memories SET metadata_json=?,embedding_json=? WHERE id=? AND user_id=?",
            [(metadata, embedding, memory_id, user_id) for metadata, embedding, memory_id in records])

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def latest_context_dump(self, *, user_id: str, source_id: str):
        return self.connection.execute(
            "SELECT * FROM memories WHERE user_id=? AND source_type='context_dump' AND source_id=? ORDER BY created_at DESC LIMIT 1",
            (user_id, source_id)).fetchone()
