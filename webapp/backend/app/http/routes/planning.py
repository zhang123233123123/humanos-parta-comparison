"""Planning HTTP route mappings; persistence belongs to application services."""
from ...application import mutation_workflows


def plans_revise_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plans/revise" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"plan": store.revise_plan(user_id, payload)}, status=201)
        return True
    return False


def plans_adjust_task_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plans/adjust-task" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json(store.adjust_scheduled_task(user_id, payload), status=201)
        return True
    return False


def plans_parallel_decision_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plans/parallel-decision" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"plan": store.decide_parallel_suggestion(user_id, payload)}, status=200)
        return True
    return False


def weekly_setup_reconcile_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/weekly-setup/reconcile" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        result = mutation_workflows.reconcile_week(user_id, payload,
            ensure_profile=store.ensure_profile, reconcile=store.reconcile_weekly_setup, replan=store.request_replan)
        request.send_json(result)
        return True
    return False


def weeks_status_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/weeks/status" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        week_id = query.get("week_id", [None])[0]
        request.send_json(store.week_status(user_id, week_id))
        return True
    return False


def weeks_rollover_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/weeks/rollover" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json(store.rollover_week(user_id, payload))
        return True
    return False


def plan_edits_events_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plan-edits/events" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"event": store.record_plan_edit_event(user_id, payload)}, status=201)
        return True
    return False


def plans_replan_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plans/replan" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        request.send_json({"replan": store.request_replan(user_id, scope=str(payload.get("scope") or "local"), trigger=str(payload.get("trigger") or "user_requested"), affected_task_ids=payload.get("affected_task_ids") or [], week_id=payload.get("week_id"), request_id=payload.get("request_id"))}, status=202)
        return True
    return False


def schedules_decide_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/schedules/decide" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"decision": store.decide_schedule(user_id, payload)})
        return True
    return False


def schedules_validate_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/schedules/validate" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"validation": store.validate_confirmed_schedule(user_id, payload)})
        return True
    return False


def plans_active_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plans/active" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        week_id = query.get("week_id", [None])[0]
        request.send_json({"plan": store.active_plan(user_id, week_id)})
        return True
    return False


def plans_proposed_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/plans/proposed" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        week_id = query.get("week_id", [None])[0]
        request.send_json({"plan": store.latest_proposed_plan(user_id, week_id)})
        return True
    return False


def schedules_confirm_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/schedules/confirm" and method == "POST":
        payload = request.read_json()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json(store.confirm_plan(user_id, payload))
        return True
    return False


def cross_week_actions(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if method == 'POST' and path in {'/api/weeks/next/preview','/api/weeks/next/confirm'}:
        payload = request.read_json()
        user_id = payload.get('user_id','demo')
        if path.endswith('/preview'):
            request.send_json({'job':store.create_background_job(user_id,'cross_week_preview',payload)},status=202)
        else:
            request.send_json(store.confirm_next_week(user_id,payload))
        return True
    return False
