"""Pure historical-session partition and reconciliation change scopes."""
from datetime import datetime
from collections.abc import Callable


def _separate_session_history(
    task: dict,
    week_id: str,
    timezone_name: str,
    reference: datetime,
    *, absolute_times: Callable,
) -> tuple[list[dict], list[dict]]:
    """Separate elapsed/started sessions from future unstarted sessions.

    Historical sessions are copied into ``execution.history_sessions`` by
    reconciliation.  They are never discarded merely because a deadline or
    availability window changes.
    """
    sessions = list((task.get("slot") or {}).get("sessions") or [])
    history: list[dict] = []
    future: list[dict] = []
    for raw in sessions:
        session = dict(raw)
        session_week = str(session.get("week_id") or task.get("week_id") or week_id)
        try:
            start_at, end_at = absolute_times(
                session_week,
                int(session.get("day_index", 0)),
                float(session.get("start", 0)),
                float(session.get("end", 0)),
                timezone_name,
            )
            session.setdefault("start_at", start_at)
            session.setdefault("end_at", end_at)
            end_moment = datetime.fromisoformat(str(session["end_at"]))
            start_moment = datetime.fromisoformat(str(session["start_at"]))
        except (TypeError, ValueError):
            future.append(session)
            continue
        has_started = bool(session.get("started_at") or session.get("actual_minutes"))
        if end_moment <= reference or start_moment <= reference and has_started:
            history.append(session)
        else:
            future.append(session)
    return history, future

def _task_change_scope(before: dict, after: dict) -> set[str]:
    changed = {
        key for key in (
            "title", "task_type", "start_at", "deadline_at", "duration", "priority", "expected_difficulty",
            "cognitive_load", "task_demand", "context", "resource_modality",
            "attention_mode", "parallelizable", "schedule_constraints",
        )
        if key in after and (after.get(key) is not None or key in {'expected_difficulty', 'start_at', 'deadline_at', 'schedule_constraints'})
        and after.get(key) != before.get(key)
    }
    if 'task_demand' in changed:
        before_demand = {k: v for k, v in (before.get('task_demand') or {}).items() if k != 'energy_requirement'}
        after_demand = {k: v for k, v in (after.get('task_demand') or {}).items() if k != 'energy_requirement'}
        if before_demand == after_demand:
            changed.discard('task_demand')
    if "dependency" in after:
        previous_dependency = (before.get("contextWindow") or {}).get("dependency")
        if after.get("dependency") != previous_dependency:
            changed.add("dependency")
    return changed

def _weekly_change_scope(before: dict, after: dict) -> set[str]:
    aliases = {
        "weekly_available_windows": "available_windows",
        "fixed_events": "fixed_events",
        "context_items": "context_items",
        "temporary_constraints": "temporary_constraints",
        "keep_buffer": "buffer",
        "buffer_preference": "buffer",
    }
    return {
        aliases[key]
        for key in aliases
        if key in after and after.get(key) != before.get(key)
    }
