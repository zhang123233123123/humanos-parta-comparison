"""Persisted conversation records and history projections."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.chat_records import ChatRecordRepository


@dataclass(frozen=True)
class ChatRecordPorts:
    atomic: Callable
    require_chat_thread: Callable
    connect: Callable
    decode: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    make_id: Callable
    now: Callable
    encode: Callable
    _enqueue_personalization: Callable
    log_event: Callable
    get_task: Callable


def save_chat_turn(
    user_id: str,
    user_text: str,
    assistant_reply: str,
    intent: str,
    features: dict,
    task_ids: list[str],
    request_id: str | None = None,
    thread_id: str | None = None,
    *, ports: ChatRecordPorts,
) -> dict:
    with ports.atomic():
        explicit_thread = thread_id is not None
        thread_id = ports.require_chat_thread(user_id, thread_id)
        request_id = str(request_id or "").strip() or None
        if request_id:
            with ports.connect() as conn:
                existing = ChatRecordRepository(conn).replay(user_id, request_id)
            if existing:
                if existing['thread_id'] != thread_id:
                    raise ValueError('request_id belongs to another conversation')
                return {
                    **dict(existing),
                    "features": ports.decode(existing["features_json"], {}),
                    "task_ids": ports.decode(existing["task_ids_json"], []),
                    "replayed": True,
                }
        profile = ports.ensure_profile(user_id)
        timezone_name = str(profile.get("timezone") or "Asia/Shanghai")
        local_time = ports.user_clock_now(user_id, timezone_name).isoformat()
        turn = {
            "id": ports.make_id("turn"),
            "thread_id": thread_id,
            "user_id": user_id,
            "request_id": request_id,
            "user_text": user_text,
            "assistant_reply": assistant_reply,
            "intent": intent,
            "features": features,
            "task_ids": task_ids,
            "created_at": ports.now(),
        }
        with ports.connect() as conn:
            if not explicit_thread:
                ChatRecordRepository(conn).ensure_legacy(user_id, turn['created_at'])
            ChatRecordRepository(conn).touch_thread(user_id, thread_id, turn['created_at'])
            ChatRecordRepository(conn).insert(turn, ports.encode(features), ports.encode(task_ids))
            ports._enqueue_personalization(
                conn, user_id=user_id, kind="chat_turn", source_id=turn["id"],
                payload={"turn": {
                    "id": turn["id"], "user_id": user_id, "created_at": turn["created_at"],
                    "user_text": user_text, "intent": intent, "features": features,
                    "task_ids": task_ids, "timezone": timezone_name,
                    "local_time": local_time,
                }},
                timestamp=turn["created_at"],
            )
        ports.log_event(user_id, "chat_turn_saved", {"turn_id": turn["id"], "intent": intent, "task_ids": task_ids})
        return turn

def list_chat_turns(user_id: str, limit: int = 20, thread_id: str | None = None, *, ports: ChatRecordPorts) -> list[dict]:
    thread_id = ports.require_chat_thread(user_id, thread_id)
    with ports.connect() as conn:
        rows = ChatRecordRepository(conn).list(user_id, thread_id, limit)
    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "user_text": row["user_text"],
            "assistant_reply": row["assistant_reply"],
            "intent": row["intent"],
            "features": ports.decode(row["features_json"], {}),
            "task_ids": ports.decode(row["task_ids_json"], []),
            "created_at": row["created_at"],
        }
        for row in reversed(rows)
    ]

def latest_task_turn_tasks(user_id: str, thread_id: str | None = None, *, ports: ChatRecordPorts) -> list[dict]:
    thread_id = ports.require_chat_thread(user_id, thread_id)
    with ports.connect() as conn:
        rows = ChatRecordRepository(conn).recent_task_ids(user_id, thread_id)
    for row in rows:
        task_ids = ports.decode(row["task_ids_json"], [])
        tasks = [ports.get_task(task_id, user_id) for task_id in task_ids if task_id]
        tasks = [task for task in tasks if task and task.get("status") not in {"completed", "terminated"}]
        if tasks:
            return tasks
    return []
