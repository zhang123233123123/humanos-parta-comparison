"""Ad-hoc session preparation and observed parallel context.

Preparation is not execution. Overlap is derived only from recorded timestamps.
"""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.tasks import TaskRepository


@dataclass(frozen=True)
class ExecutionContextPorts:
    get_task: Callable
    connect: Callable
    execution_session_row: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    make_id: Callable
    now: Callable
    current_week: Callable
    decode: Callable


def ensure_execution_session(user_id: str, payload: dict, *, ports: ExecutionContextPorts) -> dict:
    task_id = str(payload.get("task_id") or "").strip()
    if not task_id:
        raise ValueError("task_id is required")
    task = ports.get_task(task_id, user_id)
    if not task:
        raise KeyError(task_id)
    with ports.connect() as conn:
        existing = ExecutionSessionRepository(conn).latest_open_for_task(user_id=user_id, task_id=task_id)
        if existing:
            return ports.execution_session_row(existing)
    context = dict(task.get("contextWindow") or {})
    profile = ports.ensure_profile(user_id)
    current = ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai")
    start_value = task.get("start_at") or context.get("startAt") or context.get("start_at")
    start = datetime.fromisoformat(str(start_value).replace("Z", "+00:00")) if start_value else current
    if start.tzinfo is None:
        start = start.replace(tzinfo=current.tzinfo)
    duration = max(int(task.get("duration") or 60), 1)
    end_value = task.get("end_at") or task.get("end_time") or context.get("endAt") or context.get("end_at")
    end = datetime.fromisoformat(str(end_value).replace("Z", "+00:00")) if end_value else start + timedelta(minutes=duration)
    if end.tzinfo is None:
        end = end.replace(tzinfo=start.tzinfo)
    planned_minutes = max(round((end - start).total_seconds() / 60), 1)
    session_id = ports.make_id("exec")
    timestamp = ports.now()
    week_id = str(task.get("week_id") or profile.get("active_week_id") or ports.current_week(start))
    revision = int(profile.get("active_plan_revision") or 0)
    with ports.connect() as conn:
        ExecutionSessionRepository(conn).insert_adhoc(
            (session_id, user_id, task_id, f"adhoc-{task_id}-{timestamp}", week_id, revision, start.isoformat(), end.isoformat(), planned_minutes, "ready", timestamp, timestamp),
        )
        TaskRepository(conn).mark_scheduled(user_id=user_id, task_id=task_id, timestamp=timestamp)
        row = ExecutionSessionRepository(conn).get(session_id=session_id, user_id=user_id)
    return ports.execution_session_row(row)

def execution_parallel_context(user_id: str, session, *, ports: ExecutionContextPorts) -> dict:
    """Derive actual co-execution from persisted Session timestamps."""
    planned = dict(ports.decode(session["parallel_context_json"], {}))
    base = {
        **planned,
        "planned_parallel": bool(planned.get("planned_parallel")),
        "actual_parallel": False,
        "observed_overlap_minutes": 0,
        "partner_session_ids": [],
        "attribution": "independent",
        "derived_by": "backend_session_overlap",
    }
    group_id = str(planned.get("parallel_group_id") or "")
    if not group_id or not planned.get("planned_parallel") or not session["actual_start_at"]:
        return base
    with ports.connect() as conn:
        candidates = ExecutionSessionRepository(conn).other_revision_sessions(
            user_id=user_id, revision=session["plan_revision"], session_id=session["id"])
    current = ports.user_clock_now(user_id, ports.ensure_profile(user_id).get("timezone") or "Asia/Shanghai")

    def parsed(value: str | None, fallback: datetime) -> datetime:
        if not value:
            return fallback
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result.replace(tzinfo=fallback.tzinfo) if result.tzinfo is None else result

    source_start = parsed(session["actual_start_at"], current)
    source_end = parsed(session["actual_end_at"], current)
    overlap_seconds = 0.0
    partners = []
    for candidate in candidates:
        context = dict(ports.decode(candidate["parallel_context_json"], {}))
        if str(context.get("parallel_group_id") or "") != group_id or not candidate["actual_start_at"]:
            continue
        partner_start = parsed(candidate["actual_start_at"], current)
        partner_end = parsed(candidate["actual_end_at"], current)
        seconds = max((min(source_end, partner_end) - max(source_start, partner_start)).total_seconds(), 0)
        if seconds > 0:
            overlap_seconds += seconds
            partners.append(str(candidate["id"]))
    overlap_minutes = int(overlap_seconds // 60)
    if overlap_seconds > 0:
        base.update({
            "actual_parallel": True,
            "observed_overlap_minutes": max(overlap_minutes, 1),
            "partner_session_ids": sorted(partners),
            "attribution": "parallel",
        })
    return base
