"""Owner-scoped cross-week preview receipts and selected-task transfer."""
import json

class CrossWeekRepository:
    def __init__(self, conn):
        self.conn = conn

    def event(self, user_id, preview_id, event_type):
        row = self.conn.execute("SELECT payload_json FROM events WHERE user_id=? AND type=? AND json_extract(payload_json,'$.preview_id')=? ORDER BY created_at DESC LIMIT 1", (user_id,event_type,preview_id)).fetchone()
        return json.loads(row['payload_json']) if row else None

    def transfer(self, user_id, task_ids, source_week, week_id, weekly_context, timestamp):
        self.conn.execute("UPDATE plans SET plan_status='superseded',updated_at=? WHERE user_id=? AND week_id=? AND plan_status='proposed'", (timestamp,user_id,source_week))
        for task_id in task_ids:
            self.conn.execute("UPDATE tasks SET week_id=?,slot_json='null',status='queued',updated_at=? WHERE user_id=? AND id=?", (week_id,timestamp,user_id,task_id))
        self.conn.execute('UPDATE profiles SET weekly_context_json=?,updated_at=? WHERE user_id=?', (json.dumps(weekly_context,ensure_ascii=False),timestamp,user_id))
