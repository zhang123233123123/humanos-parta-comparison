"""Stable plan projections and differences, independent of storage and HTTP."""
import hashlib
import json


def decorate_plan_blocks( blocks: list[dict], week_id: str, revision: int, timezone_name: str, *, absolute_times) -> list[dict]:
    decorated: list[dict] = []
    for index, raw in enumerate(blocks):
        block = dict(raw)
        day_index = int(block.get("day_index", 0))
        start = float(block.get("start", 0))
        end = float(block.get("end", 0))
        start_at, end_at = absolute_times(week_id, day_index, start, end, timezone_name)
        block.update({
            "block_id": block.get("block_id") or f"{block.get('task_id')}-r{revision}-{index + 1}",
            "week_id": week_id,
            "plan_revision": revision,
            "start_at": start_at,
            "end_at": end_at,
            "plan_status": "proposed",
        })
        decorated.append(block)
    return decorated

def canonical_plan_snapshot(plan_patch: list[dict]) -> list[dict]:
    """Return a stable, research-safe representation of a plan."""
    fields = (
        "block_id", "task_id", "day_index", "start", "end",
        "session_minutes", "planned_work_minutes", "parallel_group_id",
        "parallel_user_confirmed", "kind", "color",
    )
    canonical = []
    for index, raw in enumerate(plan_patch or []):
        block = {key: raw.get(key) for key in fields if key in raw}
        block["block_id"] = str(raw.get("block_id") or f"{raw.get('task_id') or 'block'}:{index}")
        block["task_id"] = str(raw.get("task_id") or "")
        for key in ("start", "end"):
            if key in block and block[key] is not None:
                block[key] = round(float(block[key]), 4)
        if "day_index" in block and block["day_index"] is not None:
            block["day_index"] = int(block["day_index"])
        canonical.append(block)
    return sorted(canonical, key=lambda item: (item.get("task_id", ""), item.get("block_id", ""), item.get("day_index", -1), item.get("start", -1)))

def plan_hash(plan_patch: list[dict], *, snapshot=canonical_plan_snapshot) -> str:
    raw = json.dumps(snapshot(plan_patch), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def canonical_plan_diff(initial_patch: list[dict], final_patch: list[dict], *, snapshot=canonical_plan_snapshot) -> dict:
    initial = {item["block_id"]: item for item in snapshot(initial_patch)}
    final = {item["block_id"]: item for item in snapshot(final_patch)}
    result = {"unchanged": [], "moved": [], "resized": [], "added": [], "removed": [], "task_metadata_changed": [], "parallel_decision_changed": []}
    for block_id in sorted(initial.keys() | final.keys()):
        before = initial.get(block_id)
        after = final.get(block_id)
        if before is None:
            result["added"].append(after)
            continue
        if after is None:
            result["removed"].append(before)
            continue
        changes = {key for key in before.keys() | after.keys() if before.get(key) != after.get(key)}
        if not changes:
            result["unchanged"].append(after)
            continue
        if changes & {"day_index", "start"}:
            result["moved"].append({"block_id": block_id, "task_id": after.get("task_id"), "before": before, "after": after})
        before_duration = round(float(before.get("end", 0)) - float(before.get("start", 0)), 4)
        after_duration = round(float(after.get("end", 0)) - float(after.get("start", 0)), 4)
        work_size_changed = before_duration != after_duration or before.get("session_minutes") != after.get("session_minutes") or before.get("planned_work_minutes") != after.get("planned_work_minutes")
        if work_size_changed:
            result["resized"].append({"block_id": block_id, "task_id": after.get("task_id"), "before": before, "after": after})
        if changes & {"parallel_group_id", "parallel_user_confirmed"}:
            result["parallel_decision_changed"].append({"block_id": block_id, "task_id": after.get("task_id"), "before": before, "after": after})
        metadata_changes = changes - {"day_index", "start", "end", "session_minutes", "planned_work_minutes", "parallel_group_id", "parallel_user_confirmed"}
        if metadata_changes:
            result["task_metadata_changed"].append({"block_id": block_id, "task_id": after.get("task_id"), "fields": sorted(metadata_changes), "before": before, "after": after})
    result["has_changes"] = any(result[key] for key in result if key not in {"unchanged", "has_changes"})
    result["summary"] = {key: len(value) for key, value in result.items() if isinstance(value, list)}
    return result
