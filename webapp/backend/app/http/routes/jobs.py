"""Jobs HTTP route mappings; persistence belongs to application services."""


def background_jobs_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/background-jobs" and method == "POST":
        payload = request.read_json()
        if payload.get('kind') == 'chat_parse' and (payload.get('payload') or {}).get('assistant_mode') != 'calendar_advisor':
            from ...application.manual_task_entry import ManualTaskEntryRequired
            raise ManualTaskEntryRequired()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        kind = str(payload.get("kind") or "")
        job_payload = dict(payload.get("payload") or {})
        job_payload["user_id"] = user_id
        request.send_json({"job": store.create_background_job(user_id, kind, job_payload)}, status=202)
        return True
    return False


def background_jobs_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/background-jobs" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        job_id = query.get("job_id", [""])[0]
        job = store.get_background_job(user_id, job_id)
        if not job:
            raise KeyError(job_id)
        request.send_json({"job": job})
        return True
    return False
