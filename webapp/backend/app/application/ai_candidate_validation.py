"""Validate and score AI candidates without persistence, HTTP or model calls.

Task blocks keep their proposed times. Only approved movable routines may be
projected within their shift windows; rejected candidates remain evidence.
"""
from collections.abc import Callable
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class CandidateValidationPorts:
    build_scheduling_context: Callable
    day_index_from_due: Callable
    parse_due_start_hour: Callable
    profile_now: Callable
    schedule_task_kind: Callable
    confirmed_parallel_overlap_allowed: Callable
    local_resource_profile: Callable
    parallel_pair_rule: Callable


def validate_llm_schedule_candidates(state: dict, decision: dict, llm_result: dict, *, ports: CandidateValidationPorts) -> list[dict]:
    """Turn model-proposed blocks into calendar blocks and reject hard violations.

    DeepSeek chooses the times. Python does not move a proposed block; it only
    checks identifiers, valid time ranges, availability, deadlines and
    conflicts. Invalid candidates remain visible as rejected evidence and are
    never selected.
    """
    profile = state.get("profile", {})
    tasks = state.get("tasks", [])
    task_map = {str(task.get("id")): task for task in tasks}
    context = ports.build_scheduling_context(profile)
    rest_minutes = int(context.get("rest_minutes") or 15)
    # AI candidates may occupy a recurring routine's preferred slot only
    # when the routine can be moved inside its approved shift window. The
    # later routine-adjustment pass chooses and validates that movement.
    validation_windows = context.get("movable_routine_windows") or context.get("full_available_windows") or context["windows"]
    now = ports.profile_now(profile)
    today_index = now.weekday()
    next_quarter = math.ceil((now.hour + now.minute / 60) * 4) / 4
    fixed_blocks = [
        dict(block)
        for block in decision.get("plan_patch", [])
        if block.get("kind") == "fixed_event"
    ]
    demand_map = {
        str(item.get("task_id")): item
        for item in state.get("ai_task_analysis", {}).get("task_demands", [])
        if isinstance(item, dict)
    }
    resource_profile_map = {
        str(item.get("task_id")): item
        for item in state.get("ai_task_analysis", {}).get("task_resource_profiles", [])
        if isinstance(item, dict)
    }
    runtime_state = state.get("runtime_state") or {}
    from ..domain.runtime_observation import capacity_flags
    high_capacity_now, low_capacity_now = capacity_flags(runtime_state)
    accepted_pair_specs = {}
    for pair in ((state.get("payload") or {}).get("accepted_parallel_pairs") or []):
        if not isinstance(pair, dict) or not pair.get("parallel_group_id"):
            continue
        task_ids = {str(pair.get("primary_task_id") or ""), str(pair.get("secondary_task_id") or "")}
        task_ids.discard("")
        if len(task_ids) == 2:
            accepted_pair_specs[str(pair["parallel_group_id"])] = {
                "task_ids": task_ids,
                "allowed_overlap_minutes": max(15, min(45, int(pair.get("suggested_overlap_minutes") or 30))),
                "evidence": pair.get("evidence") or [],
            }
    deep_start = ports.parse_due_start_hour(profile.get("deep_work_window")) or 9.0
    low_start = ports.parse_due_start_hour(profile.get("low_energy_window")) or 14.0
    palette = ["blue", "green", "violet", "gold"]

    def remaining_for(task: dict) -> int:
        saved = (task.get("execution") or {}).get("remaining_duration_minutes")
        raw = int(task.get("duration", 0) if saved is None else saved)
        return max(raw, 0)

    def due_hour_for(task: dict, due_day: int | None) -> float:
        parsed = ports.parse_due_start_hour(task.get("deadline_at"))
        if parsed is not None:
            return parsed
        ends = [window["end"] for window in context["windows"] if window["day_index"] == due_day]
        return max(ends) if ends else 24.0

    validated = []
    raw_candidates = llm_result.get("candidate_plans") if isinstance(llm_result, dict) else []
    for candidate_index, raw_candidate in enumerate(raw_candidates or []):
        if not isinstance(raw_candidate, dict):
            continue
        candidate_id = str(raw_candidate.get("id") or f"ai_candidate_{candidate_index + 1}")
        violations: list[dict] = []
        blocks = [dict(block) for block in fixed_blocks]
        scheduled_work: dict[str, int] = {}
        allocated_capacity: dict[str, int] = {}
        task_session_counts: dict[str, int] = {}
        for raw_block in raw_candidate.get("blocks") or []:
            if not isinstance(raw_block, dict):
                violations.append({"type": "invalid_block", "detail": "block must be an object"})
                continue
            task_id = str(raw_block.get("task_id") or "")
            task = task_map.get(task_id)
            if not task or ports.schedule_task_kind(task) == "fixed_event":
                violations.append({"type": "unknown_or_fixed_task", "task_id": task_id})
                continue
            try:
                day_index = int(raw_block.get("day_index"))
                start = float(raw_block.get("start"))
                end = float(raw_block.get("end"))
            except (TypeError, ValueError):
                violations.append({"type": "invalid_time", "task_id": task_id})
                continue
            if day_index not in range(7) or not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= 24:
                violations.append({"type": "invalid_time", "task_id": task_id})
                continue
            session_minutes = int(round((end - start) * 60))
            if session_minutes <= 0:
                violations.append({"type": "invalid_duration", "task_id": task_id})
                continue
            inside = any(
                window["day_index"] == day_index
                and start >= window["start"] - 0.001
                and end <= window["end"] + 0.001
                for window in validation_windows
            )
            if not inside:
                violations.append({"type": "outside_available_window", "task_id": task_id, "day_index": day_index, "start": start, "end": end})
            if day_index < today_index or (day_index == today_index and start < next_quarter - 0.001):
                violations.append({"type": "past_time", "task_id": task_id})
            due_day = ports.day_index_from_due(task.get("deadline_at"), now)
            due_hour = due_hour_for(task, due_day)
            if str(task.get("deadline_at") or "").strip() and (due_day is None or day_index > due_day or (day_index == due_day and end > due_hour + 0.001)):
                violations.append({"type": "deadline", "task_id": task_id})
            hard_conflict = next(
                (
                    item for item in context["hard_constraints"]
                    if item["day_index"] == day_index and start < item["end"] and item["start"] < end
                ),
                None,
            )
            if hard_conflict:
                violations.append({"type": "hard_constraint_conflict", "task_id": task_id, "constraint": hard_conflict["label"]})
            task_session_counts[task_id] = task_session_counts.get(task_id, 0) + 1
            remaining_before_block = max(remaining_for(task) - scheduled_work.get(task_id, 0), 0)
            planned_work_minutes = min(session_minutes, remaining_before_block)
            scheduled_work[task_id] = scheduled_work.get(task_id, 0) + planned_work_minutes
            allocated_capacity[task_id] = allocated_capacity.get(task_id, 0) + session_minutes
            parallel_group_id = str(raw_block.get("parallel_group_id") or "")
            parallel_fields = {}
            if parallel_group_id:
                accepted = accepted_pair_specs.get(parallel_group_id)
                if not accepted or task_id not in accepted["task_ids"]:
                    violations.append({"type": "unconfirmed_parallel_group", "task_id": task_id, "parallel_group_id": parallel_group_id})
                else:
                    parallel_fields = {
                        "parallel_group_id": parallel_group_id,
                        "parallel_user_confirmed": True,
                        "parallel_task_ids": sorted(accepted["task_ids"]),
                        "allowed_overlap_minutes": accepted["allowed_overlap_minutes"],
                        "parallel_evidence": accepted["evidence"],
                        "parallel_role": str(raw_block.get("parallel_role") or "member"),
                    }
            blocks.append({
                "block_id": f"{task_id}-{candidate_id}-{task_session_counts[task_id]}",
                "task_id": task_id,
                "day_index": day_index,
                "deadline_day_index": due_day,
                "start": start,
                "end": end,
                "color": palette[list(task_map).index(task_id) % len(palette)],
                "kind": "task_session",
                "mode": "execution",
                "session_index": task_session_counts[task_id],
                "session_minutes": session_minutes,
                "planned_work_minutes": planned_work_minutes,
                "padding_minutes": session_minutes - planned_work_minutes,
                "total_task_minutes": remaining_for(task),
                "remaining_after_block_minutes": max(remaining_for(task) - scheduled_work[task_id], 0),
                "constraint_evidence": [
                    "This time block was proposed by the DeepSeek global scheduling prompt.",
                    str(raw_block.get("reason") or "The model did not provide an additional reason."),
                ],
                "capacity_fit": str(raw_block.get("capacity_fit") or "acceptable"),
                "capacity_evidence": [str(item) for item in (raw_block.get("capacity_evidence") or []) if str(item).strip()],
                "capacity_tradeoff": str(raw_block.get("capacity_tradeoff") or "").strip() or None,
                "state_scope": "ai_global_weekly_plan",
                **parallel_fields,
            })

        for day in range(7):
            ordered = sorted((block for block in blocks if block.get("day_index") == day), key=lambda item: item.get("start", 0))
            for index, previous in enumerate(ordered):
                for current in ordered[index + 1:]:
                    if current["start"] >= previous["end"] - 0.001:
                        break
                    if not ports.confirmed_parallel_overlap_allowed(previous, current):
                        violations.append({"type": "overlap", "block_ids": [previous.get("block_id"), current.get("block_id")]})
            task_sessions = [block for block in ordered if block.get("kind") == "task_session"]
            for previous, current in zip(task_sessions, task_sessions[1:]):
                gap_minutes = round((float(current["start"]) - float(previous["end"])) * 60)
                if 0 <= gap_minutes < rest_minutes:
                    violations.append({
                        "type": "insufficient_rest",
                        "block_ids": [previous.get("block_id"), current.get("block_id")],
                        "task_ids": [previous.get("task_id"), current.get("task_id")],
                        "required_rest_minutes": rest_minutes,
                        "actual_rest_minutes": gap_minutes,
                    })

        for group_id, accepted in accepted_pair_specs.items():
            group_blocks = [block for block in blocks if block.get("parallel_group_id") == group_id]
            group_task_ids = {str(block.get("task_id")) for block in group_blocks}
            if group_task_ids != accepted["task_ids"]:
                violations.append({"type": "accepted_parallel_pair_missing", "parallel_group_id": group_id, "expected_task_ids": sorted(accepted["task_ids"])})
                continue
            overlap_minutes = 0
            for first in group_blocks:
                for second in group_blocks:
                    if str(first.get("task_id")) >= str(second.get("task_id")) or first.get("day_index") != second.get("day_index"):
                        continue
                    overlap_minutes += max(0, round((min(first["end"], second["end"]) - max(first["start"], second["start"])) * 60))
            if overlap_minutes <= 0 or overlap_minutes > accepted["allowed_overlap_minutes"]:
                violations.append({"type": "invalid_parallel_overlap_minutes", "parallel_group_id": group_id, "overlap_minutes": overlap_minutes})
            else:
                pair_ids = sorted(accepted["task_ids"])
                first_profile = resource_profile_map.get(pair_ids[0]) or ports.local_resource_profile(task_map[pair_ids[0]])
                second_profile = resource_profile_map.get(pair_ids[1]) or ports.local_resource_profile(task_map[pair_ids[1]])
                rule_ok, rule_reason = ports.parallel_pair_rule(first_profile, second_profile, demand_map)
                if not rule_ok:
                    violations.append({"type": "parallel_resource_conflict", "parallel_group_id": group_id, "detail": rule_reason})

        routine_adjustments: list[dict] = []
        occupied = [
            *blocks,
            *context.get("hard_constraints", []),
            *(item for item in context.get("flexible_activity_blocks", []) if item.get("source_type") != "recurring_routine"),
        ]
        for routine in sorted(context.get("routine_blocks", []), key=lambda item: (item.get("day_index", 0), item.get("start", 0))):
            day = int(routine.get("day_index", -1))
            original_start = float(routine.get("start", 0))
            original_end = float(routine.get("end", original_start))
            duration = original_end - original_start
            task_overlap = any(
                block.get("kind") == "task_session"
                and int(block.get("day_index", -1)) == day
                and float(block.get("start", 0)) < original_end
                and original_start < float(block.get("end", 0))
                for block in blocks
            )
            adjusted = {**routine}
            if task_overlap:
                allowed = routine.get("availability_window") or {"start": original_start, "end": original_end}
                first_start = math.ceil(float(allowed.get("start", original_start)) * 4 - 1e-9) / 4
                last_start = math.floor((float(allowed.get("end", original_end)) - duration) * 4 + 1e-9) / 4
                options: list[float] = []
                cursor = first_start
                while cursor <= last_start + 0.001:
                    options.append(round(cursor, 2))
                    cursor += 0.25
                options.sort(key=lambda value: (abs(value - original_start), value))
                chosen = next((
                    candidate_start for candidate_start in options
                    if all(
                        int(item.get("day_index", -1)) != day
                        or candidate_start + duration <= float(item.get("start", 0)) + 0.001
                        or candidate_start >= float(item.get("end", 0)) - 0.001
                        for item in occupied
                    )
                ), None)
                if chosen is None:
                    violations.append({"type": "routine_conflict_unresolved", "context_id": routine.get("context_id"), "day_index": day})
                else:
                    adjusted["start"] = chosen
                    adjusted["end"] = chosen + duration
                    adjusted["evidence"] = "A DeepSeek-proposed urgent task occupied the preferred routine window; Python selected the nearest conflict-free position within the user-approved adjustment range."
                    routine_adjustments.append({
                        "context_id": routine.get("context_id"),
                        "day_index": day,
                        "start": chosen,
                        "end": chosen + duration,
                        "original_start": original_start,
                        "original_end": original_end,
                        "reason": adjusted["evidence"],
                    })
            occupied.append(adjusted)

        unscheduled = []
        for task_id, task in task_map.items():
            if ports.schedule_task_kind(task) == "fixed_event" or task.get("status") in {"completed", "terminated"}:
                continue
            required = remaining_for(task)
            allocated_work = scheduled_work.get(task_id, 0)
            capacity = allocated_capacity.get(task_id, 0)
            maximum_grid_capacity = int(math.ceil(required / 15) * 15)
            if capacity > maximum_grid_capacity:
                violations.append({"type": "overallocated", "task_id": task_id, "allocated_minutes": capacity, "required_minutes": required})
            if allocated_work < required:
                unscheduled.append({
                    "task_id": task_id,
                    "remaining_minutes": required - allocated_work,
                    "scheduled_minutes": allocated_work,
                    "reason": "The AI candidate did not cover the task's full remaining work duration.",
                })

        task_sessions = [block for block in blocks if block.get("kind") == "task_session"]
        today_sessions = sorted(
            (block for block in task_sessions if int(block.get("day_index", -1)) == today_index),
            key=lambda block: (float(block.get("start", 0)), float(block.get("end", 0))),
        )
        first_today = today_sessions[0] if today_sessions else None
        override_reason = str(raw_candidate.get("override_reason") or "").strip()
        ready_demanding_ids = set()
        for task_id, task in task_map.items():
            due_day = ports.day_index_from_due(task.get("deadline_at"), now)
            if (
                task.get("status") not in {"completed", "terminated"}
                and (demand_map.get(task_id) or {}).get("level") == "high"
                and str(task.get("priority") or "").lower() in {"high", "高", "高优先级"}
                and due_day is not None
                and due_day >= today_index
            ):
                ready_demanding_ids.add(task_id)
        if high_capacity_now and first_today and ready_demanding_ids and str(first_today.get("task_id")) not in ready_demanding_ids and not override_reason:
            violations.append({
                "type": "momentary_state_not_applied",
                "detail": "High current focus must select a ready, important, demanding task first unless a concrete hard-constraint override_reason is supplied.",
                "first_task_id": first_today.get("task_id"),
            })
        first_level = (demand_map.get(str(first_today.get("task_id"))) or {}).get("level") if first_today else None
        if low_capacity_now and first_today and first_level == "high" and int(first_today.get("session_minutes") or 0) > 30 and not override_reason:
            violations.append({
                "type": "momentary_state_not_applied",
                "detail": "Low current capacity requires a shorter checkpoint or a lighter first task unless a concrete override_reason is supplied.",
                "first_task_id": first_today.get("task_id"),
            })
        state_decision = {
                "state_used": {key: runtime_state.get(key) for key in ("focus", "energy", "stress")},
            "affected_decision": "next_session_selection",
            "result": "selected_high_demand_ready_task" if first_today and str(first_today.get("task_id")) in ready_demanding_ids else "selected_lighter_or_shorter_session" if first_today else "no_session_available_today",
            "first_task_id": first_today.get("task_id") if first_today else None,
            "override_reason": override_reason or None,
        }
        counts = {task_id: sum(1 for block in task_sessions if block["task_id"] == task_id) for task_id in task_map}
        for block in task_sessions:
            block["session_count"] = counts.get(block["task_id"], 1)
        fit_scores = []
        from ..domain.capacity import capacity_penalty, validate_capacity_assessment

        capacity_fit_counts = {"ideal": 0, "acceptable": 0, "risky": 0, "unsuitable": 0}
        for block in task_sessions:
            level = (demand_map.get(block["task_id"]) or {}).get("level", "medium")
            preferred = low_start if level == "low" else deep_start
            fit_scores.append(max(0.0, 1.0 - abs(block["start"] - preferred) / 6.0))
            assessment, capacity_violations = validate_capacity_assessment(block)
            block["capacity_fit"] = assessment.level
            block["capacity_evidence"] = list(assessment.evidence)
            block["capacity_tradeoff"] = assessment.tradeoff
            violations.extend(capacity_violations)
            capacity_fit_counts[assessment.level] += 1
        active_flexible_tasks = [
            task for task in task_map.values()
            if task.get("status") not in {"completed", "terminated", "blocked"}
            and ports.schedule_task_kind(task) != "fixed_event"
        ]
        from .workload_balance import eligible_workload_days, workload_balance_metrics

        eligible_days = eligible_workload_days(
            (window.get("day_index", -1) for window in validation_windows),
            (ports.day_index_from_due(task.get("deadline_at"), now) for task in active_flexible_tasks),
            today_index,
        )
        balance_metrics = workload_balance_metrics(task_sessions, eligible_days)
        load_variance = float(balance_metrics["daily_load_variance"])
        ordered_sessions = sorted(task_sessions, key=lambda block: (block["day_index"], block["start"]))
        context_switches = sum(
            1 for previous, current in zip(ordered_sessions, ordered_sessions[1:])
            if previous["day_index"] == current["day_index"] and previous["task_id"] != current["task_id"]
        )
        remaining_total = sum(item["remaining_minutes"] for item in unscheduled)
        cognitive_fit = sum(fit_scores) / len(fit_scores) if fit_scores else 1.0
        candidate_capacity_penalty = capacity_penalty(capacity_fit_counts)
        metrics = {
            "remaining_minutes": remaining_total,
            "deadline_risk_minutes": remaining_total,
            "cognitive_fit_score": round(cognitive_fit, 3),
            "capacity_fit_counts": capacity_fit_counts,
            "capacity_penalty": candidate_capacity_penalty,
            **balance_metrics,
            "context_switch_count": context_switches,
            "fragmentation_score": 0.0,
            "hard_violation_count": len(violations),
            "total_score": round(remaining_total * 1000 + len(violations) * 100000 + candidate_capacity_penalty + (1 - cognitive_fit) * 120 + load_variance * 0.02 + context_switches * 5, 2),
        }
        validated.append({
            "id": candidate_id,
            "label": raw_candidate.get("label") or candidate_id,
            "origin_strategy": "deepseek_global_planner",
            "plan_patch": blocks,
            "unscheduled_tasks": unscheduled,
            "validation": {"valid": not violations, "violations": violations},
            "metrics": metrics,
            "ai_rationale": raw_candidate.get("rationale") or "",
            "routine_adjustments": routine_adjustments,
            "state_decision": state_decision,
        })
    return validated
