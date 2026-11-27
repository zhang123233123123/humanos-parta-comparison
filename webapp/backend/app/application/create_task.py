"""Task creation use case with explicit domain, persistence and side-effect boundaries."""
from collections.abc import Callable
from contextlib import AbstractContextManager
import sqlite3
from ..repositories.tasks import TaskRepository
from ..repositories.plans import PlanRepository
from ..repositories.profiles import ProfileRepository


def create_task(user_id: str, payload: dict, *, clean_title: Callable,
                infer_type: Callable, infer_schedule_type: Callable, infer_demand: Callable,
                connect: Callable[[], AbstractContextManager[sqlite3.Connection]],
                project: Callable, make_id: Callable, current_week: Callable, now: Callable,
                encode: Callable, add_memory: Callable, log_event: Callable, get_task: Callable) -> dict:
    from ..domain.task import require_valid_attention_mode, require_valid_resource_tags
    from ..domain.task.write_fields import normalize_task_write, with_reported_difficulty

    payload = normalize_task_write(payload)

    if "resource_modality" in payload:
        require_valid_resource_tags(payload.get("resource_modality"))
    if "attention_mode" in payload:
        require_valid_attention_mode(payload.get("attention_mode"))
    title = clean_title(payload.get("title"))
    context = payload.get("context", "")
    domain_type = payload.get("type") or infer_type(title, context)
    schedule_type = infer_schedule_type({**payload, "title": title, "context": context})
    deadline = payload.get("deadline_at")
    create_request_id = str(payload.get("request_id") or "").strip() or None
    if create_request_id:
        with connect() as conn:
            duplicate = TaskRepository(conn).find_create_request(user_id=user_id, request_id=create_request_id)
        if duplicate:
            log_event(user_id, "task_create_replayed", {"task_id": duplicate["id"], "request_id": create_request_id})
            return project(duplicate)
    # Mutable fields are not identity. Two Tasks may share a title and
    # deadline; only replaying the same request_id may reuse a Task.
    requested_task_id = str(payload.get("id") or "").strip()
    # Preview identifiers are transport-only identities. Once the user
    # confirms a candidate it becomes a real Task and must receive a
    # persistent task_* identity; calendar projection intentionally hides
    # preview-* resources.
    task_id = make_id("task") if not requested_task_id or requested_task_id.startswith("preview-") else requested_task_id
    priority = payload.get("priority") or "中"
    # Structured AI/user input is authoritative. Never re-parse the shared
    # conversation context because it may contain several other tasks.
    from ..domain.task.duration import require_task_duration
    duration = require_task_duration(payload.get("duration"))
    status = payload.get("status", "queued")
    demand = with_reported_difficulty(payload.get("task_demand") or infer_demand(payload, domain_type), payload)
    from ..domain.task_energy import energy_requirement
    demand = {**demand, 'energy_requirement': energy_requirement(payload.get('energy_demand'))}
    cognitive_load = payload.get("cognitive_load") or demand["estimated_cognitive_load"]
    ambiguity = payload.get("ambiguity") or "unknown"
    switch_cost = payload.get("switch_cost") or "unknown"
    reentry_cost = payload.get("reentry_cost") or "unknown"
    context_window = payload.get("context_window") or {}
    if not isinstance(context_window, dict):
        context_window = {}
    from ..domain.task import prepare_task_creation

    aggregate = prepare_task_creation(
        task_id=task_id,
        user_id=user_id,
        title=title,
        domain_type=domain_type,
        schedule_type=schedule_type,
        duration_minutes=duration,
        priority=priority,
        status=status,
        context=context,
        context_window=context_window,
        task_demand=demand,
        cognitive_load=cognitive_load,
        ambiguity=ambiguity,
        switch_cost=switch_cost,
        reentry_cost=reentry_cost,
        execution=payload.get("execution"),
        resource_modality=payload.get("resource_modality"),
        attention_mode=payload.get("attention_mode"),
        parallelizable=bool(payload.get("parallelizable", False)),
        expected_difficulty=demand.get("expected_difficulty"),
        week_id=payload.get("week_id") or current_week(timezone_name=payload.get("timezone")),
        timezone_name=payload.get("timezone"),
        start_at=payload.get("start_at"),
        deadline_at=payload.get("deadline_at"),
    )
    context_window = aggregate.context_window
    timestamp = now()
    from ..domain.task import TASK_PROVENANCE_FIELDS, normalize_field_provenance, update_field_provenance

    provenance = normalize_field_provenance(payload.get("field_provenance"), updated_at=timestamp)
    supplied_fields = {
        field for field in TASK_PROVENANCE_FIELDS
        if field in payload
    }
    context_aliases = {
        "progress": ("progress",), "next_step": ("nextStep",),
        "open_questions": ("open_questions",), "dependency": ("dependency",),
    }
    context_fields = {field for field, names in context_aliases.items() if any(name in context_window for name in names)}
    provenance = update_field_provenance(
        provenance, fields=(supplied_fields | context_fields) - provenance.keys(),
        source=str(payload.get("_provenance_source") or "user_input"),
        source_id=payload.get("_provenance_source_id") or create_request_id,
        confidence=payload.get("_provenance_confidence"), updated_at=timestamp,
    )
    provenance = update_field_provenance(
        provenance,
        fields={"title", "task_type", "duration", "priority", "status", "resource_modality", "attention_mode", "parallelizable", "expected_difficulty"} - provenance.keys(),
        source="system_derived", source_id="task_creation_defaults", updated_at=timestamp,
    )
    record = {
        "id": task_id,
        "user_id": user_id,
        "title": title,
        "type": domain_type,
        "deadline_at": deadline,
        "duration": duration,
        "priority": priority,
        "status": status,
        "context": context,
        "context_window_json": encode(context_window),
        "cognitive_load": cognitive_load,
        "ambiguity": ambiguity,
        "switch_cost": switch_cost,
        "reentry_cost": reentry_cost,
        "slot_json": encode(payload.get("slot")),
        "checkpoints_json": encode(payload.get("checkpoints", [])),
        "demand_json": encode(demand),
        "execution_json": encode(aggregate.execution.model_dump()),
        "resource_modality_json": encode(aggregate.resource_modality),
        "attention_mode": aggregate.attention_mode,
        "parallelizable": int(aggregate.parallelizable),
        "expected_difficulty": aggregate.expected_difficulty,
        "week_id": aggregate.week_id,
        "removed_from_week": 0,
        "archived_at": None,
        "create_request_id": create_request_id,
        "field_provenance_json": encode(provenance),
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    with connect() as conn:
        TaskRepository(conn).insert(record)
        PlanRepository(conn).supersede_proposals(user_id=user_id, week_id=aggregate.week_id, timestamp=timestamp)
        PlanRepository(conn).mark_needs_update(user_id=user_id, week_id=aggregate.week_id, timestamp=timestamp)
        ProfileRepository(conn).invalidate_active_revision(user_id=user_id, timestamp=timestamp)
    add_memory(
        user_id=user_id,
        source_type="task",
        source_id=task_id,
        task_id=task_id,
        text=(
            f"Task: {title}. Domain type: {domain_type}. Schedule type: {schedule_type}. "
            f"Context: {context}. Priority: {priority}."
        ),
        metadata={
            "domain_type": domain_type,
            "schedule_type": schedule_type,
            "priority": priority,
            "status": status,
        },
    )
    log_event(user_id, "task_created", {"task_id": task_id, "title": title})
    return get_task(task_id, user_id) or {}
