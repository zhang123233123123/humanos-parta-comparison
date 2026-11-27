"""Profile persistence bound to the application-owned transaction."""
import sqlite3


class ProfileRepository:
    def get(self, *, user_id: str):
        return self.connection.execute("SELECT * FROM profiles WHERE user_id=?", (user_id,)).fetchone()

    def upsert(self, record: dict) -> None:
        columns = ("user_id", "role", "deep_work_window", "low_energy_window", "control_preference",
                   "blocker_patterns", "task_preferences", "weekly_context_json", "learned_patterns_json",
                   "timezone", "active_week_id", "active_plan_revision", "last_daily_checkin_date",
                   "research_context_json", "research_context_revision", "created_at", "updated_at")
        if set(record) != set(columns):
            raise ValueError("profile record must match persistence columns")
        updates = ", ".join(f"{name}=excluded.{name}" for name in columns if name not in {"user_id", "created_at"})
        self.connection.execute(
            f"INSERT INTO profiles ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) "
            f"ON CONFLICT(user_id) DO UPDATE SET {updates}", [record[name] for name in columns])

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def activate_plan(self, *, user_id: str, week_id: str, revision: int, timestamp: int) -> None:
        self.connection.execute(
            'UPDATE profiles SET active_week_id=?,active_plan_revision=?,updated_at=? WHERE user_id=?',
            (week_id, revision, timestamp, user_id))

    def invalidate_active_revision(self, *, user_id: str, timestamp: int) -> None:
        self.connection.execute(
            'UPDATE profiles SET active_plan_revision=NULL,updated_at=? WHERE user_id=?',
            (timestamp, user_id))
