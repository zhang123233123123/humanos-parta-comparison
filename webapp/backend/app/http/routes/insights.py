"""Automatic behavior learning HTTP contracts; no candidate promotion routes."""


def behavior_patterns(request, store, runtime, method, path, query):
    if method == 'GET' and path == '/api/behavior-patterns':
        user_id = query.get('user_id', ['demo'])[0]
        request.send_json({'data': store.behavior_patterns(user_id)})
        return True
    if method == 'PATCH' and path.startswith('/api/behavior-patterns/'):
        pattern_id = path.removeprefix('/api/behavior-patterns/')
        if not pattern_id or '/' in pattern_id:
            return False
        payload = request.read_json()
        request.send_json({'data': {'pattern': store.manage_behavior_pattern(
            payload.get('user_id', 'demo'), pattern_id, payload)}})
        return True
    return False


def profile_data_export_get(request, store, runtime, method, path, query):
    if method == 'GET' and path == '/api/profile-data/export':
        request.send_json({'data': store.export_profile_data(query.get('user_id', ['demo'])[0])})
        return True
    return False
