"""Weekly setup coordination preserving one connection transaction."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.weekly_reconciliation import WeeklyReconciliationRepository
from ..domain.task.duration import require_task_duration
from ..domain.task.write_fields import normalize_task_write, with_reported_difficulty


@dataclass(frozen=True)
class WeeklyReconciliationPorts:
    ensure_profile: Callable
    current_week: Callable
    clock_now: Callable
    safe_timezone: Callable
    now: Callable
    connect: Callable
    task_row: Callable
    _weekly_change_scope: Callable
    _task_change_scope: Callable
    _separate_session_history: Callable
    clean_task_title: Callable
    encode: Callable
    make_id: Callable
    infer_task_type: Callable
    infer_schedule_task_type: Callable
    infer_task_demand: Callable


def reconcile_weekly_setup(user_id: str, payload: dict, *, ports: WeeklyReconciliationPorts) -> dict:
    """Atomically reconcile Profile + Weekly Context + Tasks + Plan state.

    Task identity is exclusively the persisted ``task_id``.  Title and
    deadline are editable properties and are never used as identity keys.
    """
    profile_patch = dict(payload.get("profile") or {})
    submitted = [normalize_task_write(item) for item in (payload.get("tasks") or []) if str(item.get("title") or "").strip()]
    current_profile = ports.ensure_profile(user_id)
    timezone_name = str(profile_patch.get("timezone") or current_profile.get("timezone") or "Asia/Shanghai")
    week_id = str(payload.get("week_id") or (profile_patch.get("weekly_context") or {}).get("week_id") or current_profile.get("active_week_id") or ports.current_week(timezone_name=timezone_name))
    now = ports.clock_now(ports.safe_timezone(timezone_name))
    timestamp = ports.now()
    created_ids: list[str] = []
    updated_ids: list[str] = []
    archived_ids: list[str] = []
    invalidated_ids: set[str] = set()
    task_changes: dict[str, list[str]] = {}

    with ports.connect() as conn:
        rows = WeeklyReconciliationRepository(conn).tasks(*(user_id,))
        existing = {str(row["id"]): ports.task_row(row) for row in rows}
        existing_by_request_id = {
            str(row["create_request_id"]): str(row["id"])
            for row in rows if row["create_request_id"]
        }
        old_weekly = dict(current_profile.get("weekly_context") or {})
        from ..domain.profile import sanitize_weekly_context, validate_context_items

        # Omitted fields retain their persisted constraints. An explicitly
        # supplied empty list still clears that field at the user's request.
        new_weekly = sanitize_weekly_context({**old_weekly, **(profile_patch.get("weekly_context") or {})})
        validate_context_items(new_weekly)
        new_weekly["week_id"] = week_id
        new_weekly["week_of"] = week_id
        weekly_scope = ports._weekly_change_scope(old_weekly, new_weekly)

        submitted_ids = {str(item.get("id")) for item in submitted if item.get("id")}
        active_this_week = {
            task_id for task_id, task in existing.items()
            if str(task.get("week_id") or current_profile.get("active_week_id") or week_id) == week_id
            and not task.get("removed_from_week")
            and task.get("status") not in {"completed", "terminated"}
        }

        for draft in submitted:
            task_id = str(draft.get("id") or "").strip()
            request_id = str(draft.get("request_id") or "").strip()
            if not task_id and request_id:
                task_id = existing_by_request_id.get(request_id, "")
            if task_id:
                if task_id not in existing:
                    raise ValueError(f"Unknown task_id: {task_id}")
                before = existing[task_id]
                duration = require_task_duration(draft.get('duration', before.get('duration')))
                from ..domain.task.update import decide_task_patch
                decision = decide_task_patch(before, draft)
                draft = decision.patch
                if before.get("user_id") != user_id:
                    raise PermissionError("task does not belong to this user")
                # Replayed onboarding drafts identify the persisted task through
                # create_request_id rather than an explicit database ID.
                submitted_ids.add(task_id)
                scope = ports._task_change_scope(before, draft)
                task_changes[task_id] = sorted(scope)
                reschedule_fields = scope & {
                    "task_type", "start_at",
                    "deadline_at", "duration", "priority", "expected_difficulty",
                    "cognitive_load", "task_demand", "dependency",
                    "schedule_constraints",
                }
                execution = dict(before.get("execution") or {})
                history, _future = ports._separate_session_history(before, week_id, timezone_name, now)
                known_history = list(execution.get("history_sessions") or [])
                known_ids = {str(item.get("block_id")) for item in known_history if item.get("block_id")}
                known_history.extend(item for item in history if not item.get("block_id") or str(item.get("block_id")) not in known_ids)
                execution["history_sessions"] = known_history
                if "duration" in scope:
                    actual = int(execution.get("accumulated_actual_minutes") or 0)
                    execution["original_estimate_minutes"] = int(draft.get("duration") or before.get("duration") or 0)
                    execution["remaining_duration_minutes"] = max(execution["original_estimate_minutes"] - actual, 0)
                else:
                    execution.setdefault("remaining_duration_minutes", int(before.get("duration") or 0))

                context_window = dict(before.get("contextWindow") or {})
                if decision.context_window is not None:
                    context_window = decision.context_window
                if "dependency" in draft:
                    context_window["dependency"] = draft.get("dependency")

                demand = with_reported_difficulty(draft.get("task_demand") or before.get("task_demand") or {}, draft)
                values = {
                    "title": ports.clean_task_title(draft.get("title", before.get("title"))),
                    "deadline_at": draft.get("deadline_at", before.get("deadline_at")),
                    "duration": duration,
                    "priority": draft.get("priority", before.get("priority")),
                    "context": draft.get("context", before.get("context")),
                    "cognitive_load": draft.get("cognitive_load", before.get("cognitive_load")),
                    "expected_difficulty": draft.get("expected_difficulty", before.get("expected_difficulty")),
                    "context_window_json": ports.encode(context_window),
                    "demand_json": ports.encode(demand),
                    "execution_json": ports.encode(execution),
                    "week_id": week_id,
                    "removed_from_week": 0,
                    "archived_at": None,
                    "updated_at": timestamp,
                }
                if reschedule_fields:
                    values["slot_json"] = ports.encode(None)
                    values["status"] = "queued" if execution.get("remaining_duration_minutes", 0) > 0 else "completed"
                    invalidated_ids.add(task_id)
                WeeklyReconciliationRepository(conn).update_task(task_id, user_id, values)
                updated_ids.append(task_id)
                continue

            task_id = ports.make_id("task")
            title = ports.clean_task_title(draft.get("title"))
            duration = require_task_duration(draft.get("duration"))
            context = str(draft.get("context") or "")
            domain_type = draft.get("type") or ports.infer_task_type(title, context)
            schedule_type = ports.infer_schedule_task_type({**draft, "title": title, "context": context})
            from ..domain.task.schedule_type import validate_task_deadline
            validate_task_deadline(schedule_type, draft.get("deadline_at"))
            demand = with_reported_difficulty(draft.get("task_demand") or ports.infer_task_demand(draft, domain_type), draft)
            context_window = dict(draft.get("context_window") or {})
            context_window.update({
                "taskType": schedule_type,
                "startAt": draft.get("start_at") or context_window.get("startAt"),
                "dependency": draft.get("dependency", context_window.get("dependency")),
            })
            from ..domain.task.creation import prepare_task_creation
            aggregate = prepare_task_creation(task_id=task_id, user_id=user_id, title=title,
                domain_type=domain_type, schedule_type=schedule_type, duration_minutes=duration,
                priority=draft.get('priority') or '中', status='queued', context=context,
                context_window=context_window, task_demand=demand,
                cognitive_load=draft.get('cognitive_load') or demand.get('estimated_cognitive_load') or 'unknown',
                ambiguity=draft.get('ambiguity') or 'unknown', switch_cost=draft.get('switch_cost') or 'unknown',
                reentry_cost=draft.get('reentry_cost') or 'unknown', execution=None,
                resource_modality=draft.get('resource_modality'), attention_mode=draft.get('attention_mode'),
                parallelizable=bool(draft.get('parallelizable')), expected_difficulty=draft.get('expected_difficulty'),
                week_id=week_id, timezone_name=timezone_name, start_at=draft.get('start_at'),
                deadline_at=draft.get('deadline_at'))
            context_window = aggregate.context_window
            execution = {
                "original_estimate_minutes": duration,
                "accumulated_actual_minutes": 0,
                "remaining_duration_minutes": duration,
                "progress_percent": 0,
                "sessions": [],
                "history_sessions": [],
            }
            WeeklyReconciliationRepository(conn).insert_task(*(
                    task_id,user_id,title,domain_type,draft.get("deadline_at"),duration,aggregate.priority,"queued",context,
                    ports.encode(context_window),draft.get("cognitive_load") or demand.get("estimated_cognitive_load") or "unknown",
                    draft.get("ambiguity") or "unknown",draft.get("switch_cost") or "unknown",draft.get("reentry_cost") or "unknown",
                    ports.encode(None),ports.encode(draft.get("checkpoints") or []),ports.encode(demand),ports.encode(execution),
                    ports.encode(draft.get("resource_modality") or []),int(bool(draft.get("parallelizable"))),
                    draft.get("expected_difficulty") or demand.get("expected_difficulty"),week_id,0,None,
                    request_id or None,timestamp,timestamp,
                ))
            created_ids.append(task_id)
            invalidated_ids.add(task_id)
            task_changes[task_id] = ["created"]

        for task_id in sorted(active_this_week - submitted_ids):
            task = existing[task_id]
            execution = dict(task.get("execution") or {})
            history, _future = ports._separate_session_history(task, week_id, timezone_name, now)
            known = list(execution.get("history_sessions") or [])
            known_keys = {str(item.get("block_id")) for item in known if item.get("block_id")}
            known.extend(item for item in history if not item.get("block_id") or str(item.get("block_id")) not in known_keys)
            execution["history_sessions"] = known
            WeeklyReconciliationRepository(conn).archive_task(*(timestamp, ports.encode(None), ports.encode(execution), timestamp, task_id, user_id))
            archived_ids.append(task_id)
            invalidated_ids.add(task_id)

        if weekly_scope:
            for task_id, task in existing.items():
                if task_id in submitted_ids and task.get("status") not in {"completed", "terminated"}:
                    # Available-window/fixed-event/routine/buffer changes may
                    # invalidate any future unstarted session.  Preserve only
                    # elapsed history and return the task to Ready.
                    execution = dict(task.get("execution") or {})
                    history, future = ports._separate_session_history(task, week_id, timezone_name, now)
                    if future:
                        known = list(execution.get("history_sessions") or [])
                        known_keys = {str(item.get("block_id")) for item in known if item.get("block_id")}
                        known.extend(item for item in history if not item.get("block_id") or str(item.get("block_id")) not in known_keys)
                        execution["history_sessions"] = known
                        WeeklyReconciliationRepository(conn).invalidate_task(*(ports.encode(None), ports.encode(execution), timestamp, task_id, user_id))
                        invalidated_ids.add(task_id)

        profile_data = {
            "role": profile_patch.get("role", current_profile.get("role")),
            "deep_work_window": profile_patch.get("deep_work_window", current_profile.get("deep_work_window")),
            "low_energy_window": profile_patch.get("low_energy_window", current_profile.get("low_energy_window")),
            "control_preference": profile_patch.get("control_preference", current_profile.get("control_preference")),
            "blocker_patterns": profile_patch.get("blocker_patterns", current_profile.get("blocker_patterns", [])),
            "task_preferences": profile_patch.get("task_preferences", current_profile.get("task_preferences", {})),
            "learned_patterns": profile_patch.get("learned_patterns", current_profile.get("learned_patterns", [])),
        }
        WeeklyReconciliationRepository(conn).update_profile(*(
                profile_data["role"],profile_data["deep_work_window"],profile_data["low_energy_window"],
                profile_data["control_preference"],ports.encode(profile_data["blocker_patterns"]),
                ports.encode(profile_data["task_preferences"]),ports.encode(new_weekly),ports.encode(profile_data["learned_patterns"]),
                timezone_name,week_id,timestamp,user_id,
            ))

        needs_replan = bool(invalidated_ids or weekly_scope)
        if needs_replan:
            WeeklyReconciliationRepository(conn).invalidate_confirmed(*(timestamp, user_id, week_id))
            WeeklyReconciliationRepository(conn).supersede_proposed(*(timestamp, user_id, week_id))
            WeeklyReconciliationRepository(conn).clear_revision(*(user_id,))
        WeeklyReconciliationRepository(conn).record_event(*(
                ports.make_id("evt"),user_id,"weekly_setup_reconciled",
                ports.encode({"week_id": week_id,"created": created_ids,"updated": updated_ids,"archived": archived_ids,"invalidated": sorted(invalidated_ids),"weekly_scope": sorted(weekly_scope)}),timestamp,
            ))

    return {
        "task_diff": {"created": created_ids,"updated": updated_ids,"archived": archived_ids,"changes": task_changes},
        "invalidated_task_ids": sorted(invalidated_ids),
        "plan_needs_update": bool(invalidated_ids or weekly_scope),
        "message": "Your task information changed. The current plan needs an update." if invalidated_ids or weekly_scope else "Weekly information saved without changing the current plan.",
        "week_id": week_id,
        "resources": {
            "profile": "/api/profile",
            "tasks": "/api/tasks",
            "active_plan": f"/api/plans/active?week_id={week_id}",
        },
    }
