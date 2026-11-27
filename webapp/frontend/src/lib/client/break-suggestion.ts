import type { BreakSuggestion } from '../contracts/break-suggestion'
export type { BreakSuggestion } from '../contracts/break-suggestion'

const shown = new Set<string>()

// Mark when displayed, not when accepted. A rejection must never re-open it.
export function claimBreakSuggestion(id: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  const key = `humanos:break-prompt:${id}`
  if (shown.has(key)) return false
  try {
    if (storage?.getItem(key)) { shown.add(key); return false }
    storage?.setItem(key, 'shown')
  } catch { /* Memory deduplication still works when browser storage is blocked. */ }
  shown.add(key)
  return true
}

export function breakCommand(suggestion: BreakSuggestion, minutes: number, now: number) {
  if (![5, 10, 15].includes(minutes)) throw new Error('Invalid break duration')
  return {
    execution_session_id: suggestion.execution_session_id,
    expected_status: 'running',
    interruption_action: 'short_break',
    pause_reason: 'accepted_checkin_break_suggestion',
    resume_preference: 'soon',
    preferred_resume_at: new Date(now + minutes * 60_000).toISOString(),
    break_minutes: minutes,
    request_id: `checkin-break:${suggestion.id}`,
  }
}
