"""Code-owned immediate choices; each carries explicit feasibility and consequences."""
from .deterministic_scheduler import session_limit_minutes
from ..domain.profile.timing import rest_minutes


def build_decision_options(context: dict, recommendation=None) -> list[dict]:
    limit = session_limit_minutes(context.get('task_preferences') or {})
    rest = rest_minutes(context.get('task_preferences') or {})
    remaining = max(int(context.get('remaining_minutes') or 0),0)
    checks = context.get('option_checks') or {}
    raw = []
    if remaining > 0:
        raw.append({'option_id':'continue_current','action':'continue_current',
                    'duration_minutes':min(limit,remaining)})
    if rest > 0:
        raw.append({'option_id':'short_break','action':'short_break','break_minutes':rest})
    raw.append({'option_id':'continue_later','action':'continue_later'})
    for item in context.get('ready_queue') or []:
        sid = item.get('execution_session_id')
        if sid:
            raw.append({'option_id':f'switch:{sid}','action':'switch_task',
                        'target_execution_session_id':sid,'target_task_id':item.get('task_id'),
                        'target_task_title':item.get('task_title')})
    result = []
    for option in raw:
        check = checks.get(option['option_id']) or {}
        if check.get('feasible') is not True:
            continue
        option.update({'validated':True,'validation':{'valid':True,'violations':[],
            'checked_by':'python_help_decide_options'}, 'impact':check,
            'consequence_code':{'continue_current':'continue_preserves_context',
                'short_break':'break_delays_work','continue_later':'defer_requires_plan_review',
                'switch_task':'switch_requires_reentry'}[option['action']]})
        result.append(option)
    return result


def check_decision_options(user_id, context, *, session, task, profile, ready_sessions, ready_tasks, ports):
    """Same checker is used before recommendation and again before application."""
    from datetime import timedelta
    from ..domain.execution.adjustment import adjustment_review
    limit = session_limit_minutes(profile.get('task_preferences') or {})
    rest = rest_minutes(profile.get('task_preferences') or {})
    now = ports.user_clock_now(user_id,profile.get('timezone') or 'Asia/Shanghai')
    plan = ports.active_plan(user_id,str(session.get('week_id') or '')) or {}
    checks = {}
    def work_check(target, target_task, minutes):
        from ..domain.task.eligibility import require_executable_task
        try:
            require_executable_task(target_task)
        except ValueError:
            return {'feasible':False,'reason_codes':['task_not_executable']}
        if minutes <= 0:
            return {'feasible':False,'reason_codes':['no_remaining_work']}
        review = adjustment_review(session=target,task=target_task,plan=plan,profile=profile,
                                   now=now,requested_minutes=minutes)['feasibility']
        return {'feasible':review['can_continue'], **review}
    remaining = max(int(context.get('remaining_minutes') or 0),0)
    checks['continue_current'] = work_check(session,task,min(limit,remaining))
    if rest > 0:
        impact = ports.analyze_execution_impact(user_id, {'execution_session_id':session['execution_session_id'],
            'action':'short_break','break_minutes':rest,'remaining_minutes':remaining+rest})
        checks['short_break'] = {'feasible':impact.get('requires_plan_adjustment') is False or bool(plan.get('plan_id') and plan.get('plan_status') in {'confirmed','needs_update'}),
                                'requires_plan_review':impact.get('requires_plan_adjustment') is True,
                                'break_minutes':rest, 'break_end_at':(now+timedelta(minutes=rest)).isoformat(), 'resume_time_requires_review':True, 'downstream_impact':impact}
    checks['continue_later'] = {'feasible':bool(plan.get('plan_id') and plan.get('plan_status') in {'confirmed','needs_update'}),
        'requires_resume_time':True,'requires_plan_review':True,'formal_calendar_changed':False}
    for ready in ready_sessions:
        sid = ready['execution_session_id']
        minutes = int(ready.get('session_remaining_minutes') or ready.get('planned_work_minutes') or 0)
        checks[f'switch:{sid}'] = work_check(ready,ready_tasks.get(str(ready.get('task_id'))) or {},minutes) if 0 < minutes <= limit else {'feasible':False,'reason_codes':['session_limit_exceeded']}
    return checks
