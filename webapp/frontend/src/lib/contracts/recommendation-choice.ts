export type ChoiceStatus = 'original_accepted' | 'alternative_selected' | 'declined' | 'unknown'

export interface ChoiceSnapshot {
  action: string
  break_minutes?: number
  duration_minutes?: number
  target_execution_session_id?: string
  target_task_title?: string
  preferred_resume_at?: string
}
