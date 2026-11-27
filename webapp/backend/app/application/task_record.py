"""Pure projection from a persisted task record to its existing API representation."""
from collections.abc import Callable, Mapping
from typing import Any
from ..domain.task import (TASK_PROVENANCE_FIELDS, normalize_field_provenance,
                           update_field_provenance, normalize_resource_tags)


def project_task_record(row: Mapping[str, Any], *, decode: Callable) -> dict:
    context_window = decode(row["context_window_json"], {})
    # A legacy record without a saved type stays unknown, rather than acquiring
    # a new type merely because it was read.
    schedule_type = context_window.get("taskType")

    provenance = normalize_field_provenance(decode(row["field_provenance_json"], {}), updated_at=int(row["updated_at"] or row["created_at"] or 0))
    legacy_fields = {
        field for field in TASK_PROVENANCE_FIELDS
        if field not in provenance and (
            field in {"title", "task_type", "duration", "priority", "status", "attention_mode", "parallelizable"}
            or (field == "deadline_at" and row['deadline_at'])
            or (field == "context" and row["context"])
            or (field == "resource_modality" and decode(row["resource_modality_json"], []))
            or (field == "expected_difficulty" and row["expected_difficulty"] is not None)
            or (field in {"progress", "next_step", "open_questions", "dependency"} and (context_window.get({"next_step": "nextStep"}.get(field, field))))
        )
    }
    provenance = update_field_provenance(provenance, fields=legacy_fields, source="legacy_persisted", updated_at=int(row["updated_at"] or row["created_at"] or 0))
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "type": row["type"],
        "task_type": schedule_type,
        "deadline_at": row["deadline_at"],
        "timezone": context_window.get("timezone"),
        "start_at": context_window.get("startAt"),
        "schedule_constraints": context_window.get("schedule_constraints"),
        "duration": row["duration"],
        "priority": row["priority"],
        "status": row["status"],
        "context": row["context"],
        "contextWindow": context_window,
        # The task editor's public field is text; structured legacy facts stay
        # in contextWindow and are evaluated there by the execution policy.
        "dependency": context_window.get("dependency") if isinstance(context_window.get("dependency"), str) else None,
        "field_provenance": provenance,
        "cognitive_load": row["cognitive_load"],
        "task_demand": decode(row["demand_json"], {}),
        "energy_demand": decode(row["demand_json"], {}).get('energy_requirement', {}).get('level', 'unknown'),
        "energy_demand_source": decode(row["demand_json"], {}).get('energy_requirement', {}).get('source', 'unknown'),
        "execution": decode(row["execution_json"], {}),
        "resource_modality": normalize_resource_tags(decode(row["resource_modality_json"], [])),
        "attention_mode": str(row["attention_mode"] or "continuous"),
        "parallelizable": bool(row["parallelizable"]),
        "expected_difficulty": row["expected_difficulty"],
        "ambiguity": row["ambiguity"],
        "switch_cost": row["switch_cost"],
        "reentry_cost": row["reentry_cost"],
        "slot": decode(row["slot_json"], None),
        "checkpoints": decode(row["checkpoints_json"], []),
        "week_id": row["week_id"],
        "removed_from_week": bool(row["removed_from_week"]),
        "archived_at": row["archived_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
