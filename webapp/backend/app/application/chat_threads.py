"""User-scoped conversation use cases, independent of scheduling and AI."""
import uuid

from ..repositories.chat_threads import ChatThreadRepository


def require_user_thread(user_id, thread_id, *, connect):
    with connect() as conn:
        return require_thread(conn, user_id, thread_id)


def create_user_thread(user_id, payload, *, connect, now):
    with connect() as conn:
        return create_thread(conn, user_id, payload.get('title'), now())


def require_thread(conn, user_id, thread_id):
    if thread_id is None:
        return 'legacy'
    row = ChatThreadRepository(conn).get(user_id, thread_id)
    if not row:
        raise KeyError('chat thread not found')
    return row['id']


def create_thread(conn, user_id, title, now):
    title = str(title or '').strip()
    if not title or len(title) > 100:
        raise ValueError('Thread title must be 1–100 characters')
    thread_id = 'thread-' + uuid.uuid4().hex
    repository = ChatThreadRepository(conn)
    repository.insert(thread_id, user_id, title, now)
    return dict(repository.get(user_id, thread_id))


def list_threads(user_id, *, connect):
    with connect() as conn:
        repository = ChatThreadRepository(conn)
        rows = repository.list(user_id)
        active = repository.active(user_id)
    return {"threads": [dict(row) for row in rows], "active_thread_id": active['id'] if active else None}


def update_thread(user_id, thread_id, payload, *, require, connect, now):
    require(user_id, thread_id)
    with connect() as conn:
        repository = ChatThreadRepository(conn)
        if 'title' in payload:
            title = str(payload['title'] or '').strip()
            if not title or len(title) > 100:
                raise ValueError('Thread title must be 1–100 characters')
            repository.rename(user_id, thread_id, title, now())
        if payload.get('active') is True:
            repository.activate(user_id, thread_id, now())
        return dict(repository.get(user_id, thread_id))


def history_page(user_id, thread_id, limit=30, before=None, *, require, connect):
    require(user_id, thread_id)
    limit = max(1, min(int(limit), 100))
    with connect() as conn:
        repository = ChatThreadRepository(conn)
        cursor = None
        if before:
            cursor = repository.history_cursor(user_id, thread_id, before)
            if not cursor:
                raise ValueError('Invalid history cursor')
        rows = repository.history(user_id, thread_id, limit + 1, cursor)
    has_more = len(rows) > limit
    page = rows[:limit]
    return {'turns': [dict(row) for row in reversed(page)],
            'next_cursor': page[-1]['id'] if has_more else None}
