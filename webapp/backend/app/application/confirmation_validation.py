"""Interpret schedule validation without owning persistence or HTTP responses."""


def require_valid_confirmation(validation: dict) -> None:
    if validation.get("valid"):
        return
    violation_types = {
        item.get("type") for item in validation.get("violations") or []
        if isinstance(item, dict)
    }
    if violation_types & {'replan_scope_conflict', 'replan_scope_stale'}:
        raise ValueError('局部重排范围冲突或原日程已变化。请重新生成；需要调整其他日程时，请明确扩大范围。')
    if "empty_plan_with_active_tasks" in violation_types:
        raise ValueError("当前计划没有任何可执行时间块，不能确认。请先生成至少一个任务安排。")
    if "unexplained_unallocated_work" in violation_types:
        raise ValueError("有任务仍有未安排的剩余时间。请将它加入计划，或明确选择“暂不安排”。")
    raise ValueError("计划未通过时间冲突与工作量约束验证，请返回调整后重试。")
