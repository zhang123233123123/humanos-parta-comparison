"""Persist an execution transition and its evidence in the caller's transaction."""
import sqlite3
from collections.abc import Callable

from ..repositories.state_transitions import StateTransitionRepository
from ..repositories.tasks import TaskRepository


def insert_execution_transition(
    conn: sqlite3.Connection, *, user_id: str, task_id: str | None,
    before_status: str, action_type: str, after_status: str,
    make_id: Callable, now: Callable, encode: Callable,
    project_task: Callable, enqueue_personalization: Callable,
    execution_session_id: str | None = None, action_detail: dict | None = None,
    outcome: dict | None = None, created_at: int | None = None,
    trusted_execution_transition: bool = True,
) -> dict:
    # Preserve the existing event shape and default/merge precedence.
    transition = {
        "id": make_id("transition"),
        "user_id": user_id,
        "task_id": task_id,
        "before_state": {"execution_status": before_status},
        "action": {"type": action_type, "execution_session_id": execution_session_id, **(action_detail or {})},
        "predicted_state": {"execution_status": after_status},
        "actual_state": {"execution_status": after_status},
        "outcome": outcome or {"persisted": True},
        "created_at": created_at or now(),
    }
    StateTransitionRepository(conn).insert(
        transition_id=transition["id"], user_id=user_id, task_id=task_id,
        before_json=encode(transition["before_state"]),
        action_json=encode(transition["action"]),
        predicted_json=encode(transition["predicted_state"]),
        actual_json=encode(transition["actual_state"]),
        outcome_json=encode(transition["outcome"]), created_at=transition["created_at"],
    )
    task_row = TaskRepository(conn).get_for_user(task_id=task_id, user_id=user_id) if task_id else None
    enqueue_personalization(
        conn, user_id=user_id, kind="execution_transition",
        source_id=transition["id"], timestamp=transition["created_at"],
        payload={"transition": transition, "task": project_task(task_row) if task_row else None,
                 "trusted_execution_transition": trusted_execution_transition},
    )
    return transition
