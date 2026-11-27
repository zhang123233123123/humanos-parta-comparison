"""Classify a confirmed choice without executing it or learning a preference.

The caller supplies the persisted original recommendation and the validated
selection for the same user, recommendation and source Session. This module
does not authenticate, validate scheduling feasibility, read storage, or infer
that execution succeeded. In particular, legacy ``accepted`` is NOT a reliable
substitute for ``confirmed`` plus the two snapshots.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal


ChoiceStatus = Literal[
    "original_accepted", "alternative_selected", "declined", "unknown"
]


@dataclass(frozen=True)
class ChoiceClassification:
    status: ChoiceStatus
    reason_code: str


def _positive_minutes(value: object) -> bool:
    # Do not silently convert booleans, strings or fractional values.
    return type(value) is int and value > 0


def _choice_parameters(value: object) -> dict[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    action = value.get("action")
    result: dict[str, object] = {"action": action}
    if action in ("short_break", "continue_current"):
        field = "break_minutes" if action == "short_break" else "duration_minutes"
        if not _positive_minutes(value.get(field)):
            return None
        result[field] = value[field]
    elif action == "switch_task":
        target = value.get("target_execution_session_id")
        if not isinstance(target, str) or not target.strip():
            return None
        result["target_execution_session_id"] = target
        if value.get("duration_minutes") is not None:
            if not _positive_minutes(value["duration_minutes"]):
                return None
            result["duration_minutes"] = value["duration_minutes"]
    elif action != "continue_later":
        return None
    # continue_later currently recommends only the action. A user-supplied
    # return time completes that action; it is not an AI-proposed time to match.
    # Titles, explanations, validation metadata and consequence copy are not
    # execution parameters and cannot change the classification.
    return result


def classify_recommendation_choice(
    original: object,
    selected: object,
    *,
    confirmed: bool | None = None,
) -> ChoiceClassification:
    """Compare action parameters; absent evidence is never counted as acceptance.

    ``confirmed=False`` means an explicit decline, not merely a pending choice.
    Pending/legacy feedback without explicit confirmation must pass ``None``.
    Missing switch duration on only one side is insufficient comparison evidence.
    This intentionally conservative rule avoids inventing a historical duration.
    """
    if confirmed is False:
        return ChoiceClassification("declined", "explicit_decline")
    if confirmed is not True:
        return ChoiceClassification("unknown", "confirmation_not_recorded")

    before = _choice_parameters(original)
    after = _choice_parameters(selected)
    if before is None or after is None:
        return ChoiceClassification("unknown", "incomplete_choice_snapshot")
    # Known action/target changes establish an alternative even if an optional
    # duration is absent. Matching targets need enough duration evidence too.
    for field in ("action", "target_execution_session_id"):
        if before.get(field) != after.get(field):
            return ChoiceClassification("alternative_selected", "action_or_target_changed")
    if before.keys() != after.keys():
        return ChoiceClassification("unknown", "incomplete_parameter_comparison")
    if before != after:
        return ChoiceClassification("alternative_selected", "duration_changed")
    return ChoiceClassification("original_accepted", "matching_action_parameters")
