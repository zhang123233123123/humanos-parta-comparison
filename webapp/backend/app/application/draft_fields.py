"""Validate manual draft edits independently of AI extraction and HTTP."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re
from .draft_field_validation import merge_task_answers


def explicit_time(value, zone_name):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError('Time must be a date-time string')
    if not re.search(r'[T ]\d{2}:\d{2}', value):
        raise ValueError('Specify both date and time; midnight is not inferred')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.utcoffset() is not None:
        return parsed.isoformat()
    if not zone_name:
        raise ValueError('A timezone is required before editing local time')
    try:
        zone = ZoneInfo(zone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError('Unknown draft timezone; check your settings') from exc
    candidates = set()
    for fold in (0, 1):
        aware = parsed.replace(tzinfo=zone, fold=fold)
        if aware.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == parsed:
            candidates.add(aware.isoformat())
    if len(candidates) != 1:
        raise ValueError('This local time is ambiguous or nonexistent; provide an explicit UTC offset')
    return candidates.pop()


def edit_fields(task, fields, zone_name):
    if not isinstance(fields, dict) or not fields:
        raise ValueError('Provide at least one edited field')
    normalized = dict(fields)
    if 'duration_minutes' in fields and fields['duration_minutes'] is not None and type(fields['duration_minutes']) is not int:
        raise ValueError('Duration must be whole minutes')
    for key in ('start_at', 'deadline_at'):
        if key in normalized:
            normalized[key] = explicit_time(normalized[key], zone_name)
    updates = [{'task_id': task['id'], 'field': key, 'value': value, 'source_span': f'{key}={fields[key]}'} for key,value in normalized.items()]
    evidence = '\n'.join(item['source_span'] for item in updates)
    result = merge_task_answers([task], {'is_followup': True, 'updates': updates}, evidence)[0]
    start, end = result.get('start_at'), result.get('deadline_at')
    if start and end and datetime.fromisoformat(start.replace('Z', '+00:00')) >= datetime.fromisoformat(end.replace('Z', '+00:00')):
        raise ValueError('Start must be before deadline; edit or clear the conflicting time')
    for key in normalized:
        provenance_key = 'duration' if key == 'duration_minutes' else key
        result['field_provenance'][provenance_key]['source_id'] = 'draft_editor'
    return result
