"""Legacy clarification batches, distinct from persisted tasks and independent drafts."""
import re
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.pending_task_batches import PendingTaskBatchRepository


@dataclass(frozen=True)
class PendingTaskBatchPorts:
    require_chat_thread: Callable
    make_id: Callable
    now: Callable
    connect: Callable
    encode: Callable
    register_drafts: Callable
    decode: Callable


def save_pending_task_batch(user_id: str, source_text: str, tasks: list[dict], thread_id: str | None = None, *, ports: PendingTaskBatchPorts) -> dict:
    thread_id = ports.require_chat_thread(user_id, thread_id)
    batch_id = ports.make_id("taskbatch")
    missing = sorted({str(field) for task in tasks for field in (task.get("missing_fields") or []) if str(field)})
    timestamp = ports.now()
    with ports.connect() as conn:
        if thread_id == 'legacy':
            PendingTaskBatchRepository(conn).ensure_legacy(user_id,timestamp,timestamp)
        # Legacy clients retain one active batch. Independent task_drafts
        # are preserved and are authoritative for the new workspace.
        PendingTaskBatchRepository(conn).supersede(timestamp,user_id,thread_id)
        PendingTaskBatchRepository(conn).insert(batch_id, user_id, source_text, ports.encode(tasks), ports.encode(missing), "awaiting_clarification", timestamp, timestamp, thread_id)
        ports.register_drafts(conn, user_id, thread_id, batch_id, tasks, timestamp)
    return {"id": batch_id, "tasks": tasks, "missing_fields": missing, "status": "awaiting_clarification"}

def latest_pending_task_batch(user_id: str, thread_id: str | None = None, *, ports: PendingTaskBatchPorts) -> dict | None:
    thread_id = ports.require_chat_thread(user_id, thread_id)
    with ports.connect() as conn:
        row = PendingTaskBatchRepository(conn).latest(user_id,thread_id)
    if not row:
        return None
    return {"id": row["id"], "source_text": row["source_text"], "tasks": ports.decode(row["tasks_json"], []), "missing_fields": ports.decode(row["missing_fields_json"], []), "status": row["status"]}

def is_pending_task_batch_followup(text: str) -> bool:
    normalized = re.sub(r"\s+", "", text.lower())
    confirms = any(token in normalized for token in ("需要", "确认", "全部", "都是", "都要", "yes", "confirm", "all"))
    supplements = any(token in normalized for token in ("优先级", "备注", "高", "中", "低", "priority", "note"))
    return confirms or supplements

def complete_pending_task_batch(user_id: str, batch: dict, text: str, *, ports: PendingTaskBatchPorts) -> list[dict]:
    normalized = re.sub(r"\s+", "", text.lower())
    priority = "高" if "优先级都是高" in normalized or "全部高" in normalized else "低" if "优先级都是低" in normalized or "全部低" in normalized else "中" if "优先级都是中" in normalized or "全部中" in normalized else None
    no_notes = any(token in normalized for token in ("没有备注", "无备注", "no note", "no notes"))
    completed = []
    for raw in batch.get("tasks") or []:
        task = dict(raw)
        if priority:
            task["priority"] = priority
        if no_notes:
            task["context"] = ""
        missing = [field for field in (task.get("missing_fields") or []) if not (priority and field in {"priority", "user_priority"}) and not (no_notes and field in {"notes", "context", "remark"})]
        task["missing_fields"] = missing
        task["pending_batch_id"] = batch["id"]
        task["is_preview"] = True
        completed.append(task)
    with ports.connect() as conn:
        missing = sorted({field for task in completed for field in task.get("missing_fields", [])})
        PendingTaskBatchRepository(conn).complete(ports.encode(completed), ports.encode(missing), "awaiting_clarification" if missing else "resolved", ports.now(), batch["id"], user_id)
    return completed
