"""Preview next-week work without changing task ownership; confirm atomically."""
from copy import deepcopy
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import hashlib
import json
from ..repositories.cross_week import CrossWeekRepository
from .ai_ordered_scheduler import generate_ordered_plan
from .scheduling_prompt_context import scheduling_prompt_context


def snapshot(user_id, source_week, target_week, ports):
    return {'profile':ports.ensure_profile(user_id), 'tasks':ports.list_tasks(user_id),
            'plans':[ports.active_plan(user_id,w) for w in (source_week,target_week)],
            'drafts':[ports.latest_proposed_plan(user_id,w) for w in (source_week,target_week)]}


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()


def next_week_context(profile, target):
    weekly = deepcopy(profile.get('weekly_context') or {})
    weekly.update(week_id=target,week_of=target,weekly_goal='',weekly_note='',temporary_constraints=[],fixed_events=[])
    weekly['context_items'] = [i for i in weekly.get('context_items',[]) if
        i.get('occurrence_mode') in {'repeat_weekly','repeat_every_day'} or
        (not i.get('occurrence_mode') and i.get('type') in {'recurring_routine','routine_window'})]
    return weekly


def checked_plan(user_id, plan, profile, tasks, ports):
    now = ports.user_clock_now(user_id,profile.get('timezone') or 'Asia/Shanghai')
    start = datetime.fromisoformat(plan['week_id']).replace(tzinfo=ZoneInfo(profile.get('timezone') or 'Asia/Shanghai'))
    result = ports.validate_snapshot(plan,profile,tasks,max(now,start))
    by_id = {t['id']:t for t in tasks}
    for block in plan.get('plan_patch',[]):
        task = by_id.get(block.get('task_id'))
        if not task:continue
        end = start + timedelta(days=block['day_index'],hours=block['end'])
        beginning = start + timedelta(days=block['day_index'],hours=block['start'])
        if beginning < now:
            result['violations'].append({'type':'past_time','task_id':task['id']})
        if task.get('deadline_at'):
            try:
                deadline = datetime.fromisoformat(task['deadline_at'].replace('Z','+00:00'))
                if deadline.tzinfo is None:deadline=deadline.replace(tzinfo=start.tzinfo)
                if len(task['deadline_at']) == 10:deadline += timedelta(days=1)
                if end > deadline:result['violations'].append({'type':'deadline','task_id':task['id']})
            except (TypeError,ValueError):
                result['violations'].append({'type':'explicit_deadline_required','task_id':task['id']})
    result['valid'] = not result['violations']
    return result


def preview_next_week(user_id, payload, *, ports):
    if not isinstance(payload.get('task_ids'), list):
        raise ValueError('task_ids must be a list')
    ids = list(dict.fromkeys(str(x) for x in payload.get('task_ids') or []))
    if not ids:raise ValueError('请选择需要移到下一周期的待安排任务。')
    profile = ports.ensure_profile(user_id)
    source = str(payload.get('source_week') or profile.get('active_week_id') or profile.get('weekly_context',{}).get('week_id') or '')
    start = datetime.fromisoformat(source)
    target = (start+timedelta(days=7)).date().isoformat()
    captured = snapshot(user_id,source,target,ports)
    if captured['plans'][1]:raise ValueError('下一周期已有正式计划，请在周计划中调整，不能直接覆盖。')
    selected = [t for t in captured['tasks'] if t['id'] in ids]
    if len(selected)!=len(ids):raise ValueError('Task not found')
    source_blocks = (captured['plans'][0] or {}).get('plan_patch') or []
    for task in selected:
        if task.get('week_id')!=source or task.get('removed_from_week') or task.get('status')!='queued' or any(b.get('task_id')==task['id'] for b in source_blocks):
            raise ValueError('只能将本周期尚未安排的任务移到下一周期；请刷新任务状态。')
    weekly = next_week_context(profile,target)
    virtual_profile = {**deepcopy(profile),'weekly_context':weekly,'active_week_id':target}
    now = ports.user_clock_now(user_id,profile.get('timezone') or 'Asia/Shanghai')
    target_start = datetime.fromisoformat(target).replace(tzinfo=now.tzinfo)
    virtual_profile['_client_now'] = max(now,target_start).isoformat()
    target_tasks = [deepcopy(t) for t in captured['tasks'] if not t.get('removed_from_week') and
        (t['id'] in ids or (t.get('week_id')==target and t.get('status') not in {'completed','terminated'}))]
    for task in target_tasks:task['week_id']=target
    # Preserve absolute deadlines. Relative dates need explicit clarification,
    # rather than being silently reinterpreted in a different week.
    for task in target_tasks:
        if task.get('deadline_at'):
            try:datetime.fromisoformat(task['deadline_at'].replace('Z','+00:00'))
            except (TypeError,ValueError):raise ValueError('跨周期前请把任务截止时间明确为具体日期。')
    analysis = ports.analyze_schedule_inputs({'tasks':target_tasks,'profile':virtual_profile})
    if analysis.get('provider') in {'local_fallback','local_deterministic'}:
        raise ValueError('AI 任务分析暂不可用，请重试。')
    context = scheduling_prompt_context(profile=virtual_profile,tasks=target_tasks)
    from .behavior_prompt_context import add_behavior_context
    add_behavior_context(context, user_id, recent_behavior=ports.recent_behavior,
                         learned_behavior=ports.learned_behavior)
    expired = []
    for task in target_tasks:
        if task.get('deadline_at'):
            deadline = datetime.fromisoformat(task['deadline_at'].replace('Z','+00:00'))
            if deadline.tzinfo is None:deadline=deadline.replace(tzinfo=target_start.tzinfo)
            if len(task['deadline_at']) == 10:deadline += timedelta(days=1)
            if deadline <= max(now,target_start):expired.append(task['id'])
    if expired:
        plan = {'week_id':target,'plan_patch':[],'task_ids':[t['id'] for t in target_tasks],
            'unscheduled_tasks':[{'task_id':t['id'],'remaining_minutes':(t.get('execution') or {}).get('remaining_duration_minutes',t.get('duration',0)),
                'reason':'deadline_before_target_week' if t['id'] in expired else 'requires_plan_review'} for t in target_tasks],
            'validation':{'valid':False,'violations':[{'type':'deadline_before_target_week','task_id':i} for i in expired]}}
    else:
        plan = generate_ordered_plan(profile=virtual_profile,tasks=target_tasks,analysis=analysis,existing_plan=None,
            payload={'week_id':target},decision_context=context,typed_completion=ports.typed_completion,encode=ports.encode,
            validate=lambda p:checked_plan(user_id,p,virtual_profile,target_tasks,ports))
    preview = {'preview_id':ports.make_id('crossweek'),'source_week':source,'target_week':target,'task_ids':ids,
        'snapshot_hash':digest(captured),'profile':virtual_profile,'tasks':target_tasks,'plan':plan,
        'can_confirm':plan['validation']['valid'] and not plan.get('unscheduled_tasks'),
        'inherited_settings':weekly,'created_at':ports.now(),'status':'proposed'}
    with ports.atomic():
        if digest(snapshot(user_id,source,target,ports))!=preview['snapshot_hash']:
            raise ValueError('任务或设置已变化，请重新预览。')
        ports.log_event(user_id,'cross_week_preview',preview)
    return preview


def confirm_next_week(user_id, payload, *, ports):
    if payload.get('confirm') is not True:raise ValueError('请明确确认下一周期安排和沿用设置。')
    pid=str(payload.get('preview_id') or '')
    with ports.atomic() as conn:
        repo=CrossWeekRepository(conn)
        receipt=repo.event(user_id,pid,'cross_week_confirmed')
        if receipt:return receipt
        preview=repo.event(user_id,pid,'cross_week_preview')
        if not preview:raise ValueError('跨周期预览不存在，请重新生成。')
        if not preview['can_confirm']:raise ValueError('下一周期仍有未安排任务，请先调整。')
        if digest(snapshot(user_id,preview['source_week'],preview['target_week'],ports))!=preview['snapshot_hash']:
            raise ValueError('任务、设置或计划已变化，请重新预览。')
        plan=preview['plan']
        validation=checked_plan(user_id,plan,preview['profile'],preview['tasks'],ports)
        if not validation['valid']:raise ValueError('跨周期安排已失效，请重新预览。')
        repo.transfer(user_id,preview['task_ids'],preview['source_week'],preview['target_week'],preview['inherited_settings'],ports.now())
        saved=ports.save_proposed_plan(user_id,plan,{'week_id':preview['target_week'],'request_id':pid})
        result=ports.confirm_plan(user_id,{**saved,'decision':saved})
        if result.get('requires_rationale'):raise ValueError('跨周期方案发生变化，请重新预览。')
        receipt={'preview_id':pid,'source_week':preview['source_week'],'target_week':preview['target_week'],
            'task_ids':preview['task_ids'],'plan':result['plan'],'status':'confirmed'}
        ports.log_event(user_id,'cross_week_confirmed',receipt)
        return receipt
