"""Application-level commands for plan revision workflows."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

try:
    from app.domain.planning import PlanRevisionActivation, activate_plan_revision
except ImportError:
    from ..domain.planning import PlanRevisionActivation, activate_plan_revision


RESOURCE_PATHS = {
    "profile": "/api/profile",
    "tasks": "/api/tasks",
    "active_plan": "/api/plans/active",
    "execution_sessions": "/api/execution-sessions",
}


def request_replan(user_id, *, scope, trigger, affected_task_ids=None, week_id=None,
                   request_id=None, ensure_profile, current_week, make_id, create_job):
    """Queue a revision request without activating or editing the current plan."""
    if request_id is not None and (not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 200):
        raise ValueError("request_id must be a non-empty string of at most 200 characters")
    profile = ensure_profile(user_id)
    target_week = str(week_id or profile.get("active_week_id") or
                      (profile.get("weekly_context") or {}).get("week_id") or
                      current_week(timezone_name=profile.get("timezone")))
    command = build_replan_request(
        week_id=target_week, scope=scope, trigger=trigger,
        affected_task_ids=affected_task_ids,
        request_id=request_id.strip() if request_id is not None else make_id("replan"))
    job = create_job(user_id, "schedule_plan", command)
    return replan_response(command, job)


def build_replan_request(
    *,
    week_id: str,
    scope: str,
    trigger: str,
    affected_task_ids: list[str] | None,
    request_id: str,
) -> dict[str, Any]:
    """Normalize every replan trigger into one background-job command."""
    normalized_scope = scope if scope in {"local", "full", "today"} else "local"
    task_ids = sorted({str(item).strip() for item in (affected_task_ids or []) if str(item).strip()})
    return {
        "week_id": week_id,
        "source": "mutation_replan",
        "adjustment_trigger": trigger,
        "replan_scope": normalized_scope,
        "affected_task_ids": task_ids,
        "request_id": request_id,
    }


def replan_response(command: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    return {
        "request_id": command["request_id"],
        "required": True,
        "scope": command["replan_scope"],
        "trigger": command["adjustment_trigger"],
        "affected_task_ids": command["affected_task_ids"],
        "job": job,
        "confirmation_required": True,
        "resources": dict(RESOURCE_PATHS),
    }


def validate_replan_replay(previous: dict[str, Any], current: dict[str, Any]) -> None:
    """An idempotency key must identify one command, not merely one job kind."""
    if "mutation_replan" not in (previous.get("source"), current.get("source")):
        return
    fields = ("source", "week_id", "replan_scope", "adjustment_trigger", "affected_task_ids")
    if any(previous.get(field) != current.get(field) for field in fields):
        raise ValueError("request_id belongs to another replan request")


def revision_activation(*, week_id: str, revision: int, plan_id: str) -> PlanRevisionActivation:
    return activate_plan_revision(week_id=week_id, revision=revision, plan_id=plan_id)


def activation_event_payload(activation: PlanRevisionActivation) -> dict[str, Any]:
    return {
        "plan_id": activation.plan_id,
        "week_id": activation.week_id,
        "plan_revision": activation.revision,
        "invalidated_resources": list(activation.resource_names),
    }


def activation_resources(activation: PlanRevisionActivation) -> dict[str, str]:
    return {name: RESOURCE_PATHS[name] for name in activation.resource_names}


def activation_debug_view(activation: PlanRevisionActivation) -> dict[str, Any]:
    """Serializable representation for QA tooling without leaking persistence details."""
    return asdict(activation)
