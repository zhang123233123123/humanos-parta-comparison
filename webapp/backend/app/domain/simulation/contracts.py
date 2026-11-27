from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


def instant(value):
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None or dt.second or dt.microsecond:
            raise ValueError()
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        raise ValueError('时间需要包含时区，且精确到分钟') from None


class DisplayRule(Model):
    question_id: str
    equals: str | int | float | bool


class Question(Model):
    question_id: str = Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')
    revision: int = Field(default=1, ge=1)
    phase: Literal['profile', 'initial_state', 'node', 'feedback', 'daily_feedback', 'final']
    title: str = Field(min_length=1, max_length=500)
    help: str = Field(default='', max_length=2000)
    type: Literal['text', 'single', 'multiple', 'number', 'scale']
    options: list[str] = Field(default_factory=list, max_length=30)
    option_values: list[str] = Field(default_factory=list, max_length=30)
    minimum: float = 1
    maximum: float = 7
    step: float = Field(default=1, gt=0)
    low_label: str = ''
    high_label: str = ''
    required: bool = True
    enabled: bool = True
    model_usage: Literal['planning', 'node_decision', 'both', 'evaluation_only'] = 'both'
    semantic_binding: Literal['', 'energy', 'focus', 'stress', 'mood', 'session_minutes', 'rest_minutes'] = ''
    display_if: DisplayRule | None = None

    @model_validator(mode='after')
    def valid(self):
        if not self.minimum <= self.maximum or len(set(self.options)) != len(self.options):
            raise ValueError('量表范围或选项不合法')
        if self.option_values and (len(self.option_values)!=len(self.options) or len(set(self.option_values))!=len(self.option_values) or any(not x.strip() for x in self.option_values)):
            raise ValueError('选项值必须与显示文字一一对应且唯一')
        if self.type in ('single', 'multiple') and not self.options:
            raise ValueError('选择题需要选项')
        if any(not x.strip() for x in self.options):raise ValueError('选项不能为空')
        if self.type=='scale' and (self.maximum-self.minimum)/self.step>100:
            raise ValueError('量表最多101个等级')
        if self.semantic_binding == 'mood':
            if self.type != 'single' or self.model_usage == 'evaluation_only':raise ValueError('心情绑定需要可提供给模型的单选题')
        elif self.semantic_binding:
            if self.type not in ('number', 'scale') or self.model_usage == 'evaluation_only':
                raise ValueError('语义绑定需要可提供给模型的数值题')
            if self.semantic_binding in ('energy', 'focus', 'stress') and (self.minimum != 1 or self.maximum != 7):
                raise ValueError('状态绑定固定为1–7；其他量表请使用补充背景而不绑定')
            if self.semantic_binding == 'session_minutes' and not 1 <= self.minimum <= self.maximum <= 180:
                raise ValueError('工作段限制需要1–180分钟')
            if self.semantic_binding == 'rest_minutes' and not 0 <= self.minimum <= self.maximum <= 120:
                raise ValueError('休息限制需要0–120分钟')
        return self


class Configuration(Model):
    name: str = Field(min_length=1, max_length=120)
    questions: list[Question] = Field(max_length=100)

    @model_validator(mode='after')
    def valid(self):
        seen = {}
        bindings = set()
        for q in self.questions:
            if q.question_id in seen:
                raise ValueError('题号重复')
            if q.display_if:
                dep = seen.get(q.display_if.question_id)
                if not dep or dep.phase != q.phase or not dep.enabled:
                    raise ValueError('条件展示只能引用同阶段、排在前面的启用题目')
                uses={'both':{'planning','nodes'},'planning':{'planning'},'node_decision':{'nodes'},'evaluation_only':set()}
                if not uses[q.model_usage] <= uses[dep.model_usage]:
                    raise ValueError('条件题不能通过展示条件把评价用或其他用途的答案间接传给模型')
            seen[q.question_id] = q
            if q.semantic_binding and q.enabled:
                key = (q.phase, q.semantic_binding)
                if key in bindings:
                    raise ValueError('同阶段不能重复绑定同一字段')
                bindings.add(key)
        return self


class Window(Model):
    start_at: str
    end_at: str

    @model_validator(mode='after')
    def valid(self):
        if instant(self.end_at) <= instant(self.start_at):
            raise ValueError('结束时间必须晚于开始时间')
        return self


class Task(Model):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    minutes: int = Field(strict=True, ge=1, le=14400)
    deadline_at: str
    difficulty: int = Field(default=5, ge=1, le=10)
    demand: Literal['low', 'medium', 'high'] = 'medium'
    description: str = Field(default='', max_length=2000)
    allowed_windows: list[Window] = Field(default_factory=list, max_length=100)
    preferred_windows: list[Window] = Field(default_factory=list, max_length=100)


class ScenarioEvent(Model):
    id: str = Field(min_length=1, max_length=80)
    at: str
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=3000)
    # Ground truth for the simulation; not inferred from advancing the clock.
    remaining_minutes: dict[str, int] = Field(default_factory=dict)
    unavailable: list[Window] = Field(default_factory=list)


class Scenario(Model):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default='', max_length=3000)
    timezone: str = 'Asia/Shanghai'
    start_at: str
    end_at: str
    participant_input: bool = False
    tasks: list[Task] = Field(default_factory=list, max_length=30)
    availability: list[Window] = Field(default_factory=list, max_length=100)
    fixed_events: list[Window] = Field(default_factory=list, max_length=100)
    events: list[ScenarioEvent] = Field(default_factory=list, max_length=60)
    session_minutes: int = Field(default=45, ge=1, le=180)
    rest_minutes: int = Field(default=10, ge=0, le=120)
    keep_buffer: bool = False
    planning_goal: str = Field(default='', max_length=2000)

    @model_validator(mode='after')
    def valid(self):
        if not self.participant_input and (not self.tasks or not self.availability):raise ValueError('请填写任务和可用时间')
        ZoneInfo(self.timezone)
        a, b = instant(self.start_at), instant(self.end_at)
        if not 0 < (b-a).total_seconds() <= 31*86400:
            raise ValueError('场景需在31天以内，起止时间不限于一天')
        ids = {t.id for t in self.tasks}
        if len(ids) != len(self.tasks) or len({e.id for e in self.events}) != len(self.events):
            raise ValueError('任务或事件ID重复')
        for t in self.tasks:
            if not a < instant(t.deadline_at) <= b:
                raise ValueError('任务截止时间须在场景内')
        for w in [*(w for t in self.tasks for w in [*t.allowed_windows, *t.preferred_windows]), *self.availability, *self.fixed_events, *(w for e in self.events for w in e.unavailable)]:
            if not a <= instant(w.start_at) < instant(w.end_at) <= b:
                raise ValueError('时间窗口必须位于场景内')
        for e in self.events:
            if not a <= instant(e.at) <= b or not set(e.remaining_minutes) <= ids:
                raise ValueError('事件时间或任务ID不合法')
            if any(type(v) is not int or v < 0 or v > 14400 for v in e.remaining_minutes.values()):
                raise ValueError('剩余工作量须为0–14400整数分钟')
        return self


class Node(Model):
    at: str
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default='', max_length=2000)
    reason: str = Field(min_length=1, max_length=1500)
    question_ids: list[str] = Field(default_factory=list, max_length=12)


class NodeDecision(Model):
    ask_decision: Literal['ask', 'skip', 'defer']
    question_ids: list[str] = Field(default_factory=list, max_length=12)
    reason: str = Field(min_length=1, max_length=2000)
    candidate_nodes: list[Node] = Field(default_factory=list, max_length=30)


class PlanDecision(Model):
    plan_action: Literal['keep', 'revise']
    ordered_task_ids: list[str] = Field(max_length=30)
    session_minutes: int = Field(ge=1, le=180)
    rest_minutes: int = Field(ge=0, le=120)
    explanation: str = Field(min_length=1, max_length=3000)


def answer_value(q, value):
    if q['type'] == 'text':
        valid = isinstance(value, str) and len(value) <= 4000 and (not q['required'] or bool(value.strip()))
    elif q['type'] == 'single':
        valid = isinstance(value, str) and value in (q.get('option_values') or q['options'])
    elif q['type'] == 'multiple':
        valid = isinstance(value, list) and all(isinstance(x, str) for x in value) and len(set(value)) == len(value) and set(value) <= set(q.get('option_values') or q['options']) and (bool(value) or not q['required'])
    else:
        valid = type(value) in (int, float) and q['minimum'] <= value <= q['maximum'] and abs((value-q['minimum'])/q['step']-round((value-q['minimum'])/q['step'])) < 1e-6
    if not valid:
        raise ValueError('答案格式不正确：'+q['title'])
    return value
