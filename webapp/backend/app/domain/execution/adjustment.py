"""Read-only execution adjustment facts and interval feasibility.

A short gap is not evidence that a task can be fragmented. The user must name
an explicit stopping point before choosing a smaller execution scope.
"""
from datetime import datetime, timedelta
import hashlib
import json


def date(value, tz):
    if not value:
        return None
    result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return result.replace(tzinfo=tz) if result.tzinfo is None else result.astimezone(tz)


def adjustment_review(*, session, task, plan, profile, now, requested_minutes, next_step=''):
    if isinstance(requested_minutes, bool) or not isinstance(requested_minutes, int) or not 1 <= requested_minutes <= 480:
        raise ValueError('请选择 1–480 分钟的执行时长。')
    accumulated = int(session.get('accumulated_active_minutes') or 0)
    active_seconds = accumulated * 60
    started = date(session.get('resumed_at') or session.get('actual_start_at'), now.tzinfo)
    if session.get('status') == 'running' and started:
        active_seconds += max(int((now - started).total_seconds()), 0)
    snapshot = json.loads(session.get('interruption_snapshot_json') or '{}')
    settled = int(snapshot.get('actual_minutes') or 0)
    remaining = (task.get('execution') or {}).get('remaining_duration_minutes')
    if remaining is None:
        remaining = task.get('duration')
    remaining = None if remaining is None else max(int(remaining) - max(active_seconds // 60 - settled, 0), 0)
    end = now + timedelta(minutes=requested_minutes)
    conflicts = []
    week = date(str(plan.get('week_id')) + 'T00:00:00', now.tzinfo) if plan.get('week_id') else None
    for block in plan.get('plan_patch') or []:
        if block.get('block_id') == session.get('block_id'):
            continue
        start = date(block.get('start_at'), now.tzinfo)
        finish = date(block.get('end_at'), now.tzinfo)
        if week and (start is None or finish is None):
            start = week + timedelta(days=int(block['day_index']), hours=float(block['start']))
            finish = week + timedelta(days=int(block['day_index']), hours=float(block['end']))
        if start is None or finish is None or max(now, start) >= min(end, finish):
            continue
        overlap = max((min(end, finish) - max(now, start)).total_seconds() / 60, 0)
        rest = block.get('kind') == 'rest_buffer'
        conflicts.append({'block_id': block.get('block_id'), 'task_id': block.get('task_id'),
                          'title': block.get('title') or block.get('label') or block.get('task_title') or block.get('task_id') or '休息',
                          'kind': block.get('kind', 'task_session'),
                          'start_at': start.isoformat(), 'end_at': finish.isoformat(),
                          'overlap_minutes': round(overlap, 2),
                          'rest_remaining_minutes': max(round((finish - max(end, start)).total_seconds() / 60, 2), 0) if rest else None})
    planned_end = date(session.get('planned_end_at'), now.tzinfo)
    planned_start = date(session.get('planned_start_at'), now.tzinfo)
    inside_block = bool(planned_start and planned_end and now >= planned_start and end <= planned_end)
    same_plan = bool(plan.get('plan_id') and any(b.get('block_id') == session.get('block_id') for b in plan.get('plan_patch') or []))
    enough_work = remaining is not None and 0 < requested_minutes <= remaining
    reasons = []
    if not same_plan: reasons.append('active_plan_required')
    if not inside_block: reasons.append('outside_confirmed_block')
    if conflicts: reasons.append('calendar_conflict')
    if not enough_work: reasons.append('remaining_work_needs_review')
    deadline = date(task.get('deadline_at'), now.tzinfo)
    if deadline and end > deadline: reasons.append('deadline_conflict')
    feasible = not reasons
    available = max(int(((planned_end or now) - now).total_seconds() // 60), 0)
    for conflict in conflicts:
        available = min(available, max(int((date(conflict['start_at'], now.tzinfo) - now).total_seconds() // 60), 0))
    if remaining is not None: available = min(available, remaining)
    # Bind confirmation to the live minute, plan, profile, task and execution state.
    state = {'session': session, 'task': task, 'plan': plan, 'profile': profile,
             'minute': now.isoformat()[:16], 'requested_minutes': requested_minutes, 'next_step': next_step}
    token = hashlib.sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()
    return {'execution_session_id': session['execution_session_id'], 'task_id': task['id'],
            'facts': {'active_minutes': active_seconds // 60, 'task_remaining_minutes': remaining},
            'intent': {'duration_minutes': requested_minutes, 'next_step': next_step},
            'feasibility': {'can_continue': feasible, 'reason_codes': reasons, 'conflicts': conflicts,
                            'available_minutes': available, 'estimated_end_at': end.isoformat()},
            'confirmation_token': token,
            'options': ['continue'] if feasible else ['replan', 'manual', 'defer'],
            'formal_calendar_changed': False}
