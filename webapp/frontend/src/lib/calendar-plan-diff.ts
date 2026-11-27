import type { PlanBlock, PlanDecision } from '@/lib/contracts/planning-contracts'
import { draftInstant } from '@/lib/calendar-draft-time'

function instant(block: PlanBlock, side: 'start' | 'end', week: string, timezone: string) {
  const explicit = block[`${side}_at`]
  if (typeof explicit === 'string' && Number.isFinite(Date.parse(explicit))) return Date.parse(explicit)
  try { return Date.parse(draftInstant(week, block.day_index, block[side], timezone)) }
  catch { return JSON.stringify([week, block.day_index, block[side]]) }
}

function scheduleKey(block: PlanBlock, plan: PlanDecision, timezone: string) {
  const group = block.parallel_group_id
  // Group IDs can be regenerated. Compare who overlaps and their roles instead.
  const peers = group ? plan.plan_patch.filter(other => other.parallel_group_id === group)
    .map(other => [other.task_id, other.parallel_role || '', instant(other, 'start', plan.week_id || '', timezone), instant(other, 'end', plan.week_id || '', timezone)].join('|')).sort() : []
  return JSON.stringify([
    block.task_id, block.kind || 'task_session',
    instant(block, 'start', plan.week_id || '', timezone), instant(block, 'end', plan.week_id || '', timezone),
    block.planned_work_minutes ?? block.session_minutes ?? null,
    Boolean(group), block.parallel_role || '', peers,
  ])
}

/** One-to-one matching prevents duplicate new sessions borrowing an old session's state. */
export function changedPlanBlocks(plan: PlanDecision, base: PlanDecision | null, timezone: string): boolean[] {
  if (!base) return plan.plan_patch.map(() => true)
  const baseKeys = base.plan_patch.map(block => scheduleKey(block, base, timezone))
  const nextKeys = plan.plan_patch.map(block => scheduleKey(block, plan, timezone))
  const consumed = new Set<number>()
  const changed: Array<boolean | undefined> = plan.plan_patch.map(() => undefined)
  plan.plan_patch.forEach((block, index) => {
    const original = block.block_id ? base.plan_patch.findIndex((other, i) => !consumed.has(i) && other.block_id === block.block_id) : -1
    if (original < 0) return
    consumed.add(original)
    changed[index] = nextKeys[index] !== baseKeys[original]
  })
  return plan.plan_patch.map((_, index) => {
    if (changed[index] !== undefined) return changed[index]!
    const original = baseKeys.findIndex((key, i) => !consumed.has(i) && key === nextKeys[index])
    if (original < 0) return true
    consumed.add(original)
    return false
  })
}
