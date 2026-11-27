"""Validated decision support for an interrupted execution session."""

from __future__ import annotations

from typing import Any


ALLOWED_ACTIONS = {"short_break", "continue_current", "switch_task", "continue_later"}


def build_decision_evidence(context: dict[str, Any]) -> dict[str, Any]:
    """Return user-facing facts used by the policy without inferring mental state."""
    state = context.get("runtime_state") or {}
    task = context.get("task") or {}
    session = context.get("execution_session") or {}
    ready_queue = context.get("ready_queue") or []
    impact = context.get("downstream_impact") or {}
    facts: list[dict[str, Any]] = []

    for key in ("focus", "energy", "stress", "readiness"):
        value = state.get(key)
        if value is not None:
            facts.append({"kind": "self_report", "field": key, "value": value})
    if context.get("reason"):
        facts.append({"kind": "self_report", "field": "interruption_reason", "value": context["reason"]})
    recovery = context.get('recovery_context') or {}
    for key in ('progress', 'next_action', 'open_questions', 'progress_percent', 'task_remaining_minutes'):
        value = recovery.get(key)
        if value is not None and value != '' and value != []:
            facts.append({'kind': 'self_report' if recovery.get('field_sources', {}).get(key) == 'current_report' else 'persisted_state',
                          'field': key, 'value': '\n'.join(value) if isinstance(value, list) else value})
    for key, value in (
        ("remaining_minutes", context.get("remaining_minutes")),
        ("elapsed_minutes", context.get("elapsed_minutes")),
        ("deadline_at", task.get("deadline_at")),
        ("priority", task.get("priority")),
        ("session_status", session.get("status")),
    ):
        if value is not None and value != "":
            facts.append({"kind": "persisted_state", "field": key, "value": value})
    facts.append({"kind": "scheduler_state", "field": "ready_task_count", "value": len(ready_queue)})
    facts.append({"kind": "scheduler_state", "field": "affected_session_count", "value": len(impact.get("affected_sessions") or [])})

    missing = [key for key in ("focus", "energy", "stress") if state.get(key) is None]
    limitations = ["user_confirmation_required"]
    if missing:
        limitations.extend(f"missing_self_report:{key}" for key in missing)
    if not task.get("deadline_at"):
        limitations.append("missing_task_deadline")
    if not ready_queue:
        limitations.append("no_ready_alternative")
    return {
        "facts": facts,
        "evidence_strength": "limited" if missing else "moderate",
        "limitations": limitations,
        "causal_claim_allowed": False,
        "user_confirmation_required": True,
    }


def fallback_recommendation(context: dict[str, Any]) -> dict[str, Any]:
    raise ValueError('建议暂不可用，请重试或手动选择。 Recommendation unavailable; retry or choose manually.')


def validate_recommendation(raw: object, context: dict[str, Any]) -> dict[str, Any]:
    candidate = dict(raw) if isinstance(raw, dict) else fallback_recommendation(context)
    action = str(candidate.get("action") or "").strip()
    if action not in ALLOWED_ACTIONS:
        candidate = fallback_recommendation(context)
        action = candidate["action"]

    from .deterministic_scheduler import session_limit_minutes
    limit = session_limit_minutes(context.get('task_preferences') or {})
    remaining = max(int(context.get("remaining_minutes") or 0), 0)
    ready_queue = context.get("ready_queue") or []
    ready_by_session = {str(item.get("execution_session_id") or ""): item for item in ready_queue}
    violations: list[str] = []

    if action == "short_break":
        minutes = candidate.get('break_minutes')
        if type(minutes) is not int or not 1 <= minutes <= 180:
            violations.append('invalid_break_duration')
    elif action == "switch_task":
        target_id = str(candidate.get("target_execution_session_id") or "")
        if target_id not in ready_by_session:
            violations.append("target_not_in_ready_queue")

        else:
            target = ready_by_session[target_id]
            candidate["target_task_id"] = target.get("task_id")
            candidate["target_task_title"] = target.get("task_title")
    elif action == "continue_current":
        minutes = candidate.get('duration_minutes')
        if type(minutes) is not int or not 0 < minutes <= min(remaining, limit):
            violations.append('invalid_work_duration')

    candidate["action"] = action
    candidate["validated"] = True
    candidate["validation"] = {
        "valid": not violations,
        "violations": violations,
        "checked_by": "python_help_decide_policy",
    }
    return candidate


def recommendation_prompt(context: dict[str, Any]) -> list[dict[str, str]]:
    import json
    from .interruption_prompt_context import GUIDANCE
    language = '简体中文' if str(context.get('locale') or '').startswith('zh') else 'English'
    return [
        {'role':'system','content': GUIDANCE +
         'You help a user choose their next action after interruption. Select exactly one '
         'option_id from candidate_options. Python owns feasibility, durations, targets and '
         'consequences. Options requiring plan review are valid recommendations, not immediately executable calendar changes; explain that a draft needs confirmation. Never invent an option or change its parameters. Consider the shared '
         'decision_context, current recovery_context, task urgency, explicit preferences, '
         'recent behavior and similar experiences. State the relevant supplied facts and '
         'any uncertainty; do not promise an outcome. User confirmation is required. '
         'Return only recommended_option_id and a brief reason. Write reason in ' + language + '.'},
        {'role':'user','content':json.dumps(context,ensure_ascii=False)},
    ]
