"""Bounded observed history for ordering; never infer fatigue or rest from gaps."""
import json
from datetime import datetime, timedelta
from .scheduling_prompt_context import select_fields

DAYS = 7
LIMIT = 40


def recent_scheduling_behavior(user_id, *, now, recorded_now_ms, connect, sessions):
    cutoff = now - timedelta(days=DAYS)
    selected = []
    for session in sessions:
        if session.get('user_id') != user_id or not session.get('actual_start_at'):
            continue
        stamp = session.get('actual_end_at') or session.get('paused_at') or session.get('resumed_at') or session['actual_start_at']
        try:
            instant = datetime.fromisoformat(stamp)
            if instant.tzinfo is None or not cutoff <= instant <= now:
                continue
        except (TypeError, ValueError):
            continue
        item = select_fields(session, ('execution_session_id', 'task_id', 'status',
            'actual_start_at', 'actual_end_at', 'paused_at', 'resumed_at',
            'planned_work_minutes', 'live_active_minutes', 'completion_outcome',
            'pause_reason', 'resume_preference'))
        if isinstance(item.get('pause_reason'), str):
            item['pause_reason'] = item['pause_reason'][:400]
        item['observed_at'] = instant.isoformat()
        selected.append((instant, item))
    selected.sort(key=lambda pair: (pair[0], str(pair[1].get('execution_session_id'))))
    with connect() as conn:
        from .personalization_projector import drain_personalization_outbox
        from ..repositories.plan_edit_evidence import PlanEditEvidenceRepository
        drain_personalization_outbox(conn, user_id=user_id)
        rows = PlanEditEvidenceRepository(conn).recent_behavior(
            user_id, recorded_now_ms - DAYS * 86400000, recorded_now_ms, LIMIT + 1)
    events = []
    for row in reversed(rows[:LIMIT]):
        data = json.loads(row['event_json'])
        meta = data.get('metadata') or {}
        if data.get('source_type') == 'plan_edit' and meta.get('actor') != 'user':
            continue
        item = select_fields(data, ('event_id', 'event_type', 'source_type', 'source_id', 'occurred_at'))
        item['recorded_at'] = row['created_at']
        item['before'] = select_fields(data.get('before'), ('execution_status', 'day_index', 'start', 'end', 'duration', 'task_id'))
        item['after'] = select_fields(data.get('after'), ('execution_status', 'day_index', 'start', 'end', 'duration', 'task_id'))
        item['execution_session_id'] = meta.get('execution_session_id')
        item['actor'] = meta.get('actor')
        item['trusted_execution_transition'] = meta.get('trusted_execution_transition')
        events.append(item)
    return {
        'authority': 'observations_only_not_state_or_preference',
        'lookback_days': DAYS,
        'session_clock': 'account_actual_timestamps', 'session_window_end': now.isoformat(),
        'record_clock': 'server_recording_time', 'record_window_end_ms': recorded_now_ms,
        'sessions': [item for _, item in selected[-LIMIT:]], 'recorded_events': events,
        'truncated': len(selected) > LIMIT or len(rows) > LIMIT,
        'limitations': [
            'Session summaries and event records may describe the same activity; do not double count.',
            'Recorded event times are server write times and may differ from QA account time.',
            'No record or a gap does not establish rest, fatigue, postponement or a preference.',
            'Session end is not task completion; completion_outcome is a reported outcome when present.',
            'Only persisted effective events are included; history may be incomplete.',
        ],
    }
