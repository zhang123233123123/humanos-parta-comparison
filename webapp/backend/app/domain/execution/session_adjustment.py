"""Bind a model's proposed moves to the exact authorized session identifiers."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, create_model


class SessionTime(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: str
    day_index: int = Field(ge=0, le=6)
    start: float = Field(ge=0, lt=24)
    end: float = Field(gt=0, le=24)


class SessionAdjustment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    times: list[SessionTime]
    explanation: str = Field(min_length=1, max_length=1500)


def authorized_adjustment_model(identifiers):
    ids = tuple(sorted(set(identifiers)))
    if not ids:
        raise ValueError('At least one authorized work identifier is required')
    move = create_model('AuthorizedSessionTime', __base__=SessionTime,
                        session_id=(Literal[ids], ...))
    return create_model('AuthorizedSessionAdjustment', __base__=SessionAdjustment,
                        times=(list[move], ...))
