"""Execute supported job kinds through explicit business capabilities."""
from collections.abc import Callable


def finalize_job(conn, job, result, finalized_task_ids, *, decode, encode):
    from ..repositories.chat_records import ChatRecordRepository
    payload = decode(job["payload_json"], {})
    if finalized_task_ids is not None and payload.get('request_id'):
        ChatRecordRepository(conn).finalize_job_reply(
            user_id=job['user_id'], request_id=payload['request_id'],
            thread_id=payload.get('thread_id') or 'legacy',
            reply=result.get('reply', ''), task_ids_json=encode(finalized_task_ids))


def execute_job(job: dict, *, decode: Callable, chat_turn: Callable,
                list_drafts: Callable, create_task: Callable, decide_schedule: Callable, preview_next_week: Callable | None = None):
    row = job
    job_id = job["id"]
    payload = decode(row["payload_json"], {})
    finalized_task_ids = None
    if row["kind"] == "cross_week_preview":
        if preview_next_week is None:raise ValueError("Cross-week preview unavailable")
        return preview_next_week(row["user_id"], payload), None
    if row["kind"] == "chat_parse":
        result = chat_turn(row["user_id"], payload)
        previews = [task for task in (result.get("tasks") or []) if isinstance(task, dict) and task.get("is_preview")]
        if payload.get('draft_workflow'):
            result['drafts'] = list_drafts(row['user_id'])
        if not payload.get('draft_workflow') and previews and not result.get("requires_clarification") and not any(task.get("missing_fields") for task in previews) and payload.get("assistant_mode") != "calendar_advisor":
            persisted = []
            for index, task in enumerate(previews):
                persisted.append(create_task(row["user_id"], {
                    **task,
                    "request_id": f"{job_id}:task:{index}",
                    "status": "queued",
                }))
            decision = decide_schedule(row["user_id"], {
                "source": "async_chat_task_import",
                "request_id": f"{job_id}:schedule",
                "client_now": payload.get("current_time"),
            })
            result["tasks"] = persisted
            finalized_task_ids = [task['id'] for task in persisted]
            result["schedule_decision"] = decision
            result["reply"] = f"I saved {len(persisted)} tasks and generated a calendar draft. Review the draft once, then confirm it to publish the schedule."
    else:
        result = decide_schedule(row["user_id"], payload, scheduling_job_id=job_id)
    return result, finalized_task_ids
