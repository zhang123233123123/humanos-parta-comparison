"""SQLite persistence operations for Task aggregates."""

from __future__ import annotations

import sqlite3
import json
from ..domain.task.context_fields import validate_task_context


class TaskRepository:
    """Task persistence bound to a caller-owned transaction."""

    def mark_scheduled(self, *, user_id, task_id, timestamp):
        self.connection.execute(
            "UPDATE tasks SET status='scheduled',updated_at=? WHERE id=? AND user_id=?",
            (timestamp, task_id, user_id))

    def save_feedback(self, *, user_id, task_id, execution_json, demand_json, status,
                      difficulty, provenance_json, timestamp):
        self.connection.execute(
            "UPDATE tasks SET execution_json=?,demand_json=?,status=?,expected_difficulty=COALESCE(?,expected_difficulty),field_provenance_json=?,updated_at=? WHERE id=? AND user_id=?",
            (execution_json, demand_json, status, difficulty, provenance_json, timestamp, task_id, user_id))

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def find_create_request(self, *, user_id: str, request_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            'SELECT * FROM tasks WHERE user_id=? AND create_request_id=?',
            (user_id, request_id)).fetchone()

    def insert(self, record: dict) -> None:
        validate_task_context(json.loads(record['context_window_json']))
        columns = [
            'id', 'user_id', 'title', 'type', 'deadline_at', 'duration', 'priority', 'status',
            'context', 'context_window_json', 'cognitive_load', 'ambiguity', 'switch_cost',
            'reentry_cost', 'slot_json', 'checkpoints_json', 'demand_json', 'execution_json',
            'resource_modality_json', 'attention_mode', 'parallelizable', 'expected_difficulty',
            'week_id', 'removed_from_week', 'archived_at', 'create_request_id',
            'field_provenance_json', 'created_at', 'updated_at',
        ]
        if set(record) != set(columns):
            raise ValueError('task creation record must match persistence columns')
        placeholders = ', '.join('?' for _ in columns)
        self.connection.execute(
            f"INSERT INTO tasks ({', '.join(columns)}) VALUES ({placeholders})",
            [record[column] for column in columns])

    def update_fields(self, *, task_id: str, user_id: str, updates: dict) -> None:
        updates = dict(updates)
        if 'context_window_json' in updates:
            validate_task_context(json.loads(updates['context_window_json']))
        allowed = {
            'title', 'type', 'deadline_at', 'duration', 'priority', 'status', 'context',
            'cognitive_load', 'ambiguity', 'switch_cost', 'reentry_cost',
            'expected_difficulty', 'demand_json', 'slot_json', 'checkpoints_json',
            'context_window_json', 'execution_json', 'resource_modality_json',
            'attention_mode', 'parallelizable', 'field_provenance_json', 'updated_at',
        }
        if set(updates) - allowed:
            raise ValueError('unsupported task persistence field')
        if not updates:
            return
        assignments = ', '.join(f'{key}=?' for key in updates)
        self.connection.execute(f'UPDATE tasks SET {assignments} WHERE id=? AND user_id=?',
                                [*updates.values(), task_id, user_id])

    def archive(self, *, task_id: str, user_id: str, timestamp: int) -> None:
        self.connection.execute(
            'UPDATE tasks SET removed_from_week=1,archived_at=?,slot_json=?,updated_at=? WHERE id=? AND user_id=?',
            (timestamp, 'null', timestamp, task_id, user_id))

    def get_for_user(self, *, task_id: str, user_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            'SELECT * FROM tasks WHERE id=? AND user_id=?', (task_id, user_id)
        ).fetchone()

    def list_for_user(self, *, user_id: str) -> list[sqlite3.Row]:
        # Keep all persisted statuses; page-specific filtering belongs to callers.
        return self.connection.execute(
            'SELECT * FROM tasks WHERE user_id=? ORDER BY created_at ASC', (user_id,)
        ).fetchall()

    def active_for_week(self, *, user_id: str, week_id: str) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM tasks WHERE user_id=? AND week_id=? AND removed_from_week=0 AND status NOT IN ('completed','terminated')",
            (user_id, week_id),
        ).fetchall()

    def save_schedule_projection(
        self,
        *,
        task_id: str,
        user_id: str,
        slot_json: str,
        execution_json: str,
        status: str,
        timestamp: int,
    ) -> None:
        self.connection.execute(
            "UPDATE tasks SET slot_json=?,execution_json=?,status=?,updated_at=? WHERE id=? AND user_id=?",
            (slot_json, execution_json, status, timestamp, task_id, user_id),
        )

    def save_execution_state(
        self,
        *,
        task_id: str,
        user_id: str,
        execution_json: str,
        status: str,
        timestamp: int,
    ) -> None:
        self.connection.execute(
            "UPDATE tasks SET status=?,execution_json=?,updated_at=? WHERE id=? AND user_id=?",
            (status, execution_json, timestamp, task_id, user_id),
        )
