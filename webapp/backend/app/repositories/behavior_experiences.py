"""Behavior experience queue and index persistence; caller owns transactions."""
import json
import uuid

def enqueue(conn, *, user_id, kind, source_id, payload, timestamp):
    """Called in the original action's transaction; no model/network work here."""
    if kind == 'invalidate_source':
        conn.execute("UPDATE behavior_experiences SET status='invalidated' WHERE user_id=? AND source_type=? AND source_id=?",
                     (user_id,payload['source_type'],payload['source_id']))
        return
    if kind == 'plan_edit':
        eligible = payload.get('actor') == 'user' and payload.get('effective') is True and payload.get('event_type') != 'undo_edit'
        source_type = 'plan_edit'
    elif kind == 'execution_transition':
        eligible = payload.get('trusted_execution_transition', True) and (payload.get('transition', {}).get('action') or {}).get('type') == 'end'
        source_type = 'system_observation'
    else:
        eligible = kind in {'execution_feedback', 'interruption_recovery_outcome', 'recommendation_feedback'}
        source_type = 'execution_feedback' if kind in {'execution_feedback','recommendation_feedback'} else 'system_observation'
        if kind == 'interruption_recovery_outcome':
            source_id = str(payload['episode']['id']) + ':outcome'
    if not eligible:
        return
    episode = payload.get('episode') or {}
    feedback = payload.get('feedback') or {}
    transition = payload.get('transition') or {}
    task_id = (payload.get('task') or {}).get('id') or episode.get('task_id') or feedback.get('task_id') or transition.get('task_id')
    session_id = episode.get('resumed_execution_session_id') or episode.get('source_execution_session_id') or feedback.get('execution_session_id') or (transition.get('action') or {}).get('execution_session_id')
    payload = dict(payload)
    task = task_snapshot(conn, user_id, task_id, payload.get('task') or {})
    payload['task'] = task
    session_ids = list(dict.fromkeys(s for s in (session_id, episode.get('source_execution_session_id')) if s))
    payload['execution_sessions'] = session_snapshots(conn, user_id, task_id, session_ids)
    payload['snapshot_version'] = 'behavior_facts_v2'
    conn.execute('''INSERT OR IGNORE INTO behavior_experiences
        (id,user_id,kind,source_type,source_id,task_id,session_id,facts_json,status,created_at,next_attempt_at)
        VALUES (?,?,?,?,?,?,?,?,'pending',?,0)''',
        (uuid.uuid4().hex, user_id, kind, source_type, source_id, task.get('id') or episode.get('task_id') or feedback.get('task_id'), session_id,
         json.dumps(payload, ensure_ascii=False), timestamp))


def task_snapshot(conn, user_id, task_id, supplied):
    row = conn.execute('SELECT * FROM tasks WHERE user_id=? AND id=?', (user_id,task_id)).fetchone() if task_id else None
    task = dict(supplied)
    if row:
        task = dict(row)
        window = json.loads(row['context_window_json'])
        execution = json.loads(row['execution_json'])
        provenance = json.loads(row['field_provenance_json'])
    else:
        window = task.get('contextWindow') or {}
        execution = task.get('execution') or {}
        provenance = task.get('field_provenance') or {}
    result = {k:task[k] for k in ('id','title','type','duration','priority','expected_difficulty','cognitive_load','status') if k in task}
    result.update({
        'description': task.get('context') if 'context' in task else task.get('description'),
        'deadline_at': task.get('deadline_at'),
        'timezone': window.get('timezone'),
        'dependency': window.get('dependency', task.get('dependency')),
        'dependencies': window.get('dependencies', task.get('dependencies')),
        'remaining_duration_minutes': execution.get('remaining_duration_minutes'),
        'accumulated_actual_minutes': execution.get('accumulated_actual_minutes'),
        'field_provenance': provenance,
    })
    return result


def session_snapshots(conn, user_id, task_id, session_ids):
    result = []
    for session_id in session_ids:
        row = conn.execute('SELECT * FROM execution_sessions WHERE user_id=? AND id=? AND task_id=?', (user_id,session_id,task_id)).fetchone()
        if row is None:
            continue
        item = {k:row[k] for k in ('id','task_id','block_id','week_id','plan_revision','planned_start_at','planned_end_at',
            'planned_work_minutes','actual_start_at','actual_end_at','accumulated_active_minutes',
            'paused_at','resumed_at','pause_reason','interruption_action','resume_preference','preferred_resume_at',
            'remaining_at_pause','resumed_from_session_id','status','completion_outcome')}
        item['interruption_snapshot'] = json.loads(row['interruption_snapshot_json'])
        result.append(item)
    return result


def claim(conn, stamp, token):
    conn.execute('BEGIN IMMEDIATE')
    row = conn.execute("""SELECT * FROM behavior_experiences b
        WHERE status IN ('pending','failed','processing') AND next_attempt_at<=?
        AND (kind!='plan_edit' OR EXISTS (
          SELECT 1 FROM plan_edit_episodes e WHERE e.user_id=b.user_id
          AND e.id=json_extract(b.facts_json,'$.edit_episode_id') AND e.status='confirmed'))
        ORDER BY created_at LIMIT 1""", (stamp,)).fetchone()
    if row:
        conn.execute("UPDATE behavior_experiences SET status='processing',lease_token=?,next_attempt_at=?,attempts=attempts+1 WHERE id=?", (token,stamp+600000,row['id']))
    return row


def ready(conn, row, token, summary, vector, model, *, summary_model=None, prompt_version=None, generated_at=None):
    conn.execute("UPDATE behavior_experiences SET status='ready',summary=?,embedding_json=?,embedding_model=?,summary_model=?,summary_prompt_version=?,summary_generated_at=?,last_error=NULL WHERE id=? AND lease_token=? AND status='processing'", (summary,json.dumps(vector),model,summary_model,prompt_version,generated_at,row['id'],token))


def failed(conn, row, token, stamp, error):
    conn.execute("UPDATE behavior_experiences SET status='failed',last_error=?,next_attempt_at=? WHERE id=? AND lease_token=? AND status='processing'", (error,stamp+min(3600000,30000*2**min(row['attempts'],7)),row['id'],token))


def recent_index(conn, user_id):
    return conn.execute("""SELECT * FROM behavior_experiences b WHERE user_id=? AND status='ready'
        AND (kind!='plan_edit' OR EXISTS (
          SELECT 1 FROM plan_edit_episodes e WHERE e.user_id=b.user_id
          AND e.id=json_extract(b.facts_json,'$.edit_episode_id') AND e.status='confirmed'))
        ORDER BY created_at DESC LIMIT 500""", (user_id,)).fetchall()
