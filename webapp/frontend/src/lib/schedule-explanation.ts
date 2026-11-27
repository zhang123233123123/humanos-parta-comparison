import type { PlanBlock, PlanDecision } from './contracts/planning-contracts'
import type { DailyPlanReview } from './contracts/checkin-contracts'
import type { HumanOSTask } from './contracts/task-contracts'
import type { RuntimeSnapshot } from './interaction/contracts'
import { draftInstant, wallParts } from './calendar-draft-time'

export interface ScheduleExplanationInput {
  decision?: PlanDecision | null
  locale: string
  context?: 'initial' | 'adjustment' | 'keep'
  review?: DailyPlanReview | null
  snapshot?: RuntimeSnapshot | null
  base?: PlanDecision | null
  tasks?: Record<string, HumanOSTask>
  titles?: Record<string, string>
  timezone?: string
}

type Interval = { start: number; end: number; title: string }
const isWork = (block: PlanBlock) => !block.kind || ['task_session', 'work', 'task', 'flexible_task'].includes(block.kind)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
// Titles are the only free text used here; raw AI reasons are not evidence of habits or causality.
const readable = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : ''

/** Describes observed plan facts, never infers a personal habit or a change in state. */
export function getScheduleExplanation(input: ScheduleExplanationInput): string {
  const { decision, review, snapshot, tasks = {}, titles = {}, base } = input
  const zh = input.locale === 'zh'
  const context = input.context || (base ? 'adjustment' : 'initial')
  const timezone = input.timezone || snapshot?.profile.timezone || 'UTC'
  const blocks = decision?.plan_patch || []
  const work = blocks.filter(isWork)
  const name = (id: string, title?: unknown) => readable(titles[id]) || readable(tasks[id]?.title) || readable(title)
  const quoted = (title: string) => `“${title}”`
  const format = (instant: number, withDate = false) => {
    try {
      return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', { timeZone: timezone, ...(withDate ? { month: 'numeric', day: 'numeric' } as const : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
    } catch { return '' }
  }
  const interval = (block: PlanBlock, plan: PlanDecision | null | undefined): Interval | null => {
    // Numeric wall times reflect local edits; ISO fields can still describe the original block.
    if (plan?.week_id && finite(block.day_index) && finite(block.start) && finite(block.end) && block.end > block.start) {
      try { return { start: Date.parse(draftInstant(plan.week_id, block.day_index, block.start, timezone)), end: Date.parse(draftInstant(plan.week_id, block.day_index, block.end, timezone)), title: name(block.task_id, block.title) } } catch { return null }
    }
    const start = validDate(block.start_at), end = validDate(block.end_at)
    return start !== null && end !== null && end > start ? { start, end, title: name(block.task_id, block.title) } : null
  }
  const sameDay = (first: number, second: number) => {
    try { return wallParts(new Date(first), timezone).date === wallParts(new Date(second), timezone).date } catch { return false }
  }
  const currentState = () => {
    const state = snapshot?.state
    if (!state || state.current_eligible === false || ['not_current', 'not_reported', 'unverified_legacy'].includes(state.observation_status || '') || (review?.state_id && review.state_id !== snapshot?.state_id)) return ''
    let reportedDate = state.local_date
    const reportedAt = validDate(state.reported_at)
    if (!reportedDate && reportedAt !== null) {
      try { reportedDate = wallParts(new Date(reportedAt), timezone).date } catch { /* Unreadable dates are not current-state evidence. */ }
    }
    if (reportedDate ? reportedDate !== snapshot?.gate.local_date : state.current_eligible !== true) return ''
    if (review?.plan_id && review.plan_id !== snapshot?.plan_id) return ''
    const values = [
      ['energy', zh ? '精力' : 'energy'], ['focus', zh ? '专注' : 'focus'], ['stress', zh ? '压力' : 'stress'],
    ].flatMap(([key, label]) => finite(state[key]) && state[key] >= 1 && state[key] <= 7 ? [`${label} ${state[key]}/7`] : [])
    return values.length ? (zh ? `你刚报告${values.join('、')}` : `You reported ${values.join(', ')}`) : ''
  }
  const upcoming = [...(snapshot?.sessions || [])].filter(session => ['ready', 'scheduled', 'running', 'paused'].includes(session.status) && Date.parse(session.start) >= Number(snapshot?.now)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]
  const next = review?.first_session || (upcoming ? { task_id: upcoming.task_id, task_title: upcoming.title, planned_start_at: upcoming.start,
    planned_end_at: upcoming.end, planned_work_minutes: undefined } : null)
  const nextTitle = next && name(next.task_id, next.task_title)
  const nextText = () => {
    if (!next || !nextTitle) return ''
    const minutes = next.planned_work_minutes
    const duration = finite(minutes) && minutes > 0 ? (zh ? `（${minutes}分钟）` : ` (${minutes} minutes)`) : ''
    const start = validDate(next.planned_start_at)
    const end = validDate(next.planned_end_at)
    // Calendar bounds may include buffers; do not turn them into work demand.
    const clock = start !== null ? `${format(start)}${!duration && end !== null && end > start ? `–${format(end)}` : ''}` : ''
    return zh ? `接下来${clock ? ` ${clock}` : ''}是${quoted(nextTitle)}${duration}` : `Next is ${quoted(nextTitle)}${duration}${clock ? ` at ${clock}` : ''}`
  }
  if (context === 'keep') {
    const facts = [currentState(), nextText()].filter(Boolean)
    const checked = review?.assessment_status === 'completed' && review.decision === 'keep_plan'
    const conclusion = checked ? (zh ? '这次检查没有提出调整。' : 'This check did not suggest a change.') : (zh ? '目前没有更多信息说明是否需要调整。' : 'There is not enough detail to explain whether a change is needed.')
    return facts.length ? `${facts.join(zh ? '；' : '; ')}${zh ? '。' : '. '}${conclusion}` : conclusion
  }
  if (context === 'adjustment') {
    let change = ''
    // Prefer actual before/after blocks, including the user's unsaved calendar edits.
    for (const block of work) {
      const previous = base?.plan_patch.find(old => block.block_id && old.block_id === block.block_id && old.task_id === block.task_id)
      const before = previous && interval(previous, base), after = interval(block, decision)
      if (before && after?.title && (before.start !== after.start || before.end !== after.end)) {
        change = zh ? `本次把${quoted(after.title)}从 ${format(before.start, true)}–${format(before.end)} 调整到 ${format(after.start, true)}–${format(after.end)}` : `This proposal moves ${quoted(after.title)} from ${format(before.start, true)}–${format(before.end)} to ${format(after.start, true)}–${format(after.end)}`
        break
      }
    }
    const recommendedStart = validDate(review?.recommendation?.start_at)
    const plannedStart = validDate(next?.planned_start_at)
    if (!change && nextTitle && plannedStart !== null && recommendedStart !== null && recommendedStart !== plannedStart) {
      const later = recommendedStart > plannedStart
      change = zh ? `建议把${quoted(nextTitle)}从 ${format(plannedStart)} ${later ? '推迟' : '提前'}到 ${format(recommendedStart)}` : `The suggestion is to move ${quoted(nextTitle)} from ${format(plannedStart)} to ${format(recommendedStart)}`
    }
    const state = currentState()
    if (change) return `${state ? `${state}${zh ? '。' : '. '}` : ''}${change}${zh ? '。' : '.'}`
    const facts = [state, nextText()].filter(Boolean)
    const limited = zh ? '这次检查建议重新查看后续时段，具体变化将在预览中显示。' : 'This check suggests reviewing the upcoming times; the preview will show the specific changes.'
    return facts.length ? `${facts.join(zh ? '；' : '; ')}${zh ? '。' : '. '}${limited}` : (zh ? '目前没有足够信息说明这次调整的具体原因。' : 'There is not enough information to explain the reason for this change.')
  }

  const sentences: string[] = []
  const workTimes = work.map(block => interval(block, decision)).filter((value): value is Interval => Boolean(value))
  const fixed: Interval[] = []
  for (const block of [...blocks, ...(decision?.constraint_summary?.hard_constraints || [])] as PlanBlock[]) {
    if (block.kind === 'fixed_event' || tasks[block.task_id]?.task_type === 'fixed_event') {
      const time = interval({ ...block, title: readable(block.title || block.label) }, decision)
      if (time) fixed.push(time)
    }
  }
  for (const task of Object.values(tasks)) {
    if (task.task_type !== 'fixed_event') continue
    const start = validDate(task.start_at || task.start), end = validDate(task.end_time || task.end)
    const title = name(task.id || '', task.title)
    if (start !== null && end !== null && end > start && title) fixed.push({ start, end, title })
  }
  const anchor = fixed.find(f => f.title && workTimes.some(w => sameDay(w.start, f.start)) && workTimes.every(w => w.end <= f.start || w.start >= f.end))
  if (anchor) sentences.push(zh ? `${quoted(anchor.title)}固定在 ${format(anchor.start, true)}–${format(anchor.end)}，已安排的工作段避开了这段时间。` : `${quoted(anchor.title)} is fixed at ${format(anchor.start, true)}–${format(anchor.end)}; the scheduled work avoids that time.`)

  const groups = new Map<string, PlanBlock[]>()
  for (const block of work) groups.set(block.task_id, [...(groups.get(block.task_id) || []), block])
  const segmented = [...groups.entries()].find(([id, parts]) => parts.length > 1 && name(id, parts[0].title) && parts.every(b => finite(b.planned_work_minutes ?? b.session_minutes) && Number(b.planned_work_minutes ?? b.session_minutes) > 0))
  if (segmented) {
    const [id, parts] = segmented
    const minutes = parts.map(b => Number(b.planned_work_minutes ?? b.session_minutes))
    const equal = minutes.every(n => n === minutes[0])
    const total = minutes.reduce((sum, n) => sum + n, 0)
    let sentence = zh ? `${quoted(name(id, parts[0].title))}分为${parts.length}个工作段${equal ? `，每段${minutes[0]}分钟` : `，共${total}分钟`}` : `${quoted(name(id, parts[0].title))} is split into ${parts.length} sessions${equal ? ` of ${minutes[0]} minutes each` : ` totalling ${total} minutes`}`
    const rest = decision?.constraint_summary?.rest_minutes
    const times = parts.map(b => interval(b, decision)).filter((v): v is Interval => Boolean(v)).sort((a, b) => a.start - b.start)
    if (finite(rest) && rest > 0 && times.length === parts.length && times.slice(1).some((time, i) => {
      const previous = times[i]
      return sameDay(time.start, previous.end) && time.start - previous.end >= rest * 60000
        && [...workTimes, ...fixed].every(occupied => occupied.end <= previous.end || occupied.start >= time.start)
    })) sentence += zh ? `，其中两段之间留出了至少${rest}分钟的休息时间` : `, with at least ${rest} minutes for a break between two of the sessions`
    sentences.push(sentence + (zh ? '。' : '.'))
  }
  if (sentences.length < 2) {
    const deadlineTask = work.find(block => {
      const task = tasks[block.task_id], due = validDate(task?.deadline_at || task?.deadline || task?.deadline_at)
      const parts = groups.get(block.task_id) || []
      return name(block.task_id, block.title) && due !== null && parts.every(part => { const time = interval(part, decision); return time && time.end <= due })
    })
    if (deadlineTask) {
      const task = tasks[deadlineTask.task_id], due = validDate(task.deadline_at || task.deadline || task.deadline_at)!
      const first = interval(deadlineTask, decision)!
      sentences.push(zh ? `${quoted(name(deadlineTask.task_id, deadlineTask.title))}需在 ${format(due, true)} 前完成，目前的工作段从 ${format(first.start, true)} 开始，均在截止时间前。` : `${quoted(name(deadlineTask.task_id, deadlineTask.title))} is due by ${format(due, true)}; its sessions start at ${format(first.start, true)} and all finish before that deadline.`)
    }
  }
  if (!sentences.length && workTimes[0]?.title) {
    const first = workTimes[0]
    sentences.push(zh ? `${quoted(first.title)}安排在 ${format(first.start, true)}–${format(first.end)}；目前没有更多信息说明这个时段的选择。` : `${quoted(first.title)} is scheduled for ${format(first.start, true)}–${format(first.end)}; no further reason for this time is available.`)
  }
  return sentences.slice(0, 2).join(zh ? '' : ' ') || (zh ? '这份计划尚未提供足够信息来说明具体时段的选择。' : 'This plan does not provide enough information to explain the choice of times.')
}
