"""User mutations and their existing replan triggers, independent of transport.

Persistence and replan remain sequential, not a new combined transaction.
"""
from collections.abc import Callable


def capture_context(user_id: str, payload: dict, *, ensure_profile: Callable,
                    save_context: Callable, get_task: Callable) -> dict:
    ensure_profile(user_id)
    context_dump = save_context(user_id, payload)
    return {"context_dump": context_dump, "task": get_task(context_dump["task_id"], user_id)}


def execution_feedback(user_id: str, payload: dict, *, ensure_profile: Callable,
                       save_feedback: Callable, list_sessions: Callable,
                       get_task: Callable) -> dict:
    ensure_profile(user_id)
    feedback = save_feedback(user_id, payload)
    sessions = list_sessions(user_id)
    session = next((item for item in sessions
                    if item.get("execution_session_id") == feedback.get("execution_session_id")), None)
    return {"feedback": feedback, "task": get_task(feedback["task_id"], user_id),
            "execution_session": session}


def create_task(user_id: str, payload: dict, *, ensure_profile: Callable,
                create: Callable, replan: Callable) -> dict:
    ensure_profile(user_id)
    task = create(user_id, payload)
    return {"task": task, "replan": replan(user_id, scope="local", trigger="task_created",
        affected_task_ids=[task.get("id")], week_id=task.get("week_id"))}


def update_task(user_id: str, task_id: str, payload: dict, *, get_task: Callable,
                patch_task: Callable, change_scope: Callable, replan: Callable) -> dict:
    before = get_task(task_id, user_id) or {}
    task = patch_task(task_id, {**payload, "_provenance_source": "user_input",
        "_provenance_source_id": "task_api"}, user_id)
    changed = (bool(change_scope(before, task)) or before.get("contextWindow") != task.get("contextWindow")
               or before.get("status") != task.get("status"))
    return {"task": task, "replan": replan(user_id, scope="local", trigger="task_schedule_changed",
        affected_task_ids=[task_id], week_id=task.get("week_id")) if changed else {"required": False}}


def delete_task(user_id: str, task_id: str, *, get_task: Callable,
                delete: Callable, replan: Callable) -> dict:
    before = get_task(task_id, user_id) or {}
    task = delete(task_id, user_id)
    return {"task": task, "replan": replan(user_id, scope="local", trigger="task_deleted",
        affected_task_ids=[task_id], week_id=before.get("week_id"))}


def update_profile(payload: dict, *, ensure_profile: Callable,
                   upsert: Callable, replan: Callable) -> dict:
    user_id = payload["user_id"]
    before = ensure_profile(user_id)
    profile = upsert(payload)
    changed = any(before.get(key) != profile.get(key) for key in {
        "deep_work_window", "low_energy_window", "task_preferences", "timezone", "weekly_context"})
    return {"profile": profile, "replan": replan(user_id, scope="full", trigger="profile_changed")
            if changed and before.get("active_plan_revision") else {"required": False}}


def reconcile_week(user_id: str, payload: dict, *, ensure_profile: Callable,
                   reconcile: Callable, replan: Callable) -> dict:
    ensure_profile(user_id)
    result = reconcile(user_id, payload)
    if result.get("plan_needs_update"):
        result["replan"] = replan(user_id, scope="full", trigger="weekly_setup_changed",
            affected_task_ids=result.get("invalidated_task_ids"), week_id=result.get("week_id"))
    return result


def check_in(user_id: str, payload: dict, *, ensure_profile: Callable,
             save_state: Callable, evaluate: Callable, request_replan: Callable) -> dict:
    ensure_profile(user_id)
    state = save_state(user_id, payload)
    review = evaluate(user_id, {**state, "_locale": payload.get("locale", "zh")}) if payload.get("daily_checkin") else None
    # Saving an observation is not consent to generate a schedule. The user
    # explicitly requests a draft through the existing scheduling endpoint.
    return {"runtime_state": state, "daily_plan_review": review, "replan": {"required": False}}
