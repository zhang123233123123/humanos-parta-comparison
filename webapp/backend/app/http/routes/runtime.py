"""Runtime HTTP route mappings; persistence belongs to application services."""


def health_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if method == "GET" and path == "/api/health":
        request.send_json(runtime.health())
        return True
    return False


def account_capabilities_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/account/capabilities" and method == "GET":
        user_id = query.get("user_id", [""])[0]
        request.send_json(store.account_capabilities(user_id))
        return True
    return False


def developer_snapshot_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/developer/snapshot" and method == "GET":
        if not runtime.qa_mode:
            request.send_json({"error": "not_found", "path": path}, status=404)
            return True
        user_id = query.get("user_id", [""])[0]
        request.send_json(store.developer_snapshot(user_id))
        return True
    return False


def test_clock(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/test-clock":
        request_user_id = query.get("user_id", [""])[0]
        if method == "POST":
            payload = request.read_json()
            request_user_id = str(payload.get("user_id") or request_user_id)
        if not runtime.test_mode and not store.account_capabilities(request_user_id).get("test_clock"):
            request.send_json({"error": "not_found", "path": path}, status=404)
            return True
        if method == "GET":
            request.send_json(runtime.test_clock_state() if runtime.test_mode else store.user_clock_state(request_user_id))
            return True
        if method == "POST":
            state = runtime.update_test_clock(payload) if runtime.test_mode else store.update_user_clock(request_user_id, payload)
            user_id = str(payload.get("user_id") or "test-clock")
            if payload.get("user_id") and not runtime.qa_mode:
                store.log_event(user_id, "test_clock_advanced", {
                    "simulated_now": state["simulated_now"],
                    "week_id": state["week_id"],
                    "advance_minutes": payload.get("advance_minutes"),
                    "advance_days": payload.get("advance_days"),
                    "time_scale": state["time_scale"],
                })
            request.send_json(state)
            return True
    return False


def qa_scenarios(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/qa-scenarios":
        if not runtime.qa_mode:
            request.send_json({"error": "not_found", "path": path}, status=404)
            return True
        if method == "GET":
            request.send_json(runtime.qa_scenario_manifest())
            return True
    return False


def qa_scenarios_load_actions(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path in {"/api/qa-scenarios/load", "/api/qa-scenarios/reset"}:
        if not runtime.qa_mode:
            request.send_json({"error": "not_found", "path": path}, status=404)
            return True
        if method == "POST":
            payload = request.read_json()
            scenario_id = "base" if path.endswith("/reset") else str(payload.get("scenario_id") or "")
            request.send_json(runtime.restore_qa_scenario(scenario_id))
            return True
    return False
