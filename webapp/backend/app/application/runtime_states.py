"""Self-report persistence, current-day projection and review suggestions."""
from collections.abc import Callable
from dataclasses import dataclass

from ..repositories.runtime_states import RuntimeStateRepository


@dataclass(frozen=True)
class RuntimeStatePorts:
    atomic: Callable
    connect: Callable
    ensure_profile: Callable
    get_profile: Callable
    user_clock_now: Callable
    clock_now: Callable
    now: Callable
    make_id: Callable
    encode: Callable
    decode: Callable
    daily_checkin_status: Callable
    latest_runtime_state: Callable
    project_runtime_observation: Callable
    list_execution_sessions: Callable
    get_task: Callable
    _enqueue_personalization: Callable
    log_event: Callable


def save_runtime_state(user_id: str, payload: dict, *, ports: RuntimeStatePorts) -> dict:
    with ports.atomic():
        from ..domain.runtime_observation import submitted_values
        submitted_fields = submitted_values(payload)
        request_id = str(payload.get("request_id") or "").strip() or None
        if request_id:
            with ports.connect() as conn:
                existing = RuntimeStateRepository(conn).by_request(user_id, request_id)
            if existing:
                return {**ports.project_runtime_observation(existing), "replayed": True}
        profile = ports.ensure_profile(user_id)
        timezone_name = str(profile.get("timezone") or "Asia/Shanghai")
        local_time = ports.user_clock_now(user_id, timezone_name).isoformat()
        state_id = ports.make_id("state")
        state = {
            "id": state_id,
            "user_id": user_id,
            "request_id": request_id,
            "focus": submitted_fields.get("focus"),
            "energy": submitted_fields.get("energy"),
            "stress": submitted_fields.get("stress"),
            "mood": payload.get("mood"),
            "attention_residue": payload.get("attention_residue", ""),
            "emotion": payload.get("emotion", "neutral"),
            "readiness": payload.get("readiness", "unsure"),
            "daily_note": payload.get("daily_note", ""),
            "source": "self_report",
            "confidence_level": "high",
            "created_at": ports.now(),
        }
        with ports.connect() as conn:
            RuntimeStateRepository(conn).insert(
                (
                    state["id"],
                    user_id,
                    request_id,
                    state["focus"] if state["focus"] is not None else 4,
                    state["energy"] if state["energy"] is not None else 4,
                    state["stress"] if state["stress"] is not None else 4,
                    state["mood"],
                    state["attention_residue"],
                    state["emotion"],
                    state["readiness"],
                    state["daily_note"],
                    state["created_at"],
                    ports.encode({**submitted_fields, '_reported_at': local_time}),
                ),
            )
            if payload.get("daily_checkin"):
                RuntimeStateRepository(conn).mark_daily_checkin(
                    user_id, str(local_time[:10]), state["created_at"])
            ports._enqueue_personalization(
                conn, user_id=user_id, kind="state_checkin", source_id=state_id,
                payload={"checkin": {
                    "id": state_id, "user_id": user_id, "created_at": state["created_at"],
                    "daily_checkin": bool(payload.get("daily_checkin")),
                    "submission_source": str(payload.get("source") or "check_in"),
                    "timezone": timezone_name, "local_time": local_time,
                    "submitted_fields": submitted_fields,
                }},
                timestamp=state["created_at"],
            )
        from ..domain.runtime_observation import project_runtime_state, current_day_observation
        state = current_day_observation(project_runtime_state(state, {**submitted_fields, '_reported_at': local_time}), ports.user_clock_now(user_id, timezone_name))
        ports.log_event(user_id, "runtime_state_saved", state)
        if payload.get('daily_checkin'):
            from ..domain.break_suggestion import suggest_break
            state['break_suggestion'] = suggest_break(
                state, ports.list_execution_sessions(user_id, ['running']))
        return state

def daily_checkin_status(user_id: str, *, ports: RuntimeStatePorts) -> dict:
    profile = ports.ensure_profile(user_id)
    current = ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai")
    local_date = current.date().isoformat()
    last_date = profile.get("last_daily_checkin_date")
    return {
        "required": last_date != local_date,
        "local_date": local_date,
        "last_daily_checkin_date": last_date,
        "evaluated_at": current.isoformat(),
    }

def latest_runtime_state(user_id: str, *, ports: RuntimeStatePorts) -> dict:
    with ports.connect() as conn:
        row = RuntimeStateRepository(conn).latest(user_id)
    return ports.project_runtime_observation(row)

def project_runtime_observation(row, *, ports: RuntimeStatePorts) -> dict:
    from ..domain.runtime_observation import project_runtime_state, current_day_observation
    record = dict(row) if row is not None else None
    reported = None
    if record and record.get("reported_state_json") is None:
        with ports.connect() as conn:
            evidence = RuntimeStateRepository(conn).legacy_evidence(record['user_id'], record['id'])
        if evidence:
            checkin = ports.decode(evidence['payload_json'], {}).get('checkin', {})
            reported = checkin.get('submitted_fields')
            if isinstance(reported, dict) and checkin.get('local_time'):
                reported = {**reported, '_reported_at': checkin['local_time']}
    state = project_runtime_state(record, reported)
    profile = ports.get_profile(record['user_id']) if record else None
    now = ports.user_clock_now(record['user_id'], (profile or {}).get('timezone') or 'Asia/Shanghai') if record else ports.clock_now()
    return current_day_observation(state, now)
