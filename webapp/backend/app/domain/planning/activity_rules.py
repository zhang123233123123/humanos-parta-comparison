"""Preferred and flexible task placement and validation; no external access."""
from datetime import timedelta
import math

from ..profile.weekly import _clock_minutes
from ..task.recurrence import occurrence_days
from .period import day_offset
from ..timeline import WeeklySegment, WeeklyTimeAxis

from .task_priority import REMAINING_TASK_TYPES


def activity_requirements(profile, items, now):
    requirements = []
    for item in items:
        kind = item.get('type') or item.get('category')
        if kind not in {'recurring_routine', 'flexible_activity'} or not item.get('id'):
            continue
        minutes = item.get('duration_minutes')
        if type(minutes) is not int or minutes <= 0:
            raise ValueError('Activity duration must be positive whole minutes')
        start, end = _clock_minutes(item.get('start')), _clock_minutes(item.get('end'))
        for weekday in occurrence_days(profile, item.get('days') or [], now):
            requirements.append({'source_id': str(item['id']), 'task_id': item.get('task_id'), 'kind': kind,
                'title': item['title'], 'day_index': day_offset(profile, weekday, now),
                'minutes': minutes, 'start_minute': start, 'end_minute': end})
    return requirements


def place_remaining_tasks(requirements, available, occupied, *, week_start, now_minute, grid,
                    existing_blocks=(), preserved_source_ids=()):
    """Place preferred tasks, then flexible tasks, without moving ordinary work."""
    blocks, missing = [], []
    busy = [WeeklySegment(a, b) for a, b in occupied if a < b]
    represented = {(str(b.get('source_id')), b.get('day_index')) for b in existing_blocks
                   if b.get('kind') in REMAINING_TASK_TYPES}
    ordered = [r for kind in REMAINING_TASK_TYPES for r in requirements if r['kind'] == kind]
    for rule in ordered:
        identity = (rule['source_id'], rule['day_index'])
        if identity in represented or rule['source_id'] in preserved_source_ids:
            continue
        day = rule['day_index']
        lower, upper = day * 1440, (day + 1) * 1440
        free = WeeklyTimeAxis.subtract(available, busy)
        candidates = []
        preferred = rule['kind'] == 'recurring_routine'
        window_start = lower + (rule['start_minute'] or 0)
        window_end = lower + (rule['end_minute'] if rule['end_minute'] is not None else 1440)
        for window in free:
            start = math.ceil(max(window.start, lower, now_minute,
                                  lower if preferred else window_start) / grid) * grid
            while start + rule['minutes'] <= min(window.end, upper,
                                                upper if preferred else window_end):
                end = start + rule['minutes']
                # Prefer the supplied window, then the closest start. Never move ordinary work.
                candidates.append((preferred and not (window_start <= start and end <= window_end),
                                   abs(start - window_start) if preferred else start, start, end))
                start += grid
        if not candidates:
            missing.append({'source_id': rule['source_id'], 'day_index': day,
                            'title': rule['title'], 'kind': rule['kind'], 'remaining_minutes': rule['minutes'],
                            'reason': 'no_remaining_capacity'})
            continue
        _, _, start, end = min(candidates)
        prefix = 'preferred' if preferred else 'flexible'
        blocks.append({'block_id': f"{prefix}-{rule['source_id']}-{day}",
            'source_id': rule['source_id'], 'task_id': rule.get('task_id'), 'title': rule['title'],
            'kind': rule['kind'], 'day_index': day, 'start': (start - lower) / 60,
            'end': (end - lower) / 60, 'start_at': (week_start + timedelta(minutes=start)).isoformat(),
            'end_at': (week_start + timedelta(minutes=end)).isoformat(),
            'session_minutes': rule['minutes'], 'planned_work_minutes': 0, 'movable': True,
            'week_id': week_start.date().isoformat(), 'plan_status': 'proposed'})
        busy.append(WeeklySegment(start, end))
        represented.add(identity)
    return blocks, missing


def validate_activities(requirements, blocks, available, *, historical_ids=(), preserved_source_ids=()):
    """Validate source constraints, not a regenerated preferred placement."""
    errors, warnings = [], []
    expected = {(r['source_id'], r['day_index']): r for r in requirements}
    seen = set()
    for block in blocks:
        if str(block.get('block_id')) in historical_ids or block.get('kind') not in {'recurring_routine', 'flexible_activity'}:
            continue
        source = str(block.get('source_id') or '')
        if source in preserved_source_ids:
            continue
        identity = (source, block.get('day_index'))
        rule = expected.get(identity)
        if not rule or block.get('kind') != rule['kind']:
            errors.append({'type': 'unknown_activity_occurrence', 'source_id': source})
            continue
        if rule.get('task_id') and block.get('task_id') != rule['task_id']:
            errors.append({'type': 'activity_task_identity_mismatch', 'source_id': source})
        if identity in seen:
            errors.append({'type': 'duplicate_activity_occurrence', 'source_id': source})
        seen.add(identity)
        try:
            start, end = float(block['start']) * 60, float(block['end']) * 60
            if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= 1440:
                raise ValueError('Invalid activity time')
        except (KeyError, TypeError, ValueError):
            errors.append({'type': 'invalid_activity_time', 'source_id': source})
            continue
        if abs(end - start - rule['minutes']) > .001:
            errors.append({'type': 'activity_duration_mismatch', 'source_id': source})
        absolute_start, absolute_end = rule['day_index'] * 1440 + start, rule['day_index'] * 1440 + end
        if not any(w.start <= absolute_start and absolute_end <= w.end for w in available):
            errors.append({'type': 'activity_outside_availability', 'source_id': source})
        if rule['start_minute'] is not None:
            outside = start < rule['start_minute'] or end > rule['end_minute']
            if outside:
                target = warnings if rule['kind'] == 'recurring_routine' else errors
                target.append({'type': 'preferred_window_unmet' if rule['kind'] == 'recurring_routine' else 'activity_outside_window',
                               'source_id': source, 'day_index': rule['day_index'], 'title': rule['title'],
                               'message': f"{rule['title']}未安排在偏好时段内。"})
    for identity, rule in expected.items():
        if identity in seen or rule['source_id'] in preserved_source_ids:
            continue
        if rule['kind'] == 'flexible_activity':
            errors.append({'type': 'daily_activity_capacity_insufficient', 'source_id': rule['source_id'],
                           'day_index': rule['day_index'], 'message': f"灵活任务“{rule['title']}”未完整安排。"})
        else:
            warnings.append({'type': 'preferred_activity_unscheduled', 'source_id': rule['source_id'], 'title': rule['title'],
                             'day_index': rule['day_index'], 'message': f"{rule['title']}尚未安排；普通任务优先。"})
    return errors, warnings
