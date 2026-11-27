"""Typed task facts shared by parsers and application services."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator
from .schedule_type import TaskScheduleType


class ParsedTask(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    schedule_type: TaskScheduleType = "flexible_task"
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    start_at: str | None = None
    deadline_at: str | None = None
    priority: Literal["高", "中", "低"] | None = None
    recurrence: Literal['none', 'daily'] | None = Field(default=None, description='daily only when this task explicitly repeats every day; otherwise none')
    context: str = ""
    missing_fields: list[str] = Field(default_factory=list)
    source_spans: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def enforce_temporal_semantics(self) -> "ParsedTask":
        from .recurrence import normalize_recurrence
        normalized = normalize_recurrence(self.model_dump())
        self.recurrence = normalized['recurrence']
        self.missing_fields = normalized.get('missing_fields', [])
        required_time = "start_at" if self.schedule_type == "fixed_event" else "deadline_at"
        if self.recurrence != 'daily' and not getattr(self, required_time) and required_time not in self.missing_fields:
            self.missing_fields.append(required_time)
        if self.duration_minutes is None and "duration_minutes" not in self.missing_fields:
            self.missing_fields.append("duration_minutes")
        return self


class ParsedTaskBatch(BaseModel):
    input_kind: Literal['tasks', 'small_talk', 'incomplete_input'] = 'tasks'
    reply: str = Field(default='', max_length=400)
    tasks: list[ParsedTask] = Field(default_factory=list, max_length=20)
