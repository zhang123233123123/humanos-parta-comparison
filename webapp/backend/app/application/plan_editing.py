"""Edit plan candidates without conflating them with confirmed calendar state.

Transaction and confirmation boundaries are retained from the compatibility facade.
"""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from ..repositories.plans import PlanRepository


@dataclass(frozen=True)
class PlanEditingPorts:
    connect: Callable
    decode: Callable
    encode: Callable
    make_id: Callable
    now: Callable
    list_tasks: Callable
    get_task: Callable
    patch_task: Callable
    active_plan: Callable
    save_proposed_plan: Callable
    validate_confirmed_schedule: Callable
    revise_plan: Callable
    confirm_plan: Callable
    schedule_task_kind: Callable


def revise_plan(user_id: str, payload: dict, *, ports: PlanEditingPorts) -> dict:
    base_plan_id = str(payload.get("plan_id") or "").strip()
    if not base_plan_id:
        raise ValueError("plan_id is required")
    with ports.connect() as conn:
        row = PlanRepository(conn).get_for_user(plan_id=base_plan_id, user_id=user_id)
        if row and row["plan_status"] not in {"confirmed", "needs_update"}:
            row = None
    if not row:
        raise KeyError(base_plan_id)
    decision = ports.decode(row["plan_json"], {})
    decision.pop("plan_id", None)
    decision.pop("plan_revision", None)
    decision.pop("confirmed_at", None)
    decision.pop('replan_policy', None)  # Explicit new editing intent, not the old replan command.
    decision["base_plan_id"] = base_plan_id
    allocated: dict[str, int] = {}
    for block in decision.get("plan_patch") or []:
        task_id = str(block.get("task_id") or "")
        minutes = int(block.get("planned_work_minutes") or block.get("session_minutes") or round((float(block.get("end") or 0) - float(block.get("start") or 0)) * 60))
        allocated[task_id] = allocated.get(task_id, 0) + max(minutes, 0)
    unscheduled_by_task = {
        str(item.get("task_id")): dict(item)
        for item in (decision.get("unscheduled_tasks") or [])
        if isinstance(item, dict) and item.get("task_id")
    }
    for task in ports.list_tasks(user_id):
        if task.get("removed_from_week") or task.get("status") in {"completed", "terminated", "blocked"} or ports.schedule_task_kind(task) == "fixed_event":
            continue
        task_id = str(task.get("id") or "")
        remaining = int((task.get("execution") or {}).get("remaining_duration_minutes", task.get("duration") or 0))
        unallocated = max(remaining - allocated.get(task_id, 0), 0)
        if unallocated:
            previous = unscheduled_by_task.get(task_id, {})
            unscheduled_by_task[task_id] = {"task_id": task_id, "remaining_minutes": unallocated, "reason": previous.get("reason") or "Task is not allocated in the active revision and was preserved during this edit."}
    decision["unscheduled_tasks"] = list(unscheduled_by_task.values())
    request_id = str(payload.get("request_id") or "").strip() or ports.make_id("revise")
    return ports.save_proposed_plan(
        user_id,
        decision,
        {"week_id": row["week_id"], "request_id": request_id},
    )

def propose_continue_later_diff(user_id: str, execution_session: dict, impact: dict, request_id: str | None = None, *, ports: PlanEditingPorts) -> dict:
    preferred = str(execution_session.get("preferred_resume_at") or "").strip()
    if not preferred:
        raise ValueError("preferred_resume_at is required")
    active = ports.active_plan(user_id, str(execution_session.get("week_id") or "")) or {}
    if not active.get("plan_id") or active.get("plan_status") not in {"confirmed", "needs_update"}:
        raise ValueError("An active confirmed plan is required")
    from .local_calendar_diff import apply_local_calendar_diff, build_local_calendar_diff

    reschedule = impact.get("reschedule_check") or {}
    calendar_diff = build_local_calendar_diff(
        plan_id=str(active["plan_id"]),
        plan_revision=int(active.get("plan_revision") or 0),
        week_id=str(active.get("week_id") or execution_session.get("week_id")),
        execution_session=execution_session,
        preferred_resume_at=preferred,
        affected_session_ids=list(reschedule.get("releasable_execution_session_ids") or []),
    )
    projected = apply_local_calendar_diff(list(active.get("plan_patch") or []), calendar_diff)
    validation = ports.validate_confirmed_schedule(user_id, {"week_id": active.get("week_id"), "plan_patch": projected})
    decision = dict(active)
    for key in ("plan_id", "plan_revision", "plan_status", "confirmed_at", "replan_policy"):
        decision.pop(key, None)
    decision.update({
        "action": "suggest_plan",
        "source": "continue_later_local_diff",
        "base_plan_id": active["plan_id"],
        "plan_patch": projected,
        "validation": validation,
        "calendar_diff": calendar_diff,
    })
    proposed = ports.save_proposed_plan(user_id, decision, {"week_id": active.get("week_id"), "request_id": request_id or ports.make_id("continue_later")})
    return {"calendar_diff": calendar_diff, "proposed_plan": proposed, "validation": validation}

def decide_parallel_suggestion(user_id: str, payload: dict, *, ports: PlanEditingPorts) -> dict:
    from ..domain.planning import validate_parallel_decision_action

    plan_id = str(payload.get("plan_id") or "")
    suggestion_id = str(payload.get("suggestion_id") or "")
    action = validate_parallel_decision_action(payload.get("action"))
    with ports.connect() as conn:
        row = PlanRepository(conn).get_for_user(plan_id=plan_id, user_id=user_id)
        if row and row["plan_status"] != "proposed":
            row = None
        if not row:
            raise KeyError(plan_id)
        plan = ports.decode(row["plan_json"], {})
        suggestions = [dict(item) for item in (plan.get("parallel_suggestions") or [])]
        suggestion = next((item for item in suggestions if str(item.get("id")) == suggestion_id), None)
        if not suggestion:
            raise KeyError(suggestion_id)
        suggestion["status"] = "accepted" if action == "combine" else "rejected"
        if action == "combine":
            from ..domain.planning import apply_parallel_overlap

            plan["plan_patch"] = apply_parallel_overlap(plan.get("plan_patch") or [], suggestion)
            plan["accepted_parallel_pairs"] = [*(plan.get("accepted_parallel_pairs") or []), {**suggestion, "user_confirmed": True}]
        plan["parallel_suggestions"] = suggestions
        plan["validation"] = ports.validate_confirmed_schedule(user_id, {**plan, "accepted_parallel_pairs": plan.get("accepted_parallel_pairs") or []})
        if action == "combine" and not plan["validation"].get("valid"):
            raise ValueError(f"Parallel combination failed Python validation: {plan['validation'].get('violations', [])[:1]}")
        PlanRepository(conn).update_proposed_snapshot(
            plan_id=plan_id, user_id=user_id, plan_json=ports.encode(plan), timestamp=ports.now())
    return plan

def adjust_scheduled_task(user_id: str, payload: dict, *, ports: PlanEditingPorts) -> dict:
    task_id = str(payload.get("task_id") or "").strip()
    if not task_id:
        raise ValueError("task_id is required")
    task = ports.get_task(task_id, user_id)
    if not task:
        raise KeyError(task_id)
    from ..domain.task.write_fields import normalize_task_write
    # Validate before creating or confirming a revision with persistent effects.
    task_patch = normalize_task_write(payload.get("task_patch") or {})
    start_at = str(payload.get("start_at") or "").strip()
    end_at = str(payload.get("end_at") or "").strip()
    active = ports.active_plan(user_id)
    active_blocks = list((active or {}).get("plan_patch") or [])
    target = next((block for block in active_blocks if str(block.get("task_id")) == task_id), None)
    if not active or not target or not start_at or not end_at:
        allowed = {key: value for key, value in task_patch.items() if key not in {"slot", "start", "end", "start_at", "end_at", "deadline_at"}}
        if start_at and end_at:
            allowed["context_window"] = {
                **dict(allowed.get("context_window") or {}),
                "startAt": start_at, "endAt": end_at,
            }
        return {"task": ports.patch_task(task_id, {**allowed, "_provenance_source": "user_input", "_provenance_source_id": "task_inspector"}, user_id), "plan": active, "revision_created": False}
    start = datetime.fromisoformat(start_at)
    end = datetime.fromisoformat(end_at)
    if end <= start:
        raise ValueError("end_at must be after start_at")
    proposed = ports.revise_plan(user_id, {"plan_id": active["plan_id"], "request_id": payload.get("request_id") or ports.make_id("adjust")})
    next_patch = []
    for block in proposed.get("plan_patch") or []:
        if str(block.get("block_id")) != str(target.get("block_id")):
            next_patch.append(block)
            continue
        local_start = start
        local_end = end
        next_patch.append({
            **block,
            "day_index": (local_start.date() - datetime.fromisoformat(active.get("week_id") or proposed["week_id"]).date()).days,
            "start": local_start.hour + local_start.minute / 60,
            "end": local_end.hour + local_end.minute / 60,
            "start_at": local_start.isoformat(),
            "end_at": local_end.isoformat(),
            "session_minutes": max(round((local_end - local_start).total_seconds() / 60), 1),
            "planned_work_minutes": max(round((local_end - local_start).total_seconds() / 60), 1),
        })
    result = ports.confirm_plan(user_id, {
        "plan_id": proposed["plan_id"],
        "week_id": proposed["week_id"],
        "edit_episode_id": proposed.get("edit_episode_id"),
        "decision": proposed,
        "plan_patch": next_patch,
        "unscheduled_tasks": proposed.get("unscheduled_tasks") or [],
        "rationale": {
            "reason_codes": ["task_detail_schedule_change"],
            "raw_user_response": str(payload.get("reason") or ""),
            "parsed_reason": {"reason_codes": ["task_detail_schedule_change"], "raw_text": str(payload.get("reason") or "")},
            "affected_task_ids": [task_id],
            "response_status": "answered" if payload.get("reason") else "skipped",
            "generalizability": "not_sure",
            "request_id": payload.get("request_id"),
        },
    })
    allowed = {key: value for key, value in task_patch.items() if key not in {"slot", "start", "end", "start_at", "end_at", "deadline_at"}}
    updated_task = ports.patch_task(task_id, {**allowed, "_provenance_source": "user_input", "_provenance_source_id": "task_inspector"}, user_id) if allowed else ports.get_task(task_id, user_id)
    return {"task": updated_task, "plan": result.get("plan"), "validation": result.get("validation"), "revision_created": True}
