"""Conversation metadata and keyset pagination, scoped by user and thread."""


class ChatThreadRepository:
    def __init__(self, connection):
        self.connection = connection

    def get(self, user_id, thread_id):
        return self.connection.execute(
            "SELECT * FROM chat_threads WHERE user_id=? AND id=?", (user_id, thread_id)).fetchone()

    def list(self, user_id):
        return self.connection.execute(
            "SELECT * FROM chat_threads WHERE user_id=? ORDER BY updated_at DESC,id DESC",
            (user_id,)).fetchall()

    def active(self, user_id):
        return self.connection.execute(
            "SELECT id FROM chat_threads WHERE user_id=? ORDER BY last_opened_at DESC,updated_at DESC,id DESC LIMIT 1",
            (user_id,)).fetchone()

    def insert(self, thread_id, user_id, title, timestamp):
        self.connection.execute(
            "INSERT INTO chat_threads (id,user_id,title,created_at,updated_at,last_opened_at) VALUES (?,?,?,?,?,?)",
            (thread_id, user_id, title, timestamp, timestamp, timestamp))

    def rename(self, user_id, thread_id, title, timestamp):
        self.connection.execute("UPDATE chat_threads SET title=?,updated_at=? WHERE user_id=? AND id=?",
                                (title, timestamp, user_id, thread_id))

    def activate(self, user_id, thread_id, timestamp):
        self.connection.execute("UPDATE chat_threads SET last_opened_at=? WHERE user_id=? AND id=?",
                                (timestamp, user_id, thread_id))

    def history_cursor(self, user_id, thread_id, before):
        return self.connection.execute(
            "SELECT created_at,id FROM chat_turns WHERE user_id=? AND thread_id=? AND id=?",
            (user_id, thread_id, before)).fetchone()

    def history(self, user_id, thread_id, limit, cursor=None):
        params = [user_id, thread_id]
        clause = ""
        if cursor is not None:
            clause = " AND (created_at < ? OR (created_at = ? AND id < ?))"
            params.extend([cursor["created_at"], cursor["created_at"], cursor["id"]])
        return self.connection.execute(
            "SELECT id,user_text,assistant_reply,created_at FROM chat_turns WHERE user_id=? AND thread_id=?"
            + clause + " ORDER BY created_at DESC,id DESC LIMIT ?", (*params, limit)).fetchall()
