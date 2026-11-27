"""Daily flexible activity semantics, independent of storage and HTTP."""
import re
from datetime import date, timedelta


def normalize_recurrence(task: dict) -> dict:
    task = dict(task)
    recurrence = task.get('recurrence')
    # Only task-specific evidence is eligible; never copy frequency across a batch.
    evidence = ' '.join([str(task.get('title') or ''), *task.get('source_spans', [])])
    if recurrence is None and re.search(r'每天|每日|\bevery\s+day\b|\bdaily\b', evidence, re.I):
        recurrence = 'daily'
    if recurrence not in (None, 'none', 'daily'):
        raise ValueError('Unsupported recurrence')
    task['recurrence'] = recurrence or 'none'
    if recurrence == 'daily':
        missing = [key for key in task.get('missing_fields', []) if key not in ('deadline_at', 'start_at')]
        # Absolute dates cannot silently become repeating time-of-day rules.
        if task.get('start_at') or task.get('deadline_at') or task.get('task_type', task.get('schedule_type')) == 'fixed_event':
            missing.append('recurrence_time_scope')
        task['missing_fields'] = list(dict.fromkeys(missing))
    return task


def activity_id(draft_id: str) -> str:
    return 'draft-activity-' + draft_id


def occurrence_days(profile: dict, days: list[int], now) -> list[int]:
    week = (profile.get('weekly_context') or {}).get('week_id') or profile.get('active_week_id')
    start = date.fromisoformat(week) if week else now.date()
    return [day for day in days if start + timedelta(days=(day - start.weekday()) % 7) >= now.date()]


def daily_activity(draft: dict) -> dict:
    task = normalize_recurrence(draft['task'])
    if task['recurrence'] != 'daily' or task.get('missing_fields'):
        raise ValueError('Complete the daily activity before submitting')
    duration = task.get('duration')
    if type(duration) is not int or not 1 <= duration <= 1440:
        raise ValueError('Duration must be 1–1440 whole minutes')
    return {'id': activity_id(draft['draft_id']), 'title': task['title'],
            'type': 'flexible_activity', 'category': 'flexible_activity',
            'day': '每天', 'days': list(range(7)), 'duration_minutes': duration,
            'occurrence_mode': 'repeat_every_day', 'confirmed': True,
            'source': 'user_confirmed_draft', 'context': task.get('context', '')}
