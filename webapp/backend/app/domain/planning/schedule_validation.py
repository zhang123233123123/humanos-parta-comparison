"""Pure schedule snapshot invariants, independent of reads and placement."""
from collections.abc import Callable
from datetime import datetime, timedelta
import math
from zoneinfo import ZoneInfo


def validate_schedule_snapshot(payload: dict, *, profile: dict, tasks: list[dict], now: datetime,
                      schedule_task_kind: Callable, confirmed_parallel_overlap_allowed: Callable,
                      local_resource_profile: Callable, parallel_pair_rule: Callable, context: dict,
                      day_index_from_due: Callable, parse_due_start_hour: Callable, scope_policy=None) -> dict:
    """Validate a user-edited/parallel plan before Sessions are persisted."""
    raw_blocks = payload.get('plan_patch')
    malformed = []
    if not isinstance(raw_blocks, list):
        malformed.append({'type': 'invalid_plan_patch', 'message': 'plan_patch must be an array.'})
    else:
        for index, block in enumerate(raw_blocks):
            try:
                if not isinstance(block, dict):
                    raise ValueError('Plan blocks must be objects.')
                day, start, end = (block[key] for key in ('day_index', 'start', 'end'))
                if any(isinstance(value, bool) for value in (day, start, end)):
                    raise ValueError('Invalid plan time.')
                day, start, end = float(day), float(start), float(end)
                if not all(math.isfinite(value) for value in (day, start, end)) or day not in range(7) or not 0 <= start < end <= 24:
                    raise ValueError('Plan times must be within the seven-day planning period.')
            except (KeyError, TypeError, ValueError) as exc:
                malformed.append({'type': 'invalid_time', 'block_index': index, 'message': str(exc)})
    if malformed:
        return {'valid': False, 'warnings': [], 'violations': malformed,
                'checked_by': 'python_hard_constraint_validator', 'validators': ['snapshot_shape']}
    task_map = {str(task.get("id")): task for task in tasks}
    decision_payload = payload.get("decision") or {}
    requested_task_ids = payload.get("task_ids") or decision_payload.get("task_ids") or []
    plan_task_ids = {
        str(task_id)
        for task_id in requested_task_ids
        if task_id
    }
    plan_task_ids.update(
        str(item.get("task_id"))
        for item in (payload.get("unscheduled_tasks") or [])
        if isinstance(item, dict) and item.get("task_id")
    )
    # Older clients did not send an explicit plan scope. Preserve their
    # account-wide behavior, while current plans validate only the tasks
    # that the proposal was generated to schedule.
    workload_task_map = (
        {task_id: task_map[task_id] for task_id in plan_task_ids if task_id in task_map}
        if plan_task_ids
        else task_map
    )
    if scope_policy:
        workload_task_map = {key: task for key, task in task_map.items() if key in scope_policy['allowed_task_ids']}
    analysis = payload.get("ai_task_analysis") or {}
    violations: list[dict] = []
    from . import hard_dependency_cycle_ids

    dependency_cycle_ids = hard_dependency_cycle_ids(list(workload_task_map.values()), analysis)
    if dependency_cycle_ids:
        violations.append({
            "type": "hard_dependency_cycle",
            "task_ids": sorted(dependency_cycle_ids),
            "detail": "Hard task dependencies contain a cycle and cannot be scheduled.",
        })
    demand_map = {str(item.get("task_id")): item for item in (analysis.get("task_demands") or []) if isinstance(item, dict)}
    profile_map = {str(item.get("task_id")): item for item in (analysis.get("task_resource_profiles") or []) if isinstance(item, dict)}
    from .activity_rules import validate_activities
    from ..timeline import WeeklySegment
    policy = scope_policy or {}
    historical = set(policy.get('historical_block_ids', []))
    frozen_sources = {str(b.get('source_id')) for b in policy.get('frozen_blocks', [])
                      if b.get('kind') in {'recurring_routine', 'flexible_activity'}}
    activity_errors, warnings = validate_activities(
        context.get('activity_requirements', []), payload.get('plan_patch') or [],
        [WeeklySegment(int(w['day_index']) * 1440 + round(w['start'] * 60),
                       int(w['day_index']) * 1440 + round(w['end'] * 60))
         for w in context.get('activity_availability', [])],
        historical_ids=historical, preserved_source_ids=frozen_sources)
    violations.extend(activity_errors)
    current_axis = policy.get('window_start', -1)
    expected_fixed = sorted((str(b.get('task_id') or ''), int(b['day_index']), float(b['start']), float(b['end']))
        for b in context.get('hard_constraints', [])
        if int(b['day_index']) * 1440 + float(b['end']) * 60 > current_axis)
    actual_fixed = sorted((str(b.get('task_id') or ''), int(b['day_index']), float(b['start']), float(b['end']))
        for b in payload.get('plan_patch', []) if b.get('kind') == 'fixed_event'
        and (not b.get('task_id') or str(b['task_id']) in context.get('timed_task_ids', []))
        and int(b['day_index']) * 1440 + float(b['end']) * 60 > current_axis)
    if expected_fixed != actual_fixed:
        violations.append({'type': 'fixed_commitment_mismatch', 'message': '固定事项已变化、缺失或重复，请重新核对。'})
    windows = context.get("movable_routine_windows") or context.get("windows", [])
    blocks: list[dict] = []
    planned_work: dict[str, int] = {}
    for raw in payload.get("plan_patch") or []:
        if scope_policy and str(raw.get('block_id')) in scope_policy['historical_block_ids']:
            continue  # Preserved history is not unexecuted work in the new plan.
        if not isinstance(raw, dict) or not raw.get("task_id"):
            continue
        block = dict(raw)
        task_id = str(block.get("task_id"))
        task = task_map.get(task_id)
        if not task:
            violations.append({"type": "unknown_task", "task_id": task_id})
            continue
        if task.get("removed_from_week") or task.get("status") in {"completed", "terminated"}:
            violations.append({"type": "inactive_task", "task_id": task_id})
            continue
        if task.get('schedule_constraints'):
            kind = schedule_task_kind(task)
            if block.get('kind') != kind or str(block.get('source_id') or '') != task_id:
                violations.append({'type': 'activity_task_identity_mismatch', 'task_id': task_id})
                continue
            # Occurrence workload and windows are checked by activity/fixed rules,
            # not by ordinary-task lifetime remaining-work accounting.
            blocks.append(block)
            continue
        try:
            day = int(block.get("day_index"))
            start = float(block.get("start"))
            end = float(block.get("end"))
        except (TypeError, ValueError):
            violations.append({"type": "invalid_time", "task_id": task_id})
            continue
        if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= 24:
            violations.append({"type": "invalid_time", "task_id": task_id})
            continue
        if schedule_task_kind(task) != "fixed_event":
            if not any(window["day_index"] == day and start >= window["start"] - 0.001 and end <= window["end"] + 0.001 for window in windows):
                violations.append({"type": "outside_available_window", "task_id": task_id})
            conflict = next((item for item in context.get("hard_constraints", []) if item["day_index"] == day and start < item["end"] and item["start"] < end), None)
            if conflict:
                violations.append({"type": "hard_constraint_conflict", "task_id": task_id, "constraint": conflict.get("label")})
            due_day = day_index_from_due(task.get("deadline_at"), now)
            due_hour = parse_due_start_hour(task.get("deadline_at"))
            # An optional deadline is not the weekly scheduling boundary.
            # Availability/timeline validation still constrains undated tasks.
            due_text = str(task.get('deadline_at') or '').strip()
            try:
                deadline = datetime.fromisoformat(due_text.replace('Z','+00:00'))
                timezone = ZoneInfo(profile.get('timezone') or 'Asia/Shanghai')
                if deadline.tzinfo is None:deadline = deadline.replace(tzinfo=timezone)
                if len(due_text) == 10:deadline += timedelta(days=1)
                plan_week = str(payload.get('week_id') or profile.get('active_week_id') or now.date().isoformat())
                block_end = datetime.fromisoformat(plan_week).replace(tzinfo=timezone) + timedelta(days=day,hours=end)
                missed_deadline = block_end > deadline
            except (ValueError,TypeError):
                from .period import day_offset
                if due_day is not None:due_day = day_offset(profile, due_day, now)
                missed_deadline = due_day is None or day > due_day or (day == due_day and due_hour is not None and end > due_hour + 0.001)
            if due_text and missed_deadline:
                violations.append({"type": "deadline", "task_id": task_id})
        blocks.append({**block, "day_index": day, "start": start, "end": end})
        if not block.get('source_candidate_id'):
            planned_work[task_id] = planned_work.get(task_id, 0) + int(block.get("planned_work_minutes") or round((end - start) * 60))

    active_schedulable = [
        task for task in workload_task_map.values()
        if not task.get("removed_from_week")
        and task.get("status") not in {"completed", "terminated", "blocked"}
        and schedule_task_kind(task) == "flexible_task"
        and int((task.get("execution") or {}).get("remaining_duration_minutes", task.get("duration") or 0)) > 0
    ]
    if active_schedulable and not blocks:
        violations.append({
            "type": "empty_plan_with_active_tasks",
            "task_ids": [str(task.get("id")) for task in active_schedulable],
            "detail": "A plan with active remaining work must contain at least one scheduled block.",
        })

    groups: dict[str, set[str]] = {}
    for block in blocks:
        if block.get("parallel_group_id"):
            groups.setdefault(str(block["parallel_group_id"]), set()).add(str(block.get("task_id")))
    for group_id, task_ids in groups.items():
        if len(task_ids) != 2:
            violations.append({"type": "parallel_group_size", "parallel_group_id": group_id, "task_ids": sorted(task_ids)})

    for day in range(7):
        ordered = sorted((block for block in blocks if block.get("day_index") == day), key=lambda item: (item.get("start", 0), item.get("end", 0)))
        for index, first in enumerate(ordered):
            for second in ordered[index + 1:]:
                if float(second["start"]) >= float(first["end"]) - 0.001:
                    break
                if not confirmed_parallel_overlap_allowed(first, second):
                    violations.append({"type": "overlap", "block_ids": [first.get("block_id"), second.get("block_id")]})
                    continue
                first_id = str(first.get("task_id"))
                second_id = str(second.get("task_id"))
                first_profile = profile_map.get(first_id) or {"task_id": first_id, **local_resource_profile(task_map[first_id])}
                second_profile = profile_map.get(second_id) or {"task_id": second_id, **local_resource_profile(task_map[second_id])}
                rule_ok, rule_reason = parallel_pair_rule(first_profile, second_profile, demand_map)
                if not rule_ok:
                    violations.append({"type": "parallel_resource_conflict", "task_ids": [first_id, second_id], "detail": rule_reason})
    for dependency in analysis.get("dependencies") or []:
        if not isinstance(dependency, dict) or dependency.get("hard_enforced") is not True:
            continue
        before_id = str(dependency.get("before_task_id") or "")
        after_id = str(dependency.get("after_task_id") or "")
        before = [item for item in blocks if str(item.get("task_id")) == before_id]
        after = [item for item in blocks if str(item.get("task_id")) == after_id]
        if before and after:
            before_end = max(int(item["day_index"]) * 24 + float(item["end"]) for item in before)
            after_start = min(int(item["day_index"]) * 24 + float(item["start"]) for item in after)
            if before_end > after_start + 0.001:
                violations.append({"type": "dependency_order", "before_task_id": before_id, "after_task_id": after_id})
    explicit_unallocated = {}
    for item in payload.get('unscheduled_tasks') or []:
        if isinstance(item, dict):
            task_id = str(item.get('task_id'))
            explicit_unallocated[task_id] = explicit_unallocated.get(task_id, 0) + int(item.get('remaining_minutes') or 0)
    for task_id, task in workload_task_map.items():
        if task.get("removed_from_week") or task.get("status") in {"completed", "terminated", "blocked"} or schedule_task_kind(task) != "flexible_task":
            continue
        remaining = int((task.get("execution") or {}).get("remaining_duration_minutes", task.get("duration") or 0))
        allocated = planned_work.get(task_id, 0)
        if allocated > remaining:
            violations.append({"type": "planned_work_exceeds_remaining", "task_id": task_id, "planned": allocated, "remaining": remaining})
        elif allocated < remaining and explicit_unallocated.get(task_id) != remaining - allocated:
            violations.append({"type": "unexplained_unallocated_work", "task_id": task_id, "planned": allocated, "remaining": remaining})
    from ..timeline.snapshot_validation import validate_weekly_plan_timeline
    from ..profile.timing import rest_minutes as profile_rest_minutes

    week_id = str(payload.get("week_id") or profile.get("active_week_id") or now.date().isoformat())
    timezone_name = str(profile.get("timezone") or "Asia/Shanghai")
    timeline_violations = validate_weekly_plan_timeline(
        week_id=week_id,
        timezone_name=timezone_name,
        blocks=blocks + [raw for raw in payload.get('plan_patch') or []
                         if isinstance(raw, dict) and not raw.get('task_id')
                         and (not scope_policy or str(raw.get('block_id')) not in scope_policy['historical_block_ids'])],
        task_kinds={task_id: schedule_task_kind(task) for task_id, task in task_map.items()},
        minimum_rest_minutes=profile_rest_minutes(profile.get('task_preferences') or {}),
    )
    violations.extend(timeline_violations)
    return {
        "valid": not violations,
        "warnings": warnings,
        "violations": violations,
        "checked_by": "python_hard_constraint_validator",
        "validators": ["task_rules", "activity_rules", "canonical_weekly_timeline"],
    }
