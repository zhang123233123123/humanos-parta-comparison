import type { PlanDecision } from './contracts/planning-contracts'
import type { HumanOSTask } from './contracts/task-contracts'

const minutes = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : null
}

/** All amounts are either returned data or sums of the candidate's work minutes. */
export function candidateDetails(plan: PlanDecision, blockId: string, task?: HumanOSTask) {
  const block = plan.plan_patch.find(b => b.block_id === blockId)
  if (!block) return null
  const work = minutes(block.planned_work_minutes ?? block.session_minutes)
  const blocks = plan.plan_patch.filter(b => b.task_id === block.task_id && b.kind === 'task_session')
    .sort((a, b) => a.day_index - b.day_index || a.start - b.start || a.end - b.end)
  const segmentIndex = blocks.indexOf(block)
  const amounts = blocks.map(b => minutes(b.planned_work_minutes ?? b.session_minutes))
  const unscheduled = plan.unscheduled_tasks?.find(t => t.task_id === block.task_id)
  return { block, work,
    segmentNumber: segmentIndex >= 0 ? segmentIndex + 1 : null,
    segmentCount: segmentIndex >= 0 ? blocks.length : null,
    calendarMinutes: Number.isFinite(block.start) && Number.isFinite(block.end) ? Math.round((block.end - block.start) * 60) : null,
    total: minutes(task?.execution?.original_estimate_minutes ?? task?.duration),
    scheduled: amounts.length && amounts.every(n => n !== null) ? amounts.reduce<number>((sum, n) => sum + n!, 0) : null,
    remaining: minutes(task?.execution?.remaining_duration_minutes),
    unscheduled: minutes(unscheduled?.remaining_minutes),
  }
}
