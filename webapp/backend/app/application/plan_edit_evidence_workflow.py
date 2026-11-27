"""Record edits and query projected evidence without changing plan activation."""
from collections.abc import Callable
from dataclasses import dataclass

from ..repositories.plan_edit_evidence import PlanEditEvidenceRepository
from ..repositories.tasks import TaskRepository


@dataclass(frozen=True)
class PlanEditEvidencePorts:
    connect: Callable
    decode: Callable
    get_edit_episode: Callable
    now: Callable
    make_id: Callable
    encode: Callable
    _enqueue_personalization: Callable
    task_row: Callable


def get_edit_episode(user_id: str, episode_id: str, *, ports: PlanEditEvidencePorts) -> dict | None:
    with ports.connect() as conn:
        row = PlanEditEvidenceRepository(conn).episode(user_id, episode_id)
    if not row:
        return None
    return {
        "edit_episode_id": row["id"], "user_id": row["user_id"], "week_id": row["week_id"],
        "plan_id": row["plan_id"], "plan_revision": row["plan_revision"],
        "initial_plan_snapshot": ports.decode(row["initial_plan_json"], []), "initial_plan_hash": row["initial_plan_hash"],
        "final_plan_snapshot": ports.decode(row["final_plan_json"], None), "final_plan_hash": row["final_plan_hash"],
        "canonical_diff": ports.decode(row["canonical_diff_json"], {}), "status": row["status"],
        "research_context_revision": row["research_context_revision"], "started_at": row["started_at"],
        "confirmed_at": row["confirmed_at"], "updated_at": row["updated_at"],
    }

def record_plan_edit_event(user_id: str, payload: dict, *, ports: PlanEditEvidencePorts) -> dict:
    episode_id = str(payload.get("edit_episode_id") or "")
    episode = ports.get_edit_episode(user_id, episode_id)
    if not episode:
        raise KeyError(episode_id)
    request_id = str(payload.get("request_id") or "").strip() or None
    timestamp = ports.now()
    event_type = str(payload.get("event_type") or "move_session")
    valid_types = {"move_session", "resize_session", "add_session", "remove_session", "change_deadline", "change_duration", "change_priority", "change_difficulty", "select_alternative_plan", "accept_parallel_pair", "reject_parallel_pair", "undo_edit", "edit_attempt_failed"}
    if event_type not in valid_types:
        raise ValueError("Unsupported plan edit event")
    validation_result = dict(payload.get("validation_result") or {})
    effective = bool(validation_result.get("valid", event_type != "edit_attempt_failed")) and event_type != "edit_attempt_failed"
    with ports.connect() as conn:
        if request_id:
            existing = PlanEditEvidenceRepository(conn).replay(user_id, request_id)
            if existing:
                return {"event_id": existing["id"], "replayed": True, "sequence_number": existing["sequence_number"], "effective": bool(existing["effective"])}
        sequence = PlanEditEvidenceRepository(conn).next_sequence(episode_id)
        event_id = ports.make_id("edit")
        PlanEditEvidenceRepository(conn).insert(
            (event_id, episode_id, user_id, payload.get("task_id"), payload.get("block_id"), payload.get("actor") or "user", event_type, ports.encode(payload.get("before") or {}), ports.encode(payload.get("after") or {}), payload.get("interaction_source") or "calendar", ports.encode(validation_result), payload.get("reverts_event_id"), request_id, payload.get("client_time"), timestamp, sequence, 1 if effective else 0),
        )
        if event_type == "undo_edit" and payload.get("reverts_event_id"):
            PlanEditEvidenceRepository(conn).undo(payload.get("reverts_event_id"), episode_id)
            ports._enqueue_personalization(
                conn, user_id=user_id, kind="invalidate_source", source_id=f"{event_id}:invalidate",
                payload={"user_id": user_id, "source_type": "plan_edit", "source_id": str(payload.get("reverts_event_id"))},
                timestamp=timestamp,
            )
        task_row = TaskRepository(conn).get_for_user(task_id=payload.get("task_id"), user_id=user_id) if payload.get("task_id") else None
        ports._enqueue_personalization(
            conn, user_id=user_id, kind="plan_edit", source_id=event_id, timestamp=timestamp,
            payload={
                "user_id": user_id, "source_event_id": event_id, "occurred_at": timestamp,
                "event_type": event_type, "before": dict(payload.get("before") or {}),
                "after": dict(payload.get("after") or {}), "actor": str(payload.get("actor") or "user"),
                "interaction_source": str(payload.get("interaction_source") or "calendar"),
                "effective": effective, "edit_episode_id": episode_id,
                "block_id": str(payload.get("block_id") or "") or None,
                "validation_result": validation_result, "task": ports.task_row(task_row) if task_row else None,
            },
        )
        PlanEditEvidenceRepository(conn).reopen(user_id, episode_id, timestamp)
    return {"event_id": event_id, "replayed": False, "sequence_number": sequence, "effective": effective}

def list_personalization_evidence(user_id: str, *, ports: PlanEditEvidencePorts) -> list[dict]:
    with ports.connect() as conn:
        from .personalization_projector import drain_personalization_outbox

        drain_personalization_outbox(conn, user_id=user_id)
        rows = PlanEditEvidenceRepository(conn).evidence(user_id)
    return [
        {**ports.decode(row["evidence_json"], {}), "eligible_for_pattern": bool(row["eligible_for_pattern"])}
        for row in rows
    ]

def list_behavior_events(user_id: str, *, ports: PlanEditEvidencePorts) -> list[dict]:
    with ports.connect() as conn:
        from .personalization_projector import drain_personalization_outbox

        drain_personalization_outbox(conn, user_id=user_id)
        rows = PlanEditEvidenceRepository(conn).behavior(user_id)
    return [
        {**ports.decode(row["event_json"], {}), "effective": bool(row["effective"])}
        for row in rows
    ]

def list_personalization_projection_failures(user_id: str, *, ports: PlanEditEvidencePorts) -> list[dict]:
    with ports.connect() as conn:
        rows = PlanEditEvidenceRepository(conn).failures(user_id)
    return [dict(row) for row in rows]
