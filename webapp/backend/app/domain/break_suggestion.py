"""Optional check-in prompt, not an execution or scheduling command."""


def suggest_break(state: dict, sessions: list[dict]) -> dict | None:
    if (not state.get('id') or state.get('source') != 'self_report'
            or state.get('current_eligible') is not True
            or state.get('replayed') or state.get('already_completed')):
        return None
    reasons = []
    for field, code in (('focus', 'low_focus'), ('energy', 'low_energy'), ('stress', 'high_stress')):
        value = state.get(field)
        if field not in state.get('reported_fields', []) or type(value) is not int or not 1 <= value <= 7:
            continue
        if (value >= 6) if field == 'stress' else (value <= 3):
            reasons.append(code)
    running = [session for session in sessions if session.get('status') == 'running']
    # Do not arbitrarily pause one member of a parallel execution group.
    if not reasons or len(running) != 1:
        return None
    session = running[0]
    if not session.get('execution_session_id') or not session.get('task_id'):
        return None
    return {
        'id': f"{state['id']}:{session['execution_session_id']}",
        'execution_session_id': session['execution_session_id'],
        'task_id': session['task_id'],
        'task_title': session.get('task_title') or session.get('title'),
        'reason_codes': reasons,
        'suggested_minutes': 10,
        'requires_confirmation': True,
        'policy_version': 'checkin_break_prompt_v1',
    }
