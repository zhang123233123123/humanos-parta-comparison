"""Pure identity, similarity and support rules for automatic behavior learning."""
import json
import math

MIN_SUPPORT = 3


def normalized_vector(vector):
    if not isinstance(vector, list) or not vector or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in vector
    ):
        raise ValueError('Invalid semantic vector')
    norm = math.sqrt(sum(v * v for v in vector))
    if not norm:
        raise ValueError('Empty semantic vector')
    return [v / norm for v in vector]


def similarity(left, right):
    if len(left) != len(right):
        return -1.0
    return sum(a * b for a, b in zip(left, right))


def occurrence_key(record):
    facts = json.loads(record['facts_json'])
    if record['kind'] == 'plan_edit' and facts.get('edit_episode_id'):
        return 'plan_edit:' + facts['edit_episode_id']
    if record['session_id']:
        return 'session:' + record['session_id']
    return record['source_type'] + ':' + record['source_id']


def matching_group(groups, vector, model, threshold):
    ranked = [(similarity(vector, json.loads(g['anchor_json'])), g['id'])
              for g in groups if g['embedding_model'] == model]
    ranked = [(score, gid) for score, gid in ranked if score >= threshold]
    return max(ranked, default=(0, None))[1]


def validate_status(payload):
    if not isinstance(payload, dict) or set(payload) - {'user_id', 'status'}:
        raise ValueError('Only status may be changed')
    if payload.get('status') not in {'active', 'paused', 'deleted'}:
        raise ValueError('status must be active, paused or deleted')
    return payload['status']
