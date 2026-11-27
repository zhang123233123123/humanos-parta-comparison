"""Week transition SQL, sharing the caller transaction."""


class WeekLifecycleRepository:
    def __init__(self, connection):
        self.connection = connection

    def archive_context(self, history_id,user_id,week_id,context_json,timestamp):
        self.connection.execute(
            "INSERT INTO weekly_context_history (id,user_id,week_id,weekly_context_json,archived_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,week_id) DO UPDATE SET weekly_context_json=excluded.weekly_context_json,archived_at=excluded.archived_at",
            (history_id,user_id,week_id,context_json,timestamp,),
        )

    def supersede_plans(self, timestamp,user_id,week_id):
        self.connection.execute(
            "UPDATE plans SET plan_status='superseded',updated_at=? WHERE user_id=? AND week_id=? AND plan_status IN ('confirmed','needs_update','proposed')",
            (timestamp,user_id,week_id,),
        )

    def supersede_ready_sessions(self, timestamp,user_id,week_id):
        self.connection.execute(
            "UPDATE execution_sessions SET status='superseded',updated_at=? WHERE user_id=? AND week_id=? AND status='ready'",
            (timestamp,user_id,week_id,),
        )

    def tasks(self, user_id,week_id):
        return self.connection.execute(
            "SELECT * FROM tasks WHERE user_id=? AND week_id=?",
            (user_id,week_id,),
        ).fetchall()

    def carry_task(self, week_id,slot_json,timestamp,task_id,user_id):
        self.connection.execute(
            "UPDATE tasks SET week_id=?,slot_json=?,status='queued',removed_from_week=0,archived_at=NULL,updated_at=? WHERE id=? AND user_id=?",
            (week_id,slot_json,timestamp,task_id,user_id,),
        )

    def archive_task(self, archived_at,slot_json,timestamp,task_id,user_id):
        self.connection.execute(
            "UPDATE tasks SET removed_from_week=1,archived_at=?,slot_json=?,updated_at=? WHERE id=? AND user_id=?",
            (archived_at,slot_json,timestamp,task_id,user_id,),
        )

    def update_profile(self, context_json,week_id,timestamp,user_id):
        self.connection.execute(
            "UPDATE profiles SET weekly_context_json=?,active_week_id=?,active_plan_revision=NULL,last_daily_checkin_date=NULL,updated_at=? WHERE user_id=?",
            (context_json,week_id,timestamp,user_id,),
        )
