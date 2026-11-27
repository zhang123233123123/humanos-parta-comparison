"""Profile aggregate root and its owned state."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class ProfileAggregate(BaseModel):
    user_id: str = Field(min_length=1)
    role: str
    deep_work_window: str
    low_energy_window: str
    control_preference: str
    timezone: str
    blocker_patterns: list[str] = Field(default_factory=list)
    task_preferences: dict[str, Any] = Field(default_factory=dict)
    weekly_context: dict[str, Any] = Field(default_factory=dict)
    learned_patterns: list[dict[str, Any]] = Field(default_factory=list)
    research_context: dict[str, Any] = Field(default_factory=dict)
    research_context_revision: int = Field(default=0, ge=0)
    active_week_id: str | None = None
    active_plan_revision: int | None = Field(default=None, ge=0)
    last_daily_checkin_date: str | None = None

    @field_validator('task_preferences')
    @classmethod
    def validate_timing(cls, value):
        from .timing import rest_minutes, grid_minutes
        rest_minutes(value)
        grid_minutes(value)
        choices = {
            'task_switching_preference': ('finish_then_switch', 'interleave'),
            'task_distribution_preference': ('concentrated', 'spread'),
        }
        for key, allowed in choices.items():
            if value.get(key) is not None and value[key] not in allowed:
                raise ValueError(f'{key} must be null or one of {allowed}')
        return value
