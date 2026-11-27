"""End a Session without marking the whole task completed."""
from collections.abc import Callable
from ..domain.task import require_execution_transition
from ..repositories.execution_sessions import ExecutionSessionRepository


def end_execution(user_id: str, payload: dict, *, now: Callable, ensure_profile: Callable,
                  user_clock: Callable, connect: Callable, request_seen: Callable,
                  project_session: Callable, elapsed_minutes: Callable,
                  insert_transition: Callable, record_request: Callable) -> dict:
    session_id = str(payload.get('execution_session_id') or '')
    timestamp = now()
    profile = ensure_profile(user_id)
    ended_at = str(payload.get('actual_end_at') or user_clock(user_id, profile.get('timezone') or 'Asia/Shanghai').isoformat())
    actual_minutes = max(int(payload.get('actual_minutes') or 0), 0)
    request_id = str(payload.get('request_id') or '').strip() or None
    with connect() as conn:
        replay = request_seen(conn, user_id, request_id)
        if replay:
            return project_session(replay)
        sessions = ExecutionSessionRepository(conn)
        row = sessions.get(session_id=session_id, user_id=user_id)
        if not row:
            raise KeyError(session_id)
        require_execution_transition(str(row['status']), 'ended')
        calculated = int(row['accumulated_active_minutes'] or 0)
        if row['status'] == 'running':
            calculated += elapsed_minutes(row['resumed_at'] or row['actual_start_at'], ended_at)
        active = max(calculated, actual_minutes)
        sessions.mark_ended(session_id=session_id, user_id=user_id, ended_at=ended_at,
                            active_minutes=active, timestamp=timestamp)
        insert_transition(conn, user_id=user_id, task_id=row['task_id'], before_status=str(row['status']),
            action_type='end', after_status='ended', execution_session_id=session_id,
            outcome={'persisted': True, 'actual_minutes': active}, created_at=timestamp)
        record_request(conn, user_id, request_id, session_id, 'finish', timestamp)
        updated = sessions.get(session_id=session_id, user_id=user_id)
    return project_session(updated)
