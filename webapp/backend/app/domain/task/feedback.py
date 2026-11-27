"""Pure execution-feedback policy for updating a Task aggregate."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TaskFeedbackDecision:
    actual_minutes: int
    completion: str
    task_status: str
    execution: dict[str, Any]
    task_demand: dict[str, Any]


def apply_execution_feedback(
    task: dict[str, Any],
    task_evaluation: dict[str, Any],
    *,
    feedback_id: str,
    feedback_created_at: int,
    settled_actual_minutes: int = 0,
    inherited_active_minutes: int = 0,
) -> TaskFeedbackDecision:
    completion = str(task_evaluation.get("completion") or "some_progress")
    if completion == "partial":
        completion = "some_progress"
    actual_minutes = (
        0
        if completion in {"not_started", "did_not_start"}
        else max(int(task_evaluation.get("actual_minutes") or 0), 0)
    )
    # Feedback may correct this Session's work, never work inherited from a
    # previous revision. Session totals remain cumulative for existing clients.
    actual_minutes = max(actual_minutes, max(int(inherited_active_minutes), 0))

    execution = dict(task.get("execution") or {})
    # Pauses already settle cumulative Session work into the Task. Final
    # feedback reports the Session total, not additional work since its pause.
    delta = actual_minutes - max(int(settled_actual_minutes), 0)
    execution["accumulated_actual_minutes"] = max(
        int(execution.get("accumulated_actual_minutes") or 0) + delta, 0
    )
    if completion == "completed":
        remaining = 0
    elif task_evaluation.get("remaining_duration_minutes") is not None:
        remaining = max(int(task_evaluation["remaining_duration_minutes"]), 0)
    else:
        previous = execution.get("remaining_duration_minutes")
        previous = int(previous if previous is not None else task.get("duration") or 0)
        report = execution.get('remaining_work_report') or {}
        report_baseline = int(report.get('session_active_minutes') or 0) if report.get('execution_session_id') == task_evaluation.get('_execution_session_id') else 0
        remaining_delta = actual_minutes - max(int(settled_actual_minutes), report_baseline)
        remaining = max(previous - remaining_delta, 0)
    execution["remaining_duration_minutes"] = remaining
    execution["last_progress"] = str(task_evaluation.get("progress") or "").strip() or None
    execution["next_step"] = str(task_evaluation.get("next_step") or "").strip() or None
    execution["remaining_work"] = str(task_evaluation.get("remaining_work") or "").strip() or None
    execution["last_completion_outcome"] = completion
    execution["last_perceived_difficulty"] = task_evaluation.get("perceived_difficulty")
    sessions = list(execution.get("sessions") or [])
    sessions.append({
        "feedback_id": feedback_id,
        "actual_minutes": actual_minutes,
        "completion": completion,
        "perceived_difficulty": task_evaluation.get("perceived_difficulty"),
    })
    execution["sessions"] = sessions

    demand = dict(task.get("task_demand") or {})
    if task_evaluation.get("perceived_difficulty") is not None:
        calibration_history = list(demand.get("calibration_history") or [])
        calibration_history.append({
            "feedback_id": feedback_id,
            "expected_difficulty": task.get("expected_difficulty"),
            "perceived_difficulty": task_evaluation.get("perceived_difficulty"),
        })
        demand["calibration_history"] = calibration_history
        demand["last_calibrated_at"] = feedback_created_at

    return TaskFeedbackDecision(
        actual_minutes=actual_minutes,
        completion=completion,
        task_status="completed" if completion == "completed" else "queued",
        execution=execution,
        task_demand=demand,
    )
