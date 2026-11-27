"""Canonical namespaces used when interpreting personalisation evidence.

Profile context items, schedulable Tasks, and Task content describe different
things.  Keeping their names separate prevents a calendar interaction from
being assigned the wrong behavioural meaning.
"""

from __future__ import annotations

from typing import Literal
from ..task.schedule_type import TaskScheduleType, TASK_TYPES

ProfileContextKind = Literal["fixed_event", "recurring_routine", "flexible_activity"]

PROFILE_CONTEXT_KINDS = frozenset({"fixed_event", "recurring_routine", "flexible_activity"})
TASK_SCHEDULE_TYPES = TASK_TYPES

_PROFILE_CONTEXT_ALIASES = {
    "routine": "recurring_routine",
    "habit_period": "recurring_routine",
    "ai_arranged": "flexible_activity",
}


def require_profile_context_kind(value: object) -> ProfileContextKind:
    text = str(value or "").strip().lower()
    normalized = _PROFILE_CONTEXT_ALIASES.get(text, text)
    if normalized not in PROFILE_CONTEXT_KINDS:
        raise ValueError("profile_context_kind must be fixed_event, recurring_routine, or flexible_activity")
    return normalized  # type: ignore[return-value]


def require_task_schedule_type(value: object) -> TaskScheduleType:
    normalized = str(value or "").strip().lower()
    if normalized not in TASK_SCHEDULE_TYPES:
        raise ValueError("task_schedule_type must be one of the four supported task types")
    return normalized  # type: ignore[return-value]
