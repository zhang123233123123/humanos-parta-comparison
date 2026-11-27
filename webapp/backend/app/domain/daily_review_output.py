"""Restrict review references before structured-output repair retries are exhausted."""
from typing import Literal
from pydantic import Field, create_model
from .ai_output_models import DailyPlanReviewOutput


def authorized_daily_review_model(task_ids):
    identifiers = tuple(sorted(set(task_ids)))
    field_type = list[Literal[identifiers]] if identifiers else list[str]
    return create_model('AuthorizedDailyPlanReview', __base__=DailyPlanReviewOutput,
                        affected_task_ids=(field_type, Field(default_factory=list,
                                                            max_length=100 if identifiers else 0)))
