"""Validate a supplied scheduling snapshot without database or HTTP access."""
from collections.abc import Callable
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def validate_user_schedule(user_id: str, payload: dict, *, ensure_profile: Callable,
                           list_tasks: Callable, user_clock_now: Callable,
                           schedule_task_kind: Callable, confirmed_parallel_overlap_allowed: Callable,
                           local_resource_profile: Callable, parallel_pair_rule: Callable,
                           connect=None, decode=None, scope_policy=None) -> dict:
    profile = ensure_profile(user_id)
    tasks = list_tasks(user_id)
    now = user_clock_now(user_id, str(profile.get("timezone") or "Asia/Shanghai"))
    from .replan_scope import load_scope, check_scope
    policy = scope_policy if scope_policy is not None else (load_scope(user_id, {**payload, 'week_id': payload.get('week_id') or profile.get('active_week_id')}, connect=connect, decode=decode) if connect else None)
    scope_errors = check_scope(user_id, policy, payload.get('plan_patch') or [], connect=connect, decode=decode, now=now) if policy else []
    if connect:
        from .session_authorization import pending_block_errors
        scope_errors.extend(pending_block_errors(user_id, policy, payload.get('plan_patch') or [], connect=connect))
    if policy:
        from .session_authorization import session_scope_errors
        scope_errors.extend(session_scope_errors(user_id, policy, payload.get('plan_patch') or [], connect=connect, now=now))
    if policy and scope_policy is None and not payload.get('plan_id'):
        scope_errors.append({'type': 'replan_scope_conflict', 'message': '请通过当前局部重排草稿的计划编号确认，不要脱离草稿提交。'})
    result = validate_schedule(payload, profile=profile, tasks=tasks, now=now, scope_policy=policy,
        schedule_task_kind=schedule_task_kind,
        confirmed_parallel_overlap_allowed=confirmed_parallel_overlap_allowed,
        local_resource_profile=local_resource_profile, parallel_pair_rule=parallel_pair_rule)
    adjustment = (policy or {}).get('execution_adjustment')
    if adjustment:
        candidates = [b for b in payload.get('plan_patch') or []
                      if str(b.get('task_id')) == str(adjustment['task_id'])
                      and str(b.get('block_id')) not in policy['historical_block_ids']]
        candidates.sort(key=lambda b: (int(b['day_index']), float(b['start'])))
        if candidates and int(candidates[0].get('planned_work_minutes') or round((float(candidates[0]['end']) - float(candidates[0]['start'])) * 60)) < adjustment['duration_minutes']:
            scope_errors.append({'type': 'confirmed_interval_not_allocated', 'message': '新安排未容纳本次要求的连续执行时长，请修改方案或重新选择时长。'})
    from ..domain.execution.rest_adjustment import rest_candidate_violations, authorized_rest_gap
    if policy:
        scope_errors.extend(rest_candidate_violations(policy, payload.get('plan_patch') or []))
        result['violations'] = [v for v in result['violations'] if not authorized_rest_gap(v, policy, payload.get('plan_patch') or [])]
    result['violations'].extend(scope_errors)
    result['valid'] = not result['violations']
    return result


def validate_schedule(payload: dict, *, profile: dict, tasks: list[dict], now: datetime,
                      schedule_task_kind: Callable, confirmed_parallel_overlap_allowed: Callable,
                      local_resource_profile: Callable, parallel_pair_rule: Callable, scope_policy=None) -> dict:
    from .scheduling_constraints import scheduling_constraints
    from ..domain.planning.schedule_validation import validate_schedule_snapshot
    from humanos_graph import day_index_from_due, parse_due_start_hour
    target = payload.get('week_id') or profile.get('active_week_id')
    if target:
        profile = {**profile, 'active_week_id': target,
                   'weekly_context': {**(profile.get('weekly_context') or {}), 'week_id': target}}
    return validate_schedule_snapshot(payload, profile=profile, tasks=tasks, now=now,
        context=scheduling_constraints(profile, tasks=tasks, now=now, for_validation=True),
        schedule_task_kind=schedule_task_kind,
        confirmed_parallel_overlap_allowed=confirmed_parallel_overlap_allowed,
        local_resource_profile=local_resource_profile, parallel_pair_rule=parallel_pair_rule,
        day_index_from_due=day_index_from_due, parse_due_start_hour=parse_due_start_hour,
        scope_policy=scope_policy)
