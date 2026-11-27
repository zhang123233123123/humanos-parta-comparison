"""Canonical behavior groups, independent occurrences and retryable learning jobs."""
import json
import uuid
from ..domain.behavior_learning import occurrence_key, matching_group, MIN_SUPPORT


def begin_write(conn):
    if not conn.in_transaction:
        conn.execute('BEGIN IMMEDIATE')


def members(conn, group_id, user_id):
    return conn.execute('''SELECT * FROM (
        SELECT b.*,ROW_NUMBER() OVER (PARTITION BY m.occurrence_key
          ORDER BY CASE WHEN b.kind='execution_feedback' THEN 0 ELSE 1 END,b.created_at DESC,b.id) AS rank
        FROM behavior_pattern_members m
        JOIN behavior_experiences b ON b.id=m.experience_id AND b.user_id=m.user_id
        WHERE m.pattern_id=? AND m.user_id=? AND b.status='ready'
        AND (b.kind!='plan_edit' OR EXISTS (SELECT 1 FROM plan_edit_episodes e
          WHERE e.user_id=b.user_id AND e.id=json_extract(b.facts_json,'$.edit_episode_id')
          AND e.status='confirmed'))) WHERE rank=1 ORDER BY id''', (group_id, user_id)).fetchall()


def fingerprint(rows):
    from hashlib import sha256
    return sha256(json.dumps([(r['id'], r['summary'], r['embedding_model'], r['embedding_json'])
                             for r in rows], ensure_ascii=False).encode()).hexdigest()


def synchronize(conn, threshold, stamp):
    """Attach saved summaries and invalidate stale learning snapshots under a write lock."""
    rows = conn.execute('''SELECT b.* FROM behavior_experiences b
        WHERE b.status='ready' AND NOT EXISTS (
          SELECT 1 FROM behavior_pattern_members m WHERE m.experience_id=b.id)
        AND (b.kind!='plan_edit' OR EXISTS (SELECT 1 FROM plan_edit_episodes e
          WHERE e.user_id=b.user_id AND e.id=json_extract(b.facts_json,'$.edit_episode_id')
          AND e.status='confirmed')) ORDER BY b.created_at,b.id''').fetchall()
    for row in rows:
        key = occurrence_key(row)
        prior = conn.execute('SELECT * FROM behavior_pattern_members WHERE user_id=? AND occurrence_key=?',
                             (row['user_id'], key)).fetchone()
        if prior:
            gid = prior['pattern_id']
        else:
            groups = conn.execute('SELECT * FROM behavior_patterns WHERE user_id=?', (row['user_id'],)).fetchall()
            gid = matching_group(groups, json.loads(row['embedding_json']), row['embedding_model'], threshold)
            if gid is None:
                gid = 'behavior_' + uuid.uuid4().hex[:16]
                conn.execute('''INSERT INTO behavior_patterns
                    (id,user_id,anchor_json,embedding_model,status,learning_status,created_at,updated_at)
                    VALUES (?,?,?,?,'active','collecting',?,?)''',
                    (gid, row['user_id'], row['embedding_json'], row['embedding_model'], stamp, stamp))
        conn.execute('INSERT INTO behavior_pattern_members VALUES (?,?,?,?)',
                     (gid, row['user_id'], key, row['id']))
    for group in conn.execute('SELECT * FROM behavior_patterns').fetchall():
        sources = members(conn, group['id'], group['user_id'])
        digest = fingerprint(sources)
        if digest != group['source_hash']:
            state = 'pending' if len(sources) >= MIN_SUPPORT else 'collecting'
            conn.execute('''UPDATE behavior_patterns SET source_hash=?,support_count=?,learning_status=?,
                next_attempt_at=0,lease_token=NULL,attempts=0,updated_at=? WHERE id=?''',
                (digest, len(sources), state, stamp, group['id']))


def claim(conn, stamp, token):
    row = conn.execute('''SELECT * FROM behavior_patterns WHERE status!='deleted' AND
        learning_status IN ('pending','failed','processing') AND next_attempt_at<=?
        ORDER BY updated_at,id LIMIT 1''', (stamp,)).fetchone()
    if row:
        conn.execute('''UPDATE behavior_patterns SET learning_status='processing',lease_token=?,
            next_attempt_at=?,attempts=attempts+1 WHERE id=?''', (token, stamp + 600000, row['id']))
    return row


def publish(conn, row, token, result, vector, model, stamp):
    return conn.execute('''UPDATE behavior_patterns SET description=?,scope=?,confidence=?,
        summary_embedding_json=?,summary_embedding_model=?,learning_status='ready',last_error=NULL,
        updated_at=? WHERE id=? AND source_hash=? AND lease_token=? AND status!='deleted'
        AND learning_status='processing' ''',
        (result['description'], result['scope'], result['confidence'], json.dumps(vector), model,
         stamp, row['id'], row['source_hash'], token)).rowcount == 1


def fail(conn, row, token, error, stamp):
    conn.execute('''UPDATE behavior_patterns SET learning_status='failed',last_error=?,next_attempt_at=?
        WHERE id=? AND lease_token=? AND source_hash=? AND status!='deleted' ''',
        (type(error).__name__, stamp + min(3600000, 30000 * 2 ** min(row['attempts'], 7)),
         row['id'], token, row['source_hash']))


def list_groups(conn, user_id):
    return conn.execute('SELECT * FROM behavior_patterns WHERE user_id=? ORDER BY updated_at DESC,id',
                        (user_id,)).fetchall()


def update_status(conn, user_id, pattern_id, status, stamp):
    row = conn.execute('SELECT * FROM behavior_patterns WHERE id=? AND user_id=?', (pattern_id, user_id)).fetchone()
    if not row:
        raise KeyError(pattern_id)
    if row['status'] == 'deleted' and status != 'deleted':
        raise ValueError('A deleted behavior cannot be re-enabled')
    conn.execute('UPDATE behavior_patterns SET status=?,updated_at=? WHERE id=? AND user_id=?',
                 (status, stamp, pattern_id, user_id))
    return conn.execute('SELECT * FROM behavior_patterns WHERE id=? AND user_id=?', (pattern_id, user_id)).fetchone()


def job_counts(conn, user_id):
    summaries = conn.execute("SELECT status,COUNT(*) AS count FROM behavior_experiences WHERE user_id=? AND status IN ('pending','processing','failed') GROUP BY status", (user_id,)).fetchall()
    learning = conn.execute("SELECT learning_status AS status,COUNT(*) AS count FROM behavior_patterns WHERE user_id=? AND status!='deleted' AND learning_status IN ('pending','processing','failed') GROUP BY learning_status", (user_id,)).fetchall()
    return [*summaries, *learning]


def export_sources(conn, user_id):
    return [dict(r) for r in conn.execute('SELECT id,kind,source_type,source_id,task_id,session_id,facts_json,summary,status,created_at FROM behavior_experiences WHERE user_id=? ORDER BY created_at,id', (user_id,))]
