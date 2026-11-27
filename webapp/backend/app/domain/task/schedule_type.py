"""Task scheduling type is explicit input, never inferred from time fields."""

from typing import Literal, get_args

TaskScheduleType = Literal['fixed_event', 'flexible_task', 'recurring_routine', 'flexible_activity']
TASK_TYPES = frozenset(get_args(TaskScheduleType))


def require_task_type(payload: dict) -> str:
    for key in ('task_type', 'taskType'):
        if key in payload:
            value = payload[key]
            break
    else:
        window = payload.get('context_window') or {}
        value = window.get('taskType') if isinstance(window, dict) else None
    if not isinstance(value, str) or value not in TASK_TYPES:
        raise ValueError('请选择有效的任务类型。An explicit valid task_type is required.')
    return value


def validate_task_deadline(schedule_type: str, value: object) -> None:
    """Ordinary work needs an explicit deadline; activities keep their own windows."""
    from datetime import datetime
    if value is None or value == "":
        if schedule_type == 'flexible_task':
            raise ValueError('普通任务必须填写截止时间。deadline_at is required for flexible_task')
        return
    if not isinstance(value, str):
        raise ValueError('截止时间格式无效。Invalid deadline_at')
    try:
        if 'T' not in value and ' ' not in value:
            raise ValueError('date without time')
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise ValueError('截止时间格式无效。Invalid deadline_at') from error
