"""SQLite persistence operations for execution session lifecycle."""

from __future__ import annotations

import sqlite3


class ExecutionSessionRepository:
    def clear_resume(self, user_id, session_id):
        self.connection.execute('UPDATE execution_sessions SET resumed_at=NULL WHERE user_id=? AND id=?', (user_id, session_id))

    def set_confirmed_work(self, *, user_id, session_id, minutes, baseline_seconds, timestamp):
        self.connection.execute(
            "UPDATE execution_sessions SET confirmed_work_minutes=?,confirmed_work_baseline_seconds=?,updated_at=? WHERE id=? AND user_id=?",
            (minutes, baseline_seconds, timestamp, session_id, user_id))

    def latest_open_for_task(self, *, user_id, task_id):
        return self.connection.execute(
            "SELECT * FROM execution_sessions WHERE user_id=? AND task_id=? AND status IN ('ready','running','paused') ORDER BY updated_at DESC LIMIT 1",
            (user_id, task_id)).fetchone()

    def insert_adhoc(self, values):
        self.connection.execute(
            "INSERT INTO execution_sessions (id,user_id,task_id,block_id,week_id,plan_revision,planned_start_at,planned_end_at,planned_work_minutes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            values)

    def other_revision_sessions(self, *, user_id, revision, session_id):
        return self.connection.execute(
            "SELECT * FROM execution_sessions WHERE user_id=? AND plan_revision=? AND id<>?",
            (user_id, revision, session_id)).fetchall()

    def save_feedback(self, *, user_id, session_id, status, outcome, ended_at, actual_minutes, timestamp, snapshot_json):
        self.connection.execute(
            "UPDATE execution_sessions SET status=?,completion_outcome=?,actual_end_at=?,accumulated_active_minutes=?,interruption_snapshot_json=?,updated_at=? WHERE id=? AND user_id=?",
            (status, outcome, ended_at, actual_minutes, snapshot_json, timestamp, session_id, user_id))

    def save_pause(self, values):
        self.connection.execute("UPDATE execution_sessions SET status='paused',paused_at=?,resumed_at=NULL,accumulated_active_minutes=?,pause_reason=?,interruption_action=?,interruption_snapshot_json=?,resume_preference=?,preferred_resume_at=?,remaining_at_pause=?,updated_at=? WHERE id=? AND user_id=?", values)

    """Execution Session persistence bound to a caller-owned transaction."""

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def find_start_target(self, *, user_id, session_id, block_id):
        return self.connection.execute(
            'SELECT * FROM execution_sessions WHERE user_id=? AND (id=? OR block_id=?) ORDER BY updated_at DESC LIMIT 1',
            (user_id, session_id, block_id)).fetchone()

    def other_running(self, *, user_id, session_id):
        return self.connection.execute(
            "SELECT * FROM execution_sessions WHERE user_id=? AND status='running' AND id<>?",
            (user_id, session_id)).fetchall()

    def mark_running(self, *, session_id, user_id, actual_start, request_id, timestamp):
        self.connection.execute(
            "UPDATE execution_sessions SET status='running',actual_start_at=COALESCE(actual_start_at,?),resumed_at=?,paused_at=NULL,request_id=COALESCE(request_id,?),updated_at=? WHERE id=? AND user_id=?",
            (actual_start, actual_start, request_id, timestamp, session_id, user_id))

    def get(self, *, session_id: str, user_id: str) -> sqlite3.Row | None:
        return self.connection.execute('SELECT * FROM execution_sessions WHERE id=? AND user_id=?',
                                       (session_id, user_id)).fetchone()

    def mark_ended(self, *, session_id: str, user_id: str, ended_at: str,
                   active_minutes: int, timestamp: int) -> None:
        self.connection.execute(
            "UPDATE execution_sessions SET status='ended',actual_end_at=?,resumed_at=NULL,accumulated_active_minutes=?,completion_outcome=NULL,updated_at=? WHERE id=? AND user_id=?",
            (ended_at, active_minutes, timestamp, session_id, user_id))

    def list_for_user(self, *, user_id: str, statuses: list[str] | None = None) -> list[sqlite3.Row]:
        query = ('SELECT execution_sessions.*, tasks.title AS task_title FROM execution_sessions '
                 'LEFT JOIN tasks ON tasks.id=execution_sessions.task_id '
                 'AND tasks.user_id=execution_sessions.user_id WHERE execution_sessions.user_id=?')
        parameters = [user_id]
        if statuses:
            query += f" AND execution_sessions.status IN ({','.join('?' for _ in statuses)})"
            parameters.extend(statuses)
        return self.connection.execute(query + ' ORDER BY execution_sessions.planned_start_at', parameters).fetchall()

    def insert_legacy_ready(self, *, execution_id, user_id, task_id, block_id, week_id,
                            revision, start_at, end_at, planned_minutes, trait_refs_json,
                            parallel_context_json, timestamp):
        self.connection.execute(
            "INSERT INTO execution_sessions (id,user_id,task_id,block_id,week_id,plan_revision,planned_start_at,planned_end_at,planned_work_minutes,profile_trait_refs_json,parallel_context_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,block_id,plan_revision) DO NOTHING",
            (execution_id, user_id, task_id, block_id, week_id, revision, start_at, end_at,
             planned_minutes, trait_refs_json, parallel_context_json, 'ready', timestamp, timestamp))

    def retire_archived_task(self, *, user_id: str, task_id: str,
                            paused_at: str, timestamp: int) -> None:
        self.connection.execute(
            """UPDATE execution_sessions
               SET status='superseded', completion_outcome='task_deleted',
                   paused_at=CASE WHEN status='running' THEN ? ELSE paused_at END,
                   resumed_at=NULL, updated_at=?
               WHERE user_id=? AND task_id=?
                 AND status IN ('ready','running','paused','not_started')""",
            (paused_at, timestamp, user_id, task_id))

    def latest_paused_for_task(self, *, user_id: str, task_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM execution_sessions WHERE user_id=? AND task_id=? AND status='paused' ORDER BY updated_at DESC LIMIT 1",
            (user_id, task_id),
        ).fetchone()

    def revision_continuation_source(self, *, user_id, task_id, week_id, revision):
        return self.connection.execute(
            """SELECT * FROM execution_sessions
               WHERE user_id=? AND task_id=? AND week_id=? AND plan_revision<?
                 AND (remaining_at_pause IS NULL OR remaining_at_pause>0)
                 AND (status='paused' OR (status='ready' AND resumed_from_session_id IS NOT NULL))
               ORDER BY plan_revision DESC, updated_at DESC, id DESC LIMIT 1""",
            (user_id, task_id, week_id, revision)).fetchone()

    def upsert_ready(
        self,
        *,
        execution_id: str,
        user_id: str,
        task_id: str,
        block_id: str,
        week_id: str,
        revision: int,
        planned_start_at: str,
        planned_end_at: str,
        planned_work_minutes: int,
        resumed_from_session_id: str | None,
        accumulated_active_minutes: int = 0,
        remaining_at_pause: int | None = None,
        interruption_snapshot_json: str = "{}",
        profile_trait_refs_json: str = "[]",
        parallel_context_json: str = "{}",
        timestamp: int,
    ) -> None:
        self.connection.execute(
            "INSERT INTO execution_sessions (id,user_id,task_id,block_id,week_id,plan_revision,planned_start_at,planned_end_at,planned_work_minutes,resumed_from_session_id,accumulated_active_minutes,remaining_at_pause,interruption_snapshot_json,profile_trait_refs_json,parallel_context_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,block_id,plan_revision) DO UPDATE SET planned_start_at=excluded.planned_start_at,planned_end_at=excluded.planned_end_at,planned_work_minutes=excluded.planned_work_minutes,resumed_from_session_id=excluded.resumed_from_session_id,accumulated_active_minutes=excluded.accumulated_active_minutes,remaining_at_pause=excluded.remaining_at_pause,interruption_snapshot_json=excluded.interruption_snapshot_json,profile_trait_refs_json=excluded.profile_trait_refs_json,parallel_context_json=excluded.parallel_context_json,updated_at=excluded.updated_at",
            (
                execution_id, user_id, task_id, block_id, week_id, revision,
                planned_start_at, planned_end_at, planned_work_minutes,
                resumed_from_session_id, accumulated_active_minutes,
                remaining_at_pause, interruption_snapshot_json or "{}", profile_trait_refs_json or "[]", parallel_context_json or "{}",
                "ready", timestamp, timestamp,
            ),
        )

    def mark_continued_in_revision(self, *, session_id: str, timestamp: int) -> None:
        self.connection.execute(
            "UPDATE execution_sessions SET status='superseded',completion_outcome='continued_in_revision',updated_at=? WHERE id=?",
            (timestamp, session_id),
        )

    def supersede_older_future_sessions(
        self,
        *,
        user_id: str,
        week_id: str,
        active_revision: int,
        timestamp: int,
        preserved_ids=(),
    ) -> None:
        self.connection.execute(
            "UPDATE execution_sessions SET status='superseded',completion_outcome=CASE WHEN status='paused' THEN 'replaced_by_revision' ELSE completion_outcome END,updated_at=? WHERE user_id=? AND week_id=? AND plan_revision<>? AND status IN ('ready','paused')"
            + (f" AND id NOT IN ({','.join('?' for _ in preserved_ids)})" if preserved_ids else ''),
            (timestamp, user_id, week_id, active_revision, *preserved_ids),
        )
