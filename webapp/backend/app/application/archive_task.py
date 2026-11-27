"""Archive a task and invalidate its live schedule, without deleting history."""
from collections.abc import Callable
from contextlib import AbstractContextManager
import sqlite3

from ..repositories.tasks import TaskRepository
from ..repositories.plans import PlanRepository
from ..repositories.execution_sessions import ExecutionSessionRepository


def archive_task(task_id: str, user_id: str, *,
                 get_task: Callable[[str, str], dict | None],
                 connect: Callable[[], AbstractContextManager[sqlite3.Connection]],
                 now: Callable[[], int], current_week: Callable[[], str],
                 user_timestamp: Callable[[str], str], log_event: Callable) -> dict:
    current = get_task(task_id, user_id)
    if not current:
        raise KeyError(task_id)
    timestamp = now()
    with connect() as conn:
        TaskRepository(conn).archive(task_id=task_id, user_id=user_id, timestamp=timestamp)
        PlanRepository(conn).mark_needs_update(user_id=user_id,
            week_id=current.get('week_id') or current_week(), timestamp=timestamp)
        ExecutionSessionRepository(conn).retire_archived_task(user_id=user_id,
            task_id=task_id, paused_at=user_timestamp(user_id), timestamp=timestamp)
    # Preserve the existing event boundary; this refactor does not add an outbox.
    log_event(current['user_id'], 'task_archived', {'task_id': task_id, 'title': current['title']})
    return {'id': task_id, 'deleted': False, 'archived': True}
