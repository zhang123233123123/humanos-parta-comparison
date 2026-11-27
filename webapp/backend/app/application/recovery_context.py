"""Project saved recovery facts and optional current reports without writing them."""
from copy import deepcopy


def recovery_context(task, submitted=None):
    task = task or {}
    window = task.get('contextWindow') or {}
    execution = task.get('execution') or {}
    saved = {
        'progress': window.get('progress'),
        'next_action': window.get('nextStep'),
        'open_questions': window.get('open_questions'),
        'stop_reason': execution.get('last_stop_reason'),
        'progress_percent': execution.get('progress_percent'),
        'task_remaining_minutes': execution.get('remaining_duration_minutes'),
        'materials': window.get('materials'),
    }
    values, sources = {}, {}
    for source, record in (('saved_task', saved), ('current_report', submitted or {})):
        for key in saved:
            value = record.get(key)
            if value is None or value == '' or value == []:
                continue
            if key in {'progress_percent', 'task_remaining_minutes'}:
                if isinstance(value, bool):
                    raise ValueError(f'{key} must be a nonnegative whole number')
                try:
                    number = float(value)
                    if not number.is_integer() or number < 0 or (key == 'progress_percent' and number > 100):
                        raise ValueError()
                    value = int(number)
                except (ValueError, TypeError, OverflowError):
                    raise ValueError(f'{key} must be a valid nonnegative whole number') from None
            elif key == 'open_questions':
                if not isinstance(value, (str, list)):
                    raise ValueError('open_questions must be text or a list of text')
                value = value.splitlines() if isinstance(value, str) else value
                if any(not isinstance(item, str) for item in value):
                    raise ValueError('open_questions must contain text')
                value = [item.strip() for item in value if item.strip()]
            elif key != 'materials':
                if not isinstance(value, str):
                    raise ValueError(f'{key} must be text')
                value = value.strip()
            if value == '' or value == []:
                continue
            values[key] = deepcopy(value)
            sources[key] = source
    return {**values, 'field_sources': sources}
