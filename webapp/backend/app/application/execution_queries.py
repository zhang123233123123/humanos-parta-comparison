"""Session reads and record projection with an injected elapsed-time calculator."""
from collections.abc import Callable
from datetime import datetime
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..domain.execution_continuation import remaining_session_minutes


def iso_elapsed_minutes(start_value, end_value=None, *, clock_now):
    if not start_value:
        return 0
    try:
        start = datetime.fromisoformat(str(start_value))
        end = datetime.fromisoformat(str(end_value)) if end_value else clock_now(start.tzinfo)
        return max(int((end - start).total_seconds() // 60), 0)
    except (TypeError, ValueError):
        return 0


def project_session(row, *, decode: Callable, elapsed_minutes: Callable) -> dict:
    data = dict(row)
    data['profile_trait_refs'] = decode(data.pop('profile_trait_refs_json', '[]'), [])
    data['parallel_context'] = decode(data.pop('parallel_context_json', '{}'), {})
    planned = int(data.get('planned_work_minutes') or 0)
    active = int(data.get('accumulated_active_minutes') or 0)
    if data.get('status') == 'running':
        active += elapsed_minutes(data.get('resumed_at') or data.get('actual_start_at'))
    data['live_active_minutes'] = active
    data['execution_session_id'] = data.pop('id')
    data['interruption_snapshot'] = decode(data.get('interruption_snapshot_json', '{}'), {})
    if 'feedback' in data['interruption_snapshot']:
        data['work_report'] = data['interruption_snapshot']
    data['session_remaining_minutes'] = remaining_session_minutes(
        planned, active, decode(data.get('interruption_snapshot_json', '{}'), {}))
    if data.get('status') == 'interrupted':
        data['session_remaining_minutes'] = data['interruption_snapshot'].get('remaining_minutes')
    return data


def list_sessions(user_id: str, statuses: list[str] | None, *, connect: Callable, project: Callable) -> list[dict]:
    with connect() as conn:
        rows = ExecutionSessionRepository(conn).list_for_user(user_id=user_id, statuses=statuses)
    return [project(row) for row in rows]
