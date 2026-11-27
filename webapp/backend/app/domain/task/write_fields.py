"""Normalize task input without projecting away behavioral or execution facts."""
from copy import deepcopy

from .context_fields import validate_task_context


def normalize_task_write(payload: dict) -> dict:
    result = deepcopy(payload)
    for field in ('estimatedDuration', 'estimated_duration', 'deadlineAssumption', 'deadline_assumption', 'nextStep', 'openQuestions'):
        if field in result:
            raise ValueError('Unsupported task field: ' + field)
    if 'expected_difficulty' in result:
        value = result['expected_difficulty']
        if value is not None and (type(value) is not int or not 1 <= value <= 10):
            raise ValueError('expected_difficulty must be an integer from 1 to 10')
    if 'contextWindow' in result:
        raise ValueError('Use context_window for task writes')
    window = result.get('context_window', {})
    validate_task_context(window)
    if 'schedule_constraints' in result:
        if 'schedule_constraints' in window and window['schedule_constraints'] != result['schedule_constraints']:
            raise ValueError('Conflicting schedule_constraints')
        window['schedule_constraints'] = deepcopy(result['schedule_constraints'])
    for stored, field in (('dependency', 'dependency'), ('progress', 'progress'),
                          ('nextStep', 'next_step'), ('open_questions', 'open_questions')):
        if field in result:
            window[stored] = result[field]
    if window or 'context_window' in result:
        result['context_window'] = window

    return result


def with_reported_difficulty(demand: dict, payload: dict) -> dict:
    """Updating a user report must not replace analysis evidence or its provenance."""
    result = deepcopy(demand)
    if 'expected_difficulty' in payload:
        result['expected_difficulty'] = payload['expected_difficulty']
    return result
