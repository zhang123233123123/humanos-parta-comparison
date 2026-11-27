"""Generate a bounded candidate using existing plan persistence and validation."""
from copy import deepcopy
from .scheduling_error import SchedulingError
from datetime import datetime, timedelta
from ..domain.execution.session_adjustment import SessionAdjustment, authorized_adjustment_model
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.session_reports import SessionReportRepository
from ..repositories.plans import PlanRepository
from ..domain.replan_scope import build_scope_policy
from .scheduling_prompt_context import scheduling_prompt_context, compact_execution_context
from .behavior_prompt_context import add_behavior_context
from .schedule_review_prompts import SESSION_PROPOSAL_PROMPT, SESSION_PROPOSAL_VERSION


def read_context(user_id, command, ports):
    profile = ports.ensure_profile(user_id)
    now = ports.user_clock_now(user_id, profile.get('timezone'))
    plan = ports.active_plan(user_id) or {}
    state = ports.latest_runtime_state(user_id)
    if (plan.get('plan_id') != command.get('base_plan_id') or plan.get('plan_revision') != command.get('base_plan_revision')
            or state.get('id') != command.get('base_state_id') or now.date().isoformat() != command.get('local_date')):
        raise ValueError('The plan, state or local date changed; regenerate this draft')
    with ports.connect() as conn:
        rows = [dict(s) for s in ExecutionSessionRepository(conn).list_for_user(user_id=user_id)
                if s['week_id'] == plan['week_id'] and s['status'] != 'superseded']
        pending = {r['id']: dict(r) for r in SessionReportRepository(conn).pending(user_id)}
    blocks = {str(b['block_id']): b for b in plan['plan_patch']}
    eligible = {s['id']: s for s in rows if s['status'] == 'ready' and not s['actual_start_at']
                and s['block_id'] in blocks and blocks[s['block_id']].get('kind') != 'fixed_event'
                and datetime.fromisoformat(s['planned_start_at']) >= now
                and (command['scope'] == 'remaining_planning_period'
                     or datetime.fromisoformat(s['planned_start_at']).astimezone(now.tzinfo).date() == now.date())}
    if not set(command['adjustable_session_ids']).issubset(eligible):
        raise ValueError('Work already started or is outside the authorized scope')
    if any(cid not in pending or pending[cid]['status'] != 'pending' or pending[cid]['week_id'] != plan['week_id']
           for cid in command['authorized_candidate_ids']):
        raise ValueError('Pending work is no longer available')
    return profile, now, plan, state, rows, pending, eligible


def replay_proposal(repository, user_id, command, decode):
    existing = repository.find_request(user_id=user_id, request_id=command['request_id'])
    if not existing:
        return None
    saved = decode(existing['plan_json'], {})
    if saved.get('replan_policy', {}).get('runtime_authorization') != command or existing['plan_status'] != 'proposed':
        raise ValueError('This proposal request is no longer current')
    return saved['runtime_proposal']


def propose_sessions(user_id, command, *, ports):
    try:
        return _propose_sessions(user_id, command, ports=ports)
    except SchedulingError:
        raise
    except ValueError as exc:
        message = str(exc)
        codes = {
            'The plan, state or local date changed; regenerate this draft': 'schedule_stale',
            'This proposal request is no longer current': 'schedule_stale',
            'Execution changed during generation; regenerate': 'schedule_stale',
            'Work already started or is outside the authorized scope': 'schedule_scope',
            'Pending work is no longer available': 'schedule_stale',
            'No future work was authorized for scheduling': 'schedule_empty',
            'Adjustment generation is temporarily unavailable; the original plan is unchanged': 'schedule_generation_unavailable',
            'Model changed work outside the authorized set': 'schedule_model_scope',
            'Calendar duration cannot be shorter than the work budget': 'schedule_duration',
            'A time adjustment cannot change the session duration': 'schedule_duration',
        }
        if message in codes:
            raise SchedulingError(codes[message], message) from exc
        raise


def _propose_sessions(user_id, command, *, ports):
    allowed = {'user_id', 'request_id', 'base_plan_id', 'base_plan_revision', 'base_state_id',
               'adjustable_session_ids', 'authorized_candidate_ids', 'scope', 'local_date', 'candidate_duration_minutes', 'locale'}
    if set(command) - allowed or not isinstance(command.get('request_id'), str) or not 0 < len(command['request_id']) <= 200:
        raise ValueError('Invalid proposal request')
    if command.get('scope') not in {'today', 'remaining_planning_period'}:
        raise ValueError('Invalid scheduling scope')
    for key in ('adjustable_session_ids', 'authorized_candidate_ids'):
        if not isinstance(command.get(key), list) or any(not isinstance(v, str) for v in command[key]):
            raise ValueError(f'{key} must be an explicit list of IDs')
        if len(set(command[key])) != len(command[key]):
            raise ValueError('Duplicate authorization IDs')
    if command.get('candidate_duration_minutes'):
        raise ValueError('Pending work already has an explicit duration')
    facts = read_context(user_id, command, ports)
    profile, now, plan, state, rows, pending, eligible = facts
    with ports.connect() as conn:
        replay = replay_proposal(PlanRepository(conn), user_id, command, ports.decode)
    if replay:
        return replay
    movable = {sid: deepcopy(next(b for b in plan['plan_patch'] if b['block_id'] == eligible[sid]['block_id']))
               for sid in command['adjustable_session_ids']}
    for cid in command['authorized_candidate_ids']:
        p = pending[cid]
        movable[cid] = {'block_id': ports.make_id('block'), 'task_id': p['original_task_id'],
            'kind': 'task_session', 'title': p['title'], 'source_candidate_id': cid,
            'planned_work_minutes': p['remaining_minutes'], 'session_minutes': p['remaining_minutes']}
    if not movable:
        raise ValueError('No future work was authorized for scheduling')
    frozen = [deepcopy(b) for b in plan['plan_patch'] if b['block_id'] not in {v['block_id'] for v in movable.values()}]
    tasks = [task for task in ports.list_tasks(user_id)
             if task.get('archived_at') is None and not task.get('removed_from_week')]
    task_titles = {task['id']: task.get('title', '') for task in tasks}
    for block in movable.values():
        block['title'] = block.get('title') or task_titles.get(block['task_id'], '')
    context = scheduling_prompt_context(profile=profile, tasks=tasks, runtime_state=state, plan=plan)
    context = compact_execution_context(context)
    # The unchanged calendar and authorized work below already carry these blocks.
    context['existing_plan'].pop('plan_patch', None)
    add_behavior_context(context, user_id, recent_behavior=ports.recent_behavior,
                         learned_behavior=ports.learned_behavior,
                         task_ids={b['task_id'] for b in movable.values()})
    result = ports.typed_completion([
        {'role': 'system', 'content': SESSION_PROPOSAL_PROMPT},
        {'role': 'user', 'content': ports.encode({'prompt_version': SESSION_PROPOSAL_VERSION, 'locale': command.get('locale', 'zh'), 'context': context,
            'now': now.isoformat(), 'week_id': plan['week_id'], 'scope': command['scope'],
            'authorized_session_ids': list(movable), 'authorized_work': movable, 'frozen_blocks': frozen})}
    ], authorized_adjustment_model(movable), 'session_adjustment')
    if result is None:
        raise ValueError('Adjustment generation is temporarily unavailable; the original plan is unchanged')
    result = SessionAdjustment.model_validate(result)
    ids = [t.session_id for t in result.times]
    if len(ids) != len(set(ids)) or not set(ids).issubset(movable) or not set(command['adjustable_session_ids']).issubset(ids):
        raise ValueError('Model changed work outside the authorized set')
    blocks, changes = list(frozen), []
    week_start = datetime.fromisoformat(plan['week_id']).replace(tzinfo=now.tzinfo)
    for t in result.times:
        b = movable[t.session_id]
        if t.end <= t.start or (t.end - t.start)*60 + .001 < b['planned_work_minutes']:
            raise ValueError('Calendar duration cannot be shorter than the work budget')
        if t.session_id in eligible and abs((t.end - t.start) - (b['end'] - b['start'])) > .001:
            raise ValueError('A time adjustment cannot change the session duration')
        before = b.get('start_at')
        b.update(day_index=t.day_index, start=t.start, end=t.end,
            start_at=(week_start + timedelta(days=t.day_index, hours=t.start)).isoformat(),
            end_at=(week_start + timedelta(days=t.day_index, hours=t.end)).isoformat())
        if t.session_id in pending or before != b['start_at']:
            changes.append({'session_id': t.session_id, 'title': b.get('title', ''), 'before': before, 'after': b['start_at']})
        blocks.append(b)
    tasks = [task for task in ports.list_tasks(user_id)
             if task.get('archived_at') is None and not task.get('removed_from_week')]
    policy = build_scope_policy(scope='today' if command['scope'] == 'today' else 'full',
        affected_task_ids=[], baseline=plan, tasks=tasks, sessions=rows, now=now, week_id=plan['week_id'])
    policy.update(frozen_blocks=frozen, runtime_authorization=command,
                  allowed_task_ids=sorted(set(policy['allowed_task_ids']) | {b['task_id'] for b in movable.values()}),
                  authorized_pending={cid: {'task_id': pending[cid]['original_task_id'], 'minutes': pending[cid]['remaining_minutes']}
                                      for cid in command['authorized_candidate_ids']})
    # Workload validation keeps independent portions out of the parent budget.
    allocated = {}
    for b in blocks:
        if b['block_id'] not in policy['historical_block_ids'] and not b.get('source_candidate_id'):
            tid = str(b.get('task_id', ''))
            allocated[tid] = allocated.get(tid, 0) + int(b.get('planned_work_minutes') or b.get('session_minutes') or 0)
    unscheduled = [{'task_id': t['id'], 'remaining_minutes': rest, 'reason': '保留未安排工作；本次只调整明确授权的工作段。'}
        for t in tasks if t.get('status') not in {'completed', 'terminated'} and t['id'] in policy['allowed_task_ids'] and t.get('task_type') != 'fixed_event'
        and (rest := int((t.get('execution') or {}).get('remaining_duration_minutes', t.get('duration') or 0)) - allocated.get(t['id'], 0)) > 0]
    draft = {**deepcopy(plan), 'plan_patch': blocks, 'replan_policy': policy, 'base_plan_id': plan['plan_id'],
             'unscheduled_tasks': unscheduled, 'explanation': result.explanation}
    for field in ('plan_id', 'plan_revision', 'confirmed_at', 'plan_status', 'edit_episode_id'):
        draft.pop(field, None)
    validation = ports.validate_confirmed_schedule(user_id, draft, scope_policy=policy)
    if not validation.get('valid'):
        raise SchedulingError('schedule_constraints', 'Candidate failed constraint validation', validation['violations'])
    with ports.atomic() as conn:
        # Another identical request may have finished while this model call
        # was running. Return its saved receipt without replacing its snapshot.
        replay = replay_proposal(PlanRepository(conn), user_id, command, ports.decode)
        if replay:
            return replay
        fresh = read_context(user_id, command, ports)
        if [(r['id'], r['status'], r['updated_at']) for r in fresh[4]] != [(r['id'], r['status'], r['updated_at']) for r in rows]:
            raise ValueError('Execution changed during generation; regenerate')
        validation = ports.validate_confirmed_schedule(user_id, draft, scope_policy=policy)
        if not validation.get('valid'):
            raise SchedulingError('schedule_constraints', 'Candidate failed constraint validation', validation['violations'])
        saved = ports.save_proposed_plan(user_id, draft, {'week_id': plan['week_id'], 'request_id': command['request_id']})
        proposal = {'id': saved['plan_id'], 'authorization': command, 'valid': True, 'status': 'proposed',
                    'changes': changes, 'unallocated_candidate_ids': sorted(set(command['authorized_candidate_ids']) - set(ids))}
        saved['runtime_proposal'] = proposal
        PlanRepository(conn).update_snapshot(plan_id=saved['plan_id'], plan_json=ports.encode(saved))
    return proposal
