"""Generate pending overlap suggestions without changing the base plan."""
from collections.abc import Callable
from datetime import datetime
import math


def build_parallel_suggestions(state: dict, plan_patch: list[dict], *,
                               clock: Callable[[str], datetime],
                               make_suffix: Callable[[], str]) -> list[dict]:
    """Find safe post-plan overlap opportunities without changing the base plan."""
    try:
        from humanos_graph import build_scheduling_context, day_index_from_due, parse_due_start_hour
    except ModuleNotFoundError:  # package import during unit tests
        from backend.humanos_graph import build_scheduling_context, day_index_from_due, parse_due_start_hour

    analysis = state.get("ai_task_analysis", {})
    pairs = analysis.get("parallel_candidate_pairs") or []
    accepted_task_sets = {
        frozenset({str(pair.get("primary_task_id") or ""), str(pair.get("secondary_task_id") or "")})
        for pair in ((state.get("payload") or {}).get("accepted_parallel_pairs") or [])
        if isinstance(pair, dict) and pair.get("user_confirmed") is True
    }
    accepted_context_sets = {
        frozenset({str(pair.get("primary_context_id") or ""), str(pair.get("secondary_context_id") or "")})
        for pair in ((state.get("payload") or {}).get("accepted_parallel_context_pairs") or [])
        if isinstance(pair, dict) and pair.get("user_confirmed") is True
    }
    tasks = {str(task.get("id")): task for task in state.get("tasks", [])}
    profile = state.get("profile", {})
    now = clock(str(profile.get("timezone") or "Asia/Shanghai"))
    suggestions: list[dict] = []
    task_blocks = [block for block in plan_patch if block.get("kind") == "task_session" and block.get("task_id")]
    planning_context = build_scheduling_context(profile)

    def target_before_deadline(task: dict, day_index: int, end: float) -> bool:
        due_day = day_index_from_due(task.get("deadline_at"), now)
        if due_day is None or day_index > due_day:
            return False
        due_hour = parse_due_start_hour(task.get("deadline_at"))
        return day_index < due_day or due_hour is None or end <= due_hour + 0.001

    for pair_index, pair in enumerate(pairs):
        primary_id = str(pair.get("primary_task_id") or "")
        secondary_id = str(pair.get("secondary_task_id") or "")
        if frozenset({primary_id, secondary_id}) in accepted_task_sets:
            continue
        primary_task = tasks.get(primary_id)
        secondary_task = tasks.get(secondary_id)
        if not primary_task or not secondary_task:
            continue
        requested = max(15, min(45, int(pair.get("suggested_overlap_minutes") or 30)))
        requested = int(round(requested / 15.0) * 15)
        found = None
        # Try both directions because one task's existing Session may provide a
        # safer target before both deadlines.
        for host_id, guest_id in ((primary_id, secondary_id), (secondary_id, primary_id)):
            host_task = tasks[host_id]
            guest_task = tasks[guest_id]
            host_blocks = sorted((block for block in task_blocks if str(block.get("task_id")) == host_id), key=lambda block: (block.get("day_index", 0), block.get("start", 0)))
            guest_blocks = sorted((block for block in task_blocks if str(block.get("task_id")) == guest_id), key=lambda block: (block.get("day_index", 0), block.get("start", 0)))
            for host_block in host_blocks:
                host_minutes = int(host_block.get("session_minutes") or round((float(host_block["end"]) - float(host_block["start"])) * 60))
                for guest_block in guest_blocks:
                    guest_minutes = int(guest_block.get("session_minutes") or round((float(guest_block["end"]) - float(guest_block["start"])) * 60))
                    host_work = int(host_block.get("planned_work_minutes") or host_minutes)
                    guest_work = int(guest_block.get("planned_work_minutes") or guest_minutes)
                    overlap_minutes = min(requested, host_minutes, guest_minutes, host_work, guest_work)
                    overlap_minutes = int(math.floor(overlap_minutes / 15.0) * 15)
                    if overlap_minutes < 15:
                        continue
                    target_end = float(host_block["start"]) + overlap_minutes / 60.0
                    if not target_before_deadline(guest_task, int(host_block["day_index"]), target_end):
                        continue
                    third_conflict = any(
                        other.get("block_id") not in {host_block.get("block_id"), guest_block.get("block_id")}
                        and int(other.get("day_index", -1)) == int(host_block["day_index"])
                        and float(host_block["start"]) < float(other.get("end", 0))
                        and float(other.get("start", 0)) < target_end
                        for other in plan_patch
                    )
                    if third_conflict:
                        continue
                    found = (host_id, guest_id, host_block, guest_block, overlap_minutes, target_end)
                    break
                if found:
                    break
            if found:
                break
        if not found:
            continue
        host_id, guest_id, host_block, guest_block, overlap_minutes, target_end = found
        group_id = f"parallel_group_{pair_index + 1}_{make_suffix()}"
        suggestions.append({
            "id": f"parallel_suggestion_{pair_index + 1}",
            "status": "pending",
            "primary_task_id": host_id,
            "secondary_task_id": guest_id,
            "primary_block_id": host_block.get("block_id"),
            "secondary_block_id": guest_block.get("block_id"),
            "parallel_group_id": group_id,
            "day_index": int(host_block["day_index"]),
            "start": float(host_block["start"]),
            "end": target_end,
            "suggested_overlap_minutes": overlap_minutes,
            "resource_basis": pair.get("resource_basis") or [],
            "confidence_level": pair.get("confidence_level") or "medium",
            "evidence": [*(pair.get("evidence") or []), pair.get("python_rule_reason")],
            "requires_user_confirmation": True,
            "python_validation": {"valid": True, "max_tasks": 2, "deadline_checked": True, "third_party_conflict": False},
        })
    context_blocks = [block for block in planning_context.get("flexible_activity_blocks", []) if block.get("source_type") == "flexible_activity" and block.get("context_id")]
    context_by_id: dict[str, list[dict]] = {}
    for block in context_blocks:
        context_by_id.setdefault(str(block.get("context_id")), []).append(block)
    low_energy_start = parse_due_start_hour(profile.get("low_energy_window")) or 14.0
    high_demand_ready = any(
        str(item.get("level") or "") == "high"
        for item in analysis.get("task_demands") or []
        if isinstance(item, dict)
    )
    for pair_index, pair in enumerate(analysis.get("parallel_context_pairs") or []):
        primary_id = str(pair.get("primary_context_id") or "")
        secondary_id = str(pair.get("secondary_context_id") or "")
        if frozenset({primary_id, secondary_id}) in accepted_context_sets:
            continue
        primary_blocks = context_by_id.get(primary_id, [])
        secondary_blocks = context_by_id.get(secondary_id, [])
        requested = max(15, min(45, int(pair.get("suggested_overlap_minutes") or 30)))
        requested = int(round(requested / 15.0) * 15)
        chosen = None
        for first in primary_blocks:
            for second in secondary_blocks:
                if int(first.get("day_index", -1)) != int(second.get("day_index", -2)):
                    continue
                day = int(first["day_index"])
                first_range = first.get("availability_window") or {"start": first["start"], "end": first["end"]}
                second_range = second.get("availability_window") or {"start": second["start"], "end": second["end"]}
                range_start = max(float(first_range["start"]), float(second_range["start"]))
                range_end = min(float(first_range["end"]), float(second_range["end"]))
                cursor = math.ceil(max(range_start, low_energy_start if high_demand_ready else range_start) * 4) / 4
                while cursor + requested / 60 <= range_end + 0.001:
                    end = cursor + requested / 60
                    conflict = any(
                        int(block.get("day_index", -1)) == day
                        and cursor < float(block.get("end", 0))
                        and float(block.get("start", 0)) < end
                        for block in [*task_blocks, *planning_context.get("hard_constraints", [])]
                    )
                    if not conflict:
                        chosen = (day, cursor, end)
                        break
                    cursor += 0.25
                if chosen:
                    break
            if chosen:
                break
        if not chosen:
            continue
        day, start, end = chosen
        suggestions.append({
            "id": f"context_parallel_suggestion_{pair_index + 1}",
            "kind": "context_activity_pair",
            "status": "pending",
            "primary_context_id": primary_id,
            "secondary_context_id": secondary_id,
            "primary_title": pair.get("primary_title") or "Activity 1",
            "secondary_title": pair.get("secondary_title") or "Activity 2",
            "parallel_group_id": f"parallel_context_{pair_index + 1}_{make_suffix()}",
            "day_index": day,
            "start": start,
            "end": end,
            "suggested_overlap_minutes": requested,
            "resource_basis": pair.get("resource_basis") or [],
            "confidence_level": pair.get("confidence_level") or "medium",
            "evidence": [*(pair.get("evidence") or []), pair.get("python_rule_reason")],
            "requires_user_confirmation": True,
            "python_validation": {"valid": True, "max_tasks": 2, "third_party_conflict": False},
        })
    return suggestions[:3]
