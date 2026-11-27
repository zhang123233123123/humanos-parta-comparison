"""Profile-driven deterministic scheduling on a canonical weekly axis."""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from humanos_graph import build_scheduling_context, day_index_from_due, parse_due_start_hour, profile_now
from app.domain.timeline import WeeklySegment, WeeklyTimeAxis
from app.domain.planning import assess_next_session_fit, hard_dependency_cycle_ids
from ..domain.task.eligibility import execution_blockers
from ..domain.profile.timing import rest_minutes as profile_rest_minutes, grid_minutes as profile_grid_minutes

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def session_limit_minutes(preferences: dict) -> int:
    """Preserve the user's session cap, independently of calendar grid padding."""
    value = preferences.get('preferred_session_minutes')
    if value is None:
        return 45
    if isinstance(value, bool):
        raise ValueError('Session limit must be whole minutes between 1 and 180')
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise ValueError('Session limit must be whole minutes between 1 and 180') from None
    if str(minutes) != str(value).strip() or not 1 <= minutes <= 180:
        raise ValueError('Session limit must be whole minutes between 1 and 180')
    return minutes


def _week_start(week_id: str, timezone_name: str) -> datetime:
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone = ZoneInfo("UTC")
    return datetime.fromisoformat(week_id).replace(tzinfo=timezone)


def _axis(day_index: int, hour: float) -> int:
    return WeeklyTimeAxis.from_legacy_hour(day_index, hour)


def _hour(axis_minute: int) -> float:
    return WeeklyTimeAxis.to_legacy_hour(axis_minute)


def _deadline_axis(task: dict[str, Any], now: datetime, period_start: datetime | None = None) -> int | None:
    from humanos_graph import absolute_date_from_due
    start = period_start or (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    text = str(task.get('deadline_at') or '')
    try:
        exact = datetime.fromisoformat(text.replace('Z', '+00:00'))
        exact = exact.astimezone(start.tzinfo) if exact.tzinfo else exact.replace(tzinfo=start.tzinfo)
        if len(text) == 10:exact += timedelta(days=1)
        return round((exact - start).total_seconds() / 60)
    except ValueError:
        pass
    absolute = absolute_date_from_due(text, now)
    if absolute:
        absolute = absolute.astimezone(start.tzinfo) if absolute.tzinfo else absolute.replace(tzinfo=start.tzinfo)
        hour = parse_due_start_hour(task.get('deadline_at'))
        deadline = absolute.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(hours=hour if hour is not None else 24)
        return round((deadline - start).total_seconds() / 60)
    weekday = day_index_from_due(task.get('deadline_at'), now)
    if weekday is None:return None
    hour = parse_due_start_hour(task.get('deadline_at'))
    return _axis((weekday - start.weekday()) % 7, hour if hour is not None else 24)


def _remaining_minutes(task: dict[str, Any]) -> int:
    execution = task.get("execution") or {}
    return max(int(execution.get("remaining_duration_minutes", task.get("duration") or 0)), 0)


def _task_kind(task: dict[str, Any]) -> str:
    if 'task_type' in task:
        from ..domain.task.schedule_type import require_task_type
        return require_task_type(task)
    return str(task.get("task_type") or task.get("type") or "flexible_task")


def _overlaps(start: int, end: int, occupied: list[tuple[int, int]]) -> bool:
    candidate = WeeklySegment(start, end)
    return any(candidate.overlaps(WeeklySegment(occupied_start, occupied_end)) for occupied_start, occupied_end in occupied)


def _find_slot(
    available: list[WeeklySegment], occupied: list[WeeklySegment], *, duration_minutes: int,
    not_before: int, deadline: int | None, rest_after_minutes: int,
    daily_load_minutes: dict[int, int] | None = None, grid_minutes: int = 15,
) -> WeeklySegment | None:
    """Choose the earliest slot on the least-loaded feasible day."""
    boundary = 10080 if deadline is None else min(max(deadline, 0), 10080)
    candidates = []
    day_loads = daily_load_minutes or {}
    free = WeeklyTimeAxis.subtract(available, occupied)
    for segment in free:
        start = math.ceil(max(segment.start, not_before) / grid_minutes) * grid_minutes
        while start + duration_minutes <= min(segment.end, boundary):
            end = start + duration_minutes
            day_end = min((start // 1440 + 1) * 1440, 10080)
            protected = WeeklySegment(start, min(end + rest_after_minutes, day_end))
            if any(item.contains(protected) for item in free):
                candidates.append(WeeklySegment(start, end))
            start += grid_minutes
    return min(candidates, key=lambda item: (day_loads.get(item.start // 1440, 0), item.start), default=None)


def _dependency_order(tasks: list[dict[str, Any]], analysis: dict[str, Any], now: datetime) -> list[dict[str, Any]]:
    task_map = {str(task.get("id")): task for task in tasks}
    predecessors: dict[str, set[str]] = {task_id: set() for task_id in task_map}
    for dependency in analysis.get("dependencies") or []:
        if not isinstance(dependency, dict) or dependency.get("hard_enforced") is not True:
            continue
        before = str(dependency.get("before_task_id") or "")
        after = str(dependency.get("after_task_id") or "")
        if before in task_map and after in task_map:
            predecessors[after].add(before)

    def base_key(task: dict[str, Any]) -> tuple[int, int, int, str]:
        deadline = _deadline_axis(task, now)
        return (
            deadline if deadline is not None else 10081,
            PRIORITY_ORDER.get(str(task.get("priority") or "medium").lower(), 1),
            -_remaining_minutes(task),
            str(task.get("id") or ""),
        )

    ordered: list[dict[str, Any]] = []
    pending = dict(task_map)
    while pending:
        ready = [task for task_id, task in pending.items() if not (predecessors.get(task_id) or set()) & pending.keys()]
        if not ready:
            ready = list(pending.values())
        selected = min(ready, key=base_key)
        ordered.append(selected)
        pending.pop(str(selected.get("id")), None)
    return ordered


def build_deterministic_plan(
    *,
    profile: dict[str, Any],
    tasks: list[dict[str, Any]],
    analysis: dict[str, Any] | None = None,
    existing_plan: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    prepare_only: bool = False,
) -> dict[str, Any]:
    """Allocate task sessions without allowing the model to invent times."""
    payload = payload or {}
    scope_policy = payload.get('_replan_policy')
    analysis = analysis or {}
    runtime_state = dict(payload.get("runtime_state") or {})
    timezone_name = str(profile.get("timezone") or "Asia/Shanghai")
    now = profile_now(profile)
    week_id = str(payload.get("week_id") or profile.get("active_week_id") or (profile.get("weekly_context") or {}).get("week_id") or now.date().isoformat())
    week_start = _week_start(week_id, timezone_name)
    weekly_axis = WeeklyTimeAxis(week_id, timezone_name)
    preferences = profile.get("task_preferences") or {}
    session_minutes = session_limit_minutes(preferences)
    rest_minutes = profile_rest_minutes(preferences)
    grid_minutes = profile_grid_minutes(preferences)
    profile = {**profile, 'active_week_id': week_id, 'weekly_context': {**(profile.get('weekly_context') or {}), 'week_id': week_id}}
    from .scheduling_constraints import scheduling_constraints
    context = scheduling_constraints(profile, tasks=tasks)
    raw_windows = context.get("movable_routine_windows") or context.get("windows") or []
    windows = sorted(
        (_axis(int(item["day_index"]), float(item["start"])), _axis(int(item["day_index"]), float(item["end"])))
        for item in raw_windows
        if int(item.get("day_index", -1)) in range(7) and float(item.get("end", 0)) > float(item.get("start", 0))
    )
    fixed_constraints = [
        dict(item)
        for item in context.get("hard_constraints") or []
        if int(item.get("day_index", -1)) in range(7) and float(item.get("end", 0)) > float(item.get("start", 0))
    ]
    occupied: list[tuple[int, int]] = sorted(
        (_axis(int(item["day_index"]), float(item["start"])), _axis(int(item["day_index"]), float(item["end"])))
        for item in fixed_constraints
    )
    available_segments = [WeeklySegment(start, end) for start, end in windows]
    full_windows = context.get("full_available_windows") or raw_windows
    full_available_segments = [
        WeeklySegment(_axis(int(item["day_index"]), float(item["start"])), _axis(int(item["day_index"]), float(item["end"])))
        for item in full_windows
        if int(item.get("day_index", -1)) in range(7) and float(item.get("end", 0)) > float(item.get("start", 0))
    ]
    occupied_segments = [WeeklySegment(start, end) for start, end in occupied]
    initial_free_segments = WeeklyTimeAxis.subtract(available_segments, occupied_segments)
    schedulable_tasks = {
        str(task.get("id")): task
        for task in tasks
        if task.get("id")
        and not task.get("removed_from_week")
        and not execution_blockers(task)
        and _task_kind(task) == "flexible_task"
        and _remaining_minutes(task) > 0
    }
    cycle_task_ids = hard_dependency_cycle_ids(list(schedulable_tasks.values()), analysis)
    active_tasks = {task_id: task for task_id, task in schedulable_tasks.items() if task_id not in cycle_task_ids}
    if scope_policy:
        active_tasks = {key: task for key, task in active_tasks.items() if key in scope_policy['allowed_task_ids']}
    activity_titles = {str(item['id']): str(item.get('title') or '')
                       for item in (profile.get('weekly_context') or {}).get('context_items', [])
                       if isinstance(item, dict) and item.get('id')}
    blocks: list[dict[str, Any]] = []
    for index, item in enumerate(fixed_constraints):
        start = _axis(int(item["day_index"]), float(item["start"]))
        end = _axis(int(item["day_index"]), float(item["end"]))
        blocks.append({
            "block_id": (f"fixed-{item['task_id']}-{item['day_index']}" if item.get('task_id')
                         else f"fixed-{item.get('id') or item.get('context_id') or index}-{week_id}-{item['day_index']}-{start}"),
            "source_id": str(item.get("id") or item.get("context_id") or "") or None,
            "task_id": str(item.get("task_id") or "") or None,
            "title": activity_titles.get(str(item.get('context_id'))) or str(item.get("title") or item.get("label") or "Fixed event"),
            "day_index": int(item["day_index"]),
            "start": float(item["start"]),
            "end": float(item["end"]),
            "start_at": (week_start + timedelta(minutes=start)).isoformat(),
            "end_at": (week_start + timedelta(minutes=end)).isoformat(),
            "week_start_minute": start,
            "week_end_minute": end,
            "kind": "fixed_event",
            "mode": "protected",
            "movable": False,
            "session_minutes": end - start,
            "planned_work_minutes": 0,
            "constraint_evidence": ["User-provided fixed event on the weekly timeline"],
            "state_scope": "weekly_hard_constraint",
            "week_id": week_id,
            "plan_status": "proposed",
            "scheduler": "python_timeline_v2",
        })
    allocated: dict[str, int] = {task_id: 0 for task_id in schedulable_tasks}
    task_end: dict[str, int] = {}
    daily_load_minutes: dict[int, int] = {}

    if scope_policy:
        from copy import deepcopy
        # Frozen blocks are copied verbatim, never clipped to a changed budget.
        if scope_policy['base_plan_id']:
            blocks = []
        history_ids = set(scope_policy['historical_block_ids'])
        for block in deepcopy(scope_policy['frozen_blocks']):
            blocks.append(block)
            start = _axis(int(block['day_index']), float(block['start']))
            end = _axis(int(block['day_index']), float(block['end']))
            occupied.append((start, min(end + rest_minutes, (start // 1440 + 1) * 1440)))
            task_id = str(block.get('task_id') or '')
            work = 0 if str(block['block_id']) in history_ids else int(block.get('planned_work_minutes') or block.get('session_minutes') or end - start)
            if task_id in allocated:
                allocated[task_id] += work
                task_end[task_id] = max(task_end.get(task_id, 0), end)
            daily_load_minutes[start // 1440] = daily_load_minutes.get(start // 1440, 0) + work
        lower, upper = scope_policy['window_start'], scope_policy['window_end']
        def clipped(segments):
            return [WeeklySegment(max(s.start, math.ceil(lower)), min(s.end, upper)) for s in segments
                    if max(s.start, math.ceil(lower)) < min(s.end, upper)]
        available_segments = clipped(available_segments)
        full_available_segments = clipped(full_available_segments)

    preserve_existing = not scope_policy and not payload.get("rebuild_from_scratch")
    if preserve_existing and existing_plan:
        for raw in existing_plan.get("plan_patch") or []:
            task_id = str(raw.get("task_id") or "")
            if task_id not in active_tasks:
                continue
            block = dict(raw)
            try:
                start = _axis(int(block["day_index"]), float(block["start"]))
                end = _axis(int(block["day_index"]), float(block["end"]))
            except (KeyError, TypeError, ValueError):
                continue
            if end <= start or _overlaps(start, end + rest_minutes, occupied):
                continue
            work = min(int(block.get("planned_work_minutes") or end - start), _remaining_minutes(active_tasks[task_id]) - allocated[task_id])
            if work <= 0:
                continue
            block.update({"planned_work_minutes": work, "session_minutes": work, "scheduler": "python_timeline_v1"})
            blocks.append(block)
            allocated[task_id] += work
            task_end[task_id] = max(task_end.get(task_id, 0), end)
            day_index = start // 1440
            daily_load_minutes[day_index] = daily_load_minutes.get(day_index, 0) + work
            occupied.append((start, min(end + rest_minutes, (start // 1440 + 1) * 1440)))

    dependency_map: dict[str, set[str]] = {task_id: set() for task_id in active_tasks}
    for dependency in analysis.get("dependencies") or []:
        if isinstance(dependency, dict) and dependency.get("hard_enforced") is True:
            before = str(dependency.get("before_task_id") or "")
            after = str(dependency.get("after_task_id") or "")
            if before in schedulable_tasks and after in active_tasks:
                dependency_map[after].add(before)

    current_axis = max(round((now - week_start).total_seconds() / 60 / grid_minutes) * grid_minutes, 0) if week_start <= now < week_start + timedelta(days=7) else 0
    unscheduled: list[dict[str, Any]] = [
        {
            "task_id": task_id,
            "remaining_minutes": _remaining_minutes(schedulable_tasks[task_id]),
            "required_minutes": _remaining_minutes(schedulable_tasks[task_id]),
            "available_minutes": 0,
            "shortage_minutes": _remaining_minutes(schedulable_tasks[task_id]),
            "reason": "hard_dependency_cycle",
        }
        for task_id in sorted(cycle_task_ids)
        if not scope_policy or task_id in scope_policy['allowed_task_ids']
    ]
    demand_map = {
        str(item.get("task_id")): str(item.get("level") or "medium")
        for item in analysis.get("task_demands") or [] if isinstance(item, dict)
    }
    if prepare_only:
        # Preparation performs no task ranking, learned-prior scoring or placement.
        # The production AI-order workflow consumes this immutable fact snapshot.
        return {
            "tasks": active_tasks, "all_tasks": schedulable_tasks,
            "allocated": allocated, "task_end": task_end,
            "dependencies": dependency_map, "blocks": blocks, "occupied": occupied,
            "available": available_segments, "full_available": full_available_segments,
            "context": context, "scope_policy": scope_policy, "unscheduled": unscheduled,
            "week_id": week_id, "week_start": week_start, "now": now,
            "current_axis": max(math.ceil((now - week_start).total_seconds() / 60 / grid_minutes) * grid_minutes, 0),
            "session_minutes": session_minutes, "rest_minutes": rest_minutes, "grid_minutes": grid_minutes,
            "analysis": analysis,
        }

    next_session_policy_applied = False
    for task in _dependency_order(list(active_tasks.values()), analysis, now):
        task_id = str(task["id"])
        unsatisfied_dependencies = sorted(
            dependency_id
            for dependency_id in dependency_map.get(task_id, set())
            if allocated.get(dependency_id, 0) < _remaining_minutes(schedulable_tasks[dependency_id])
        )
        if unsatisfied_dependencies:
            remaining = _remaining_minutes(task) - allocated[task_id]
            unscheduled.append({
                "task_id": task_id,
                "remaining_minutes": remaining,
                "required_minutes": remaining,
                "available_minutes": 0,
                "shortage_minutes": remaining,
                "reason": "hard_dependency_unsatisfied",
                "blocked_by_task_ids": unsatisfied_dependencies,
            })
            continue
        remaining = _remaining_minutes(task) - allocated[task_id]
        deadline = _deadline_axis(task, now, week_start)
        dependency_ready = max((task_end.get(item, 0) + rest_minutes for item in dependency_map.get(task_id, set())), default=0)
        session_index = 1 + sum(1 for block in blocks if str(block.get("task_id")) == task_id)
        while remaining > 0:
            work = min(session_minutes, remaining)
            chosen_segment = _find_slot(
                available_segments,
                [WeeklySegment(start, end) for start, end in occupied],
                duration_minutes=work,
                not_before=max(current_axis, dependency_ready),
                deadline=deadline,
                rest_after_minutes=rest_minutes, grid_minutes=grid_minutes,

                daily_load_minutes=daily_load_minutes,
            )
            used_buffer = False
            if chosen_segment is None and context.get("keep_buffer"):
                chosen_segment = _find_slot(
                    full_available_segments,
                    [WeeklySegment(start, end) for start, end in occupied],
                    duration_minutes=work,
                    not_before=max(current_axis, dependency_ready),
                    deadline=deadline,
                    rest_after_minutes=rest_minutes, grid_minutes=grid_minutes,

                    daily_load_minutes=daily_load_minutes,
                )
                used_buffer = chosen_segment is not None
            chosen = (chosen_segment.start, chosen_segment.end) if chosen_segment else None
            if not chosen:
                remaining_free = WeeklyTimeAxis.subtract(
                    available_segments,
                    [WeeklySegment(start, end) for start, end in occupied],
                )
                available_minutes = WeeklyTimeAxis.capacity(
                    remaining_free,
                    before=deadline,
                    after=max(current_axis, dependency_ready),
                )
                unscheduled.append({
                    "task_id": task_id,
                    "remaining_minutes": remaining,
                    "required_minutes": remaining,
                    "available_minutes": available_minutes,
                    "shortage_minutes": max(remaining - available_minutes, 0),
                    "reason": "no_available_interval_before_deadline" if deadline is not None else "no_available_interval",
                    **({'message': '本次重排范围内没有足够时间；其他日程未移动。请调整任务或明确扩大范围。'} if scope_policy else {}),
                })
                break
            start, end = chosen
            start_at = week_start + timedelta(minutes=start)
            end_at = week_start + timedelta(minutes=end)
            actual_work = min(work, remaining, session_minutes)
            is_today_next_session = start // 1440 == (now.date() - week_start.date()).days and not next_session_policy_applied
            policy_decision = (
                assess_next_session_fit(demand_map.get(task_id), runtime_state).to_dict()
                if is_today_next_session
                else {
                    "fit": "not_assessed",
                    "confidence": "not_applicable",
                    "evidence": ["Momentary state is not projected beyond today's next Session."],
                    "scope": "future_session",
                    "authority": "soft_advisory",
                }
            )
            if is_today_next_session:
                next_session_policy_applied = True
            used_block_ids = {str(b.get('block_id')) for b in blocks}
            while f'{task_id}-deterministic-{session_index}' in used_block_ids:
                session_index += 1
            blocks.append({
                "block_id": f"{task_id}-deterministic-{session_index}",
                "task_id": task_id,
                "day_index": start // 1440,
                "deadline_day_index": deadline // 1440 if deadline is not None else None,
                "start": _hour(start),
                "end": _hour(end),
                "start_at": start_at.isoformat(),
                "end_at": end_at.isoformat(),
                "week_start_minute": start,
                "week_end_minute": end,
                "kind": "task_session",
                "mode": "execution",
                "session_index": session_index,
                "session_minutes": actual_work,
                "planned_work_minutes": actual_work,
                "padding_minutes": max(work - actual_work, 0),
                "total_task_minutes": _remaining_minutes(task),
                "remaining_after_block_minutes": remaining - actual_work,
                "constraint_evidence": [
                    f"Profile focus-session length: {session_minutes} minutes",
                    f"Profile protected rest after session: {rest_minutes} minutes",
                    "Allocated by deterministic Python weekly timeline",
                    *( ["Protected buffer was used because preferred capacity before the deadline was insufficient."] if used_buffer else [] ),
                ],
                "used_buffer": used_buffer,
                "state_scope": "weekly_skeleton",
                "week_id": week_id,
                "plan_status": "proposed",
                "scheduler": "python_timeline_v2",
                "scheduling_policy": policy_decision,
            })
            occupied.append((start, min(end + rest_minutes, (start // 1440 + 1) * 1440)))
            task_end[task_id] = end
            allocated[task_id] += actual_work
            day_index = start // 1440
            daily_load_minutes[day_index] = daily_load_minutes.get(day_index, 0) + actual_work
            remaining -= actual_work
            session_index += 1

    from ..domain.planning.activity_rules import place_remaining_tasks
    frozen_sources = {str(b.get('source_id')) for b in (scope_policy or {}).get('frozen_blocks', [])
                      if b.get('kind') in {'recurring_routine', 'flexible_activity'}}
    remaining_blocks, unplaced_activities = place_remaining_tasks(
        context.get('activity_requirements', []), available_segments, occupied,
        week_start=week_start, now_minute=max(0, (now - week_start).total_seconds() / 60),
        grid=grid_minutes, existing_blocks=blocks, preserved_source_ids=frozen_sources)
    blocks.extend(remaining_blocks)
    blocks.sort(key=lambda item: (_axis(int(item["day_index"]), float(item["start"])), str(item.get("task_id"))))
    return {
        "action": "suggest_plan",
        **({'replan_policy': scope_policy, 'task_ids': scope_policy['allowed_task_ids']} if scope_policy else {}),
        "plan_patch": blocks,
        "candidate_plans": [{"id": "deterministic", "label": "Profile timeline", "plan_patch": blocks, "unscheduled_tasks": unscheduled}],
        "selected_candidate_id": "deterministic",
        "unscheduled_tasks": unscheduled,
        "unscheduled_activities": unplaced_activities,
        "ai_task_analysis": analysis,
        "requires_confirmation": True,
        "control_mode": "python_scheduled_user_confirmed",
        "explanation": f"Python allocated {len(blocks)} focus sessions across the least-loaded eligible days using {session_minutes}-minute sessions and {rest_minutes}-minute protected breaks.",
        "confidence": {"level": "high" if not unscheduled else "medium", "evidence": ["Profile", "Weekly Context", "Task deadlines", "Task dependencies", "Python timeline allocation"]},
        "constraint_summary": {**context, "preferred_session_minutes": session_minutes, "rest_minutes": rest_minutes},
        "scheduler": {"engine": "python_timeline_v2", "policy_version": "human_capacity_soft_v1", "axis_start": 0, "axis_end": 10080, "grid_minutes": grid_minutes, "session_minutes": session_minutes, "rest_minutes": rest_minutes, "initial_available_minutes": WeeklyTimeAxis.capacity(initial_free_segments), "ai_role": "task_analysis_and_soft_review"},
        "task_ids": sorted(schedulable_tasks),
        "week_id": week_id,
    }
