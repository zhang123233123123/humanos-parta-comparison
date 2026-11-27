"""Explicit capabilities for conversation context and language evidence."""
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class ChatContextPorts:
    list_chat_turns: Callable
    list_tasks: Callable
    latest_task_turn_tasks: Callable
    search_memories: Callable
    latest_pending_task_batch: Callable
    log_event: Callable


def build_chat_context(user_id: str, text: str, thread_id: str | None = None, *, ports: ChatContextPorts) -> dict:
    turns = ports.list_chat_turns(user_id, limit=6, thread_id=thread_id)
    active_tasks = [
        task for task in ports.list_tasks(user_id)
        if task.get("status") not in {"completed", "terminated"}
    ]
    latest_chain = ports.latest_task_turn_tasks(user_id, thread_id)
    recent_tasks = latest_chain if thread_id is not None else (latest_chain or active_tasks[-5:])
    query = " ".join(
        [
            text,
            " ".join(task.get("title", "") for task in recent_tasks),
            " ".join(turn.get("user_text", "") for turn in turns[-3:]),
        ]
    )
    memories = ports.search_memories(user_id, query, top_k=5)
    context = {
        "pending_task_batch": ports.latest_pending_task_batch(user_id, thread_id),
        "thread_id": thread_id,
        "global_tasks": [{"id": task['id'], "title": task['title'], "status": task['status']} for task in active_tasks],
        "recent_turns": [
            {
                "user_text": turn.get("user_text"),
                "assistant_reply": turn.get("assistant_reply"),
                "intent": turn.get("intent"),
                "task_ids": turn.get("task_ids", []),
            }
            for turn in turns[-4:]
        ],
        "recent_tasks": [
            {
                "id": task.get("id"),
                "title": task.get("title"),
                "deadline_at": task.get("deadline_at"),
                "duration": task.get("duration"),
                "status": task.get("status"),
                "context": task.get("context"),
            }
            for task in recent_tasks
        ],
        "active_task_titles": [task.get("title") for task in active_tasks[-8:]],
        "retrieved_memories": [
            {
                "source_type": memory.get("source_type"),
                "task_id": memory.get("task_id"),
                "text": memory.get("text"),
                "score": memory.get("score"),
            }
            for memory in memories
        ],
    }
    ports.log_event(
        user_id,
        "chat_context_built",
        {
            "recent_task_ids": [task.get("id") for task in recent_tasks],
            "memory_ids": [memory.get("memory_id") for memory in memories],
            "embedding_model": "humanos-local-hash-embedding-v1",
        },
    )
    return context
