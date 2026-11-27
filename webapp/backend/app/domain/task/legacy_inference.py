"""Compatibility names for explicit task input; no text inference."""


def infer_task_type(title: str, context: str = "") -> str:
    return "unknown"


def infer_schedule_task_type(payload: dict) -> str:
    from .schedule_type import require_task_type
    return require_task_type(payload)


def clean_task_title(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError('任务名称必填。Task title is required.')
    return value.strip()


def infer_task_demand(payload: dict, task_type: str) -> dict:
    """Preserve explicit reports without deriving load from title or difficulty."""
    expected = payload.get('expected_difficulty')
    if expected is not None and (type(expected) is not int or not 1 <= expected <= 10):
        raise ValueError('expected_difficulty must be an integer from 1 to 10')
    level = payload.get('cognitive_load') or 'unknown'
    reported = expected is not None or level != 'unknown'
    return {
        'estimated_cognitive_load': level,
        'expected_difficulty': expected,
        'task_features': payload.get('task_features') or {},
        'evidence': [],
        'confidence_level': 'unknown',
        'source': 'user_self_report' if reported else 'unknown',
        'user_confirmed': reported,
    }
