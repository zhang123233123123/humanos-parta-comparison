"""Apply explicitly confirmed task notes without changing execution status."""
import json
from ..repositories.tasks import TaskRepository


def save_confirmed_report(user_id, task_id, payload, session, *, ports):
    task = ports.get_task(task_id,user_id)
    execution = dict(task.get('execution') or {})
    window = dict(task.get('contextWindow') or {})
    report = {}
    for key,target in (('progress','progress'),('next_action','nextStep'),('open_questions','open_questions')):
        value = payload.get(key)
        if value is not None and value != '' and value != []:
            report[key] = value
            window[target] = value
    percent = payload.get('progress_percent')
    if percent is not None:
        if type(percent) is not int or not 0 <= percent <= 100:
            raise ValueError('progress_percent must be an integer from 0 to 100')
        execution['progress_percent'] = percent
        report['progress_percent'] = percent
    remaining = payload.get('task_remaining_minutes')
    if remaining is not None:
        if type(remaining) is not int or remaining < 0:
            raise ValueError('task_remaining_minutes must be a non-negative integer')
        execution['remaining_duration_minutes'] = remaining
        execution['remaining_work_report'] = {'minutes':remaining,'source':'user_report',
            'execution_session_id':session['execution_session_id'],
            'session_active_minutes':int(session.get('live_active_minutes') or session.get('accumulated_active_minutes') or 0),
            'recommendation_id':payload['recommendation_id'], 'reported_at':ports.now()}
        report['task_remaining_minutes'] = remaining
    if report:
        from ..domain.task import update_field_provenance
        provenance = update_field_provenance(task.get('field_provenance'),
            fields={ {'next_action':'next_step'}.get(k,k) for k in report if k in {'progress','next_action','open_questions'} },
            source='user_input',source_id=payload['recommendation_id'],updated_at=ports.now())
        with ports.connect() as conn:
            TaskRepository(conn).update_fields(task_id=task_id,user_id=user_id,updates={
                'execution_json':json.dumps(execution,ensure_ascii=False),'context_window_json':json.dumps(window,ensure_ascii=False),
                'field_provenance_json':json.dumps(provenance), 'updated_at':ports.now()})
    return {'confirmed_report':report,'report_application_status':'applied' if report else 'not_supplied'}
