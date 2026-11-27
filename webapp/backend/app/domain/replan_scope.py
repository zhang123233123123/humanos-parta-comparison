"""Pure, fail-closed boundaries for scoped schedule revisions."""
from copy import deepcopy
from collections import Counter
from datetime import datetime
import json


def block_signature(block):
    fields = ('block_id', 'task_id', 'source_id', 'kind', 'day_index', 'start', 'end',
              'planned_work_minutes', 'session_minutes', 'parallel_group_id',
              'parallel_user_confirmed', 'parallel_role', 'start_at', 'end_at', 'source_candidate_id')
    return json.dumps({key: block.get(key) for key in fields}, sort_keys=True)


def build_scope_policy(*, scope, affected_task_ids, baseline, tasks, sessions, now, week_id):
    if scope not in {'local', 'today', 'full'}:
        raise ValueError('重排范围无效，请重新选择。')
    affected = {str(item) for item in affected_task_ids if item}
    if scope == 'local' and not affected:
        raise ValueError('局部重排需要指定任务，请选择任务或明确选择全周重排。')
    start = datetime.fromisoformat(week_id).replace(tzinfo=now.tzinfo)
    current = (now - start).total_seconds() / 60
    day = (now.date() - start.date()).days
    if scope == 'today' and day not in range(7):
        raise ValueError('今日重排只能用于用户时区下的当前周。')
    raw_blocks = (baseline or {}).get('plan_patch') or []
    baseline_ids = {str(b.get('block_id')) for b in raw_blocks}
    if any(s['status'] == 'running' and str(s['block_id']) not in baseline_ids for s in sessions):
        raise ValueError('有运行中的执行记录不在当前计划内，请先暂停或处理该记录，再重新安排。')
    session_map = {str(s['block_id']): s for s in sessions}
    running_tasks = {str(s['task_id']) for s in sessions if s['status'] == 'running'}
    allowed = {str(t['id']) for t in tasks} if scope == 'full' else affected
    if scope == 'today':
        allowed |= {str(b['task_id']) for b in raw_blocks if b.get('task_id') and int(b['day_index']) == day}
    allowed -= running_tasks
    frozen, history = [], []
    for block in raw_blocks:
        if not block.get('block_id'):
            raise ValueError('原计划缺少时间块标识，请先修复原计划后重排。')
        minute = int(block['day_index']) * 1440 + float(block['start']) * 60
        session = session_map.get(str(block['block_id']), {})
        historical = (int(block['day_index']) * 1440 + float(block['end']) * 60 <= current
                      or session.get('status') in {'completed', 'ended', 'interrupted', 'partial', 'not_started', 'terminated'})
        protected = (not block.get('task_id') or block.get('kind') == 'fixed_event'
                     or str(block.get('task_id')) not in allowed or minute < current
                     or (scope == 'today' and int(block['day_index']) != day))
        if historical or protected:
            frozen.append(deepcopy(block))
            if historical:
                history.append(str(block['block_id']))
    return {'scope': scope, 'week_id': week_id,
            'base_plan_id': (baseline or {}).get('plan_id'),
            'base_blocks': deepcopy(raw_blocks), 'frozen_blocks': frozen,
            'historical_block_ids': history, 'allowed_task_ids': sorted(allowed),
            'window_start': max(current, day * 1440 if scope == 'today' else 0),
            'window_end': (day + 1) * 1440 if scope == 'today' else 10080,
            'session_versions': sorted((str(s['id']), s['status'], s['updated_at']) for s in sessions)}


def scope_violations(policy, blocks):
    frozen = policy['frozen_blocks']
    frozen_ids = {str(b['block_id']) for b in frozen}
    actual = [b for b in blocks if str(b.get('block_id')) in frozen_ids]
    failures = []
    if Counter(map(block_signature, actual)) != Counter(map(block_signature, frozen)):
        failures.append({'type': 'replan_scope_conflict', 'message': '范围外日程被修改、删除或重复，请重新生成；需要移动其他安排时，请明确扩大重排范围。'})
    allowed = set(policy['allowed_task_ids'])
    for block in blocks:
        if str(block.get('block_id')) in frozen_ids:
            continue
        if not policy['base_plan_id'] and not block.get('task_id'):
            continue  # Initial plan still includes Profile-owned commitments.
        start = int(block['day_index']) * 1440 + float(block['start']) * 60
        end = int(block['day_index']) * 1440 + float(block['end']) * 60
        if (str(block.get('task_id')) not in allowed or start < policy['window_start']
                or end > policy['window_end']):
            failures.append({'type': 'replan_scope_conflict', 'message': '新增安排超出本次重排范围，请调整任务或明确扩大范围。'})
            break
    return failures
