"""Save a task re-entry checkpoint with explicit transaction and indexing capabilities."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.context_dumps import ContextDumpRepository
from ..repositories.tasks import TaskRepository


@dataclass(frozen=True)
class ContextDumpPorts:
    connect: Callable
    get_task: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    _insert_state_transition: Callable
    _enqueue_personalization: Callable
    index_context_dump_memory: Callable
    log_event: Callable
    decode: Callable
    encode: Callable
    make_id: Callable
    now: Callable


def save_context_dump(user_id: str, payload: dict, *, ports: ContextDumpPorts) -> dict:
    request_id = str(payload.get("request_id") or "").strip() or None
    if request_id:
        with ports.connect() as conn:
            existing = ContextDumpRepository(conn).find_request(user_id=user_id, request_id=request_id)
        if existing:
            saved = dict(existing)
            saved["open_questions"] = ports.decode(saved.get("open_questions"), [])
            saved["materials"] = ports.decode(saved.get("materials"), [])
            saved["metadata"] = ports.decode(saved.pop("metadata_json", "{}"), {})
            return saved
    dump_id = ports.make_id("dump")
    task_id = payload["task_id"]
    task = ports.get_task(task_id, user_id)
    if not task:
        raise KeyError(task_id)
    profile = ports.ensure_profile(user_id)
    timezone_name = str(profile.get("timezone") or "Asia/Shanghai")
    local_time = ports.user_clock_now(user_id, timezone_name).isoformat()
    submitted_fields = {
        key: payload[key]
        for key in ("progress", "progress_percent", "task_remaining_minutes", "open_questions", "next_action", "stop_reason", "materials")
        if key in payload
    }
    raw_questions = payload.get("open_questions") or []
    open_questions = [str(item).strip() for item in raw_questions if str(item).strip()] if isinstance(raw_questions, list) else [line.strip() for line in str(raw_questions).splitlines() if line.strip()]
    dump = {
        "id": dump_id,
        "user_id": user_id,
        "task_id": task_id,
        "execution_session_id": str(payload.get("execution_session_id") or "").strip() or None,
        "plan_revision": payload.get("plan_revision"),
        "request_id": request_id,
        "checkpoint_type": str(payload.get("checkpoint_type") or "human_context"),
        "supersedes_dump_id": str(payload.get("supersedes_dump_id") or "").strip() or None,
        "metadata": dict(payload.get("metadata") or {}),
        "progress": payload.get("progress", ""),
        "open_questions": open_questions,
        "next_action": payload.get("next_action", ""),
        "stop_reason": payload.get("stop_reason", "unknown"),
        "materials": payload.get("materials", []),
        "created_at": ports.now(),
    }
    checkpoints = [
        {"label": "Pause reason", "text": dump["stop_reason"]},
        {"label": "Current progress", "text": dump["progress"] or "Not provided"},
        {"label": "Next action", "text": dump["next_action"] or "Confirm one small next step before resuming."},
    ]
    execution = dict(task.get("execution") or {})
    # A Context Dump describes where the user stopped.  It must not treat
    # the remaining time in one Execution Session as the remaining work
    # for the whole task.  Task estimates may still be corrected, but only
    # through the explicitly named task-level field.
    task_remaining = payload.get("task_remaining_minutes")
    if task_remaining is not None:
        execution["remaining_duration_minutes"] = max(int(task_remaining), 0)
    elif execution.get("remaining_duration_minutes") is None:
        execution["remaining_duration_minutes"] = max(int(task.get("duration", 60)), 0)
    payload_progress = payload.get("progress_percent")
    execution["progress_percent"] = int(execution.get("progress_percent", 0) if payload_progress is None else payload_progress)
    execution["last_stop_reason"] = dump["stop_reason"]
    next_status = "blocked" if dump["stop_reason"] == "blocked" else "paused"
    context_window = dict(task.get("contextWindow") or {})
    # Blank optional notes must not erase existing context or its provenance.
    context_updates = {key: value for key, value in {
        "progress": dump["progress"], "nextStep": dump["next_action"],
        "open_questions": "; ".join(dump["open_questions"]),
    }.items() if value}
    context_window.update(context_updates)
    from ..domain.task import update_field_provenance

    context_provenance = update_field_provenance(
        task.get("field_provenance"), fields={
            {"nextStep": "next_step"}.get(key, key)
            for key in context_updates
        } | {"status"},
        source="user_input", source_id=dump_id, updated_at=dump["created_at"],
    )
    with ports.connect() as conn:
        ContextDumpRepository(conn).insert({
            **{key: dump[key] for key in ("id", "user_id", "task_id", "execution_session_id",
                "plan_revision", "request_id", "checkpoint_type", "supersedes_dump_id",
                "progress", "next_action", "stop_reason", "created_at")},
            "metadata_json": ports.encode(dump["metadata"]),
            "open_questions": ports.encode(dump["open_questions"]),
            "materials": ports.encode(dump["materials"]),
        })
        TaskRepository(conn).update_fields(task_id=task_id, user_id=user_id, updates={
            "status": next_status, "checkpoints_json": ports.encode(checkpoints),
            "execution_json": ports.encode(execution), "context_window_json": ports.encode(context_window),
            "field_provenance_json": ports.encode(context_provenance), "updated_at": dump["created_at"],
        })
        ports._insert_state_transition(conn, user_id=user_id, task_id=task_id, before_status=str(task.get("status") or "unknown"), action_type="capture_context", after_status=next_status, action_detail={"context_dump_id": dump_id, "stop_reason": dump["stop_reason"]}, outcome={"persisted": True, "remaining_minutes": execution["remaining_duration_minutes"]}, created_at=dump["created_at"])
        ports._enqueue_personalization(
            conn, user_id=user_id, kind="context_dump", source_id=dump_id,
            payload={
                "context_dump": {
                    "id": dump_id, "user_id": user_id, "created_at": dump["created_at"],
                    "execution_session_id": dump["execution_session_id"],
                    "checkpoint_type": dump["checkpoint_type"],
                    "timezone": timezone_name, "local_time": local_time,
                    "submitted_fields": submitted_fields,
                },
                "task": task,
            },
            timestamp=dump["created_at"],
        )
    if not payload.get("skip_memory_index"):
        ports.index_context_dump_memory(user_id, dump)
    ports.log_event(user_id, "context_dump_saved", dump)
    return dump
