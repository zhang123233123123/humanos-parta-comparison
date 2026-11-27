"""Bounded, synchronized existence markers; persisted plans remain authoritative."""
import threading


class RequestReplayMarkers:
    def __init__(self, capacity: int = 64):
        if capacity < 1:
            raise ValueError('Replay marker capacity must be positive')
        self._capacity = capacity
        self._markers: dict[str, None] = {}
        self._lock = threading.Lock()

    def __contains__(self, key):
        with self._lock:
            return key in self._markers

    def __len__(self):
        with self._lock:
            return len(self._markers)

    def remember(self, key: str):
        with self._lock:
            self._markers[key] = None
            while len(self._markers) > self._capacity:
                del self._markers[next(iter(self._markers))]
