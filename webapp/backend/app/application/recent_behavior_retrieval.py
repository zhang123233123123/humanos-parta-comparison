"""Retrieve recent single-event summaries; original interruption facts travel with hits."""
import json
import logging
from ..domain.behavior_learning import occurrence_key, similarity
from .behavior_learning import semantic_vector, threshold

LOG = logging.getLogger(__name__)
DAYS = 7
LIMIT = 40


def candidates(connect, user_id, now_ms):
    with connect() as conn:
        rows = conn.execute('''SELECT b.* FROM behavior_experiences b
            WHERE b.user_id=? AND b.status='ready' AND b.created_at BETWEEN ? AND ?
            AND (b.kind!='plan_edit' OR EXISTS (SELECT 1 FROM plan_edit_episodes e
              WHERE e.user_id=b.user_id AND e.id=json_extract(b.facts_json,'$.edit_episode_id')
              AND e.status='confirmed'))
            ORDER BY CASE WHEN b.kind='execution_feedback' THEN 0 ELSE 1 END,
              b.created_at DESC,b.id''', (user_id, now_ms - DAYS * 86400000, now_ms)).fetchall()
    # An end event and its explicit feedback are one occurrence, not two votes.
    unique = {}
    for row in rows:
        unique.setdefault(occurrence_key(row), row)
    return list(unique.values())


def retrieve_recent(user_id, query, *, connect, embed, now_ms):
    meta = {'authority': 'retrieved_recent_observations_not_preferences',
            'lookback_days': DAYS, 'clock': 'server_recording_time', 'window_end_ms': now_ms}
    try:
        rows = candidates(connect, user_id, now_ms)
        if not rows or not query.strip():
            return {**meta, 'status': 'empty', 'items': []}
        vector, model = semantic_vector(embed, query)
        # Re-read after network I/O so removed sources and new feedback are honored.
        rows = candidates(connect, user_id, now_ms)
        scored = [(similarity(vector, json.loads(row['embedding_json'])), row)
                  for row in rows if row['embedding_model'] == model]
        scored = sorted((pair for pair in scored if pair[0] >= threshold()),
                        key=lambda pair: (-pair[0], -pair[1]['created_at'], pair[1]['id']))
        items = [{
            'experience_id': row['id'], 'occurrence_key': occurrence_key(row),
            'source_type': row['source_type'], 'source_id': row['source_id'],
            'task_id': row['task_id'], 'session_id': row['session_id'],
            'summary': row['summary'], 'created_at': row['created_at'],
            'similarity': round(score, 4), 'facts': json.loads(row['facts_json']),
        } for score, row in scored[:LIMIT]]
        return {**meta, 'status': 'ready' if items else 'empty', 'items': items,
                'truncated': len(scored) > LIMIT}
    except Exception as error:
        LOG.warning('Recent behavior retrieval unavailable: %s', type(error).__name__)
        return {**meta, 'status': 'unavailable', 'items': []}
