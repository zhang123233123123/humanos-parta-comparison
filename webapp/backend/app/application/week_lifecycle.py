"""Week status and explicit rollover application workflows."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.week_lifecycle import WeekLifecycleRepository


@dataclass(frozen=True)
class WeekLifecyclePorts:
    ensure_profile: Callable
    current_week: Callable
    list_tasks: Callable
    now: Callable
    connect: Callable
    make_id: Callable
    encode: Callable
    task_row: Callable


def week_status(user_id: str, requested_week_id: str | None = None, *, ports: WeekLifecyclePorts) -> dict:
    profile = ports.ensure_profile(user_id)
    current_week = str(requested_week_id or ports.current_week(timezone_name=profile.get("timezone")))
    active_week = str(profile.get("active_week_id") or (profile.get("weekly_context") or {}).get("week_id") or current_week)
    from ..domain.planning.period import current_period
    current_week = current_period(active_week, current_week)
    unfinished_task_ids = [
        str(task.get("id")) for task in ports.list_tasks(user_id)
        if task.get("week_id") == active_week
        and not task.get("removed_from_week")
        and task.get("status") not in {"completed", "terminated"}
        and int((task.get("execution") or {}).get("remaining_duration_minutes", task.get("duration") or 0)) > 0
    ]
    return {
        "current_week_id": current_week,
        "active_week_id": active_week,
        "new_week": current_week != active_week,
        "unfinished_task_ids": unfinished_task_ids,
        "resources": {"tasks": "/api/tasks"},
    }

def rollover_week(user_id: str, payload: dict, *, ports: WeekLifecyclePorts) -> dict:
    profile = ports.ensure_profile(user_id)
    old_week = str(profile.get("active_week_id") or (profile.get("weekly_context") or {}).get("week_id") or ports.current_week(timezone_name=profile.get("timezone")))
    new_week = str(payload.get("week_id") or ports.current_week(timezone_name=profile.get("timezone")))
    carry_ids = {str(item) for item in (payload.get("carry_task_ids") or [])}
    use_last = bool(payload.get("use_last_week"))
    from ..domain.profile import sanitize_weekly_context

    weekly = sanitize_weekly_context(profile.get("weekly_context") or {})
    timestamp = ports.now()
    with ports.connect() as conn:
        WeekLifecycleRepository(conn).archive_context(*(ports.make_id("weekhist"),user_id,old_week,ports.encode(weekly),timestamp))
        WeekLifecycleRepository(conn).supersede_plans(*(timestamp,user_id,old_week))
        WeekLifecycleRepository(conn).supersede_ready_sessions(*(timestamp, user_id, old_week))
        rows = WeekLifecycleRepository(conn).tasks(*(user_id,old_week))
        for row in rows:
            task = ports.task_row(row)
            remaining = int((task.get("execution") or {}).get("remaining_duration_minutes", task.get("duration") or 0))
            if str(task["id"]) in carry_ids and remaining > 0 and task.get("status") not in {"completed","terminated"}:
                WeekLifecycleRepository(conn).carry_task(*(new_week,ports.encode(None),timestamp,task["id"],user_id))
            else:
                WeekLifecycleRepository(conn).archive_task(*(timestamp,ports.encode(None),timestamp,task["id"],user_id))
        new_context = {
            "week_id": new_week,
            "week_of": new_week,
            # Availability is a Profile-owned capacity boundary established
            # during onboarding. A fresh week clears transient commitments,
            # not the person's normal working-time envelope.
            "weekly_available_windows": weekly.get("weekly_available_windows", ""),
            "context_items": [
                item for item in (weekly.get("context_items") or [])
                if isinstance(item, dict)
                and (
                    item.get("occurrence_mode") in {"repeat_weekly", "repeat_every_day"}
                    or (
                        use_last
                        and item.get("type") in {"routine_window", "recurring_routine"}
                        and not item.get("occurrence_mode")
                    )
                )
            ],
            "weekly_goal": "",
            "temporary_constraints": [],
            "fixed_events": [],
            "keep_buffer": weekly.get("keep_buffer", True),
            "weekly_note": "",
        }
        new_context = sanitize_weekly_context(new_context)
        WeekLifecycleRepository(conn).update_profile(*(ports.encode(new_context),new_week,timestamp,user_id))
    return {
        "week_id": new_week,
        "previous_week_id": old_week,
        "carried_task_ids": sorted(carry_ids),
        "active_plan_revision": None,
        "resources": {
            "profile": "/api/profile",
            "tasks": "/api/tasks",
            "active_plan": f"/api/plans/active?week_id={new_week}",
            "week_status": f"/api/weeks/status?week_id={new_week}",
        },
    }
