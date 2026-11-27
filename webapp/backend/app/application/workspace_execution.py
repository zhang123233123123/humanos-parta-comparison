"""Explicit calendar-session start/switch and confirmed missed-session deferral."""
from ..domain.execution.work_report import text
from ..domain.task.eligibility import require_executable_task
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.execution_requests import ExecutionRequestRepository
from ..repositories.session_reports import SessionReportRepository
from ..repositories.tasks import TaskRepository


def current_target(user_id, command, ports, sessions):
    row = sessions.get(user_id=user_id, session_id=command['session_id'])
    if row is None:
        raise KeyError(command['session_id'])
    plan = ports.active_plan(user_id) or {}
    if plan.get('plan_revision') != command.get('base_plan_revision') or row['block_id'] not in {
            b['block_id'] for b in plan.get('plan_patch', [])}:
        raise ValueError('The plan changed; reload before changing execution')
    require_executable_task(ports.get_task(row['task_id'], user_id))
    return row


def workspace_execution(user_id, command, *, defer=False, ports):
    allowed = {'user_id', 'request_id', 'session_id', 'base_plan_revision'} | (
        {'confirmed_not_started'} if defer else {'expected_active_id', 'retain_previous', 'remaining_minutes', 'progress'})
    if set(command) - allowed:
        raise ValueError('Unknown workspace execution fields')
    for field in ('request_id', 'session_id'):
        if not text(command, field, 200):
            raise ValueError(f'{field} is required')
    if type(command.get('base_plan_revision')) is not int:
        raise ValueError('base_plan_revision must be an integer')
    if defer and command.get('confirmed_not_started') is not True:
        raise ValueError('Explicit not-started confirmation is required')
    if not defer and 'expected_active_id' not in command:
        raise ValueError('expected_active_id is required')
    progress = text(command, 'progress', 240)
    if command.get('remaining_minutes') is not None:
        raise ValueError('Switching work does not estimate unfinished work')
    ports.ensure_profile(user_id)
    with ports.atomic() as conn:
        sessions = ExecutionSessionRepository(conn)
        requests = ExecutionRequestRepository(conn)
        request_action = 'workspace_defer' if defer else 'workspace_start'
        previous = requests.get(user_id=user_id, request_id=command['request_id'])
        if previous:
            if previous['execution_session_id'] != command['session_id'] or previous['action'] != request_action:
                raise ValueError('request_id belongs to another session or action')
            return ports.execution_session_row(sessions.get(user_id=user_id, session_id=command['session_id']))
        row = current_target(user_id, command, ports, sessions)
        now = ports.user_clock_now(user_id)
        timestamp = ports.now()
        if defer:
            if row['status'] != 'ready' or row['actual_start_at']:
                raise ValueError('Only unstarted sessions can be deferred')
            from datetime import datetime
            if now < datetime.fromisoformat(row['planned_end_at']):
                raise ValueError('This session has not reached its planned end')
            sessions.save_feedback(user_id=user_id, session_id=row['id'], status='not_started',
                outcome='not_started', ended_at=now.isoformat(), actual_minutes=0,
                timestamp=timestamp, snapshot_json=ports.encode({'result': 'not_started'}))
            SessionReportRepository(conn).create_pending(ports.make_id('pending'), user_id, row['id'],
                row['planned_work_minutes'], 'explicitly_deferred_session', timestamp)
            action, status = 'end', 'not_started'
        else:
            from datetime import datetime
            if datetime.fromisoformat(row['planned_start_at']).astimezone(now.tzinfo).date() != now.date():
                raise ValueError('Only today’s sessions can be started')
            if row['status'] not in {'ready', 'running', 'paused'}:
                raise ValueError('This session is closed')
            # Match the workspace: first running session, then first paused
            # session in calendar order, including the target being resumed.
            open_sessions = sessions.list_for_user(user_id=user_id, statuses=['running', 'paused'])
            running = [s for s in open_sessions if s['status'] == 'running']
            current = running[0] if running else next((s for s in open_sessions if s['status'] == 'paused'), None)
            expected = command['expected_active_id']
            if (current['id'] if current else None) != expected:
                raise ValueError('Current work changed; review the switch again')
            if len(running) > 1:
                raise ValueError('Resolve parallel work before switching')
            if row['status'] == 'running':
                requests.record(user_id=user_id, request_id=command['request_id'], session_id=row['id'],
                                action=request_action, timestamp=timestamp)
                return ports.execution_session_row(row)
            if current and current['status'] == 'running':
                active = int(current['accumulated_active_minutes'] or 0) + ports._iso_elapsed_minutes(
                    current['resumed_at'] or current['actual_start_at'], now.isoformat())
                snapshot = ports.decode(current['interruption_snapshot_json'], {})
                if progress:
                    snapshot['progress'] = progress
                sessions.save_pause((now.isoformat(), active, None, 'switch_task', ports.encode(snapshot),
                                     None, None, None, timestamp, current['id'], user_id))
                TaskRepository(conn).update_fields(task_id=current['task_id'], user_id=user_id,
                                                  updates={'status': 'paused', 'updated_at': timestamp})
                ports._insert_state_transition(conn, user_id=user_id, task_id=current['task_id'],
                    before_status='running', action_type='pause', after_status='paused',
                    execution_session_id=current['id'], created_at=timestamp)
            sessions.mark_running(user_id=user_id, session_id=row['id'], actual_start=now.isoformat(),
                                  request_id=command['request_id'], timestamp=timestamp)
            TaskRepository(conn).update_fields(task_id=row['task_id'], user_id=user_id,
                                              updates={'status': 'running', 'updated_at': timestamp})
            action, status = ('resume' if row['status'] == 'paused' else 'start'), 'running'
        ports._insert_state_transition(conn, user_id=user_id, task_id=row['task_id'], before_status=row['status'],
            action_type=action, after_status=status, execution_session_id=row['id'], created_at=timestamp)
        requests.record(user_id=user_id, request_id=command['request_id'], session_id=row['id'],
                        action=request_action, timestamp=timestamp)
        return ports.execution_session_row(sessions.get(user_id=user_id, session_id=row['id']))
