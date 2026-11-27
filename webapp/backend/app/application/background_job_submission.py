"""Queue jobs with replay validation and atomic draft linkage; no server imports."""
from .plan_revision import validate_replan_replay
from ..repositories.background_jobs import BackgroundJobRepository


def create_job(user_id: str, kind: str, payload: dict, *, atomic, require_thread,
               get_draft, get_task, get_job, link_draft, start, make_id, now, encode, decode,
               ensure_profile, current_week) -> dict:
    if kind == 'chat_parse' and payload.get('assistant_mode') != 'calendar_advisor':
        from .manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()
    if kind not in {"chat_parse", "schedule_plan", "cross_week_preview"}:
        raise ValueError("unsupported background job kind")
    if kind == "chat_parse" and payload.get("thread_id") is not None:
        require_thread(user_id, payload["thread_id"])
    job_id = make_id("job")
    request_id = str(payload.get("request_id") or "").strip() or None
    timestamp = now()
    with atomic() as conn:
        draft = None
        if kind == 'schedule_plan' and payload.get('draft_id'):
            draft = get_draft(user_id, payload['draft_id'])
            saved = draft.get('activity_exists') if draft['task'].get('recurrence') == 'daily' else get_task(draft['task_id'], user_id) if draft.get('task_id') else False
            if draft['status'] != 'submitted' or not saved:
                raise ValueError('Only a saved task can be scheduled')
        if request_id:
            existing = BackgroundJobRepository(conn).find_request(user_id, kind, request_id)
            if existing:
                validate_replan_replay(decode(existing['payload_json'], {}), payload)
                if decode(existing['payload_json'], {}).get('thread_id') != payload.get('thread_id'):
                    raise ValueError('request_id belongs to another conversation')
                if decode(existing['payload_json'], {}).get('draft_id') != payload.get('draft_id'):
                    raise ValueError('request_id belongs to another draft')
                return get_job(user_id, str(existing["id"])) or {}
        if draft and draft.get('schedule_job_id'):
            previous = get_job(user_id, draft['schedule_job_id'])
            if previous is None:
                raise ValueError('Linked scheduling job is unavailable')
            if previous['status'] in ('queued', 'running') or payload.get('retry_job_id') != previous['job_id']:
                return previous
        if kind == 'schedule_plan':
            profile = ensure_profile(user_id)
            week = (payload.get('week_id') or profile.get('active_week_id')
                    or (profile.get('weekly_context') or {}).get('week_id')
                    or current_week(timezone_name=profile.get('timezone') or 'Asia/Shanghai'))
            payload = {**payload, 'week_id': str(week)}
        BackgroundJobRepository(conn).insert(job_id, user_id, kind, request_id, encode(payload), timestamp)
        if draft:
            link_draft(conn, job_id, draft['draft_id'], user_id)
    start(job_id)
    return get_job(user_id, job_id) or {}
