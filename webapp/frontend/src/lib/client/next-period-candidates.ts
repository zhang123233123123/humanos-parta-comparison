import type { PlanDecision } from '@/lib/contracts/planning-contracts'

type Task = { id: string; status: string; week_id?: string; removed_from_week?: boolean; duration?: number; execution?: { remaining_duration_minutes?: number } }

// Queued or unconfirmed is not evidence that this period has no room.
export function nextPeriodCandidates<T extends Task>(tasks: T[], week: string, active: PlanDecision | null, proposed: PlanDecision | null): T[] {
  if (!week) return []
  const currentDraft = proposed?.week_id === week && proposed.plan_status === 'proposed' ? proposed : null
  const plan = currentDraft || (active?.week_id === week ? active : null)
  if (!plan) return []
  const blocked = new Set((plan.unscheduled_tasks || [])
    .filter(item => Number(item.remaining_minutes) > 0 && ['no_feasible_slot', 'no_available_interval', 'no_available_interval_before_deadline'].includes(String(item.reason)))
    .map(item => String(item.task_id)))
  // Whole-task cross-period transfer must not duplicate any placed segment.
  const placed = new Set([...(active?.week_id === week ? active.plan_patch || [] : []), ...(currentDraft?.plan_patch || [])].map(block => block.task_id))
  return tasks.filter(task => task.week_id === week && task.status === 'queued' && !task.removed_from_week && blocked.has(task.id) && !placed.has(task.id) && (task.execution?.remaining_duration_minutes ?? task.duration ?? 0) > 0)
}
