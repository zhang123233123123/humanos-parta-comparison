"""Process-local scheduling admission; slow work never holds the registry lock."""
from contextlib import contextmanager
from dataclasses import dataclass, field
import threading


@dataclass
class _UserEntry:
    lock: object = field(default_factory=threading.Lock)
    references: int = 0


class UserSchedulingGate:
    def __init__(self, max_concurrent: int = 4):
        if type(max_concurrent) is not int or not 1 <= max_concurrent <= 32:
            raise ValueError('HUMANOS_SCHEDULE_MAX_CONCURRENCY must be an integer from 1 to 32')
        self.max_concurrent = max_concurrent
        self._capacity = threading.BoundedSemaphore(max_concurrent)
        self._registry_lock = threading.Lock()
        self._users: dict[str, _UserEntry] = {}

    @classmethod
    def from_environment(cls, environment):
        value = environment.get('HUMANOS_SCHEDULE_MAX_CONCURRENCY', '4')
        try:
            return cls(int(value))
        except (ValueError, TypeError):
            raise ValueError('HUMANOS_SCHEDULE_MAX_CONCURRENCY must be an integer from 1 to 32') from None

    @contextmanager
    def for_user(self, user_id: str):
        with self._registry_lock:
            entry = self._users.setdefault(user_id, _UserEntry())
            entry.references += 1
        try:
            # Duplicates wait outside capacity, leaving room for other users.
            with entry.lock:
                with self._capacity:
                    yield
        finally:
            with self._registry_lock:
                entry.references -= 1
                if entry.references == 0:
                    del self._users[user_id]
