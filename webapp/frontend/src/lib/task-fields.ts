import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import { draftInstant, wallParts } from '@/lib/calendar-draft-time'

/** Form wall time and API instants must never depend on the proxy server's timezone. */
export function taskDateInput(value: string | null | undefined, zone: string): string {
  if (!value) return ''
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value.slice(0, 16)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const { date: day, hour } = wallParts(date, zone)
  const minute = Math.round(hour * 60)
  return `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function taskDateInstant(value: string | null | undefined, zone: string): string | null {
  if (!value) return null
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid task date')
    return new Date(value).toISOString()
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::00)?$/.exec(value)
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) throw new Error('Invalid task date')
  const instant = draftInstant(match[1], 0, Number(match[2]) + Number(match[3]) / 60, zone)
  if (taskDateInput(instant, zone) !== value.slice(0, 16)) throw new Error('Invalid task date')
  return instant
}

/** Context-window fields are read as text, without replacing a user's explicit empty value. */
export function taskText(task: HumanOSTask, field: 'progress' | 'next_step' | 'open_questions' | 'dependency'): string {
  const window = task.contextWindow || {}
  const stored = field === 'next_step' ? 'nextStep' : field
  const value = task[field] ?? window[stored]
  return typeof value === 'string' ? value : ''
}
