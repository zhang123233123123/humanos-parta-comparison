"""Weekly setup persistence, bound to one caller-owned connection."""
import json
from ..domain.task.context_fields import validate_task_context


class WeeklyReconciliationRepository:
    def __init__(self, connection):
        self.connection = connection

    def update_task(self, task_id, user_id, values):
        values = dict(values)
        if 'context_window_json' in values:
            validate_task_context(json.loads(values['context_window_json']))
        allowed = {"title", "deadline_at", "duration", "priority", "context", "cognitive_load", "expected_difficulty", "context_window_json", "demand_json", "execution_json", "week_id", "removed_from_week", "archived_at", "updated_at", "slot_json", "status"}
        if set(values) - allowed:
            raise ValueError("unsupported weekly task field")
        assignments = ", ".join(f"{key}=?" for key in values)
        self.connection.execute(f"UPDATE tasks SET {assignments} WHERE id=? AND user_id=?", [*values.values(), task_id, user_id])

    def tasks(self, user_id):
        return self.connection.execute(
            "SELECT * FROM tasks WHERE user_id=?",
            (user_id,),
        ).fetchall()

    def insert_task(self, task_id,user_id,title,domain_type,deadline_at,duration,priority,status,context,context_json,cognitive_load,ambiguity,switch_cost,reentry_cost,slot_json,checkpoints_json,demand_json,execution_json,resources_json,parallelizable,difficulty,week_id,removed,archived,request_id,created_at,updated_at):
        validate_task_context(json.loads(context_json))
        self.connection.execute(
            """INSERT INTO tasks (
                  id,user_id,title,type,deadline_at,duration,priority,status,context,
                  context_window_json,cognitive_load,ambiguity,switch_cost,reentry_cost,
                  slot_json,checkpoints_json,demand_json,execution_json,
                  resource_modality_json,parallelizable,expected_difficulty,
                  week_id,removed_from_week,archived_at,create_request_id,created_at,updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (task_id,user_id,title,domain_type,deadline_at,duration,priority,status,context,context_json,cognitive_load,ambiguity,switch_cost,reentry_cost,slot_json,checkpoints_json,demand_json,execution_json,resources_json,parallelizable,difficulty,week_id,removed,archived,request_id,created_at,updated_at,),
        )

    def archive_task(self, archived_at,slot_json,execution_json,updated_at,task_id,user_id):
        self.connection.execute(
            "UPDATE tasks SET removed_from_week=1, archived_at=?, slot_json=?, execution_json=?, updated_at=? WHERE id=? AND user_id=?",
            (archived_at,slot_json,execution_json,updated_at,task_id,user_id,),
        )

    def invalidate_task(self, slot_json,execution_json,updated_at,task_id,user_id):
        self.connection.execute(
            "UPDATE tasks SET slot_json=?, execution_json=?, status='queued', updated_at=? WHERE id=? AND user_id=?",
            (slot_json,execution_json,updated_at,task_id,user_id,),
        )

    def update_profile(self, role,deep_work_window,low_energy_window,control_preference,blockers,preferences,weekly_json,patterns_json,timezone_name,week_id,updated_at,user_id):
        self.connection.execute(
            """UPDATE profiles SET role=?,deep_work_window=?,low_energy_window=?,control_preference=?,
               blocker_patterns=?,task_preferences=?,weekly_context_json=?,learned_patterns_json=?,timezone=?,
               active_week_id=?,updated_at=? WHERE user_id=?""",
            (role,deep_work_window,low_energy_window,control_preference,blockers,preferences,weekly_json,patterns_json,timezone_name,week_id,updated_at,user_id,),
        )

    def invalidate_confirmed(self, timestamp,user_id,week_id):
        self.connection.execute(
            "UPDATE plans SET plan_status='needs_update', updated_at=? WHERE user_id=? AND week_id=? AND plan_status='confirmed'",
            (timestamp,user_id,week_id,),
        )

    def supersede_proposed(self, timestamp,user_id,week_id):
        self.connection.execute(
            "UPDATE plans SET plan_status='superseded', updated_at=? WHERE user_id=? AND week_id=? AND plan_status='proposed'",
            (timestamp,user_id,week_id,),
        )

    def clear_revision(self, user_id):
        self.connection.execute(
            "UPDATE profiles SET active_plan_revision=NULL WHERE user_id=?",
            (user_id,),
        )

    def record_event(self, event_id,user_id,event_type,payload_json,timestamp):
        self.connection.execute(
            "INSERT INTO events (id,user_id,type,payload_json,created_at) VALUES (?,?,?,?,?)",
            (event_id,user_id,event_type,payload_json,timestamp,),
        )
