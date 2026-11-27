"""Process-wide real/simulated clock with an explicit test-mode gate."""
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


class SharedClock:
    def __init__(self, *, base, scale, enabled, monotonic, safe_timezone, current_week):
        self.base = base
        self.scale = scale
        self.enabled = enabled
        self.monotonic = monotonic
        self.safe_timezone = safe_timezone
        self.current_week = current_week
        self.anchor = monotonic()
        self.lock = threading.RLock()

    def now(self, timezone_name=None):
        if timezone_name is None:
            target_timezone = None
        elif isinstance(timezone_name, ZoneInfo):
            target_timezone = timezone_name
        else:
            target_timezone = self.safe_timezone(str(timezone_name))
        if not self.enabled():
            return datetime.now(target_timezone).astimezone() if target_timezone is None else datetime.now(target_timezone)
        with self.lock:
            elapsed_real_seconds = max(self.monotonic() - self.anchor, 0)
            simulated = self.base + timedelta(minutes=elapsed_real_seconds * self.scale)
        return simulated.astimezone(target_timezone) if target_timezone else simulated

    def state(self):
        if not self.enabled():
            raise PermissionError("Test clock is disabled")
        return {
            "enabled": True,
            "simulated_now": self.now().isoformat(),
            "time_scale": self.scale,
            "week_id": self.current_week(self.now()),
        }

    def update(self, payload, *, allow_backward=False):
        if not self.enabled():
            raise PermissionError("Test clock is disabled")
        with self.lock:
            current = self.now()
            if payload.get("set_time") or payload.get("simulated_now"):
                candidate = datetime.fromisoformat(str(payload.get("set_time") or payload.get("simulated_now")))
                if candidate.tzinfo is None:
                    candidate = candidate.replace(tzinfo=ZoneInfo("Asia/Singapore"))
                current = candidate
            current += timedelta(
                days=float(payload.get("advance_days") or 0),
                minutes=float(payload.get("advance_minutes") or 0))
            if not allow_backward and current < self.now():
                raise ValueError("Backward time travel requires restoring an independent QA scenario snapshot")
            self.base = current
            self.anchor = self.monotonic()
            if payload.get("time_scale") is not None:
                self.scale = max(float(payload.get("time_scale") or 0), 0)
        return self.state()
