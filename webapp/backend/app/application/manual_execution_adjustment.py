"""Create an editable candidate from a saved execution-adjustment receipt."""
from copy import deepcopy
from datetime import datetime, timedelta
import math
from ..repositories.recommendation_events import RecommendationEventRepository
from ..repositories.plans import PlanRepository
from .replan_scope import capture_scope


def manual_adjustment_draft(user_id, payload, *, ports):
    request_id = str(payload.get('request_id') or '').strip()
    if not request_id or len(request_id) > 200:
        raise ValueError('request_id is required')
    with ports.atomic():
        with ports.connect() as conn:
            row = RecommendationEventRepository(conn).latest(user_id, request_id, 'execution_adjustment_applied')
            existing = PlanRepository(conn).find_request(user_id=user_id, request_id=request_id + ':manual')
        if row is None:
            raise KeyError('Saved adjustment not found')
        saved = ports.decode(row['payload_json'], {})
        command, result = saved['command'], saved['result']
        if command['choice'] not in {'replan', 'manual', 'defer', 'borrow_rest'}:
            raise ValueError('请先确认暂停并保存现场。')
        if existing:
            if existing['plan_status'] != 'proposed':
                raise ValueError('这份草案已被替换或确认，请返回当前计划。')
            return {'proposal': ports.decode(existing['plan_json'], {})}
        profile = ports.ensure_profile(user_id)
        now = ports.user_clock_now(user_id, profile.get('timezone') or 'Asia/Shanghai')
        plan = ports.active_plan(user_id, result.get('week_id')) or {}
        if not plan.get('plan_id'):
            raise ValueError('没有可调整的正式计划，请先完成本周规划。')
        tasks = ports.list_tasks(user_id)
        policy = capture_scope(user_id, payload={
            'replan_scope': 'today', 'affected_task_ids': [result['task_id']],
            'adjustment_trigger': 'execution_adjustment', 'request_id': result['replan_request_id'],
        }, baseline=plan, tasks=tasks, now=now, week_id=plan['week_id'], connect=ports.connect)
        frozen_ids = {str(b['block_id']) for b in policy['frozen_blocks']}
        blocks = deepcopy(policy['frozen_blocks'])
        blocks += [deepcopy(b) for b in plan.get('plan_patch') or []
                   if str(b.get('block_id')) not in frozen_ids and str(b.get('task_id')) != str(result['task_id'])
                   and str(b.get('block_id')) not in {str(c['block_id']) for c in policy.get('rest_changes', [])}]
        start = math.ceil(policy['window_start'] / 15) * 15
        minutes = command['duration_minutes']
        task = next(t for t in tasks if str(t['id']) == str(result['task_id']))
        remaining = int((task.get('execution') or {}).get('remaining_duration_minutes', task.get('duration') or 0))
        if remaining <= 0:
            raise ValueError('任务没有剩余工作，请先结束执行或修正剩余量。')
        if minutes > remaining:
            raise ValueError('所选时长超过保存后的任务剩余量，请重新选择时长。')
        end = start + math.ceil(minutes / 15) * 15
        if end > policy['window_end']:
            raise ValueError('今天已没有足够时间容纳本段执行，请在计划页选择其他日期。')
        week_start = datetime.fromisoformat(plan['week_id']).replace(tzinfo=now.tzinfo)
        blocks.append({'block_id': request_id + ':continuation', 'task_id': result['task_id'],
            'title': task['title'], 'kind': 'task_session', 'day_index': start // 1440,
            'start': (start % 1440) / 60, 'end': ((end - 1) % 1440 + 1) / 60,
            'start_at': (week_start + timedelta(minutes=start)).isoformat(),
            'end_at': (week_start + timedelta(minutes=end)).isoformat(),
            'planned_work_minutes': minutes, 'session_minutes': minutes})
        allocated = {}
        for block in blocks:
            if str(block.get('block_id')) in policy['historical_block_ids']:
                continue
            tid = str(block.get('task_id') or '')
            allocated[tid] = allocated.get(tid, 0) + int(block.get('planned_work_minutes') or block.get('session_minutes') or 0)
        unscheduled = []
        for item in tasks:
            if str(item['id']) not in policy['allowed_task_ids'] or item.get('status') in {'completed', 'terminated', 'blocked'}:
                continue
            rest = int((item.get('execution') or {}).get('remaining_duration_minutes', item.get('duration') or 0)) - allocated.get(str(item['id']), 0)
            if rest > 0:
                unscheduled.append({'task_id': item['id'], 'remaining_minutes': rest,
                                    'reason': '待安排的剩余工作；本草案不会把它标记为完成。'})
        proposal = ports.save_proposed_plan(user_id, {
            'base_plan_id': plan['plan_id'], 'replan_policy': policy, 'plan_patch': blocks,
            'unscheduled_tasks': unscheduled, 'task_ids': policy['allowed_task_ids'],
            'explanation': '手动调整草案：保留实际历史，将本次执行放在下一时间网格供修改。请检查冲突，并安排或明确保留待安排工作；确认前正式计划不变。',
        }, {'week_id': plan['week_id'], 'request_id': request_id + ':manual'})
        return {'proposal': proposal}
