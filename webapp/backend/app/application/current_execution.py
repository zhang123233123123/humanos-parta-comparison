"""Current-session selection and legacy hydration; this use case is not read-only."""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.profiles import ProfileRepository
from ..domain.task.eligibility import execution_blockers


@dataclass(frozen=True)
class CurrentExecutionPorts:
    list_execution_sessions: Callable
    active_plan: Callable
    now: Callable
    connect: Callable
    make_id: Callable
    encode: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    get_task: Callable


def current_execution(user_id: str, *, ports: CurrentExecutionPorts) -> dict:
    sessions = ports.list_execution_sessions(user_id, ["running", "paused", "ended", "ready"])
    # Existing confirmed plans created before execution_sessions was added
    # are upgraded lazily. This preserves user data and avoids forcing a
    # plan regeneration merely to obtain Now / Up next state.
    if not sessions and not ports.list_execution_sessions(user_id):
        plan = ports.active_plan(user_id) or {}
        if plan.get("plan_status") == "confirmed" and plan.get("plan_patch"):
            timestamp = ports.now()
            with ports.connect() as conn:
                confirmed_trait_ids = ProfileRepository(conn).confirmed_trait_ids(user_id=user_id)
                for index, block in enumerate(plan.get("plan_patch") or []):
                    if not block.get("task_id"):
                        continue
                    execution_id = ports.make_id("exec")
                    block_id = str(block.get("block_id") or f"{block.get('task_id')}-r{plan.get('plan_revision')}-{index + 1}")
                    planned_minutes = int(block.get("planned_work_minutes") or block.get("session_minutes") or round((float(block.get("end", 0)) - float(block.get("start", 0))) * 60))
                    ExecutionSessionRepository(conn).insert_legacy_ready(
                        execution_id=execution_id, user_id=user_id, task_id=str(block.get("task_id")),
                        block_id=block_id, week_id=str(plan.get("week_id") or ""),
                        revision=int(plan.get("plan_revision") or 0),
                        start_at=str(block.get("start_at") or ""), end_at=str(block.get("end_at") or ""),
                        planned_minutes=planned_minutes,
                        trait_refs_json=ports.encode(sorted({str(item) for item in block.get("applied_profile_trait_ids") or [] if str(item) in confirmed_trait_ids})),
                        parallel_context_json=ports.encode({"planned_parallel": bool(block.get("parallel_group_id") and block.get("parallel_user_confirmed")), "parallel_group_id": block.get("parallel_group_id"), "parallel_role": block.get("parallel_role"), "partner_task_ids": [str(item) for item in block.get("parallel_task_ids") or [] if str(item) != str(block.get("task_id"))], "source": "confirmed_plan"}),
                        timestamp=timestamp)
            sessions = ports.list_execution_sessions(user_id, ["running", "paused", "ended", "ready"])
    running = [item for item in sessions if item["status"] == "running"]
    paused = [item for item in sessions if item["status"] == "paused"]
    ended = [item for item in sessions if item["status"] == "ended"]
    ready = [item for item in sessions if item["status"] == "ready"
             and not execution_blockers(ports.get_task(str(item.get('task_id') or ''), user_id))]
    profile = ports.ensure_profile(user_id)
    current = ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai")
    deferred = []
    actionable_paused = []
    for item in paused:
        preference = str(item.get("resume_preference") or "")
        preferred_at = item.get("preferred_resume_at")
        should_defer = preference == "unknown"
        if preferred_at:
            try:
                resume_at = datetime.fromisoformat(str(preferred_at).replace("Z", "+00:00"))
                if resume_at.tzinfo is None:
                    resume_at = resume_at.replace(tzinfo=current.tzinfo)
                should_defer = should_defer or resume_at > current
            except ValueError:
                pass
        (deferred if should_defer else actionable_paused).append(item)
    deferred_sessions = []
    for item in deferred:
        task = ports.get_task(str(item.get("task_id") or ""), user_id) or {}
        deferred_sessions.append({**item, "task_title": task.get("title"), "task": task})
    def planned_end(item: dict) -> datetime | None:
        value = item.get("planned_end_at")
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed.replace(tzinfo=current.tzinfo) if parsed.tzinfo is None else parsed
        except ValueError:
            return None

    overdue_running = [item for item in running if planned_end(item) is not None and current >= planned_end(item)]
    active_running = [item for item in running if item not in overdue_running]
    missed_ready = [item for item in ready if planned_end(item) is not None and current >= planned_end(item)]
    upcoming_ready = [item for item in ready if item not in missed_ready]

    def with_task(item: dict) -> dict:
        item_task = ports.get_task(str(item.get("task_id") or ""), user_id) or {}
        return {**item, "task_title": item_task.get("title"), "task": item_task}

    overdue_sessions = [with_task(item) for item in overdue_running]
    missed_sessions = [with_task(item) for item in missed_ready]
    selected = (active_running or actionable_paused or ended or upcoming_ready[:1])
    if not selected:
        return {"mode": "empty", "session": None, "task": None, "deferred_sessions": deferred_sessions, "overdue_sessions": overdue_sessions, "missed_sessions": missed_sessions, "requires_resolution": bool(overdue_sessions)}
    session = selected[0]
    task = ports.get_task(session["task_id"], user_id)
    mode = "running" if session["status"] == "running" else "paused" if session["status"] == "paused" else "session_ended" if session["status"] == "ended" else "up_next"
    if mode == "up_next" and session.get("planned_start_at"):
        try:
            planned_start = datetime.fromisoformat(str(session["planned_start_at"]).replace("Z", "+00:00"))
            planned_end = datetime.fromisoformat(str(session.get("planned_end_at") or "").replace("Z", "+00:00")) if session.get("planned_end_at") else None
            if planned_start.tzinfo is None:
                planned_start = planned_start.replace(tzinfo=current.tzinfo)
            if planned_end and planned_end.tzinfo is None:
                planned_end = planned_end.replace(tzinfo=current.tzinfo)
            if current >= planned_start and (planned_end is None or current < planned_end):
                mode = "ready_to_start"
        except ValueError:
            pass
    return {"mode": mode, "session": session, "task": task, "deferred_sessions": deferred_sessions, "overdue_sessions": overdue_sessions, "missed_sessions": missed_sessions, "requires_resolution": bool(overdue_sessions)}
