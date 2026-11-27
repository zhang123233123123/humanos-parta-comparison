"""Conversation record SQL; no independent connection or commit."""


class ChatRecordRepository:
    def finalize_job_reply(self, *, user_id, request_id, thread_id, reply, task_ids_json):
        self.connection.execute(
            'UPDATE chat_turns SET assistant_reply=?,task_ids_json=? WHERE user_id=? AND request_id=? AND thread_id=?',
            (reply, task_ids_json, user_id, request_id, thread_id))

    def __init__(self, connection):
        self.connection = connection

    def replay(self, user_id, request_id):
        return self.connection.execute(
            "SELECT * FROM chat_turns WHERE user_id=? AND request_id=?", (user_id, request_id),
        ).fetchone()

    def ensure_legacy(self, user_id, timestamp):
        self.connection.execute(
            "INSERT OR IGNORE INTO chat_threads (id,user_id,title,created_at,updated_at) VALUES ('legacy',?,'历史对话',?,?)",
            (user_id, timestamp, timestamp),
        )

    def touch_thread(self, user_id, thread_id, timestamp):
        self.connection.execute(
            "UPDATE chat_threads SET updated_at=?,last_opened_at=? WHERE user_id=? AND id=?",
            (timestamp, timestamp, user_id, thread_id),
        )

    def insert(self, turn, features_json, task_ids_json):
        self.connection.execute(
            "INSERT INTO chat_turns (id,user_id,request_id,user_text,assistant_reply,intent,features_json,task_ids_json,created_at,thread_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (turn["id"], turn["user_id"], turn["request_id"], turn["user_text"],
             turn["assistant_reply"], turn["intent"], features_json, task_ids_json,
             turn["created_at"], turn["thread_id"]),
        )

    def list(self, user_id, thread_id, limit):
        return self.connection.execute(
            "SELECT * FROM chat_turns WHERE user_id=? AND thread_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
            (user_id, thread_id, limit),
        ).fetchall()

    def recent_task_ids(self, user_id, thread_id):
        return self.connection.execute(
            "SELECT task_ids_json FROM chat_turns WHERE user_id=? AND thread_id=? ORDER BY created_at DESC,id DESC LIMIT 6",
            (user_id, thread_id),
        ).fetchall()
