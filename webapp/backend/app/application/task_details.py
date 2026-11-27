"""Task detail projection, independent of HTTP response envelopes."""
from collections.abc import Callable

from ..domain.task_energy import assess_energy_requirement


def task_details(user_id: str, task_id: str, *, get_task: Callable,
                 latest_runtime_state: Callable) -> dict:
    task = get_task(task_id, user_id)
    if not task:
        raise KeyError(task_id)
    task['energy_assessment'] = assess_energy_requirement(task, latest_runtime_state(user_id))
    return task
