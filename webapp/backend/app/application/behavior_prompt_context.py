"""Two behavior sources: retrieved recent occurrences and direct long-term background."""
import json
import logging

LOG = logging.getLogger(__name__)


def add_behavior_context(context, user_id, *, recent_behavior, learned_behavior, task_ids=None):
    tasks = context.get('tasks', [])
    if task_ids is not None:
        allowed = set(task_ids)
        tasks = [task for task in tasks if str(task.get('id')) in allowed]
    query = 'Review the current state and remaining work: ' + json.dumps({
        'state': context.get('momentary_state', {}), 'tasks': tasks,
    }, ensure_ascii=False)
    for key, fetch in (
        ('recent_behavior', (lambda: recent_behavior(user_id, query)) if recent_behavior else None),
        ('learned_behaviors', (lambda: learned_behavior(user_id)) if learned_behavior else None),
    ):
        try:
            context[key] = fetch() if fetch else {'status': 'empty', 'items': []}
        except Exception as error:
            LOG.warning('%s unavailable: %s', key, type(error).__name__)
            context[key] = {'status': 'unavailable', 'items': []}
    return context
