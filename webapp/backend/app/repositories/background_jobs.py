"""Background-job SQL bound to a caller-owned connection and transaction."""
import sqlite3


class BackgroundJobRepository:
    def link_draft(self, job_id, draft_id, user_id):
        self.connection.execute('UPDATE task_drafts SET schedule_job_id=? WHERE id=? AND user_id=?',
                                (job_id, draft_id, user_id))

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def get(self, job_id, user_id=None):
        if user_id is not None:
            return self.connection.execute('SELECT * FROM background_jobs WHERE id=? AND user_id=?', (job_id, user_id)).fetchone()
        return self.connection.execute('SELECT * FROM background_jobs WHERE id=?', (job_id,)).fetchone()

    def find_request(self, user_id, kind, request_id):
        return self.connection.execute('SELECT id,payload_json FROM background_jobs WHERE user_id=? AND kind=? AND request_id=?', (user_id, kind, request_id)).fetchone()

    def has_newer_schedule(self, *, user_id, week_id, job_id):
        # rowid represents insertion order even when timestamps are equal.
        # The caller holds the publication write transaction.
        return self.connection.execute(
            """SELECT 1 FROM background_jobs
               WHERE user_id=? AND kind='schedule_plan'
                 AND json_extract(payload_json, '$.week_id')=?
                 AND rowid > (SELECT rowid FROM background_jobs WHERE id=? AND user_id=?)
               LIMIT 1""", (user_id, week_id, job_id, user_id)).fetchone() is not None

    def insert(self, job_id, user_id, kind, request_id, payload_json, timestamp):
        self.connection.execute(
            "INSERT INTO background_jobs (id,user_id,kind,request_id,status,payload_json,result_json,error,created_at,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (job_id, user_id, kind, request_id, 'queued', payload_json, None, None, timestamp, None, None, timestamp))

    def mark_running(self, job_id, timestamp):
        cursor = self.connection.execute(
            "UPDATE background_jobs SET status='running',started_at=?,updated_at=?,error=NULL WHERE id=? AND status='queued'",
            (timestamp, timestamp, job_id))
        return cursor.rowcount == 1

    def complete(self, job_id, result_json, timestamp):
        self.connection.execute("UPDATE background_jobs SET status='completed',result_json=?,completed_at=?,updated_at=? WHERE id=?", (result_json, timestamp, timestamp, job_id))

    def fail(self, job_id, error, timestamp):
        self.connection.execute("UPDATE background_jobs SET status='failed',error=?,completed_at=?,updated_at=? WHERE id=?", (error, timestamp, timestamp, job_id))

    def recover_pending(self, timestamp):
        rows = self.connection.execute("SELECT id FROM background_jobs WHERE status IN ('queued','running') ORDER BY created_at ASC").fetchall()
        self.connection.execute("UPDATE background_jobs SET status='queued',updated_at=? WHERE status='running'", (timestamp,))
        return [row['id'] for row in rows]
