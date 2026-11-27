"""Tasks HTTP route mappings; persistence belongs to application services."""
from ...application import mutation_workflows


def tasks(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/tasks":
        user_id = query.get("user_id", ["demo"])[0]
        if method == "GET":
            store.ensure_profile(user_id)
            request.send_json({
                # Deletion archives history; the user-facing collection must
                # not restore archived items when the page reloads.
                "data": {"tasks": [task for task in store.list_tasks(user_id)
                                   if task.get("archived_at") is None]},
                "resources": {"self": "/api/tasks", "profile": "/api/profile"},
                "meta": {"resource": "tasks", "aggregate_root": "task", "read_only": False},
            })
            return True
        if method == "POST":
            payload = request.read_json()
            user_id = payload.get("user_id", user_id)
            result = mutation_workflows.create_task(user_id, payload,
                ensure_profile=store.ensure_profile, create=store.create_task, replan=store.request_replan)
            request.send_json({
                "data": result,
                "resources": {"collection": "/api/tasks"},
                "meta": {"resource": "task", "aggregate_root": "task", "read_only": False},
            }, status=201)
            return True
    return False


def tasks_parse_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/tasks/parse" and method == "POST":
        from ...application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()
    return False


def task_drafts_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == '/api/task-drafts' and method == 'GET':
        request.send_json({'drafts': store.task_drafts().list(query.get('user_id', ['demo'])[0])})
        return True
    return False


def task_drafts_item_patch_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path.startswith('/api/task-drafts/') and method in {'PATCH', 'POST'}:
        from ...application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()
    return False


def tasks_item_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path.startswith("/api/tasks/") and method == "GET":
        task_id = path.split("/")[-1]
        user_id = query.get("user_id", ["demo"])[0]
        from ...application.task_details import task_details
        task = task_details(user_id, task_id, get_task=store.get_task,
                            latest_runtime_state=store.latest_runtime_state)
        request.send_json({
            "data": {"task": task},
            "resources": {"collection": "/api/tasks"},
            "meta": {"resource": "task", "aggregate_root": "task", "read_only": False},
        })
        return True
    return False


def tasks_item_patch(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path.startswith("/api/tasks/") and method == "PATCH":
        task_id = path.split("/")[-1]
        payload = request.read_json()
        user_id = payload.get("user_id") or query.get("user_id", ["demo"])[0]
        result = mutation_workflows.update_task(user_id, task_id, payload,
            get_task=store.get_task, patch_task=store.patch_task,
            change_scope=store._task_change_scope, replan=store.request_replan)
        request.send_json({
            "data": result,
            "resources": {"collection": "/api/tasks"},
            "meta": {"resource": "task", "aggregate_root": "task", "read_only": False},
        })
        return True
    return False


def tasks_item_delete(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path.startswith("/api/tasks/") and method == "DELETE":
        task_id = path.split("/")[-1]
        user_id = query.get("user_id", ["demo"])[0]
        result = mutation_workflows.delete_task(user_id, task_id,
            get_task=store.get_task, delete=store.delete_task, replan=store.request_replan)
        request.send_json({
            "data": result,
            "resources": {"collection": "/api/tasks"},
            "meta": {"resource": "task", "aggregate_root": "task", "read_only": False},
        })
        return True
    return False
