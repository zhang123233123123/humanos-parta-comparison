"""Product task categories and allocation precedence, independent of storage."""

PLACEMENT_PRIORITY = ('fixed_event', 'flexible_task', 'recurring_routine', 'flexible_activity')
REMAINING_TASK_TYPES = PLACEMENT_PRIORITY[2:]
TASK_LABELS = {
    'fixed_event': '固定任务',
    'flexible_task': '普通任务',
    'recurring_routine': '偏好任务',
    'flexible_activity': '灵活任务',
}
