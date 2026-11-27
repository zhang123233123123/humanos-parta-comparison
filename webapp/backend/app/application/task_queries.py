"""Read-only task use cases; persistence and projection are separate dependencies."""
from collections.abc import Callable
from contextlib import AbstractContextManager
import sqlite3
from ..repositories.tasks import TaskRepository


class TaskQueries:
    def __init__(self, *, connect: Callable[[], AbstractContextManager[sqlite3.Connection]],
                 project: Callable[[sqlite3.Row], dict]):
        self.connect = connect
        self.project = project

    def get(self, task_id: str, user_id: str) -> dict | None:
        with self.connect() as conn:
            row = TaskRepository(conn).get_for_user(task_id=task_id, user_id=user_id)
        return self.project(row) if row else None

    def list(self, user_id: str) -> list[dict]:
        with self.connect() as conn:
            rows = TaskRepository(conn).list_for_user(user_id=user_id)
        return [self.project(row) for row in rows]
