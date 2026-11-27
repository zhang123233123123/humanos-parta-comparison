"""Validate the current task context contract; no legacy conversion on live writes."""

RETIRED_CONTEXT_FIELDS = frozenset({
    'estimatedDuration', 'estimated_duration', 'deadline', 'deadlineAt',
    'deadline_at', 'due', 'deadlineAssumption', 'deadline_assumption',
    'next_step', 'openQuestions',
})


def validate_task_context(value: dict) -> None:
    if not isinstance(value, dict):
        raise ValueError('context_window must be an object')
    invalid = RETIRED_CONTEXT_FIELDS.intersection(value)
    if invalid:
        raise ValueError('Unsupported task context fields: ' + ', '.join(sorted(invalid)))
