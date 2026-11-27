"""Bounded rest consumption for an explicitly requested, reviewable draft."""
from copy import deepcopy
from datetime import datetime, timedelta


def allow_rest_candidate(policy, *, reviewed_conflicts, now):
    allowed = {str(c['block_id']) for c in reviewed_conflicts if c.get('kind') == 'rest_buffer'}
    if not allowed:
        raise ValueError('没有可复核的休息冲突。')
    intent = policy['execution_adjustment']
    start = policy['window_start']
    import math
    end = start + math.ceil(intent['duration_minutes'] / 15) * 15
    week = datetime.fromisoformat(policy['week_id']).replace(tzinfo=now.tzinfo)
    changes, frozen = [], []
    # Borrowing rest cannot silently shift any other task.
    current_frozen = {str(b['block_id']): deepcopy(b) for b in policy['frozen_blocks']}
    for original in policy['base_blocks']:
        bid = str(original['block_id'])
        if bid in current_frozen:
            block = current_frozen[bid]
        elif str(original.get('task_id')) != str(intent['task_id']):
            block = deepcopy(original)
        else:
            continue
        a = int(block['day_index']) * 1440 + float(block['start']) * 60
        b = int(block['day_index']) * 1440 + float(block['end']) * 60
        if block.get('kind') != 'rest_buffer' or max(a, start) >= min(b, end):
            frozen.append(block)
            continue
        if bid not in allowed:
            raise ValueError('时间已变化，休息占用范围与复核不一致，请重新选择。')
        consumed_start = max(a, start)
        if a < start:
            history_id = bid + ':history:' + intent['request_id']
            frozen.append({**block, 'block_id': history_id,
                'end': (start - int(block['day_index']) * 1440) / 60,
                'end_at': (week + timedelta(minutes=start)).isoformat(), 'week_end_minute': start})
            policy['historical_block_ids'] = list(set(policy['historical_block_ids']) | {history_id})
        after = None
        if end < b:
            after = {**block, 'start': (end - int(block['day_index']) * 1440) / 60,
                     'start_at': (week + timedelta(minutes=end)).isoformat(),
                     'week_start_minute': end}
            frozen.append(after)
        changes.append({'block_id': bid, 'before': block, 'after': after,
                        'consumed_minutes': min(b, end) - consumed_start,
                        'remaining_minutes': max(b - end, 0),
                        'consumed_start': consumed_start, 'consumed_end': min(b, end)})
    if not changes:
        raise ValueError('原休息已不在本段执行范围内，请重新复核。')
    policy['frozen_blocks'] = frozen
    policy['rest_changes'] = changes
    policy['rest_confirmation_id'] = intent['request_id']
    policy['allowed_task_ids'] = [str(intent['task_id'])]
    return policy


def rest_candidate_violations(policy, blocks):
    changes = policy.get('rest_changes') or []
    if not changes:
        return []
    intent = policy['execution_adjustment']
    target = [b for b in blocks if str(b.get('task_id')) == str(intent['task_id'])
              and str(b.get('block_id')) not in policy['historical_block_ids']]
    failures = []
    for change in changes:
        if not any(int(b['day_index']) * 1440 + float(b['start']) * 60 <= change['consumed_start']
                   and int(b['day_index']) * 1440 + float(b['end']) * 60 >= change['consumed_end'] for b in target):
            failures.append({'type': 'rest_change_without_work', 'message': '执行位置已变化，不能保留原休息缩减；请重新生成方案。'})
    return failures


def authorized_rest_gap(violation, policy, blocks):
    if violation.get('type') != 'insufficient_rest' or not policy or not policy.get('rest_changes'):
        return False
    ids = violation.get('interval_ids') or []
    mapping = {str(b.get('block_id')): b for b in blocks}
    if len(ids) != 2 or any(str(i) not in mapping for i in ids):
        return False
    left, right = [mapping[str(i)] for i in ids]
    if str(left.get('task_id')) != str(policy['execution_adjustment']['task_id']):
        return False
    left_end = int(left['day_index']) * 1440 + float(left['end']) * 60
    right_start = int(right['day_index']) * 1440 + float(right['start']) * 60
    return any(left_end == c['consumed_end'] and right_start >= c['consumed_end'] + c['remaining_minutes']
               for c in policy['rest_changes'])
