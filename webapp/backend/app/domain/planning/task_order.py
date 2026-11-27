"""The model only permutes code-generated execution segment IDs."""
from pydantic import Field
from .ai_outputs import StrictOutputModel


class TaskOrderOutput(StrictOutputModel):
    ordered_segment_ids: list[str] = Field(max_length=10080)
