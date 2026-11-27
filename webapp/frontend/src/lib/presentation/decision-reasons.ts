/** Stable backend codes -> user explanation + next step. No scheduling logic. */
type Entry = [string, string, string, string]
const timeAction = ['请检查任务时间、截止时间和可用时段，再重新生成。', 'Check task times, deadlines and availability, then regenerate.'] as const
const workAction = ['请核对预计时长和剩余工作量，再重新生成；不要直接删除未安排的工作。', 'Check estimated and remaining work, then regenerate; do not discard unallocated work.'] as const
const retryAction = ['请重新生成安排；若再次出现，请保留诊断信息以便排查。', 'Regenerate the schedule. If this persists, keep the diagnostics for investigation.'] as const
const parallelAction = ['请检查并行许可和资源冲突，或将任务分开执行。', 'Review parallel permission and resource conflicts, or execute separately.'] as const
const entry = (zh: string, en: string, action: readonly [string, string] = retryAction): Entry => [zh, en, ...action]
export const decisionReasons: Record<string, Entry> = {
  replan_scope_conflict: entry('调整超出了本次重排范围，其他日程尚未改变。', 'The edit exceeds this replan scope; other events remain unchanged.', ['请在当前范围内调整，或明确选择扩大重排范围。', 'Adjust within this scope or explicitly choose a broader replan.']),
  replan_scope_stale: entry('原日程或执行状态已变化，这份重排草稿已过期。', 'The schedule or execution state changed; this replan draft is stale.', ['请刷新并重新生成安排。', 'Refresh and regenerate the schedule.']),
  no_available_interval_before_deadline: entry('截止时间前没有足够的可用时段。', 'Not enough available time before the deadline.', timeAction),
  no_available_interval: entry('当前可用时间内没有合适的时段。', 'No suitable slot within the available time.', timeAction),
  deadline: entry('安排超过了任务截止时间。', 'The schedule exceeds the task deadline.', timeAction),
  past_time: entry('安排包含已经过去的时间。', 'The schedule includes time in the past.', timeAction),
  outside_available_window: entry('安排不在设置的可用时段内。', 'The schedule is outside configured availability.', timeAction),
  outside_current_week: entry('所选时间不在当前周内。', 'The selected time is outside the current week.', timeAction),
  overlap: entry('安排中的时间块发生重叠。', 'Scheduled blocks overlap.', timeAction),
  session_overlap: entry('所选时间与已有执行安排冲突。', 'The selected time conflicts with an existing session.', timeAction),
  hard_constraint_conflict: entry('安排与固定事项等不可移动的约束冲突。', 'The schedule conflicts with fixed commitments.', timeAction),
  routine_conflict_unresolved: entry('日常活动与任务之间的冲突尚未解决。', 'A routine/task conflict remains unresolved.', timeAction),
  invalid_time: entry('返回的时间数据无法用于安排。', 'The returned time data cannot be scheduled.'),
  invalid_block: entry('部分时间块的数据不完整或无效。', 'Some schedule blocks are incomplete or invalid.'),
  invalid_or_off_grid_time: entry('时间块格式不正确，或不符合排程时间步长。', 'Block times are invalid or do not match the scheduling grid.'),
  insufficient_rest: entry('相邻任务之间未留足设置要求的休息时间。', 'The configured rest gap between tasks is insufficient.', timeAction),
  session_too_short: entry('执行段短于系统允许的最小长度。', 'A session is shorter than the allowed minimum.'),
  incomplete_coverage: entry('部分任务的剩余工作尚未安排完整。', 'Some remaining task work is not fully scheduled.', workAction),
  unexplained_unallocated_work: entry('仍有工作未安排，且结果没有充分说明。', 'Work remains unallocated without a sufficient explanation.', workAction),
  overallocated: entry('任务被安排的工作量超过了需要。', 'A task has more scheduled work than needed.', workAction),
  planned_work_exceeds_remaining: entry('执行段的计划工作量超过任务剩余工作量。', 'Planned session work exceeds remaining task work.', workAction),
  empty_plan_with_active_tasks: entry('仍有待安排任务，但没有生成时间块。', 'Tasks need scheduling, but no blocks were generated.', workAction),
  hard_dependency_cycle: entry('任务的前置依赖形成循环，需先调整依赖关系。', 'Required task dependencies form a cycle. Review the dependencies.', ['请先修改循环依赖，再重新生成。', 'Resolve the dependency cycle, then regenerate.']),
  hard_dependency_unsatisfied: entry('前置任务尚未安排妥当，暂时无法安排此任务。', 'A required predecessor could not be scheduled.', ['请检查前置任务及其时间要求。', 'Review predecessor tasks and their timing.']),
  dependency_order: entry('任务顺序不符合前置依赖要求。', 'Task order does not satisfy predecessor requirements.', ['请先安排前置任务，再安排后续任务。', 'Schedule required predecessors first.']),
  unknown_task: entry('安排引用了当前无法找到的任务。', 'The schedule references an unavailable task.', ['请刷新任务列表，再重新生成安排。', 'Refresh the task list, then regenerate.']),
  unknown_or_fixed_task: entry('安排引用了未知任务，或把固定事项当成可移动任务。', 'The schedule references an unknown task or treats a fixed event as movable.'),
  inactive_task: entry('安排包含当前不应继续执行的任务。', 'The schedule includes a task that should not currently execute.', ['请核对任务状态后重新生成。', 'Review task status, then regenerate.']),
  unconfirmed_parallel_group: entry('并行安排尚未获得所需确认。', 'The parallel arrangement lacks required confirmation.', parallelAction),
  parallel_group_size: entry('并行组中的任务数量不符合规则。', 'The parallel group size is not supported.', parallelAction),
  parallel_resource_conflict: entry('并行任务占用的资源存在冲突。', 'Parallel tasks have conflicting resource demands.', parallelAction),
  invalid_parallel_overlap_minutes: entry('并行重叠时长不符合规则。', 'The parallel overlap duration is invalid.', parallelAction),
  accepted_parallel_pair_missing: entry('生成结果没有正确保留已确认的并行组合。', 'The result did not retain a confirmed parallel pair.'),
  momentary_state_not_applied: entry('候选安排未满足现有状态适配校验。', 'The candidate did not satisfy the current state-fit check.', ['请复核当日自报和第一执行段，或重新生成建议。', 'Review today’s self-report and first session, or regenerate.']),
  missed_start: entry('原定开始时间已经过去，需要复核安排。', 'The planned start has passed; review the schedule.', timeAction),
  low_energy: entry('你填写的精力较低，可复核接下来的安排。', 'You reported low energy; consider reviewing what comes next.', ['可更新自报、查看调整建议，或保留原计划。', 'Update your report, review suggestions, or keep the plan.']),
  low_focus: entry('你填写的专注较低，可复核下一执行段。', 'You reported low focus; consider reviewing the next session.', ['可更新自报、查看调整建议，或保留原计划。', 'Update your report, review suggestions, or keep the plan.']),
  high_stress: entry('你填写的压力较高，可复核接下来的安排。', 'You reported high stress; consider reviewing what comes next.', ['可更新自报、查看调整建议，或保留原计划。', 'Update your report, review suggestions, or keep the plan.']),
  not_ready: entry('你表示尚不确定能否开始，或需要休息。', 'You reported uncertainty about starting or a need for rest.', ['可以先休息、更新状态，或查看调整建议。', 'Consider a break, update your state, or review suggestions.']),
}

export function decisionReason(code: unknown, locale: string) {
  const key = typeof code === 'string' ? code : ''
  const known = Object.prototype.hasOwnProperty.call(decisionReasons, key) ? decisionReasons[key] : undefined
  const zh = locale === 'zh'
  return {
    known: !!known,
    message: known ? known[zh ? 0 : 1] : (zh ? '系统未返回可读的具体原因，暂时无法确定问题类型。' : 'No readable reason was returned; the issue type is not yet known.'),
    nextStep: known ? known[zh ? 2 : 3] : (zh ? '请先刷新相关记录；如仍出现，请展开诊断信息并反馈，不必反复修改任务。' : 'Refresh the relevant records. If this persists, share the diagnostics rather than repeatedly editing tasks.'),
  }
}
