"""Legacy pending-batch storage; connection and transaction belong to the caller."""


class PendingTaskBatchRepository:
    def __init__(self, connection):
        self.connection = connection

    def ensure_legacy(self, user_id, created_at, updated_at):
        self.connection.execute(
            "INSERT OR IGNORE INTO chat_threads (id,user_id,title,created_at,updated_at) VALUES ('legacy',?,'历史对话',?,?)",
            (user_id, created_at, updated_at),
        )

    def supersede(self, timestamp, user_id, thread_id):
        self.connection.execute(
            "UPDATE pending_task_batches SET status='superseded',updated_at=? WHERE user_id=? AND thread_id=? AND status='awaiting_clarification'",
            (timestamp, user_id, thread_id),
        )

    def insert(self, batch_id, user_id, source_text, tasks_json, missing_json, status, created_at, updated_at, thread_id):
        self.connection.execute(
            "INSERT INTO pending_task_batches (id,user_id,source_text,tasks_json,missing_fields_json,status,created_at,updated_at,thread_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (batch_id, user_id, source_text, tasks_json, missing_json, status, created_at, updated_at, thread_id),
        )

    def latest(self, user_id, thread_id):
        return self.connection.execute(
            "SELECT * FROM pending_task_batches WHERE user_id=? AND thread_id=? AND status='awaiting_clarification' ORDER BY updated_at DESC LIMIT 1",
            (user_id, thread_id),
        ).fetchone()

    def complete(self, tasks_json, missing_json, status, timestamp, batch_id, user_id):
        self.connection.execute(
            "UPDATE pending_task_batches SET tasks_json=?,missing_fields_json=?,status=?,updated_at=? WHERE id=? AND user_id=?",
            (tasks_json, missing_json, status, timestamp, batch_id, user_id),
        )
