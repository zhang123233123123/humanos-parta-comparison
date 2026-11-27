"""Profile HTTP route mappings; persistence belongs to application services."""
from ...application import mutation_workflows


def profile(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/profile":
        user_id = query.get("user_id", ["demo"])[0]
        if method == "GET":
            request.send_json({
                "data": {"profile": store.ensure_profile(user_id)},
                "resources": {"self": "/api/profile", "tasks": "/api/tasks"},
                "meta": {"resource": "profile", "aggregate_root": "profile", "read_only": False},
            })
            return True
        if method == "PUT":
            payload = request.read_json()
            payload["user_id"] = payload.get("user_id", user_id)
            result = mutation_workflows.update_profile(payload,
                ensure_profile=store.ensure_profile, upsert=store.upsert_profile, replan=store.request_replan)
            request.send_json({
                "data": result,
                "resources": {"self": "/api/profile", "tasks": "/api/tasks"},
                "meta": {"resource": "profile", "aggregate_root": "profile", "read_only": False},
            })
            return True
    return False
