"""Atomic feedback settlement with no parent workload or plan mutation."""
from datetime import datetime, timedelta
from hashlib import sha256
import json
from ..domain.execution.work_report import validate_report
from ..repositories.session_reports import SessionReportRepository
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.tasks import TaskRepository
from ..repositories.runtime_states import RuntimeStateRepository
from ..domain.runtime_observation import project_runtime_state, current_day_observation


def report_receipt(conn, user_id, session_id, state_id, pending_id, ports):
    row = RuntimeStateRepository(conn).get(user_id, state_id)
    state = project_runtime_state(row)
    # Reconstruct the original immutable receipt at its own report time, not today's state.
    state = current_day_observation(state, datetime.fromisoformat(state['reported_at']))
    return {'runtime_state': state, 'execution_session': ports.execution_session_row(
        ExecutionSessionRepository(conn).get(user_id=user_id, session_id=session_id)),
        'pending_work_id': pending_id, 'daily_plan_review': None}


def pending_work(user_id, *, connect):
    with connect() as conn:
        rows = SessionReportRepository(conn).pending(user_id)
    return [{**{k: r[k] for k in ('id', 'original_task_id', 'source_session_id', 'title',
                                'remaining_minutes', 'source', 'status')},
             'deadline': r['deadline_at'],
             'planning_period_end': (datetime.fromisoformat(r['week_id']) + timedelta(days=6)).date().isoformat()}
            for r in rows]


def report_session(user_id, payload, *, ports):
    command = validate_report(payload)
    command_hash = sha256(json.dumps(command, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    ports.ensure_profile(user_id)
    with ports.atomic() as conn:
        reports = SessionReportRepository(conn)
        previous = reports.replay(user_id, command['request_id'])
        if previous:
            if previous['command_hash'] != command_hash:
                raise ValueError('request_id belongs to another session report')
            return report_receipt(conn, user_id, previous['execution_session_id'], previous['state_id'], previous['pending_work_id'], ports)
        sessions = ExecutionSessionRepository(conn)
        row = sessions.get(user_id=user_id, session_id=command['source_session_id'])
        if row is None:
            raise KeyError(command['source_session_id'])
        if row['task_id'] != command['original_task_id']:
            raise ValueError('Session does not belong to this task')
        plan = ports.active_plan(user_id)
        if not plan or plan['plan_id'] != command['plan_id'] or plan['plan_revision'] != command['plan_revision']:
            raise ValueError('Plan changed; reload before reporting this session')
        if row['block_id'] not in {b['block_id'] for b in plan.get('plan_patch', [])}:
            raise ValueError('Session is outside the active plan')
        if row['status'] not in {'ready', 'running', 'paused'}:
            raise ValueError('Session is already closed')
        from ..domain.task.eligibility import require_executable_task
        require_executable_task(ports.get_task(row['task_id'], user_id))
        if command['result'] == 'interrupted' and not row['actual_start_at']:
            raise ValueError('Start this session before interrupting it')
        state = ports.save_runtime_state(user_id, {**command['state'], 'request_id': command['request_id'] + ':state',
            'source': 'session_report', 'daily_checkin': True})
        ended_at = ports.user_clock_now(user_id).isoformat()
        active = int(row['accumulated_active_minutes'] or 0)
        if row['status'] == 'running':
            active += ports._iso_elapsed_minutes(row['resumed_at'] or row['actual_start_at'], ended_at)
        snapshot = {'result': command['result'], 'reason': command['reason'], 'progress': command['progress'],
                    'next_step': command['next_step'], 'remaining_minutes': command.get('remaining_minutes'),
                    'feedback': dict(command['state']), 'actual_minutes': active, 'state_id': state['id']}
        timestamp = ports.now()
        status = 'completed' if command['outcome'] == 'completed' else 'interrupted'
        sessions.save_feedback(user_id=user_id, session_id=row['id'], status=status,
            outcome=command['result'], ended_at=ended_at, actual_minutes=active,
            timestamp=timestamp, snapshot_json=ports.encode(snapshot))
        sessions.clear_resume(user_id, row['id'])
        candidate = None
        if command.get('remaining_minutes') is not None:
            candidate = ports.make_id('pending')
            reports.create_pending(candidate, user_id, row['id'], command['remaining_minutes'],
                                   'unfinished_session' if command['result'] == 'unfinished' else 'interrupted_session', timestamp)
        # Reconcile only the status. Task workload, demand and task notes stay owned by the task.
        sibling_statuses = {s['status'] for s in sessions.list_for_user(user_id=user_id)
                            if s['task_id'] == row['task_id'] and s['id'] != row['id']}
        task_status = 'running' if 'running' in sibling_statuses else 'paused' if 'paused' in sibling_statuses else 'scheduled' if 'ready' in sibling_statuses else 'queued'
        TaskRepository(conn).update_fields(task_id=row['task_id'], user_id=user_id,
            updates={'status': task_status, 'updated_at': timestamp})
        ports._insert_state_transition(conn, user_id=user_id, task_id=row['task_id'],
            before_status=row['status'], action_type='end', after_status=status, execution_session_id=row['id'],
            outcome={'persisted': True, 'completion': command['result'], 'actual_minutes': active,
                     'pending_work_id': candidate}, created_at=timestamp)
        task = ports.get_task(row['task_id'], user_id)
        feedback = {'id': command['request_id'], 'user_id': user_id, 'task_id': row['task_id'],
            'execution_session_id': row['id'], 'created_at': timestamp, 'trigger': 'session_report',
            'task_evaluation': {'completion': command['result'], 'progress': command['progress'],
                                'next_step': command['next_step'], 'reason': command['reason'],
                                'session_remaining_minutes': command.get('remaining_minutes')}, 'state_evaluation': command['state'],
            'recommendation_evaluation': {}, 'profile_trait_refs': ports.decode(row['profile_trait_refs_json'], [])}
        ports._enqueue_personalization(conn, user_id=user_id, kind='execution_feedback',
            source_id=command['request_id'], payload={'feedback': feedback, 'task': task}, timestamp=timestamp)
        # Persist retrieval memory using the existing outbox-driven behavior experience pipeline.
        reports.insert(user_id, row['id'], command['request_id'], command_hash, state['id'], candidate, timestamp)
        result = report_receipt(conn, user_id, row['id'], state['id'], candidate, ports)
    return result
