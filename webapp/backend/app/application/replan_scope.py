"""Trusted scope snapshots: persistence access separated from scope rules."""
from ..repositories.plans import PlanRepository
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..domain.replan_scope import build_scope_policy, block_signature, scope_violations


def scope_sessions(conn, user_id, week_id):
    rows = ExecutionSessionRepository(conn).list_for_user(user_id=user_id)
    return [dict(row) for row in rows if row['week_id'] == week_id and row['status'] != 'superseded']


def capture_scope(user_id, *, payload, baseline, tasks, now, week_id, connect):
    if not payload.get('replan_scope'):
        return None
    with connect() as conn:
        sessions = scope_sessions(conn, user_id, week_id)
    policy = build_scope_policy(scope=payload['replan_scope'],
        affected_task_ids=payload.get('affected_task_ids') or [], baseline=baseline,
        tasks=tasks, sessions=sessions, now=now, week_id=week_id)
    # Only a committed adjustment receipt can authorize this continuation intent.
    request_id = str(payload.get('request_id') or '')
    if payload.get('adjustment_trigger') == 'execution_adjustment' and request_id.endswith(':replan'):
        import json
        import math
        from copy import deepcopy
        from datetime import datetime, timedelta
        from ..repositories.recommendation_events import RecommendationEventRepository
        with connect() as conn:
            row = RecommendationEventRepository(conn).latest(user_id, request_id[:-7], 'execution_adjustment_applied')
        if row is None:
            raise ValueError('执行调整记录不存在，请重新检查并保存现场。')
        receipt = json.loads(row['payload_json'])
        command = receipt['command']
        result = receipt['result']
        if command['choice'] not in {'replan', 'manual', 'defer', 'borrow_rest'} or result.get('week_id') != week_id:
            raise ValueError('执行调整与本次重排不匹配。')
        source = next((s for s in sessions if s['id'] == command['execution_session_id']), None)
        if source is None or source['status'] != 'paused':
            raise ValueError('原执行状态已变化，请重新检查。')
        if str(source['task_id']) not in policy['allowed_task_ids']:
            raise ValueError('执行调整不在本次重排范围内。')
        policy['execution_adjustment'] = {'request_id': request_id[:-7], 'task_id': source['task_id'],
            'execution_session_id': source['id'], 'duration_minutes': command['duration_minutes'],
            'next_step': command.get('next_step') or ''}
        # Preserve actual history up to interruption, releasing the unused tail.
        week_start = datetime.fromisoformat(week_id).replace(tzinfo=now.tzinfo)
        paused_at = datetime.fromisoformat(source['paused_at']).astimezone(now.tzinfo)
        pause_axis = (paused_at - week_start).total_seconds() / 60
        frozen = []
        for original in policy['frozen_blocks']:
            block = deepcopy(original)
            if str(block['block_id']) == str(source['block_id']):
                start_axis = int(block['day_index']) * 1440 + float(block['start']) * 60
                if pause_axis <= start_axis:
                    continue  # There is no executed calendar interval to preserve.
                end_axis = min(int(block['day_index']) * 1440 + float(block['end']) * 60, pause_axis)
                block['end'] = (end_axis - int(block['day_index']) * 1440) / 60
                block['end_at'] = (week_start + timedelta(minutes=end_axis)).isoformat()
                block['planned_work_minutes'] = int(source.get('accumulated_active_minutes') or 0)
                block['session_minutes'] = max(int(end_axis - start_axis), 0)
                policy['historical_block_ids'] = list(set(policy['historical_block_ids']) | {str(block['block_id'])})
            frozen.append(block)
        policy['frozen_blocks'] = frozen
        policy['window_start'] = math.ceil(policy['window_start'] / 15) * 15
        if command['choice'] == 'borrow_rest':
            from ..domain.execution.rest_adjustment import allow_rest_candidate
            policy = allow_rest_candidate(policy, reviewed_conflicts=result['review']['feasibility']['conflicts'], now=now)
    if payload.get('adjustment_trigger') == 'help_decide_break':
        import json
        from datetime import datetime
        from ..repositories.recommendation_events import RecommendationEventRepository
        suffix = ':break-replan'
        if suffix not in request_id:
            raise ValueError('休息重排缺少已确认的动作记录。')
        with connect() as conn:
            row = RecommendationEventRepository(conn).latest(user_id, request_id.split(suffix, 1)[0], 'help_decide_choice_applied')
        receipt = json.loads(row['payload_json']) if row else {}
        execution = (receipt.get('result') or {}).get('execution') or {}
        source_id = (execution.get('execution_session') or {}).get('execution_session_id')
        source = next((item for item in sessions if item['id'] == source_id), None)
        if (not execution.get('requires_replan') or execution.get('action') != 'short_break'
                or source is None or source['status'] != 'paused'
                or source['paused_at'] != execution['execution_session'].get('paused_at')
                or source['task_id'] not in policy['allowed_task_ids']):
            raise ValueError('休息执行状态已变化，请重新检查。')
        policy = reserve_interruption_break(policy, source, execution['break_end_at'], now)
    return policy


def reserve_interruption_break(policy, source, break_end_at, now):
    """Release only the paused block's unused tail; reserve the chosen rest."""
    from copy import deepcopy
    from datetime import datetime, timedelta
    policy = deepcopy(policy)
    start = datetime.fromisoformat(policy['week_id']).replace(tzinfo=now.tzinfo)
    paused = datetime.fromisoformat(source['paused_at']).astimezone(now.tzinfo)
    pause_axis = (paused - start).total_seconds() / 60
    frozen = []
    for block in policy['frozen_blocks']:
        if str(block['block_id']) == str(source['block_id']):
            begin = int(block['day_index']) * 1440 + float(block['start']) * 60
            if pause_axis <= begin:
                continue
            end = min(int(block['day_index']) * 1440 + float(block['end']) * 60, pause_axis)
            block['end'] = (end - int(block['day_index']) * 1440) / 60
            block['end_at'] = (start + timedelta(minutes=end)).isoformat()
            block['planned_work_minutes'] = int(source.get('accumulated_active_minutes') or 0)
            block['session_minutes'] = max(int(end - begin), 0)
            policy['historical_block_ids'] = sorted(set(policy['historical_block_ids']) | {str(block['block_id'])})
        frozen.append(block)
    policy['frozen_blocks'] = frozen
    policy['window_start'] = max(policy['window_start'], (datetime.fromisoformat(break_end_at) - start).total_seconds() / 60)
    policy['interruption_break'] = {'execution_session_id': source['id'], 'break_end_at': break_end_at}
    return policy


def load_scope(user_id, payload, *, connect, decode):
    with connect() as conn:
        plans = PlanRepository(conn)
        plan_id = payload.get('plan_id') or (payload.get('decision') or {}).get('plan_id')
        row = plans.get_for_user(plan_id=plan_id, user_id=user_id) if plan_id else None
        if row is None and not plan_id and payload.get('week_id'):
            row = plans.latest_proposed(user_id=user_id, week_id=payload['week_id'])
        return decode(row['plan_json'], {}).get('replan_policy') if row else None


def check_scope(user_id, policy, blocks, *, connect, decode, now=None):
    if not policy:
        return []
    with connect() as conn:
        active = PlanRepository(conn).latest_active(user_id=user_id, week_id=policy['week_id'])
        baseline = decode(active['plan_json'], {}) if active else {}
        versions = sorted([str(s['id']), s['status'], s['updated_at']]
                          for s in scope_sessions(conn, user_id, policy['week_id']))
    if ((active['id'] if active else None) != policy['base_plan_id']
            or sorted(map(block_signature, baseline.get('plan_patch') or [])) != sorted(map(block_signature, policy['base_blocks']))
            or versions != sorted(list(s) for s in policy['session_versions'])):
        return [{'type': 'replan_scope_stale', 'message': '原日程或执行状态已变化，请重新生成局部安排。'}]
    if now is not None:
        from datetime import datetime
        start = datetime.fromisoformat(policy['week_id']).replace(tzinfo=now.tzinfo)
        policy = {**policy, 'window_start': max(policy['window_start'], (now - start).total_seconds() / 60)}
    return scope_violations(policy, blocks)
