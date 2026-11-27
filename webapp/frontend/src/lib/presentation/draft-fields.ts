export type DraftFields = { recurrence?: string | null; title?: string; task_type?: string; duration?: number | null; priority?: string | null; start_at?: string | null; deadline_at?: string | null; context?: string | null }
export type DraftForm = Record<'recurrence' | 'title' | 'task_type' | 'duration_minutes' | 'priority' | 'start_at' | 'deadline_at' | 'context', string>

export function localDraftTime(value: string | null | undefined, zone?: string | null): string {
  if (!value) return ''
  if (!zone) return value
  // Legacy offset-free timestamps already represent local wall time; never
  // reinterpret them using the browser's timezone.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 16)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const get = (key: string) => parts.find(p => p.type === key)?.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
export function draftForm(task: DraftFields, zone?: string | null): DraftForm {
  return { recurrence: task.recurrence || 'none', title: task.title || '', task_type: task.task_type || '', duration_minutes: task.duration == null ? '' : String(task.duration), priority: task.priority || '', start_at: localDraftTime(task.start_at, zone), deadline_at: localDraftTime(task.deadline_at, zone), context: task.context || '' }
}
export function changedDraftFields(original: DraftForm, current: DraftForm): Record<string, string | number | null> {
  const changed: Record<string, string | number | null> = {}
  for (const key of Object.keys(current) as Array<keyof DraftForm>) {
    if (current[key] === original[key]) continue
    const value = current[key]
    if (key === 'title' && !value.trim()) throw new Error('任务名称不能为空 / Task title is required')
    if (key === 'duration_minutes' && value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1440)) throw new Error('时长必须为 1–1440 整数分钟 / Duration must be 1–1440 whole minutes')
    changed[key] = key === 'duration_minutes' && value ? Number(value) : value || null
  }
  return changed
}
