"""Execution HTTP route mappings; persistence belongs to application services."""
from ...application import mutation_workflows


def workspace_sessions(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == '/api/execution-sessions/propose' and method == 'POST':
        payload = request.read_json()
        request.send_json({'data': {'proposal': store.propose_sessions(payload.get('user_id', 'demo'), payload)}}, status=201)
        return True
    if path == '/api/pending-work' and method == 'GET':
        request.send_json({'data': {'pending_work': store.pending_work(query.get('user_id', ['demo'])[0])}})
        return True
    if method != 'POST' or path not in {'/api/execution-sessions/report', '/api/execution-sessions/workspace-start', '/api/execution-sessions/defer'}:
        return False
    payload = request.read_json()
    user_id = payload.get('user_id', 'demo')
    result = store.report_session(user_id, payload) if path.endswith('/report') else {
        'execution_session': store.workspace_execution(user_id, payload, defer=path.endswith('/defer'))}
    request.send_json({'data': result}, status=201)
    return True


def state_checkins_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/state-checkins/review" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        result = store.evaluate_daily_checkin(user_id, {"_locale": payload.get("locale", "zh")})
        request.send_json({"daily_plan_review": result})
        return True
    if path == "/api/state-checkins" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        result = mutation_workflows.check_in(user_id, payload,
            ensure_profile=store.ensure_profile, save_state=store.save_runtime_state,
            evaluate=store.evaluate_daily_checkin, request_replan=store.request_replan)
        request.send_json(result, status=201)
        return True
    return False


def state_checkins_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/state-checkins" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        request.send_json(store.daily_checkin_status(user_id))
        return True
    return False


def execution_recommendations_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution/recommendations" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"data": store.help_decide(user_id, payload)}, status=201)
        return True
    return False


def execution_recommendations_feedback_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution/recommendations/feedback" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"data": {"feedback": store.save_help_decide_feedback(user_id, payload)}}, status=201)
        return True
    return False


def execution_recommendations_resume_time_check_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution/recommendations/resume-time-check" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"data": store.check_resume_time(user_id, payload)})
        return True
    return False


def execution_recommendations_apply_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution/recommendations/apply" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"data": store.apply_help_decide_recommendation(user_id, payload)})
        return True
    return False


def context_dumps_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/context-dumps" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        result = mutation_workflows.capture_context(user_id, payload,
            ensure_profile=store.ensure_profile, save_context=store.save_context_dump,
            get_task=store.get_task)
        request.send_json({"data": result, "resources": {"task": "/api/tasks", "execution_sessions": "/api/execution-sessions", "reentry": "/api/reentry"}, "meta": {"resource": "context_dump", "aggregate_root": "task", "read_only": False}}, status=201)
        return True
    return False


def execution_feedback_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-feedback" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        result = mutation_workflows.execution_feedback(user_id, payload,
            ensure_profile=store.ensure_profile, save_feedback=store.save_execution_feedback,
            list_sessions=store.list_execution_sessions, get_task=store.get_task)
        request.send_json(result, status=201)
        return True
    return False


def execution_sessions_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        statuses = [item for value in query.get("status", []) for item in value.split(",") if item]
        request.send_json({"execution_sessions": store.list_execution_sessions(user_id, statuses or None)})
        return True
    return False


def execution_sessions_current_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/current" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        request.send_json(store.current_execution(user_id))
        return True
    return False


def execution_sessions_start_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/start" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json({"execution_session": store.start_execution_session(user_id, payload)})
        return True
    return False


def execution_sessions_ensure_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/ensure" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json({"execution_session": store.ensure_execution_session(user_id, payload)}, status=201)
        return True
    return False


def execution_sessions_interrupt_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/interrupt" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json(store.review_interruption(user_id, payload, capture_context=True))
        return True
    return False


def execution_sessions_pause_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/pause" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json(store.review_interruption(user_id, payload, capture_context=False))
        return True
    return False


def execution_sessions_impact_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/impact" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json({"impact": store.analyze_execution_impact(user_id, payload)})
        return True
    return False


def interruption_episodes_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/interruption-episodes" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        store.ensure_profile(user_id)
        request.send_json({"data": store.interruption_recovery_summary(user_id), "resources": {"execution_sessions": "/api/execution-sessions", "profile": "/api/profile"}, "meta": {"resource": "interruption_episodes", "aggregate_root": "task", "read_only": True, "causal_claim_allowed": False, "profile_write_allowed": False, "plan_write_allowed": False}})
        return True
    return False


def execution_sessions_end_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/execution-sessions/end" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json({"execution_session": store.end_execution_session(user_id, payload)})
        return True
    return False


def state_transitions_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/state-transitions" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"data": {"transition": store.record_state_transition(user_id, payload)}, "resources": {"task": "/api/tasks", "execution_sessions": "/api/execution-sessions", "context_dump": "/api/context-dumps"}, "meta": {"resource": "state_transition", "aggregate_root": "task", "read_only": False}}, status=201)
        return True
    return False


def reentry_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/reentry" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"data": {"reentry": store.reentry_prompt(user_id, payload)}, "resources": {"task": "/api/tasks", "execution_sessions": "/api/execution-sessions", "context_dump": "/api/context-dumps"}, "meta": {"resource": "reentry_guidance", "aggregate_root": "task", "read_only": False, "plan_write_allowed": False, "records_guidance_generation": True}})
        return True
    return False


def execution_adjustment_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == '/api/execution-sessions/adjustment' and method == 'POST':
        payload = request.read_json()
        request.send_json({'data': store.adjust_execution(payload.get('user_id', 'demo'), payload)})
        return True
    return False
