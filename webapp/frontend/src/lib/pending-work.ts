import type { PlanDecision } from './contracts/planning-contracts'
import type { CandidateWork } from './interaction/contracts'

/** Unknown amounts remain unknown; an explicitly empty string is not zero. */
export function pendingMinutes(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

/** The same returned records drive both the list and its badge. */
export function pendingWork(
  unscheduled: PlanDecision['unscheduled_tasks'] | undefined,
  candidates: CandidateWork[] | null | undefined,
) {
  const hasRemainingWork = (value: unknown) => {
    const amount = pendingMinutes(value)
    return amount === null || amount > 0
  }
  const unscheduledItems = (unscheduled || []).filter(item => hasRemainingWork(item.remaining_minutes))
  const candidateItems = (candidates || []).filter(item => item.status === 'pending' && hasRemainingWork(item.remaining_minutes))
  return {
    unscheduled: unscheduledItems,
    candidates: candidateItems,
    count: unscheduledItems.length + candidateItems.length,
  }
}


/** A saved task without a returned scheduled block belongs in the pending list. */
export function pendingSavedTasks(
  tasks: import('./contracts/task-contracts').HumanOSTask[],
  sessions: Array<{ task_id?: string; status?: string }>,
  plan: PlanDecision | null,
  retained: CandidateWork[] | null | undefined,
) {
  const represented = new Set([
    ...(plan?.plan_patch || []).map(block => String(block.task_id || '')),
    ...(plan?.unscheduled_tasks || []).map(item => String(item.task_id || '')),
    ...(retained || []).filter(item => item.status === 'pending').map(item => item.original_task_id),
    ...sessions.filter(item => !['superseded', 'cancelled'].includes(String(item.status || '').toLowerCase())).map(item => String(item.task_id || '')),
  ])
  return tasks.filter(task => {
    const id = String(task.id || ''), status = String(task.status || 'queued').toLowerCase()
    return id && !task.is_preview && !id.startsWith('preview-') && !represented.has(id)
      && !['completed', 'terminated', 'removed_from_week'].includes(status)
      && !['fixed_event', 'recurring_routine', 'flexible_activity'].includes(String(task.task_type || task.type || ''))
  })
}
