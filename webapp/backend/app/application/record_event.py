"""Persist an event within the caller's existing connection/transaction policy."""
from ..repositories.events import EventRepository


def record_event(user_id, event_type, payload, *, connect, make_id, encode, now):
    with connect() as conn:
        EventRepository(conn).insert(event_id=make_id('evt'), user_id=user_id,
            event_type=event_type, payload_json=encode(payload), timestamp=now())
