"""Pure update decisions for the Task aggregate."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


SCHEDULING_FIELDS = frozenset({
    "task_type",
    "deadline_at",
    "start_at",
    "duration",
    "priority",
    "expected_difficulty",
    "cognitive_load",
    "task_demand",
    "dependency",
    "resource_modality",
    "attention_mode",
    "parallelizable",
    "schedule_constraints",
})

CONTEXT_WINDOW_FIELDS = frozenset({
    "start_at",
    "deadline_at",
    "task_type",
    "taskType",
    "dependency",
    "context_window",
    "schedule_constraints",
})


@dataclass(frozen=True)
class TaskPatchDecision:
    patch: dict[str, Any]
    schedule_changed: bool
    context_window: dict[str, Any] | None
    duration_changed: bool


def decide_task_patch(current: dict[str, Any], incoming: dict[str, Any]) -> TaskPatchDecision:
    patch = dict(incoming)
    from .schedule_type import require_task_type
    from .context_fields import validate_task_context
    supplied_window = patch.get('context_window', {})
    validate_task_context(supplied_window)
    if 'schedule_constraints' in supplied_window and 'schedule_constraints' not in patch:
        patch['schedule_constraints'] = supplied_window['schedule_constraints']
    # Nested scheduling facts must participate in the same invalidation policy
    # as their top-level write fields. Recovery notes remain context only.
    for stored, field in (('startAt', 'start_at'), ('dependency', 'dependency')):
        if stored in supplied_window and field not in patch:
            patch[field] = supplied_window[stored]
    if 'task_type' in patch or 'taskType' in patch or (isinstance(supplied_window, dict) and 'taskType' in supplied_window):
        patch['task_type'] = require_task_type(patch)

    # Validate the resulting record, not just the supplied patch fields.
    from .schedule_type import validate_task_deadline
    validate_task_deadline(patch.get('task_type', current.get('task_type')),
                           patch.get('deadline_at', current.get('deadline_at')))

    schedule_changed = any(
        key in patch and patch.get(key) != current.get(key)
        for key in SCHEDULING_FIELDS
    )
    context_window = None
    if CONTEXT_WINDOW_FIELDS.intersection(patch):
        current_window = current.get("contextWindow") or {}
        if not isinstance(current_window, dict):
            current_window = {}
        context_window = {**current_window, **supplied_window}
        if 'schedule_constraints' in patch:
            context_window['schedule_constraints'] = patch['schedule_constraints']
        aliases = {
            "start_at": "startAt",
            "dependency": "dependency",
        }
        for source, target in aliases.items():
            if source in patch:
                context_window[target] = patch.get(source)
        if "task_type" in patch or "taskType" in patch:
            context_window["taskType"] = patch['task_type']
    from .schedule_constraints import validate_task_timing
    effective_window = context_window if context_window is not None else dict(current.get('contextWindow') or {})
    validate_task_timing(patch.get('task_type', current.get('task_type')), effective_window,
        patch.get('duration', current.get('duration')), patch.get('deadline_at', current.get('deadline_at')),
        week_id=current.get('week_id'))

    return TaskPatchDecision(
        patch=patch,
        schedule_changed=schedule_changed,
        context_window=context_window,
        duration_changed="duration" in patch and patch.get("duration") != current.get("duration"),
    )


def status_after_schedule_change(current_status: str, explicit_status: str | None) -> str | None:
    if explicit_status is not None:
        return explicit_status
    if current_status in {"completed", "terminated", "blocked", "paused"}:
        return None
    return "queued"
