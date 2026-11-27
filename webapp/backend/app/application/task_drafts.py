"""Durable task proposals. No AI or calendar side effects during reads/edits."""
import json
import time
from datetime import datetime
from dataclasses import dataclass
from typing import Callable

from ..repositories.task_drafts import TaskDraftRepository, register
from ..domain.task.recurrence import activity_id, daily_activity


class DraftConflict(ValueError):
    pass


def timestamp():
    return int(time.time() * 1000)


def record(row):
    result = dict(row)
    result['task'] = json.loads(result.pop('task_json'))
    result['draft_id'] = result.pop('id')
    return result


@dataclass(frozen=True)
class TaskDraftPorts:
    connect: Callable
    atomic: Callable
    get_task: Callable
    create_task: Callable
    get_profile: Callable | None = None
    upsert_profile: Callable | None = None


class TaskDrafts:
    def __init__(self, ports: TaskDraftPorts):
        self.ports = ports

    def list(self, user):
        with self.ports.connect() as conn:
            return [self.with_scheduling(conn, record(r)) for r in TaskDraftRepository(conn).list(user)]

    @staticmethod
    def with_scheduling(conn, draft):
        profile = TaskDraftRepository(conn).profile_timezone(draft['user_id'])
        draft['edit_timezone'] = draft['task'].get('timezone') or (profile['timezone'] if profile else None)
        if draft['task'].get('recurrence') == 'daily':
            draft['activity_id'] = activity_id(draft['draft_id'])
            weekly = json.loads(profile['weekly_context_json'] or '{}') if profile else {}
            draft['activity_exists'] = any(item.get('id') == draft['activity_id'] for item in weekly.get('context_items', []))
        job_id = draft.get('schedule_job_id')
        draft['scheduling'] = {'job_id': job_id, 'status': 'not_requested'}
        if job_id:
            row = TaskDraftRepository(conn).scheduling_job(draft['user_id'], job_id)
            if not row:
                draft['scheduling']['status'] = 'unavailable'
            else:
                result = json.loads(row['result_json'] or '{}')
                invalid = result.get('validation', {}).get('valid') is False or bool(result.get('unscheduled_tasks'))
                draft['scheduling'].update(status=row['status'], outcome=('needs_correction' if invalid else 'review_required') if row['status'] == 'completed' else None)
                if row['status'] == 'completed' and result.get('plan_id'):
                    plan = TaskDraftRepository(conn).plan_status(draft['user_id'], result['plan_id'])
                    if plan:
                        draft['scheduling'].update(plan_id=result['plan_id'], plan_status=plan['plan_status'])
                        if plan['plan_status'] == 'confirmed':
                            draft['scheduling']['outcome'] = 'confirmed'
                        elif plan['plan_status'] in ('superseded','needs_update'):
                            draft['scheduling']['outcome'] = 'outdated'
        return draft

    def get(self, user, draft_id):
        with self.ports.connect() as conn:
            row = TaskDraftRepository(conn).get(user, draft_id)
        if row is None:
            raise KeyError('Task draft not found')
        with self.ports.connect() as conn:
            return self.with_scheduling(conn, record(row))

    def update(self, user, draft_id, version, *, task=None, action=None):
        with self.ports.atomic() as conn:
            draft = self.get(user, draft_id)
            if version != draft['version']:
                raise DraftConflict('Draft changed; reload before editing')
            if draft['status'] in ('submitted', 'cancelled'):
                raise DraftConflict('Draft is already closed')
            data = task if task is not None else draft['task']
            if action not in (None, 'defer', 'resume', 'cancel'):
                raise ValueError('Unsupported draft action')
            status = {'defer': 'deferred', 'cancel': 'cancelled'}.get(action)
            if action is None and draft['status'] == 'deferred':
                status = 'deferred'
            status = status or ('needs_input' if data.get('missing_fields') else 'ready')
            TaskDraftRepository(conn).update(user, draft_id, json.dumps(data, ensure_ascii=False), status, timestamp())
            self.close_batch(conn, user, draft['batch_id'])
            return self.get(user, draft_id)

    def edit(self, user, draft_id, version, fields):
        from .draft_fields import edit_fields
        with self.ports.atomic():
            draft = self.get(user, draft_id)
            if draft['version'] != version:
                raise DraftConflict('Draft changed; reload before editing')
            task = edit_fields(draft['task'], fields, draft['edit_timezone'])
            return self.update(user, draft_id, version, task=task)

    @staticmethod
    def close_batch(conn, user, batch):
        repository = TaskDraftRepository(conn)
        if not repository.has_open_batch(user, batch):
            repository.close_batch(user, batch, timestamp())

    def submit(self, user, draft_id, version):
        # Task creation and draft closure share one SQLite transaction. Stable
        # request identity is owned by the draft, not a button or chat request.
        from .manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()
