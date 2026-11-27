"""Index checkpoint memory using explicit storage and embedding capabilities."""
from collections.abc import Callable
from ..repositories.memories import MemoryRepository


def index_context_dump_memory(user_id: str, dump: dict, *, connect: Callable, decode: Callable, add_memory: Callable) -> dict:
    task_id = str(dump.get("task_id") or "")
    source_id = str(dump.get("id") or "")
    with connect() as conn:
        existing = MemoryRepository(conn).latest_context_dump(user_id=user_id, source_id=source_id)
    if existing:
        saved = dict(existing)
        saved["metadata"] = decode(saved.pop("metadata_json", "{}"), {})
        saved.pop("embedding_json", None)
        return saved
    memory_text = (
        f"Context dump for task {task_id}. Progress: {dump['progress']}. "
        f"Open questions: {', '.join(dump['open_questions'])}. "
        f"Next action: {dump['next_action']}. Stop reason: {dump['stop_reason']}."
    )
    return add_memory(
        user_id=user_id,
        source_type="context_dump",
        source_id=source_id,
        task_id=task_id,
        text=memory_text,
        metadata={"stop_reason": dump["stop_reason"], "task_id": task_id},
    )
