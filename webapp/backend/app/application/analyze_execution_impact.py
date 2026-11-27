"""Collect execution impact inputs without changing the formal plan."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.execution_sessions import ExecutionSessionRepository


@dataclass(frozen=True)
class ExecutionImpactPorts:
    connect: Callable
    execution_session_row: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    get_task: Callable
    list_execution_sessions: Callable
    active_plan: Callable


def analyze_execution_impact(user_id: str, payload: dict, *, ports: ExecutionImpactPorts) -> dict:
    """Deterministically identify future Sessions affected by an execution change."""
    session_id = str(payload.get("execution_session_id") or "").strip()
    if not session_id:
        raise ValueError("execution_session_id is required")
    with ports.connect() as conn:
        row = ExecutionSessionRepository(conn).get(user_id=user_id, session_id=session_id)
    if not row:
        raise KeyError(session_id)
    session = ports.execution_session_row(row)
    profile = ports.ensure_profile(user_id)
    current = ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai")
    remaining_minutes = max(
        int(payload.get("remaining_minutes") if payload.get("remaining_minutes") is not None else session.get("session_remaining_minutes") or 0),
        0,
    )
    task = ports.get_task(str(session.get("task_id") or ""), user_id) or {}
    future = [
        item for item in ports.list_execution_sessions(user_id, ["ready", "paused", "running"])
        if item.get("execution_session_id") != session_id
        and item.get("planned_start_at")
    ]
    active = ports.active_plan(user_id, str(session.get("week_id") or "")) or {}
    from .execution_impact import assess_execution_impact

    impact = assess_execution_impact(
        current=current,
        session=session,
        task=task,
        future_sessions=future,
        active_plan=active,
        action=str(payload.get("action") or "resume"),
        remaining_minutes=remaining_minutes,
        change_minutes=max(int(payload.get("break_minutes") or payload.get("change_minutes") or remaining_minutes), 0),
        session_slack_minutes=max(int(payload.get("session_slack_minutes") or 0), 0),
    )
    from ..domain.execution.impact_confirmation import impact_token
    impact['confirmation_token'] = impact_token(impact)
    return impact
