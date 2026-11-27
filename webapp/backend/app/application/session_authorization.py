"""Recheck saved session authorization before validation or plan activation."""
from datetime import datetime
from ..repositories.session_reports import SessionReportRepository
from ..repositories.runtime_states import RuntimeStateRepository
from ..repositories.plans import PlanRepository
from ..domain.replan_scope import block_signature


def pending_block_errors(user_id, policy, blocks, *, connect):
    with connect() as conn:
        pending = {r['id']: r for r in SessionReportRepository(conn).pending(user_id)}
        active_blocks = {}
        for week_id in {r['week_id'] for r in pending.values()}:
            active = PlanRepository(conn).latest_active(user_id=user_id, week_id=week_id)
            if active:
                import json
                for block in json.loads(active['plan_json']).get('plan_patch', []):
                    if block.get('source_candidate_id'):
                        active_blocks[block['source_candidate_id']] = block
    errors, seen = [], set()
    for block in blocks:
        cid = block.get('source_candidate_id')
        if not cid:
            continue
        record = pending.get(cid)
        authorized = (policy or {}).get('authorized_pending', {}).get(cid)
        existing = active_blocks.get(cid)
        if (cid in seen or record is None or record['original_task_id'] != block.get('task_id')
                or record['remaining_minutes'] != block.get('planned_work_minutes')
                or record['status'] == 'pending' and (not authorized
                    or authorized['task_id'] != block.get('task_id')
                    or authorized['minutes'] != block.get('planned_work_minutes'))
                or record['status'] == 'scheduled' and (not existing
                    or existing['block_id'] != block.get('block_id'))):
            errors.append({'type': 'replan_scope_conflict', 'message': '待安排项来源或工作量无效，或尚未获得安排授权。'})
        seen.add(cid)
    return errors


def session_scope_errors(user_id, policy, blocks, *, connect, now):
    command = (policy or {}).get('runtime_authorization')
    if not command:
        return []
    errors = []
    def fail(message):
        errors.append({'type': 'replan_scope_conflict', 'message': message})
    with connect() as conn:
        state = RuntimeStateRepository(conn).latest(user_id)
        pending = {r['id']: r for r in SessionReportRepository(conn).pending(user_id)}
    if (state['id'] if state else None) != command['base_state_id'] or now.date().isoformat() != command['local_date']:
        fail('状态或账号日期已变化，请重新生成。')
    frozen = {b['block_id']: b for b in policy['frozen_blocks']}
    base = {b['block_id']: b for b in policy['base_blocks']}
    allowed_blocks = set(base) - set(frozen)
    seen_blocks, seen_pending = set(), set()
    for b in blocks:
        bid = b.get('block_id')
        if bid in seen_blocks:
            fail('工作段重复，请重新生成。')
        seen_blocks.add(bid)
        if bid in frozen:
            continue
        cid = b.get('source_candidate_id')
        if bid in allowed_blocks:
            old = base[bid]
            protected = lambda x: block_signature({k:v for k,v in x.items() if k not in {'day_index','start','end','start_at','end_at'}})
            if protected(old) != protected(b) or abs((old['end']-old['start']) - (b['end']-b['start'])) > .001:
                fail('时间调整不能替换任务或改变本段工作量。')
        elif cid:
            record = pending.get(cid)
            expected = policy.get('authorized_pending', {}).get(cid)
            if (not record or record['status'] != 'pending' or not expected or cid in seen_pending
                    or b.get('task_id') != expected['task_id'] or b.get('planned_work_minutes') != expected['minutes']):
                fail('待安排项不在授权范围内、已安排或工作量发生变化。')
            seen_pending.add(cid)
        elif bid not in allowed_blocks:
            fail('新增工作段未获授权。')
    if not allowed_blocks.issubset(seen_blocks):
        fail('授权工作段被删除，请恢复原工作段。')
    return errors
