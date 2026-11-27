"""Six-step execution adjustment coordinator using the existing planner.

Preview reads facts; confirmation applies an interval or checkpoints execution
before handing remaining work to the existing plan review/confirmation workflow.
"""
from dataclasses import dataclass
from collections.abc import Callable
from ..domain.execution.adjustment import adjustment_review
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.recommendation_events import RecommendationEventRepository


@dataclass(frozen=True)
class AdjustmentPorts:
    connect: Callable
    atomic: Callable
    execution_session_row: Callable
    get_task: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    active_plan: Callable
    list_tasks: Callable
    save_proposed_plan: Callable
    start_execution_session: Callable
    interrupt_execution_session: Callable
    log_event: Callable
    decode: Callable
    now: Callable


def review(user_id, payload, *, ports):
    with ports.connect() as conn:
        row = ExecutionSessionRepository(conn).get(user_id=user_id, session_id=str(payload.get('execution_session_id') or ''))
    if row is None:
        raise KeyError('Execution session not found')
    session = ports.execution_session_row(row)
    if session['status'] not in {'running', 'paused'}:
        raise ValueError('执行状态已变化，请刷新后重新选择。')
    task = ports.get_task(session['task_id'], user_id)
    profile = ports.ensure_profile(user_id)
    current = ports.user_clock_now(user_id, profile.get('timezone') or 'Asia/Shanghai')
    plan = ports.active_plan(user_id, session.get('week_id')) or {}
    correction = payload.get('task_remaining_minutes')
    if correction is not None and (isinstance(correction, bool) or not isinstance(correction, int) or correction < 0):
        raise ValueError('剩余工作量必须是非负整数。')
    # Resolve the single stored deadline using the planner's date semantics,
    # including older natural-language dates. Do not persist another alias.
    from .deterministic_scheduler import _deadline_axis
    from datetime import timedelta
    day_start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    deadline_minute = _deadline_axis(task, current, day_start)
    review_task = {**task, 'deadline_at': (day_start + timedelta(minutes=deadline_minute)).isoformat() if deadline_minute is not None else None}
    result = adjustment_review(session=session, task=review_task, plan=plan, profile=profile, now=current,
                               requested_minutes=payload.get('duration_minutes'), next_step=str(payload.get('next_step') or '').strip())
    # Recheck current Profile commitments as well as the persisted calendar.
    from humanos_graph import build_scheduling_context, day_index_from_due, parse_due_start_hour
    from datetime import timedelta
    from ..domain.planning.period import period_start
    current_day = (current.date() - period_start(profile, current)).days
    context = build_scheduling_context(profile)
    start_hour = current.hour + current.minute / 60 + current.second / 3600
    finish = current + timedelta(minutes=payload['duration_minutes'])
    end_hour = finish.hour + finish.minute / 60 + finish.second / 3600
    windows = context.get('movable_routine_windows') or context.get('windows', [])
    errors = result['feasibility']['reason_codes']
    if finish.date() != current.date() or not any(w['day_index'] == current_day and start_hour >= w['start'] and end_hour <= w['end'] for w in windows):
        errors.append('outside_available_window')
    if any(c['day_index'] == current_day and start_hour < c['end'] and c['start'] < end_hour for c in context.get('hard_constraints', [])):
        errors.append('fixed_commitment_conflict')
    if str(task.get('deadline_at') or '').strip():
        from .deterministic_scheduler import _deadline_axis
        from datetime import datetime
        start = datetime.combine(period_start(profile, current), datetime.min.time(), tzinfo=current.tzinfo)
        deadline = _deadline_axis(task, current, start)
        if deadline is None or (finish - start).total_seconds() / 60 > deadline:
            errors.append('deadline_conflict')
    if errors:
        result['feasibility']['can_continue'] = False
        result['options'] = ['replan', 'manual', 'defer']
    if correction is not None:
        import hashlib
        result['facts']['reported_task_remaining_minutes'] = correction
        result['feasibility']['can_continue'] = False
        result['feasibility']['reason_codes'].append('remaining_work_correction')
        result['options'] = ['replan', 'manual', 'defer']
        result['confirmation_token'] = hashlib.sha256(f"{result['confirmation_token']}:{correction}".encode()).hexdigest()
    return result, session


def adjust_execution(user_id, payload, *, ports):
    if payload.get('stage') == 'manual':
        from .manual_execution_adjustment import manual_adjustment_draft
        return manual_adjustment_draft(user_id, payload, ports=ports)
    if payload.get('stage', 'preview') == 'preview':
        return {'review': review(user_id, payload, ports=ports)[0]}
    if payload.get('stage') != 'confirm':
        raise ValueError('Unknown adjustment stage')
    request_id = payload.get('request_id')
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 200:
        raise ValueError('request_id is required')
    command = {k: payload.get(k) for k in ('execution_session_id', 'duration_minutes', 'next_step', 'progress', 'task_remaining_minutes', 'choice', 'confirmation_token')}
    with ports.atomic():
        with ports.connect() as conn:
            receipt = RecommendationEventRepository(conn).latest(user_id, request_id, 'execution_adjustment_applied')
        if receipt:
            saved = ports.decode(receipt['payload_json'], {})
            if saved['command'] != command:
                raise ValueError('request_id belongs to another adjustment')
            return saved['result']
        checked, session = review(user_id, payload, ports=ports)
        if checked['confirmation_token'] != payload.get('confirmation_token'):
            raise ValueError('时间、任务或日历已变化，请重新检查后确认。')
        choice = payload.get('choice')
        if choice == 'continue':
            if not checked['feasibility']['can_continue']:
                raise ValueError('需要先调整并确认计划，不能直接继续。')
            if session['status'] == 'paused':
                session = ports.start_execution_session(user_id, {'execution_session_id': session['execution_session_id'], 'request_id': request_id + ':resume'})
            # Use current persisted execution timestamps, not browser time.
            from ..domain.execution.adjustment import date
            current = ports.user_clock_now(user_id, ports.ensure_profile(user_id).get('timezone') or 'Asia/Shanghai')
            baseline = int(session.get('accumulated_active_minutes') or 0) * 60
            started = date(session.get('resumed_at') or session.get('actual_start_at'), current.tzinfo)
            if started: baseline += max((current - started).total_seconds(), 0)
            with ports.connect() as conn:
                ExecutionSessionRepository(conn).set_confirmed_work(user_id=user_id, session_id=session['execution_session_id'],
                    minutes=payload['duration_minutes'], baseline_seconds=baseline, timestamp=ports.now())
            result = {'status': 'running', 'execution_session_id': session['execution_session_id'], 'review': checked}
        elif choice in {'replan', 'manual', 'defer', 'borrow_rest'}:
            if choice == 'borrow_rest' and not any(c['kind'] == 'rest_buffer' for c in checked['feasibility']['conflicts']):
                raise ValueError('没有已复核的休息冲突。')
            checkpoint = ports.interrupt_execution_session(user_id, {
                'execution_session_id': session['execution_session_id'], 'interruption_action': 'continue_later',
                'request_id': request_id + ':checkpoint', 'pause_reason': 'execution_adjustment',
                'progress': str(payload.get('progress') or ''), 'next_step': str(payload.get('next_step') or ''),
                'resume_preference': 'unknown', 'task_remaining_minutes': payload.get('task_remaining_minutes'),
            }, index_memory=False)
            result = {'status': 'awaiting_plan' if choice != 'defer' else 'deferred', 'review': checked,
                      'checkpoint': checkpoint, 'task_id': session['task_id'], 'week_id': session.get('week_id'),
                      'replan_request_id': request_id + ':replan', 'requires_plan_confirmation': True}
        else:
            raise ValueError('Unknown adjustment choice')
        ports.log_event(user_id, 'execution_adjustment_applied', {'id': request_id, 'command': command, 'result': result})
        return result
