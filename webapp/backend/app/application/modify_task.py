"""Task modification use case; no HTTP, Store, or model implementation imports."""
from collections.abc import Callable
from contextlib import AbstractContextManager
import sqlite3
from ..domain.task import normalize_resource_tags
from ..repositories.tasks import TaskRepository
from ..repositories.plans import PlanRepository
from ..repositories.profiles import ProfileRepository


def modify_task(task_id: str, patch: dict, user_id: str, *,
                get_task: Callable, ensure_profile: Callable,
                separate_history: Callable, current_week: Callable, now: Callable,
                connect: Callable[[], AbstractContextManager[sqlite3.Connection]],
                encode: Callable, decode: Callable, log_event: Callable) -> dict:
    current = get_task(task_id, user_id)
    if not current:
        raise KeyError(task_id)
    from ..domain.task.write_fields import normalize_task_write, with_reported_difficulty
    patch = normalize_task_write(patch)
    from ..domain.task.duration import require_task_duration
    if 'duration' in patch:
        require_task_duration(patch['duration'])
    if 'title' in patch:
        from ..domain.task.legacy_inference import clean_task_title
        patch['title'] = clean_task_title(patch['title'])
    provenance_source = str(patch.pop("_provenance_source", "system_derived"))
    provenance_source_id = patch.pop("_provenance_source_id", None)
    provenance_confidence = patch.pop("_provenance_confidence", None)
    from ..domain.task import TASK_PROVENANCE_FIELDS, require_valid_attention_mode, require_valid_resource_tags, update_field_provenance

    if "resource_modality" in patch:
        require_valid_resource_tags(patch.get("resource_modality"))
    if "attention_mode" in patch:
        require_valid_attention_mode(patch.get("attention_mode"))
    from ..domain.task import decide_task_patch, status_after_schedule_change

    decision = decide_task_patch(current, patch)
    patch = decision.patch
    schedule_changed = decision.schedule_changed
    allowed = {
        "title",
        "type",
        "deadline_at",
        "duration",
        "priority",
        "status",
        "context",
        "cognitive_load",
        "ambiguity",
        "switch_cost",
        "reentry_cost",
        "expected_difficulty",
    }
    updates: dict[str, object] = {k: v for k, v in patch.items() if k in allowed}
    if "expected_difficulty" in patch and "task_demand" not in patch:
        updates["demand_json"] = encode(with_reported_difficulty(current.get("task_demand") or {}, patch))
    if "slot" in patch:
        updates["slot_json"] = encode(patch["slot"])
    if "checkpoints" in patch:
        updates["checkpoints_json"] = encode(patch["checkpoints"])
    if decision.context_window is not None:
        updates["context_window_json"] = encode(decision.context_window)
    if "task_demand" in patch:
        updates["demand_json"] = encode(with_reported_difficulty(patch["task_demand"], patch))
    if 'demand_json' in updates or 'energy_demand' in patch:
        from ..domain.task_energy import energy_requirement
        demand = decode(updates.get('demand_json'), {}) if 'demand_json' in updates else dict(current.get('task_demand') or {})
        demand['energy_requirement'] = energy_requirement(patch['energy_demand']) if 'energy_demand' in patch else (current.get('task_demand') or {}).get('energy_requirement', energy_requirement(None))
        updates['demand_json'] = encode(demand)
    if "execution" in patch:
        updates["execution_json"] = encode(patch["execution"])
    if "resource_modality" in patch:
        updates["resource_modality_json"] = encode(normalize_resource_tags(patch["resource_modality"]))
    if "attention_mode" in patch:
        from ..domain.task import normalize_attention_mode

        updates["attention_mode"] = normalize_attention_mode(patch["attention_mode"])
    if "parallelizable" in patch:
        updates["parallelizable"] = int(bool(patch["parallelizable"]))
    if schedule_changed:
        profile = ensure_profile(user_id)
        week_id = str(current.get("week_id") or profile.get("active_week_id") or current_week(timezone_name=profile.get("timezone")))
        execution = dict(patch.get("execution") or current.get("execution") or {})
        history, _future = separate_history(current, week_id, profile.get("timezone") or "Asia/Shanghai")
        known = list(execution.get("history_sessions") or [])
        keys = {str(item.get("block_id")) for item in known if item.get("block_id")}
        known.extend(item for item in history if not item.get("block_id") or str(item.get("block_id")) not in keys)
        execution["history_sessions"] = known
        if decision.duration_changed:
            actual = int(execution.get("accumulated_actual_minutes") or 0)
            execution["original_estimate_minutes"] = int(patch.get("duration") or current.get("duration") or 0)
            execution["remaining_duration_minutes"] = max(execution["original_estimate_minutes"] - actual, 0)
        updates["execution_json"] = encode(execution)
        updates["slot_json"] = encode(None)
        # A caller-provided lifecycle result (for example execution
        # feedback marking a Task completed) is authoritative. Do not
        # overwrite it merely because the same patch also calibrates Task
        # Demand and therefore affects future scheduling.
        next_status = status_after_schedule_change(current.get("status") or "queued", patch.get("status"))
        if next_status is not None:
            updates["status"] = next_status
    updated_at = now()
    provenance_fields = {field for field in TASK_PROVENANCE_FIELDS if field in patch}
    if "context_window" in patch:
        window = patch.get("context_window") or {}
        if isinstance(window, dict):
            aliases = {
                "progress": ("progress",), "next_step": ("nextStep",),
                "open_questions": ("open_questions",), "dependency": ("dependency",),
            }
            for field, names in aliases.items():
                if any(name in window for name in names):
                    provenance_fields.add(field)
    updates["field_provenance_json"] = encode(update_field_provenance(
        current.get("field_provenance"), fields=provenance_fields,
        source=provenance_source, source_id=provenance_source_id,
        confidence=provenance_confidence, updated_at=updated_at,
    ))
    updates["updated_at"] = updated_at
    with connect() as conn:
        TaskRepository(conn).update_fields(task_id=task_id, user_id=user_id, updates=updates)
        if schedule_changed:
            PlanRepository(conn).mark_needs_update(user_id=user_id,
                week_id=current.get("week_id") or week_id, timestamp=updated_at)
            ProfileRepository(conn).invalidate_active_revision(user_id=user_id, timestamp=updated_at)
    log_event(current["user_id"], "task_updated", {"task_id": task_id, "patch": patch})
    return get_task(task_id, user_id) or {}
