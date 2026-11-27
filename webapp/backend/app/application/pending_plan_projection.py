"""Hide retired pending work on reads without rewriting historical plan snapshots."""
from ..repositories.tasks import TaskRepository


def visible_pending_plan(plan, user_id, *, connect):
    if not plan.get('unscheduled_tasks'):
        return plan
    with connect() as conn:
        retired = {row['id'] for row in TaskRepository(conn).list_for_user(user_id=user_id)
                   if row['archived_at'] is not None or row['removed_from_week']
                   or row['status'] in {'completed', 'terminated'}}
    return {**plan, 'unscheduled_tasks': [item for item in plan['unscheduled_tasks']
                                        if item.get('task_id') not in retired]}
