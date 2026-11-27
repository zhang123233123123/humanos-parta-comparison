export interface BreakSuggestion {
  id: string
  execution_session_id: string
  task_id: string
  task_title?: string | null
  reason_codes: string[]
  suggested_minutes: number
  requires_confirmation: true
}
