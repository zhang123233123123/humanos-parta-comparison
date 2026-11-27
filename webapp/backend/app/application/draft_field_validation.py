"""Typed, side-effect-free updates to an unfinished task batch."""
from copy import deepcopy
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from ..domain.task.schedule_type import TASK_TYPES


class TaskFieldAnswer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    task_id: str
    field: Literal['title', 'start_at', 'deadline_at', 'duration_minutes', 'priority', 'context', 'task_type', 'recurrence']
    value: str | int | None
    source_span: str = Field(min_length=1)


class TaskClarificationAnswer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    is_followup: bool
    updates: list[TaskFieldAnswer] = Field(default_factory=list, max_length=120)
    question: str = ''




def merge_task_answers(tasks: list[dict], answer: dict, text: str) -> list[dict]:
    parsed = TaskClarificationAnswer.model_validate(answer)
    result = deepcopy(tasks)
    by_id = {str(task['id']): task for task in result}
    touched = set()
    for update in parsed.updates:
        if update.task_id not in by_id or update.source_span not in text:
            raise ValueError('Clarification must reference an existing task and user evidence')
        key = (update.task_id, update.field)
        if key in touched:
            raise ValueError('Duplicate clarification field')
        touched.add(key)
        value = update.value
        if update.field == 'title':
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 200:
                raise ValueError('Title must contain 1–200 characters')
            value = value.strip()
        if update.field in {'start_at', 'deadline_at'} and value is not None:
            if not isinstance(value, str) or datetime.fromisoformat(value.replace('Z', '+00:00')).utcoffset() is None:
                raise ValueError('Clarified time must include a timezone')
        if update.field == 'duration_minutes' and value is not None:
            if type(value) is not int or not 1 <= value <= 1440:
                raise ValueError('Invalid clarified duration')
        if update.field == 'priority' and value not in {None, '高', '中', '低'}:
            raise ValueError('Invalid clarified priority')
        if update.field == 'context' and value is not None and not isinstance(value, str):
            raise ValueError('Clarified context must be text')
        if update.field == 'task_type' and value not in TASK_TYPES:
            raise ValueError('Invalid clarified task type')
        if update.field == 'recurrence' and value not in {'none', 'daily'}:
            raise ValueError('Invalid recurrence')
        task = by_id[update.task_id]
        task[update.field] = value
        if update.field == 'duration_minutes':
            task['duration'] = value
        task.setdefault('field_provenance', {})[{'duration_minutes': 'duration'}.get(update.field, update.field)] = {
            'source': 'user_self_report', 'source_id': 'task_clarification', 'source_span': update.source_span}
        if value is not None:
            aliases = {update.field}
            if update.field == 'duration_minutes':
                aliases.add('duration')
            if update.field == 'priority':
                aliases.add('user_priority')
            task['missing_fields'] = [f for f in task.get('missing_fields', []) if f not in aliases]
    changed_ids = {task_id for task_id, _ in touched}
    for task in result:
        if str(task['id']) not in changed_ids:
            continue
        time_field = 'start_at' if task.get('task_type') == 'fixed_event' else 'deadline_at'
        opposite = 'deadline_at' if time_field == 'start_at' else 'start_at'
        missing = [f for f in task.get('missing_fields', []) if f != opposite]
        if not task.get(time_field) and task.get('recurrence') != 'daily':
            missing.append(time_field)
        if not task.get('duration'):
            missing.append('duration_minutes')
        task['missing_fields'] = list(dict.fromkeys(missing))
        from ..domain.task.recurrence import normalize_recurrence
        task['missing_fields'] = [key for key in task['missing_fields'] if key != 'recurrence_time_scope']
        task.update(normalize_recurrence(task))
        task['is_preview'] = True
    return result


def missing_task_question(tasks: list[dict], locale: str = 'zh') -> str:
    names = {'start_at': '开始时间', 'deadline_at': '截止时间', 'duration_minutes': '预计时长',
             'priority': '优先级', 'user_priority': '优先级', 'recurrence_time_scope': '重复活动的时间范围（灵活活动无需固定开始或截止时间）'}
    items = [f"{task.get('title', task.get('id'))}：" + '、'.join(names.get(f, f) if locale == 'zh' else f for f in task.get('missing_fields', []))
             for task in tasks if task.get('missing_fields')]
    if not items:
        return '这批任务已保留。' if locale == 'zh' else 'Your task batch has been retained.'
    return ('已保留这批任务，还需要补充：' if locale == 'zh' else 'Tasks retained. Please provide: ') + '；'.join(items)
