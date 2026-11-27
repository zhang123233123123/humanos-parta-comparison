"""Model-only assessment of whether to offer today's adjustment; never schedules."""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import logging

from ..domain.daily_review_output import authorized_daily_review_model
from .calendar_advisor import sessions_for_local_date
from .scheduling_prompt_context import scheduling_prompt_context, select_fields, compact_execution_context
from .behavior_prompt_context import add_behavior_context
from .schedule_review_prompts import DAILY_REVIEW_PROMPT as SYSTEM_PROMPT, DAILY_REVIEW_VERSION


@dataclass(frozen=True)
class DailyReviewPorts:
    ensure_profile: Callable
    user_clock_now: Callable
    latest_runtime_state: Callable
    list_tasks: Callable
    list_execution_sessions: Callable
    active_plan: Callable
    recent_behavior: Callable
    learned_behavior: Callable
    typed_completion: Callable
    encode: Callable
    log_event: Callable


SESSION_FIELDS = (
    'execution_session_id', 'block_id', 'task_id', 'task_title', 'status', 'week_id', 'plan_revision',
    'planned_start_at', 'planned_end_at', 'planned_work_minutes', 'actual_start_at',
    'actual_end_at', 'paused_at', 'updated_at', 'accumulated_active_minutes',
    'session_remaining_minutes', 'task_remaining_minutes', 'live_active_minutes',
    'pause_reason', 'interruption_action', 'interruption_snapshot_json',
)


def read_facts(user_id, ports):
    profile = ports.ensure_profile(user_id)
    now = ports.user_clock_now(user_id, profile.get('timezone') or 'Asia/Shanghai')
    state = ports.latest_runtime_state(user_id)
    week = str(profile.get('active_week_id') or (profile.get('weekly_context') or {}).get('week_id') or '')
    plan = ports.active_plan(user_id, week) or {}
    tasks = [t for t in ports.list_tasks(user_id) if not t.get('removed_from_week')
             and not t.get('archived_at') and (not week or t.get('week_id') == week)]
    sessions = [s for s in ports.list_execution_sessions(user_id)
                if s.get('status') != 'superseded' and (not week or s.get('week_id') == week)]
    return profile, now, state, plan, tasks, sessions


def fact_version(facts):
    profile, now, state, plan, tasks, sessions = facts
    # Freshness check only, never a heuristic decision about suitability.
    persisted_sessions = [select_fields(s, tuple(f for f in SESSION_FIELDS if f not in {
        'live_active_minutes', 'session_remaining_minutes', 'task_remaining_minutes'})) for s in sessions]
    return (profile, now.date(), state.get('id'), state.get('current_eligible'), plan, tasks, persisted_sessions)


def build_context(facts):
    from humanos_graph import build_scheduling_context
    profile, now, state, plan, tasks, sessions = facts
    week = profile.get('active_week_id') or (profile.get('weekly_context') or {}).get('week_id')
    day = (now.date() - datetime.fromisoformat(week).date()).days
    today = sessions_for_local_date(sessions, tasks, now)
    remaining = [s for s in today if s.get('status') == 'ready' and not s.get('actual_start_at')
                 and datetime.fromisoformat(s['planned_start_at']) >= now]
    task_ids = {str(s.get('task_id')) for s in remaining}
    finished_blocks = {str(s.get('block_id')) for s in today
                       if s.get('status') in {'completed', 'ended', 'interrupted', 'partial', 'terminated', 'not_started'}}
    task_ids.update(str(b['task_id']) for b in plan.get('plan_patch', [])
                    if b.get('task_id') and b.get('day_index') == day
                    and str(b.get('block_id')) not in finished_blocks
                    and float(b.get('end', 0)) > now.hour + now.minute / 60)
    task_ids -= {str(s.get('task_id')) for s in today if s.get('status') == 'running'}
    task_ids &= {str(t['id']) for t in tasks if t.get('status') not in {'completed', 'terminated'}}
    context = scheduling_prompt_context(profile=profile, tasks=tasks, runtime_state=state,
                                       plan=plan)
    for projected, task in zip(context['tasks'], tasks):
        projected.update(select_fields(task, ('description', 'remaining_duration_minutes', 'task_remaining_minutes')))
    # Never include the plan's old runtime-state snapshot or global chat history.
    context['existing_plan']['plan_patch'] = [select_fields(b, (
        'block_id', 'task_id', 'source_id', 'kind', 'day_index', 'start', 'end', 'start_at', 'end_at',
        'planned_work_minutes', 'session_minutes', 'parallel_group_id', 'parallel_user_confirmed',
    )) for b in plan.get('plan_patch', []) if b.get('day_index') == day]
    context.update(current_time=now.isoformat(), local_date=now.date().isoformat(),
                   period_start=week, day_index=day, scope='today',
                   remaining_task_ids=sorted(task_ids),
                   today_sessions=[select_fields(s, tuple(f for f in SESSION_FIELDS if f != 'interruption_snapshot_json')) for s in today])
    timing = build_scheduling_context({**profile, 'active_week_id': week,
                                      'weekly_context': {**profile.get('weekly_context', {}), 'week_id': week}})
    context['today_constraints'] = {
        key: [v for v in value if v.get('day_index') == day] if isinstance(value, list)
             and all(isinstance(v, dict) for v in value) else value
        for key, value in timing.items()
    }
    return context


def evaluate_daily_plan(user_id, *, locale, ports):
    zh = locale != 'en'
    unavailable = {
        'assessment_status': 'unavailable', 'decision': None, 'requires_plan_adjustment': False,
        'reason': '状态已保存，但模型评估暂不可用；原计划保持不变，请重试评估。' if zh else
                  'Your state is saved, but model review is unavailable. Your plan is unchanged; retry the review.',
        'affected_task_ids': [], 'missing_information': [], 'reason_codes': [],
        'first_session': None, 'options': ['retry_review', 'keep_plan'],
    }
    try:
        facts = read_facts(user_id, ports)
        context = compact_execution_context(build_context(facts))
        add_behavior_context(context, user_id, recent_behavior=ports.recent_behavior,
                             learned_behavior=ports.learned_behavior,
                             task_ids=context['remaining_task_ids'])
        output_model = authorized_daily_review_model(context['remaining_task_ids'])
        result = ports.typed_completion([
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': ports.encode({'prompt_version': DAILY_REVIEW_VERSION, 'locale': 'zh' if zh else 'en', 'context': context})},
        ], output_model, 'daily_plan_review')
        result = output_model.model_validate(result).model_dump()
        if not set(result['affected_task_ids']).issubset(set(context['remaining_task_ids'])):
            raise ValueError('Review referred to tasks outside today’s remaining work')
        if fact_version(facts) != fact_version(read_facts(user_id, ports)):
            return {**unavailable, 'reason': '评估期间状态或安排已变化，请重新评估；原计划未改变。' if zh else
                    'State or schedule changed during review. Retry; the active plan is unchanged.'}
        review = {**result, 'assessment_status': 'completed',
                  'requires_plan_adjustment': result['decision'] == 'suggest_adjustment',
                  'evaluated_at': facts[1].isoformat(), 'state_id': facts[2].get('id'),
                  'plan_id': facts[3].get('plan_id'), 'first_session': None, 'reason_codes': [],
                  'options': ['view_adjustment', 'keep_plan'] if result['decision'] == 'suggest_adjustment' else ['keep_plan']}
        ports.log_event(user_id, 'daily_plan_review_evaluated', {'prompt_version': DAILY_REVIEW_VERSION, 'context': context, 'review': review})
        return review
    except Exception as exc:
        logging.getLogger(__name__).warning('Daily plan model review unavailable (%s)', type(exc).__name__)
        return unavailable
