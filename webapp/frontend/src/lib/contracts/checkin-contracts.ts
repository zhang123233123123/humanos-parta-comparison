export interface RuntimeState {
  break_suggestion?: import('./break-suggestion').BreakSuggestion | null
  focus: number | null
  energy: number | null
  stress: number | null
  reported_fields?: string[]
  missing_fields?: string[]
  observation_status?: 'recorded' | 'unverified_legacy' | 'not_reported' | 'not_current'
  current_eligible?: boolean
  reported_at?: string
  created_at?: number
  mood?: string | null
  emotion?: string
  readiness?: string | null
  attention_residue?: string | null
  daily_note?: string | null
  local_date?: string
  [key: string]: unknown
}

export interface ContextDump {
  id?: string
  task_id: string
  progress?: string
  progress_percent?: number
  task_remaining_minutes?: number
  session_remaining_minutes?: number
  remaining_duration_minutes?: number
  next_action?: string
  open_questions?: string
  stop_reason?: string
  materials?: unknown[]
  created_at?: string | number
  [key: string]: unknown
}

export interface ReentryResult {
  task_id?: string
  first_step?: string
  previous_progress?: string
  previous_stop_reason?: string
  task_remaining_minutes?: number
  remaining_duration_minutes?: number
  suggested_block_minutes?: number | null
  open_questions?: string[]
  recommendation?: string
  [key: string]: unknown
}

export interface DailyPlanReview {
  assessment_status?: 'completed' | 'unavailable'
  decision?: 'suggest_adjustment' | 'keep_plan' | 'insufficient_information' | null
  reason?: string
  affected_task_ids?: string[]
  missing_information?: string[]
  state_id?: string | null
  plan_id?: string | null
  requires_plan_adjustment: boolean
  evaluated_at?: string
  first_session: {
    execution_session_id: string
    task_id: string
    task_title?: string
    planned_start_at?: string
    planned_end_at?: string
    planned_work_minutes?: number
  } | null
  reason_codes: string[]
  recommendation?: {
    start_at: string
    duration_minutes: number
  }
  options: string[]
}

export interface HelpDecideRecommendation {
  context?: { execution_session?: { execution_session_id?: string; status?: string } }
  options?: Array<HelpDecideRecommendation['recommendation']>
  id: string
  provider: 'deepseek' | 'deterministic_fallback'
  recommendation: {
    action: 'short_break' | 'continue_current' | 'switch_task' | 'continue_later'
    reason?: string
    consequence_code?: string
    option_id?: string
    impact?: { feasible?: boolean; estimated_end_at?: string; break_end_at?: string; requires_resume_time?: boolean; requires_plan_review?: boolean }
    break_minutes?: number
    duration_minutes?: number
    target_execution_session_id?: string
    target_task_id?: string
    target_task_title?: string
    validated: boolean
    validation: { valid: boolean; violations: string[]; checked_by: string }
  }
  evidence: {
    facts: Array<{ kind: 'self_report' | 'persisted_state' | 'scheduler_state'; field: string; value: string | number | boolean }>
    evidence_strength: 'limited' | 'moderate'
    limitations: string[]
    causal_claim_allowed: false
    user_confirmation_required: true
  }
}

export interface CheckInResourceEnvelope<T> {
  data: T
  resources: { self: string; profile: string; active_plan: string; execution_sessions: string }
  meta: { resource: 'daily_checkin'; aggregate_root: 'profile'; read_only: boolean }
}

export interface TaskLifecycleResourceEnvelope<T> {
  data: T
  resources: Record<string, string>
  meta: { resource: 'context_dump' | 'reentry_guidance'; aggregate_root: 'task'; read_only: boolean; plan_write_allowed?: false }
}
