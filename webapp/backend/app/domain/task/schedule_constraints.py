"""Validated per-task occurrence and window facts; no persistence or clock reads."""
from copy import deepcopy
from datetime import date, timedelta
import re

TIMED_TASK_TYPES = frozenset({'fixed_event', 'recurring_routine', 'flexible_activity'})
FIELDS = frozenset({'occurrence_mode', 'date', 'days', 'start_date', 'start_time', 'end_time'})


def clock_minutes(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d|24:00', value):
        raise ValueError('Task window times must use HH:mm')
    hour, minute = map(int, value.split(':'))
    return hour * 60 + minute


def iso_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Task dates must use YYYY-MM-DD')
    return date.fromisoformat(value)


def normalize_constraints(kind, value, duration, *, week_id=None):
    if kind == 'flexible_task':
        if value not in (None, {}):
            raise ValueError('Ordinary tasks use deadline_at, not occurrence windows')
        return None
    if kind not in TIMED_TASK_TYPES or not isinstance(value, dict) or not value:
        raise ValueError('This task type requires schedule_constraints')
    if set(value) - FIELDS:
        raise ValueError('Unsupported schedule_constraints fields')
    result = deepcopy(value)
    mode = result.get('occurrence_mode')
    if mode == 'one_off':
        iso_date(result.get('date'))
        if 'days' in result or 'start_date' in result:
            raise ValueError('Single occurrences use date only')
    elif mode == 'repeat_selected_days':
        days = result.get('days')
        if not isinstance(days, list) or not days or any(type(d) is not int or d not in range(7) for d in days):
            raise ValueError('Repeated tasks require weekdays from 0 to 6')
        if len(days) != len(set(days)) or 'date' in result:
            raise ValueError('Repeated task weekdays must be unique; do not supply date')
        iso_date(result.get('start_date'))
        result['days'] = sorted(days)
    else:
        raise ValueError('Select one_off or repeat_selected_days')
    has_start = result.get('start_time') is not None
    has_end = result.get('end_time') is not None
    if has_start != has_end or (kind != 'flexible_activity' and not has_start):
        raise ValueError('This task requires paired start_time and end_time')
    if has_start:
        start, end = clock_minutes(result['start_time']), clock_minutes(result['end_time'])
        if end <= start:
            raise ValueError('Task end_time must be later than start_time; overnight windows are unsupported')
        if kind == 'fixed_event' and duration != end - start:
            raise ValueError('Fixed task duration must equal its fixed window')
        if kind == 'flexible_activity' and duration > end - start:
            raise ValueError('Flexible task duration exceeds its allowed window')
    if week_id and not occurrence_dates(result, week_id):
        raise ValueError('Task has no occurrence in the selected planning period')
    return result


def occurrence_dates(constraints, week_id):
    start = iso_date(week_id)
    dates = [start + timedelta(days=i) for i in range(7)]
    if constraints['occurrence_mode'] == 'one_off':
        selected = iso_date(constraints['date'])
        return [selected] if selected in dates else []
    first = iso_date(constraints['start_date'])
    return [d for d in dates if d >= first and d.weekday() in constraints['days']]


def validate_task_timing(kind, window, duration, deadline, *, week_id=None):
    from .schedule_type import validate_task_deadline
    validate_task_deadline(kind, deadline)
    value = window.get('schedule_constraints')
    if value is not None or kind in {'recurring_routine', 'flexible_activity'}:
        normalized = normalize_constraints(kind, value, duration, week_id=week_id)
        if normalized is not None:
            window['schedule_constraints'] = normalized
        if window.get('startAt'):
            raise ValueError('Occurrence tasks use schedule_constraints, not start_at')
    elif kind == 'fixed_event' and not window.get('startAt'):
        raise ValueError('fixed_event requires startAt or schedule_constraints')


def task_context_items(tasks, week_id, *, now_date=None):
    """Read-only projection for planning; preserves canonical Task identity."""
    items = []
    for task in tasks:
        constraints = task.get('schedule_constraints')
        if not constraints or task.get('removed_from_week') or task.get('status') in {'completed', 'terminated', 'blocked'}:
            continue
        if task.get('week_id') and task['week_id'] != week_id:
            continue
        dates = occurrence_dates(constraints, week_id)
        if now_date:
            dates = [d for d in dates if d >= now_date]
        if not dates:
            continue
        items.append({'id': task['id'], 'task_id': task['id'], 'title': task['title'],
            'type': task['task_type'], 'day': ', '.join(d.isoformat() for d in dates),
            'days': [d.weekday() for d in dates], 'occurrence_mode': constraints['occurrence_mode'],
            'duration_minutes': task['duration'],
            **({'start': constraints['start_time'], 'end': constraints['end_time']}
               if constraints.get('start_time') is not None else {})})
    return items
