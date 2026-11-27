"""Legacy draft schema and one-time data recovery, without worker side effects."""
import json

from ..repositories.task_drafts import register


def migrate(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS task_drafts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, thread_id TEXT NOT NULL,
        batch_id TEXT NOT NULL, preview_id TEXT NOT NULL, task_json TEXT NOT NULL,
        status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        task_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(user_id,batch_id,preview_id))''')
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(task_drafts)')}
    if 'schedule_job_id' not in columns:
        conn.execute('ALTER TABLE task_drafts ADD COLUMN schedule_job_id TEXT')
        # Recover links created by earlier versions, without executing jobs.
        for job in conn.execute("SELECT id,user_id,payload_json,request_id FROM background_jobs WHERE kind='schedule_plan' ORDER BY created_at,id"):
            payload = json.loads(job['payload_json'])
            draft_id = payload.get('draft_id')
            if not draft_id and str(job['request_id'] or '').startswith('draft-plan:'):
                draft_id = job['request_id'][len('draft-plan:'):]
            if draft_id:
                conn.execute("UPDATE task_drafts SET schedule_job_id=? WHERE user_id=? AND id=? AND status='submitted'", (job['id'],job['user_id'],draft_id))
    # Only live legacy proposals are imported. Superseded history stays history.
    for row in conn.execute("SELECT * FROM pending_task_batches WHERE status IN ('awaiting_clarification','resolved')"):
        register(conn, row['user_id'], row['thread_id'], row['id'], json.loads(row['tasks_json']), row['created_at'])
