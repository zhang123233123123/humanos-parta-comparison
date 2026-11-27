"""Aggregate QA diagnostics behind the account capability gate."""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..repositories.account_diagnostics import AccountDiagnosticsRepository


@dataclass(frozen=True)
class DeveloperSnapshotPorts:
    account_capabilities: Callable
    ensure_profile: Callable
    user_row: Callable
    active_plan: Callable
    list_tasks: Callable
    list_execution_sessions: Callable
    connect: Callable
    decode: Callable
    user_clock_now: Callable
    latest_runtime_state: Callable


def developer_snapshot(identity: str, *, ports: DeveloperSnapshotPorts) -> dict:
    if not ports.account_capabilities(identity).get("qa_tools"):
        raise PermissionError("developer snapshot is available to test accounts only")
    profile = ports.ensure_profile(identity)
    user = ports.user_row(identity)
    user_id = str(user["email"] if user else identity)
    active_plan = ports.active_plan(user_id)
    tasks = ports.list_tasks(user_id)
    sessions = ports.list_execution_sessions(user_id)
    task_ids = {str(task.get("id")) for task in tasks}
    active_revision = profile.get("active_plan_revision")
    issues = []
    active_statuses = {"ready", "running", "paused"}
    for session in sessions:
        session_id = session.get("execution_session_id")
        if session.get("status") in active_statuses and active_revision is not None and session.get("plan_revision") != active_revision:
            issues.append({"severity": "error", "code": "session_revision_mismatch", "entity_type": "execution_session", "entity_id": session_id, "message": f"Active Session revision {session.get('plan_revision')} differs from profile revision {active_revision}."})
        if str(session.get("task_id")) not in task_ids:
            issues.append({"severity": "error", "code": "orphan_execution_session", "entity_type": "execution_session", "entity_id": session_id, "message": "Execution Session references a missing Task."})
    active_by_task: dict[str, list[dict]] = {}
    for session in sessions:
        if session.get("status") in active_statuses:
            active_by_task.setdefault(str(session.get("task_id")), []).append(session)
    for task_id, rows in active_by_task.items():
        if len(rows) > 1:
            issues.append({"severity": "warning", "code": "duplicate_active_task_sessions", "entity_type": "task", "entity_id": task_id, "message": f"Task has {len(rows)} active Sessions across revisions."})
    for task in tasks:
        slot = task.get("slot") or {}
        slot_revision = slot.get("plan_revision") if isinstance(slot, dict) else None
        if slot_revision is not None and active_revision is not None and slot_revision != active_revision and task.get("status") not in {"completed", "terminated"}:
            issues.append({"severity": "warning", "code": "task_slot_revision_mismatch", "entity_type": "task", "entity_id": task.get("id"), "message": f"Task slot revision {slot_revision} differs from profile revision {active_revision}."})
    with ports.connect() as conn:
        plan_rows = AccountDiagnosticsRepository(conn).plans(user_id)
        event_rows = AccountDiagnosticsRepository(conn).events(user_id)
        edit_rows = AccountDiagnosticsRepository(conn).edits(user_id)
        transition_rows = AccountDiagnosticsRepository(conn).transitions(user_id)
        projection_failure_rows = AccountDiagnosticsRepository(conn).failures(user_id)
    plans = []
    for row in plan_rows:
        plan = ports.decode(row["plan_json"], {})
        plan.update({"plan_id": row["id"], "week_id": row["week_id"], "plan_revision": row["plan_revision"], "plan_status": row["plan_status"], "created_at": row["created_at"], "updated_at": row["updated_at"], "confirmed_at": row["confirmed_at"]})
        plans.append(plan)
    events = [{"id": row["id"], "type": row["type"], "payload": ports.decode(row["payload_json"], {}), "created_at": row["created_at"]} for row in event_rows]
    plan_edits = [{key: ports.decode(row[key], {}) if key in {"before_json", "after_json", "validation_result_json"} else row[key] for key in row.keys()} for row in edit_rows]
    state_transitions = [{key: ports.decode(row[key], {}) if key in {"before_state_json", "action_json", "predicted_state_json", "actual_state_json", "outcome_json"} else row[key] for key in row.keys()} for row in transition_rows]
    return {
        "view": {
            "kind": "qa_aggregate_snapshot",
            "read_only": True,
            "ordinary_user_visible": False,
            "aggregate_roots": ["profile", "task"],
            "coordination_records": ["plans", "execution_sessions"],
            "evidence_records": ["events", "plan_edit_events", "state_transitions", "behavior_events", "evidence_items"],
        },
        "generated_at": ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai").isoformat(),
        "account": {"email": user_id, "account_type": "test"},
        "profile": profile,
        "active_plan": active_plan,
        "plans": plans,
        "tasks": tasks,
        "execution_sessions": sessions,
        "latest_runtime_state": ports.latest_runtime_state(user_id),
        "events": events,
        "plan_edit_events": plan_edits,
        "state_transitions": state_transitions,
        "personalization_projection_failures": [dict(row) for row in projection_failure_rows],
        "diagnostics": {"healthy": not issues, "issue_count": len(issues), "issues": issues},
    }
