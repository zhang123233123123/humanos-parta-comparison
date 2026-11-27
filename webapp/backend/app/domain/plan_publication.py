"""Optimistic publication policy; independent of storage, HTTP and AI."""
import hashlib
import json


def plan_identity(plan):
    record = dict(plan or {})
    if not record:
        return None
    # An edit can change a candidate in place without allocating a revision.
    content = json.loads(record['plan_json']) if 'plan_json' in record else dict(record)
    for key in ('plan_id', 'plan_revision', 'plan_status', 'week_id'):
        content.pop(key, None)
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':'),
                                      ensure_ascii=False).encode('utf-8')).hexdigest()
    return (record.get('plan_id') or record.get('id'),
            record.get('plan_revision'), record.get('plan_status'), digest)


def publication_state(active, proposed):
    return (plan_identity(active), plan_identity(proposed))


def require_unchanged_publication(expected, current):
    if expected != current:
        raise ValueError('排程计算期间计划已变化，请刷新后重新生成草案。')
