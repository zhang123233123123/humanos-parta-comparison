"""Calendar assistance only; task entry is a structured user operation."""
from collections.abc import Callable
from dataclasses import dataclass
from .manual_task_entry import ManualTaskEntryRequired

@dataclass(frozen=True)
class ChatTurnPorts:
    require_chat_thread: Callable
    calendar_advisor_turn: Callable


def chat_turn(user_id: str, payload: dict, *, ports: ChatTurnPorts) -> dict:
    if payload.get('assistant_mode') != 'calendar_advisor':
        raise ManualTaskEntryRequired()
    text = str(payload.get('text') or '').strip()
    if not text:
        raise ValueError('text is required')
    ports.require_chat_thread(user_id, payload.get('thread_id'))
    return ports.calendar_advisor_turn(user_id, text, payload)
