"""Compatibility task identity/resource descriptions and confirmed overlap gate."""
import re


def normalize_task_identity(value: object) -> str:
    """Normalize exact identity fields without pretending to do semantic deduplication."""
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def schedule_task_kind(task: dict) -> str:
    return str(
        task.get("task_type")
        or task.get("contextWindow", {}).get("taskType")
        or task.get("context_window", {}).get("taskType")
        or "flexible_task"
    )


PARALLEL_RESOURCE_MODALITIES = {"visual", "auditory", "verbal", "motor"}


def normalize_resource_modalities(value: object) -> list[str]:
    from .resource_profile import normalize_resource_tags

    return normalize_resource_tags(value)


def local_resource_profile(task: dict, *, normalize=normalize_resource_modalities) -> dict:
    """Conservative fallback: describe resources, but never auto-create a pair."""
    title = f"{task.get('title', '')} {task.get('context', '')}".lower()
    modalities = normalize(task.get("resource_modality"))
    if not modalities:
        if re.search(r"播客|听力|音频|podcast|audio|listen", title):
            modalities.append("auditory")
        if re.search(r"洗衣|整理房间|打扫|做饭|laundry|clean", title):
            modalities.append("motor")
        if re.search(r"散步|走路|通勤|walk|commut", title):
            modalities.append("motor")
        if re.search(r"阅读|看文献|看视频|read|video", title):
            modalities.append("visual")
        if re.search(r"写|论文|汇报|课程|做题|write|paper|course|assignment", title):
            modalities.append("verbal")
        if re.search(r"分析|研究|复习|编程|设计|analy|research|review|code|design", title):
            modalities.extend(["visual", "verbal"])
        if re.search(r"会议|组会|访谈|电话|meeting|interview|call", title):
            modalities.extend(["auditory", "verbal"])
    modalities = list(dict.fromkeys(modalities))
    attention_mode = str(task.get("attention_mode") or "").strip().lower()
    if attention_mode not in {"continuous", "intermittent", "passive"}:
        attention_mode = "passive" if re.search(r"上传|下载|编译|机器运行|upload|download|compile", title) else "intermittent" if re.search(r"洗衣|整理|打扫|做饭|laundry|clean|cook", title) else "continuous"
    parallelizable = bool(task.get("parallelizable"))
    return {
        "task_id": task.get("id"),
        "resource_modality": modalities,
        "attention_mode": attention_mode,
        "parallelizable": parallelizable,
        "evidence": ["Conservative initial classification from the task title and the user's saved resource types"],
        "confidence_level": "low",
        "source": "local_fallback",
    }


def parallel_pair_rule(primary: dict, secondary: dict, demand_map: dict[str, dict]) -> tuple[bool, str]:
    """Python safety gate for a model-proposed two-task overlap."""
    from .resource_profile import parallel_compatibility

    return parallel_compatibility(primary, secondary)


def confirmed_parallel_overlap_allowed(first: dict, second: dict) -> bool:
    group_id = str(first.get("parallel_group_id") or "")
    if not group_id or group_id != str(second.get("parallel_group_id") or ""):
        return False
    if not first.get("parallel_user_confirmed") or not second.get("parallel_user_confirmed"):
        return False
    task_ids = {str(first.get("task_id") or ""), str(second.get("task_id") or "")}
    declared = {str(item) for item in (first.get("parallel_task_ids") or [])}
    declared.update(str(item) for item in (second.get("parallel_task_ids") or []))
    if len(task_ids) != 2 or not task_ids.issubset(declared):
        return False
    overlap_minutes = max(0, round((min(float(first.get("end", 0)), float(second.get("end", 0))) - max(float(first.get("start", 0)), float(second.get("start", 0)))) * 60))
    allowed = min(int(first.get("allowed_overlap_minutes") or 0), int(second.get("allowed_overlap_minutes") or 0))
    return overlap_minutes > 0 and overlap_minutes <= allowed


def plan_allows_parallel_start(plan: dict, first_block_id: str, second_block_id: str) -> bool:
    plan = plan or {}
    blocks = {str(item.get("block_id")): item for item in (plan.get("plan_patch") or [])}
    first, second = blocks.get(first_block_id), blocks.get(second_block_id)
    if not first or not second:
        return False
    group_id = first.get("parallel_group_id")
    group_task_ids = {
        str(item.get("task_id"))
        for item in blocks.values()
        if item.get("parallel_group_id") == group_id and item.get("parallel_user_confirmed")
    }
    return bool(
        first.get("parallel_user_confirmed")
        and second.get("parallel_user_confirmed")
        and group_id
        and group_id == second.get("parallel_group_id")
        and len(group_task_ids) == 2
    )
