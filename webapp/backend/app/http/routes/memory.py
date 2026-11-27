"""Memory HTTP route mappings; persistence belongs to application services."""


def memories_search_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/memories/search" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        q = query.get("q", [""])[0]
        top_k = int(query.get("top_k", ["5"])[0])
        store.ensure_profile(user_id)
        request.send_json({"data": {"memories": store.search_memories(user_id, q, top_k=top_k)}, "resources": {"profile": "/api/profile", "behavior_patterns": "/api/behavior-patterns"}, "meta": {"resource": "memory_evidence", "aggregate_root": "profile", "read_only": True, "plan_write_allowed": False}})
        return True
    return False
