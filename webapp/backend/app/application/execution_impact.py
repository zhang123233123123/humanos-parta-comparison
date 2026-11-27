"""Application composition for interruption and resume impact assessment."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

try:
    from app.application.local_rescheduler import assess_local_reschedule
    from app.application.plan_capacity_projection import annotate_future_sessions, project_plan_capacity, week_minute
    from app.domain.execution import analyze_remaining_work_impact
except ImportError:
    from .local_rescheduler import assess_local_reschedule
    from .plan_capacity_projection import annotate_future_sessions, project_plan_capacity, week_minute
    from ..domain.execution import analyze_remaining_work_impact


def assess_execution_impact(
    *,
    current: datetime,
    session: dict[str, Any],
    task: dict[str, Any],
    future_sessions: list[dict[str, Any]],
    active_plan: dict[str, Any],
    action: str,
    remaining_minutes: int,
    change_minutes: int | None = None,
    session_slack_minutes: int = 0,
) -> dict[str, Any]:
    session_id = str(session.get("execution_session_id") or "")
    week_id = str(session.get("week_id") or active_plan.get("week_id") or "")
    if not week_id:
        # Ad-hoc sessions have no weekly calendar boundary to project.
        return analyze_remaining_work_impact(
            current=current, remaining_minutes=max(int(remaining_minutes), 0),
            future_sessions=future_sessions, current_session_id=session_id,
            deadline_at=task.get('deadline_at'), action=action,
        )
    capacity = project_plan_capacity(
        active_plan,
        current_week_minute=week_minute(current, week_id),
        current_execution_session_id=session_id,
    )
    future = annotate_future_sessions(future_sessions, capacity)
    plan_week = str(active_plan.get('week_id') or week_id)
    plan_start = datetime.fromisoformat(f'{plan_week}T00:00:00').replace(tzinfo=current.tzinfo)
    occupied_blocks = {str(item.get('block_id')) for item in future if item.get('block_id')}
    for item in [*capacity.get('fixed_events', []), *capacity.get('buffer_intervals', [])]:
        block_id = str(item.get('source_id') or item.get('id') or '')
        if block_id in occupied_blocks or block_id == str(session.get('block_id') or ''):
            continue
        future.append({
            'execution_session_id': f'fixed:{block_id}', 'task_id': item.get('task_id'),
            'task_title': item.get('title') or item.get('label') or 'Rest', 'fixed_event': item.get('kind') != 'rest_buffer',
            'kind': item.get('kind'),
            'planned_start_at': (plan_start + timedelta(minutes=int(item.get('week_start_minute') or 0))).isoformat(),
            'planned_end_at': (plan_start + timedelta(minutes=int(item.get('week_end_minute') or 0))).isoformat(),
        })
    context = dict(task.get("contextWindow") or {})
    deadline_at = task.get("deadline_at")
    week_start = datetime.fromisoformat(f"{week_id}T00:00:00").replace(tzinfo=current.tzinfo)
    impact = analyze_remaining_work_impact(
        current=current,
        remaining_minutes=max(int(remaining_minutes), 0),
        future_sessions=future,
        current_session_id=session_id,
        deadline_at=deadline_at,
        week_end_at=week_start + timedelta(days=7),
        action=action,
    )
    next_starts = []
    for item in future:
        try:
            value = datetime.fromisoformat(str(item["planned_start_at"]).replace("Z", "+00:00"))
            next_starts.append(value.replace(tzinfo=current.tzinfo) if value.tzinfo is None else value.astimezone(current.tzinfo))
        except (KeyError, TypeError, ValueError):
            continue
    idle_gap = max(int((min(next_starts) - current).total_seconds() // 60), 0) if next_starts else 0
    impact["reschedule_check"] = assess_local_reschedule(
        impact=impact,
        change_minutes=max(int(remaining_minutes if change_minutes is None else change_minutes), 0),
        session_slack_minutes=max(int(session_slack_minutes), 0),
        idle_gap_minutes=idle_gap,
        buffer_minutes=0,  # Rest requires explicit review; distant gaps cannot absorb this delay.
    )
    impact["capacity_projection"] = capacity
    return impact
