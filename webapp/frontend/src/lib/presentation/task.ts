import { draftInstant } from '@/lib/calendar-draft-time'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import type { ExecutionSession } from '@/lib/contracts/execution-contracts'

export function localTime(value: string | number | Date | null | undefined, zone: string, locale: string, mode: 'date' | 'time' | 'datetime' = 'datetime') {
  if (!value) return locale === 'zh' ? '未填写' : 'Not set'
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const wall = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value) : null
  const date = new Date(dateOnly ? value + 'T12:00:00Z' : wall ? draftInstant(wall[1], 0, Number(wall[2])+Number(wall[3])/60, zone) : value)
  if (!Number.isFinite(date.getTime())) return locale === 'zh' ? '未填写' : 'Not set'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    timeZone: dateOnly ? 'UTC' : zone,
    ...(mode !== 'time' ? { month: 'long', day: 'numeric' } as const : {}),
    ...(mode !== 'date' && !dateOnly ? { hour: '2-digit', minute: '2-digit', hour12: false } as const : {}),
  }).format(date)
}

export function taskStatus(status: unknown, zh: boolean) {
  return status === 'completed' ? (zh ? '已完成' : 'Completed') : ['terminated', 'cancelled', 'canceled'].includes(String(status)) ? (zh ? '已取消' : 'Cancelled') : (zh ? '未完成' : 'Unfinished')
}
export function segmentStatus(status: unknown, zh: boolean) {
  const labels: Record<string, [string, string]> = { ready: ['待开始', 'Upcoming'], queued: ['待安排', 'Unscheduled'], scheduled: ['待开始', 'Upcoming'], running: ['进行中', 'In progress'], paused: ['已中断', 'Interrupted'], interrupted: ['已中断', 'Interrupted'], completed: ['已完成', 'Completed'], ended: ['已结束', 'Ended'], terminated: ['已取消', 'Cancelled'], cancelled: ['已取消', 'Cancelled'], deferred: ['已暂缓', 'Deferred'], blocked: ['暂无法开始', 'Not available yet'] }
  return labels[String(status)]?.[zh ? 0 : 1] || (zh ? '待确认' : 'To confirm')
}
export function priorityLabel(value: unknown, zh: boolean) {
  const key = ({ 高: 'high', 中: 'medium', 低: 'low' } as Record<string, string>)[String(value)] || String(value)
  return ({ high: zh ? '高优先级' : 'High priority', medium: zh ? '中优先级' : 'Medium priority', low: zh ? '低优先级' : 'Low priority' } as Record<string, string>)[key] || (zh ? '未填写' : 'Not set')
}
export function arrangement(task: HumanOSTask, sessions: ExecutionSession[]) {
  const unique = Array.from(new Map(sessions.map(s => [s.execution_session_id, s])).values())
  const active = unique.filter(s => !['superseded', 'cancelled', 'terminated', 'deferred'].includes(s.status))
  const estimate = Number(task.duration)
  const planned = active.reduce((sum, s) => sum + (typeof s.planned_work_minutes === 'number' ? s.planned_work_minutes : 0), 0)
  // Planned work is never evidence of actual completion.
  const actual = task.execution?.accumulated_actual_minutes
  return { sessions: active, estimate: Number.isFinite(estimate) && estimate > 0 ? estimate : null, planned, actual: typeof actual === 'number' && Number.isFinite(actual) ? actual : null }
}

export function interruptionReason(value: unknown, zh: boolean) {
  const labels: Record<string, [string, string]> = { tired: ['累了 / 状态不好', 'Tired / not feeling well'], stuck: ['卡住了', 'Stuck'], missing_material: ['缺少资料', 'Missing material'], interrupted: ['被打断', 'Interrupted'], longer_than_expected: ['这段任务比预计更难', 'Harder than expected'], priority_changed: ['优先级变化', 'Priority changed'], other: ['其他', 'Other'] }
  const text = typeof value === 'string' ? value : ''
  return labels[text]?.[zh ? 0 : 1] || (text.startsWith('other: ') ? text.slice(7) : /^[a-z_]+$/.test(text) ? (zh ? '已记录' : 'Recorded') : text)
}
