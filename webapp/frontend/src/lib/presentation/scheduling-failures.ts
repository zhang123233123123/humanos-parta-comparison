/** Only recognized public codes become user-facing text; never render raw model diagnostics. */
export function schedulingFailure(code: string, violations: unknown, zh: boolean): string | null {
  const reasons: Record<string, [string, string]> = {
    deadline: ['草案中有工作超过了截止时间。请重新生成；若反复出现，可检查工作量、可用时间或截止时间。', 'Some work in the draft ends after its deadline. Regenerate; if this repeats, review workload, availability or deadlines.'],
    outside_available_window: ['草案中有工作落在可用时间之外。请重新生成，或修改可用时间。', 'Some work falls outside your available hours. Regenerate or update availability.'],
    overlap: ['草案中的安排存在时间重叠。请重新生成或检查已有日历安排。', 'The draft contains overlapping sessions. Regenerate or review existing calendar entries.'],
    hard_constraint_conflict: ['草案与不可占用的时间冲突。请重新生成或核对时间限制。', 'The draft conflicts with protected time. Regenerate or review time constraints.'],
    dependency_order: ['草案没有满足任务的先后依赖关系。请重新生成或检查任务依赖。', 'The draft violates task dependencies. Regenerate or review the dependencies.'],
    hard_dependency_cycle: ['任务依赖形成循环。请修改任务依赖后重新生成。', 'Task dependencies form a cycle. Update them before regenerating.'],
    replan_scope_conflict: ['草案超出了允许调整的范围。请重新生成，或检查安排范围。', 'The draft exceeds the authorized scope. Regenerate or review the scheduling scope.'],
    fixed_commitment_mismatch: ['草案未完整保留固定事项。请刷新日历后重新生成。', 'The draft did not preserve fixed commitments. Refresh the calendar and regenerate.'],
    invalid_time: ['草案中有无效的时间范围。请重新生成。', 'The draft contains an invalid time range. Regenerate.'],
    planned_work_exceeds_remaining: ['草案安排的工作量超过了剩余工作量。请刷新任务后重新生成。', 'Scheduled work exceeds the remaining workload. Refresh tasks and regenerate.'],
    unexplained_unallocated_work: ['草案没有完整交代剩余工作的安排。请重新生成或扩大安排范围。', 'The draft does not account for all remaining work. Regenerate or expand the scheduling scope.'],
  }
  const messages: Record<string, [string, string]> = {
    schedule_stale: ['计划、状态或待安排工作已变化。请刷新后重新生成草案。', 'The plan, state or pending work changed. Refresh and regenerate the draft.'],
    schedule_scope: ['所选工作已开始或不在允许调整的范围内。请刷新并重新选择工作。', 'Selected work has started or is outside the authorized scope. Refresh and select work again.'],
    schedule_empty: ['当前范围内没有可调整的工作。请选择待安排工作或扩大安排范围。', 'There is no adjustable work in this scope. Select pending work or expand the scope.'],
    schedule_generation_unavailable: ['模型暂时未返回可用的调整草案，请稍后重试。', 'The model did not return a usable adjustment. Try again later.'],
    schedule_model_scope: ['生成的草案更改了未授权的工作，已被拒绝。请重新生成。', 'The generated draft changed unauthorized work and was rejected. Regenerate.'],
    schedule_duration: ['草案中的工作段时长不符合原有工作量要求。请重新生成。', 'Draft session durations do not match the required workload. Regenerate.'],
  }
  const index = zh ? 0 : 1
  let message = messages[code]?.[index]
  if (code === 'schedule_constraints') {
    const types = Array.isArray(violations) ? violations.map(v => v && typeof v === 'object' && typeof v.type === 'string' ? v.type : '') : []
    const fallback = zh ? '草案还有未通过的安排约束，请重新生成；若仍失败，请反馈此问题。' : 'The draft failed another scheduling constraint. Regenerate; if it persists, report the issue.'
    message = [...new Set(types.map(type => reasons[type]?.[index] || fallback))].join(' ') || fallback
  }
  if (!message) return null
  return message + (zh ? ' 原计划和待安排工作都没有改变。' : ' Your plan and pending work are unchanged.')
}
