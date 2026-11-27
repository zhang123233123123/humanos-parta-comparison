import type { PlanBlock, PlanDecision } from '@/lib/contracts/planning-contracts'
import { changedPlanBlocks } from '@/lib/calendar-plan-diff'
import { draftInstant, wallParts } from '@/lib/calendar-draft-time'

type Change = { key: string; title: string; detail: string }

function time(block: PlanBlock, plan: PlanDecision, timezone: string, side: 'start' | 'end') {
  try {
    const supplied = block[`${side}_at`]
    const value = typeof supplied === 'string' ? supplied : draftInstant(plan.week_id || '', block.day_index, block[side], timezone)
    const parts = wallParts(new Date(value), timezone)
    const minutes = Math.round(parts.hour * 60)
    return { date: parts.date, clock: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
  } catch { return null }
}

function dateLabel(date: string) {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function work(block: PlanBlock) {
  const value = block.planned_work_minutes ?? block.session_minutes
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Describe actual calendar differences; never invent a reason or an old time. */
export function calendarChangeSummary(plan: PlanDecision, base: PlanDecision, titles: Record<string, string> = {}, timezone = 'UTC', limit = 3) {
  const changed = changedPlanBlocks(plan, base, timezone)
  const consumed = new Set<number>()
  const matches = new Map<number, number>()
  // First reserve stable IDs, then semantically unchanged sessions whose IDs
  // were regenerated. This keeps split-task segments from borrowing a sibling.
  plan.plan_patch.forEach((block, index) => {
    const original = block.block_id ? base.plan_patch.findIndex((other, i) => !consumed.has(i) && block.block_id === other.block_id) : -1
    if (original >= 0) { matches.set(index, original); consumed.add(original) }
  })
  plan.plan_patch.forEach((block, index) => {
    if (changed[index] || matches.has(index)) return
    const original = base.plan_patch.findIndex((other, i) => !consumed.has(i) && !changedPlanBlocks({ ...plan, plan_patch: [block] }, { ...base, plan_patch: [other] }, timezone)[0])
    if (original >= 0) { matches.set(index, original); consumed.add(original) }
  })
  const entries: Change[] = []
  plan.plan_patch.forEach((block, index) => {
    if (!changed[index] || (block.kind && block.kind !== 'task_session')) return
    let original = matches.get(index)
    if (original === undefined) {
      const remaining = base.plan_patch.map((other, i) => ({ other, i })).filter(({ other, i }) => !consumed.has(i) && other.task_id === block.task_id && (other.kind || 'task_session') === (block.kind || 'task_session'))
      const nextCount = plan.plan_patch.filter((other, i) => changed[i] && !matches.has(i) && other.task_id === block.task_id && (other.kind || 'task_session') === (block.kind || 'task_session')).length
      if (remaining.length === 1 && nextCount === 1) { original = remaining[0].i; consumed.add(original) }
    }
    const before = original === undefined ? null : base.plan_patch[original]
    const from = before ? time(before, base, timezone, 'start') : null
    const to = time(block, plan, timezone, 'start')
    const end = time(block, plan, timezone, 'end')
    const oldEnd = before ? time(before, base, timezone, 'end') : null
    let detail = '安排已更新'
    if (from && to && (from.date !== to.date || from.clock !== to.clock)) {
      const includeDate = from.date !== to.date
      detail = `${includeDate ? `${dateLabel(from.date)} ` : ''}${from.clock} → ${includeDate ? `${dateLabel(to.date)} ` : ''}${to.clock}`
    } else if (from && to && oldEnd && end && (oldEnd.date !== end.date || oldEnd.clock !== end.clock)) {
      detail = `${from.clock}–${oldEnd.clock} → ${to.clock}–${end.clock}`
    } else if (before && work(before) !== null && work(block) !== null && work(before) !== work(block)) {
      detail = `工作量 ${work(before)} → ${work(block)} 分钟`
    } else if (!before && to && end) {
      // When regenerated IDs are ambiguous, show only the supplied new time.
      const isNewTask = !base.plan_patch.some(other => other.task_id === block.task_id)
      detail = `${isNewTask ? '新增' : '安排为'} ${dateLabel(to.date)} ${to.clock}–${end.clock}`
    }
    entries.push({ key: block.block_id || `${block.task_id}:${index}`, title: titles[block.task_id] || block.title || '任务', detail })
  })
  return { entries: entries.slice(0, limit), remaining: Math.max(0, entries.length - limit) }
}
