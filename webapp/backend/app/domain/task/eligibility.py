"""Shared execution gates for explicit task facts, without text inference."""


def execution_blockers(task: dict | None) -> list[str]:
    if not task:
        return ['task_missing']
    reasons = []
    if task.get('status') in {'blocked', 'completed', 'terminated'}:
        reasons.append('task_' + task['status'])
    if task.get('removed_from_week') or task.get('archived_at'):
        reasons.append('task_archived')
    window = task.get('contextWindow') or {}
    if not isinstance(window, dict):
        return reasons + ['invalid_task_context']
    # Existing UI stores free text here. Text alone is NOT proof of a block.
    # Check both legacy and persisted representations; one must not hide the other.
    for dependency in (task.get('dependency'), task.get('dependencies'), window.get('dependency')):
        if isinstance(dependency, dict) and dependency.get('hard_blocked') is True:
            reasons.append('dependency_blocked')
            break
    return reasons


def require_executable_task(task: dict | None) -> None:
    if execution_blockers(task):
        raise ValueError('任务当前不可执行：请检查受阻状态、依赖或归档状态。 Task is not executable; review its status and dependencies.')
