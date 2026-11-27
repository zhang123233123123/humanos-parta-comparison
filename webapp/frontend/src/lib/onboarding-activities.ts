// Form-only drafts keep inactive inputs; collection deliberately excludes them.
export type ActivityType = 'fixed_event' | 'recurring_routine' | 'flexible_activity'
export type Frequency = 'once' | 'daily' | 'weekly'
export type ActivityDraft = {
  persistedId?: string
  editing?: boolean
  added?: boolean
  version: 2; id: string; title: string; type: ActivityType; frequency: Frequency
  date: string; startDate: string; weekdays: number[]
  fixed: { start: string; end: string }
  preferred: { start: string; end: string; minutes: string }
  flexible: { minutes: string; window: 'availability' | 'limited'; start: string; end: string }
}
export type PlanningDates = { start: string; end: string; today: string }
export const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const englishDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export function shiftDate(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value
}
export const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
export function dateLabel(date: string, zh = true) {
  return validDate(date) ? `${date} · ${zh ? weekdays[weekday(date)] : englishDays[weekday(date)]}` : ''
}
export function newActivity(id: string, period: PlanningDates): ActivityDraft {
  const start = period.today > period.start ? period.today : period.start
  return { version: 2, editing: true, added: false, id, title: '', type: 'fixed_event', frequency: 'weekly', date: start, startDate: start, weekdays: [],
    fixed: { start: '', end: '' }, preferred: { start: '', end: '', minutes: '' }, flexible: { minutes: '', window: 'availability', start: '', end: '' } }
}
export function restoreActivity(raw: any, period: PlanningDates): ActivityDraft {
  if (raw.version === 2) return JSON.parse(JSON.stringify(raw)) // Preserve dates and even invalid input verbatim.
  const template = newActivity(String(raw.id), period)
  const days = Array.isArray(raw.days) ? raw.days.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6)
    : englishDays.includes(raw.day) ? [englishDays.indexOf(raw.day)] : []
  const once = ['one_off', 'once_this_week'].includes(raw.occurrence_mode)
  const legacyDate = validDate(raw.day || '') ? raw.day : ''
  let date = raw.date || legacyDate || ''
  if (!date && once && days.length === 1) {
    // Old weekday-only, once-per-period records map to that date, never to today.
    date = Array.from({ length: 7 }, (_, i) => shiftDate(period.start, i)).find(d => weekday(d) === days[0]) || ''
  }
  const start = raw.start == null ? '' : String(raw.start), end = raw.end == null ? '' : String(raw.end)
  const minutes = raw.duration_minutes == null ? '' : String(raw.duration_minutes)
  return { ...template, editing: false, added: true, id: raw.id, persistedId: raw.persistedId, title: raw.title || '', type: raw.type || 'fixed_event', frequency: once ? 'once' : 'weekly',
    date, startDate: raw.startDate || raw.start_date || period.start, weekdays: days,
    fixed: { start: raw.type === 'fixed_event' ? start : '', end: raw.type === 'fixed_event' ? end : '' },
    preferred: { start: raw.type === 'recurring_routine' ? start : '', end: raw.type === 'recurring_routine' ? end : '', minutes: raw.type === 'recurring_routine' ? minutes : '' },
    flexible: { minutes: raw.type === 'flexible_activity' ? minutes : '', window: raw.type === 'flexible_activity' && (start || end) ? 'limited' : 'availability', start: raw.type === 'flexible_activity' ? start : '', end: raw.type === 'flexible_activity' ? end : '' } }
}
export function activityDates(item: ActivityDraft, period: PlanningDates): string[] {
  if (item.frequency === 'once') return validDate(item.date) && item.date >= period.start && item.date <= period.end ? [item.date] : []
  if (!validDate(item.startDate)) return []
  const dates: string[] = []
  for (let date = period.start; date <= period.end; date = shiftDate(date, 1)) {
    if (date >= item.startDate && (item.frequency === 'daily' || item.weekdays.includes(weekday(date)))) dates.push(date)
  }
  return dates
}
const clock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0,2))*60 + Number(value.slice(3)) : null
export function validateActivity(item: ActivityDraft, period: PlanningDates) {
  const errors: Record<string,string> = {}, warnings: Record<string,string> = {}
  if (!item.title.trim()) errors.title = '请填写活动名称。'
  const key = item.frequency === 'once' ? 'date' : 'startDate'
  const date = item[key]
  if (!validDate(date)) errors[key] = '请选择有效日期。'
  else if (date < period.start || date > period.end) errors[key] = '请选择当前规划期内的日期。'
  if (item.frequency === 'weekly' && !item.weekdays.length) errors.weekdays = '请至少选择一天。'
  else if (!errors[key] && !activityDates(item, period).length) errors[key] = '当前规划期内没有符合条件的日期'
  const mode = item.type === 'fixed_event' ? 'fixed' : item.type === 'recurring_routine' ? 'preferred' : 'flexible'
  const values = item[mode]
  const hasWindow = mode !== 'flexible' || item.flexible.window === 'limited'
  let windowMinutes: number | null = null
  if (hasWindow) {
    const start = clock(values.start), end = clock(values.end)
    if (start === null) errors[`${mode}.start`] = '请填写有效时间。'
    if (end === null) errors[`${mode}.end`] = '请填写有效时间。'
    else if (start !== null && end <= start) errors[`${mode}.end`] = '结束必须晚于开始，本轮不支持跨夜。'
    else if (start !== null) windowMinutes = end - start
  }
  if (mode !== 'fixed') {
    const minutes = item[mode].minutes
    if (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) <= 0) errors[`${mode}.minutes`] = '请填写正整数分钟，不能留空、小数、0或负数。'
    else if (windowMinutes !== null && Number(minutes) > windowMinutes) {
      if (mode === 'preferred') warnings['preferred.minutes'] = `偏好时段只有${windowMinutes}分钟，活动预计需要${minutes}分钟，可能需要安排在该时段之外。`
      else errors['flexible.minutes'] = `可安排时段只有${windowMinutes}分钟，请扩大时段或修改预计用时。`
    }
  }
  return { errors, warnings, valid: Object.keys(errors).length === 0 }
}
export function collectActivity(item: ActivityDraft, period: PlanningDates) {
  if (!validateActivity(item, period).valid) throw new Error('请先修正活动表单中的错误。')
  const dates = activityDates(item, period)
  const base = { id: item.id, title: item.title.trim(), type: item.type, day: dates.join(', '), days: dates.map(weekday), occurrence_mode: item.frequency === 'once' ? 'one_off' : 'repeat_selected_days' }
  // Existing context_items fields only. No hidden draft fields cross the API boundary.
  if (item.type === 'fixed_event') return { ...base, start: item.fixed.start, end: item.fixed.end }
  if (item.type === 'recurring_routine') return { ...base, start: item.preferred.start, end: item.preferred.end, duration_minutes: Number(item.preferred.minutes) }
  return { ...base, duration_minutes: Number(item.flexible.minutes), ...(item.flexible.window === 'limited' ? { start: item.flexible.start, end: item.flexible.end } : {}) }
}

/** Adapt the existing form into a canonical Task; the form layout stays unchanged. */
export function collectActivityTask(item: ActivityDraft, period: PlanningDates, timezone?: string) {
  const activity = collectActivity(item, period)
  const minutes = item.type === 'fixed_event'
    ? clock(item.fixed.end)! - clock(item.fixed.start)!
    : Number(item.type === 'recurring_routine' ? item.preferred.minutes : item.flexible.minutes)
  const timing = item.type === 'fixed_event' ? item.fixed : item.type === 'recurring_routine' ? item.preferred
    : item.flexible.window === 'limited' ? item.flexible : null
  return {
    ...(item.persistedId ? { id: item.persistedId } : {}), request_id: item.id,
    title: activity.title, task_type: item.type, duration: minutes,
    ...(timezone ? { timezone } : {}), week_id: period.start,
    schedule_constraints: {
      occurrence_mode: item.frequency === 'once' ? 'one_off' : 'repeat_selected_days',
      ...(item.frequency === 'once' ? { date: item.date }
        : { days: item.frequency === 'daily' ? [0,1,2,3,4,5,6] : [...item.weekdays], start_date: item.startDate }),
      ...(timing ? { start_time: timing.start, end_time: timing.end } : {}),
    },
  }
}

export function taskActivityRecord(task: import('./contracts/task-contracts').HumanOSTask) {
  const constraints = task.schedule_constraints
  if (!constraints || !task.id || !['fixed_event', 'recurring_routine', 'flexible_activity'].includes(task.task_type || '')) return null
  return { id: task.id, persistedId: task.id, title: task.title, type: task.task_type,
    occurrence_mode: constraints.occurrence_mode, date: constraints.date,
    day: constraints.date || '', days: constraints.days || [], startDate: constraints.start_date,
    start: constraints.start_time, end: constraints.end_time, duration_minutes: task.duration }
}
