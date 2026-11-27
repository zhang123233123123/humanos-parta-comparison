"""Test-account clock policies and explicit wall-clock dependency."""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..repositories.account_diagnostics import AccountDiagnosticsRepository


@dataclass(frozen=True)
class AccountClockPorts:
    user_row: Callable
    safe_timezone: Callable
    clock_now: Callable
    wall_time: Callable
    user_clock_now: Callable
    current_week: Callable
    connect: Callable
    user_clock_state: Callable
    log_event: Callable


def user_clock_now(identity: str, timezone_name: str | None = None, *, ports: AccountClockPorts) -> datetime:
    row = ports.user_row(identity)
    target_zone = ports.safe_timezone(timezone_name) if timezone_name else None
    if not row or row["account_type"] != "test" or not row["test_clock_base"]:
        return ports.clock_now(target_zone)
    base = datetime.fromisoformat(str(row["test_clock_base"]).replace("Z", "+00:00"))
    if base.tzinfo is None:
        base = base.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
    anchor_ms = int(row["test_clock_anchor_ms"] or int(ports.wall_time() * 1000))
    scale = max(float(row["test_time_scale"] or 0), 0)
    elapsed_minutes = max(int(ports.wall_time() * 1000) - anchor_ms, 0) / 60000 * scale
    current = base + timedelta(minutes=elapsed_minutes)
    return current.astimezone(target_zone) if target_zone else current

def user_clock_state(identity: str, *, ports: AccountClockPorts) -> dict:
    row = ports.user_row(identity)
    if not row or row["account_type"] != "test":
        raise PermissionError("not found")
    current = ports.user_clock_now(identity)
    return {
        "enabled": True,
        "simulated_now": current.isoformat(),
        "time_scale": float(row["test_time_scale"] or 0),
        "week_id": ports.current_week(current),
        "using_real_time": not bool(row["test_clock_base"]),
    }

def update_user_clock(identity: str, payload: dict, *, ports: AccountClockPorts) -> dict:
    row = ports.user_row(identity)
    if not row or row["account_type"] != "test":
        raise PermissionError("not found")
    if payload.get("use_real_time"):
        with ports.connect() as conn:
            AccountDiagnosticsRepository(conn).reset_clock(row["id"])
    else:
        current = ports.user_clock_now(identity)
        if payload.get("set_time") or payload.get("simulated_now"):
            current = datetime.fromisoformat(str(payload.get("set_time") or payload.get("simulated_now")).replace("Z", "+00:00"))
            if current.tzinfo is None:
                current = current.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
        current += timedelta(days=float(payload.get("advance_days") or 0), minutes=float(payload.get("advance_minutes") or 0))
        scale = max(float(payload.get("time_scale", row["test_time_scale"] or 0)), 0)
        with ports.connect() as conn:
            AccountDiagnosticsRepository(conn).update_clock(
                row["id"], current.isoformat(), int(ports.wall_time() * 1000), scale)
    state = ports.user_clock_state(identity)
    ports.log_event(identity, "test_clock_adjusted", {"simulated_now": state["simulated_now"], "time_scale": state["time_scale"], "using_real_time": state["using_real_time"]})
    return state
