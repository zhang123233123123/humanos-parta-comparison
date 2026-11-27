"""Chat HTTP route mappings; persistence belongs to application services."""


def chat_turn_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/chat/turn" and method == "POST":
        payload = request.read_json()
        if payload.get('assistant_mode') != 'calendar_advisor':
            from ...application.manual_task_entry import ManualTaskEntryRequired
            raise ManualTaskEntryRequired()
        user_id = payload.get("user_id", "demo")
        store.ensure_profile(user_id)
        request.send_json({"turn": store.chat_turn(user_id, payload)}, status=201)
        return True
    return False


def chat_turns_get(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == "/api/chat/turns" and method == "GET":
        user_id = query.get("user_id", ["demo"])[0]
        limit = int(query.get("limit", ["20"])[0])
        store.ensure_profile(user_id)
        thread_id = query.get('thread_id', [None])[0]
        request.send_json(store.chat_history_page(user_id, thread_id, limit, query.get('before', [None])[0]) if thread_id else {"turns": store.list_chat_turns(user_id, limit=limit)})
        return True
    return False


def chat_threads_get_post(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path == '/api/chat/threads' and method in {'GET', 'POST'}:
        payload = request.read_json() if method == 'POST' else {}
        user_id = payload.get('user_id') or query.get('user_id', ['demo'])[0]
        request.send_json({'thread': store.create_chat_thread(user_id, payload)} if method == 'POST' else store.list_chat_threads(user_id), status=201 if method == 'POST' else 200)
        return True
    return False


def chat_threads_item_patch(request, store, runtime, method: str, path: str, query: dict) -> bool:
    if path.startswith('/api/chat/threads/') and method == 'PATCH':
        payload = request.read_json()
        request.send_json({'thread': store.update_chat_thread(payload.get('user_id', 'demo'), path.split('/')[-1], payload)})
        return True
    return False
