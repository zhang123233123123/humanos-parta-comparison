"""Job lifecycle orchestration with explicit persistence and execution dependencies."""
from collections.abc import Callable
from contextlib import AbstractContextManager
import sqlite3
from typing import Any

from ..repositories.background_jobs import BackgroundJobRepository


class BackgroundJobRunner:
    def __init__(self, *, connect: Callable[[], AbstractContextManager[sqlite3.Connection]],
                 now: Callable[[], int], execute: Callable[[dict], tuple[dict, Any]],
                 finalize: Callable[[sqlite3.Connection, dict, dict, Any], None],
                 encode: Callable[[object], str]):
        self.connect = connect
        self.now = now
        self.execute = execute
        self.finalize = finalize
        self.encode = encode

    def run(self, job_id: str) -> None:
        timestamp = self.now()
        with self.connect() as conn:
            repository = BackgroundJobRepository(conn)
            # Claim before reading. A single conditional write serializes
            # competing workers without holding a lock across model calls.
            if not repository.mark_running(job_id, timestamp):
                return
            row = repository.get(job_id)
            job = dict(row)
        # Model calls and task workflows run outside the job-state transaction.
        try:
            result, finalization = self.execute(job)
            completed = self.now()
            with self.connect() as conn:
                self.finalize(conn, job, result, finalization)
                BackgroundJobRepository(conn).complete(job_id, self.encode(result), completed)
        except Exception as exc:
            completed = self.now()
            with self.connect() as conn:
                BackgroundJobRepository(conn).fail(job_id, f'{type(exc).__name__}: {exc}', completed)

    def resume(self, start: Callable[[str], None]) -> None:
        with self.connect() as conn:
            job_ids = BackgroundJobRepository(conn).recover_pending(self.now())
        for job_id in job_ids:
            start(job_id)
