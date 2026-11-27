"""Optional, user-confirmed energy demand; never derived from difficulty."""
LEVELS = {'unknown', 'low', 'medium', 'high'}


def energy_requirement(value):
    level = 'unknown' if value is None else value
    if not isinstance(level, str) or level not in LEVELS:
        raise ValueError('energy_demand must be unknown, low, medium or high')
    return {'level': level, 'source': 'user_confirmed' if level != 'unknown' else 'unknown'}


def assess_energy_requirement(task, state):
    level = task.get('energy_demand') or (task.get('task_demand') or {}).get('energy_requirement', {}).get('level', 'unknown')
    if state.get('current_eligible') is False or state.get('source') in {'default', 'legacy_unknown', 'historical_self_report'}:
        code = 'current_energy_unknown'
    elif level not in LEVELS or level == 'unknown' or state.get('energy') is None:
        code = 'insufficient_energy_evidence'
    elif level == 'high' and state['energy'] <= 3:
        code = 'high_demand_low_reported_energy'
    else:
        code = 'review_energy_requirement'
    return {'task_id': task.get('id'), 'energy_demand': level, 'reported_energy': state.get('energy'),
            'reported_at': state.get('reported_at'), 'created_at': state.get('created_at'),
            'reason_code': code, 'authority': 'soft_advisory', 'policy_version': 'energy_advisory_v1',
            'automatic_reschedule': False, 'confidence': 'limited'}
