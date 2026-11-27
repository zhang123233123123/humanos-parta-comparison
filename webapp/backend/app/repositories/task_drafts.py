"""Owner-scoped draft persistence; callers own transaction boundaries."""
import json
import time
import uuid


def register(conn, user, thread, batch, tasks, now=None):
    now = now or int(time.time() * 1000)
    for task in tasks:
        preview = str(task['id'])
        status = 'needs_input' if task.get('missing_fields') else 'ready'
        TaskDraftRepository(conn).insert('draft-' + uuid.uuid4().hex, user, thread, batch, preview,
                                         json.dumps(task, ensure_ascii=False), status, now)


class TaskDraftRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, user):
        return self.connection.execute('SELECT * FROM task_drafts WHERE user_id=? ORDER BY updated_at DESC,id DESC', (user,)).fetchall()

    def get(self, user, draft_id):
        return self.connection.execute('SELECT * FROM task_drafts WHERE user_id=? AND id=?', (user, draft_id)).fetchone()

    def profile_timezone(self, user):
        return self.connection.execute('SELECT timezone,weekly_context_json FROM profiles WHERE user_id=?', (user,)).fetchone()

    def scheduling_job(self, user, job_id):
        return self.connection.execute("SELECT status,result_json FROM background_jobs WHERE id=? AND user_id=? AND kind='schedule_plan'", (job_id, user)).fetchone()

    def plan_status(self, user, plan_id):
        return self.connection.execute('SELECT plan_status FROM plans WHERE id=? AND user_id=?', (plan_id, user)).fetchone()

    def insert(self, draft_id, user, thread, batch, preview, task_json, status, now):
        self.connection.execute('INSERT OR IGNORE INTO task_drafts (id,user_id,thread_id,batch_id,preview_id,task_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
                                (draft_id, user, thread, batch, preview, task_json, status, now, now))

    def update(self, user, draft_id, task_json, status, now):
        self.connection.execute('UPDATE task_drafts SET task_json=?,status=?,version=version+1,updated_at=? WHERE user_id=? AND id=?',
                                (task_json, status, now, user, draft_id))

    def has_open_batch(self, user, batch):
        return self.connection.execute("SELECT 1 FROM task_drafts WHERE user_id=? AND batch_id=? AND status NOT IN ('submitted','cancelled')", (user, batch)).fetchone() is not None

    def close_batch(self, user, batch, now):
        self.connection.execute("UPDATE pending_task_batches SET status='resolved',updated_at=? WHERE user_id=? AND id=?", (now, user, batch))

    def mark_submitted(self, user, draft_id, task_id, now):
        self.connection.execute("UPDATE task_drafts SET status='submitted',task_id=?,version=version+1,updated_at=? WHERE user_id=? AND id=?", (task_id, now, user, draft_id))
