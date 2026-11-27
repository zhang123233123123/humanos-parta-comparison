"""Storage resources shared by the application facade, with no business imports."""
from pathlib import Path
import os

from .sqlite_database import SQLiteDatabase
from .sqlite_schema import initialize_schema
from .chat_thread_schema import migrate_chat_threads
from .task_draft_schema import migrate as migrate_task_drafts
from .scheduling_concurrency import UserSchedulingGate
from .request_replay_markers import RequestReplayMarkers


class ApplicationStorage:
    def __init__(self, path: Path):
        self.path = path
        self.database = SQLiteDatabase(path)
        self.schedule_gate = UserSchedulingGate.from_environment(os.environ)
        self.schedule_request_cache = RequestReplayMarkers()
        self._transaction_state = self.database.transaction_state

    def connect(self):
        return self.database.connect()

    def atomic(self):
        return self.database.atomic()

    def init_db(self):
        with self.connect() as conn:
            initialize_schema(conn, migrate_chat_threads=migrate_chat_threads,
                              migrate_task_drafts=migrate_task_drafts)
