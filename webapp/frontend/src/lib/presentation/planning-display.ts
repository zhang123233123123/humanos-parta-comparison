/** Format scheduler coordinates; never change or infer persisted times. */
import { decisionReason } from '@/lib/presentation/decision-reasons'
export function clockHour(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) return '—'
  const minutes = Math.round(value * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function draftTimeLabel(block: { day_index?: number; start?: number; end?: number; planned_work_minutes?: number; session_minutes?: number }, locale: string): string {
  const zh = locale === 'zh'
  const days = zh ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const day = typeof block.day_index === 'number' && Number.isInteger(block.day_index) ? days[block.day_index] : undefined
  const duration = block.planned_work_minutes ?? block.session_minutes
  const suffix = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? ` · ${duration} ${zh ? '分钟' : 'min'}` : ''
  return `${day || (zh ? '日期待确认' : 'Day unconfirmed')} ${clockHour(block.start)}–${clockHour(block.end)}${suffix}`
}

export function schedulingReason(reason: string | undefined, locale: string): string {
  const result = decisionReason(reason, locale)
  if (result.known) return result.message
  if (reason && !/^[a-z][a-z0-9_]*$/.test(reason)) return reason
  return result.message
}

export function unscheduledTitle(task: { task_id?: string; title?: string }, titles: Map<string, string>, locale: string): string {
  const title = titles.get(String(task.task_id)) || task.title
  if (title) return title
  return locale === 'zh' ? `未找到任务名称${task.task_id ? `（编号：${task.task_id}）` : ''}` : `Task name unavailable${task.task_id ? ` (ID: ${task.task_id})` : ''}`
}
