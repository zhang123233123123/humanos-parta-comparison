"""Explicit session feedback; never infer task remainder from elapsed time."""
def text(payload, key, limit):
    value = payload.get(key, '')
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f'{key} must be text of at most {limit} characters')
    return value.strip()


def validate_report(payload):
    allowed = {'user_id', 'request_id', 'source_session_id', 'original_task_id', 'plan_id',
               'plan_revision', 'outcome', 'state', 'reason', 'progress', 'next_step',
               'remaining_minutes', 'retain_candidate', 'locale', 'result'}
    if set(payload) - allowed:
        raise ValueError('Unknown session report fields: ' + ', '.join(sorted(set(payload) - allowed)))
    for key in ('request_id', 'source_session_id', 'original_task_id', 'plan_id'):
        if not text(payload, key, 200):
            raise ValueError(f'{key} is required')
    if type(payload.get('plan_revision')) is not int:
        raise ValueError('plan_revision must be an integer')
    if payload.get('outcome') not in {'completed', 'interrupted'}:
        raise ValueError('Invalid session outcome')
    state = payload.get('state')
    if not isinstance(state, dict) or set(state) - {'mood', 'energy', 'focus', 'stress', 'daily_note'}:
        raise ValueError('Invalid state fields')
    if state.get('mood') not in {'positive', 'neutral', 'low', 'anxious'}:
        raise ValueError('Please choose mood, energy, focus and stress')
    for key in ('energy', 'focus', 'stress'):
        if type(state.get(key)) is not int or not 1 <= state[key] <= 7:
            raise ValueError('Please choose mood, energy, focus and stress')
    text(state, 'daily_note', 1500)
    reason = text(payload, 'reason', 247)
    if reason not in {'', 'tired', 'stuck', 'interrupted', 'other'} and not reason.startswith('other: '):
        raise ValueError('Invalid interruption reason')
    for key in ('progress', 'next_step'):
        text(payload, key, 240)
    minutes = payload.get('remaining_minutes')
    if minutes is not None and (type(minutes) is not int or not 1 <= minutes <= 10080):
        raise ValueError('remaining_minutes must be an integer from 1 to 10080 or null')
    result = payload.get('result', 'interrupted' if payload['outcome'] == 'interrupted' else 'done')
    if result not in {'interrupted', 'done', 'unfinished'} or (payload['outcome'] == 'completed') != (result == 'done'):
        raise ValueError('Session result and outcome disagree')
    if result == 'done' and minutes is not None:
        raise ValueError('Completed work cannot retain unfinished minutes')
    if result != 'interrupted' and reason:
        raise ValueError('Only an explicit interruption accepts an interruption reason')
    if payload.get('retain_candidate', minutes is not None) != (minutes is not None):
        raise ValueError('A pending portion requires an explicit estimate')
    return {**payload, 'result': result, 'reason': reason,
            'progress': text(payload, 'progress', 240), 'next_step': text(payload, 'next_step', 240)}
