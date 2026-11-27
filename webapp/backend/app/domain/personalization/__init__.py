"""Contracts for evidence-based, user-controlled personalisation."""

from .models import BehaviorEvent, EvidenceItem, EvidenceScope
from .taxonomy import (
    PROFILE_CONTEXT_KINDS,
    TASK_SCHEDULE_TYPES,
    ProfileContextKind,
    TaskScheduleType,
    require_profile_context_kind,
    require_task_schedule_type,
)

__all__ = [
    "BehaviorEvent",
    "EvidenceItem",
    "EvidenceScope",
    "PROFILE_CONTEXT_KINDS",
    "TASK_SCHEDULE_TYPES",
    "ProfileContextKind",
    "TaskScheduleType",
    "require_profile_context_kind",
    "require_task_schedule_type",
]
