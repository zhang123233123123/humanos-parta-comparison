"""Interruption recovery persistence on the execution transaction."""
import sqlite3


class InterruptionEpisodeRepository:
    def list_for_user(self, user_id):
        return self.connection.execute(
            "SELECT * FROM interruption_episodes WHERE user_id=? ORDER BY created_at DESC",
            (user_id,)).fetchall()

    def latest_open_for_task(self, *, user_id: str, task_id: str):
        return self.connection.execute(
            "SELECT * FROM interruption_episodes WHERE user_id=? AND task_id=? AND status IN ('pending','resumed') ORDER BY created_at DESC LIMIT 1",
            (user_id, task_id)).fetchone()

    def mark_guidance(self, *, user_id: str, episode_id: str, generated_at: str, timestamp: int):
        self.connection.execute(
            "UPDATE interruption_episodes SET reentry_guidance_generated_at=?,updated_at=? WHERE id=? AND user_id=?",
            (generated_at, timestamp, episode_id, user_id))

    def latest_settled(self, *, user_id, session_id):
        return self.connection.execute(
            "SELECT * FROM interruption_episodes WHERE user_id=? AND resumed_execution_session_id=? AND status='settled' ORDER BY updated_at DESC LIMIT 1",
            (user_id, session_id)).fetchone()

    def settle_feedback(self, *, user_id, episode_id, outcome_json, settled_at, timestamp):
        self.connection.execute(
            "UPDATE interruption_episodes SET status='settled',outcome_json=?,settled_at=?,updated_at=? WHERE id=? AND user_id=?",
            (outcome_json, settled_at, timestamp, episode_id, user_id))

    def find_request(self, *, user_id, request_id):
        return self.connection.execute(
            "SELECT * FROM interruption_episodes WHERE user_id=? AND request_id=?",
            (user_id, request_id)).fetchone()

    def active_recovery(self, *, user_id, session_id):
        return self.connection.execute(
            "SELECT * FROM interruption_episodes WHERE user_id=? AND resumed_execution_session_id=? AND status='resumed' ORDER BY updated_at DESC LIMIT 1",
            (user_id, session_id)).fetchone()

    def latest_source(self, *, user_id, session_id):
        return self.connection.execute(
            "SELECT * FROM interruption_episodes WHERE user_id=? AND source_execution_session_id=? ORDER BY created_at DESC LIMIT 1",
            (user_id, session_id)).fetchone()

    def settle_reinterrupted(self, values):
        self.connection.execute("UPDATE interruption_episodes SET status='settled',outcome_json=?,settled_at=?,updated_at=? WHERE id=?", values)

    def insert_pending(self, values):
        self.connection.execute("INSERT INTO interruption_episodes (id,user_id,task_id,source_execution_session_id,interruption_action,pause_reason,paused_at,remaining_minutes,task_demand_snapshot_json,runtime_state_snapshot_json,profile_trait_refs_json,status,request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", values)

    def link_context(self, *, user_id, episode_id, context_id, timestamp):
        self.connection.execute(
            "UPDATE interruption_episodes SET context_dump_id=?,updated_at=? WHERE id=? AND user_id=?",
            (context_id, timestamp, episode_id, user_id))

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def latest_resumed(self, *, user_id, session_id):
        return self.connection.execute(
            'SELECT * FROM interruption_episodes WHERE user_id=? AND resumed_execution_session_id=? ORDER BY updated_at DESC LIMIT 1',
            (user_id, session_id)).fetchone()

    def pending_for_resume(self, *, user_id, session):
        source_ids = [str(session['id'])]
        if session['resumed_from_session_id']:
            source_ids.append(str(session['resumed_from_session_id']))
        placeholders = ','.join('?' for _ in source_ids)
        return self.connection.execute(
            f"SELECT * FROM interruption_episodes WHERE user_id=? AND source_execution_session_id IN ({placeholders}) AND status='pending' ORDER BY created_at DESC LIMIT 1",
            (user_id, *source_ids)).fetchone()

    def mark_resumed(self, *, user_id, episode_id, session_id, resumed_at, latency, active_minutes, timestamp):
        self.connection.execute(
            "UPDATE interruption_episodes SET status='resumed',resumed_execution_session_id=?,resumed_at=?,resume_latency_minutes=?,active_minutes_before_resume=?,updated_at=? WHERE id=? AND user_id=?",
            (session_id, resumed_at, latency, active_minutes, timestamp, episode_id, user_id))

    def get(self, *, user_id, episode_id):
        return self.connection.execute('SELECT * FROM interruption_episodes WHERE id=? AND user_id=?',
                                       (episode_id, user_id)).fetchone()
