import type { DailyPlanReview, RuntimeState } from '../contracts/checkin-contracts'

export type Mood = 'positive' | 'neutral' | 'low' | 'anxious'
export interface StateValues {
  mood: Mood | ''; energy: number | null; focus: number | null; stress: number | null
  daily_note: string
}
export const emptyState = (): StateValues => ({ mood: '', energy: null, focus: null, stress: null, daily_note: '' })
export interface DailyGate { required: boolean; local_date: string; last_daily_checkin_date: string | null; evaluated_at: string }
export interface WorkSession {
  id: string; task_id: string; title: string; ordinal: number; start: string; end: string
  status: string; plan_id: string; plan_revision: number; kind: 'work'; block_id: string
  planned_work_minutes?: number; started_at?: string | null
  progress?: string; next_step?: string
}
export interface FixedCommitment { id: string; title: string; start: string; end: string; kind: 'fixed' }
export interface StartWorkCommand {
  request_id: string; session_id: string; base_plan_revision: number; expected_active_id: string | null
  retain_previous?: boolean; remaining_minutes?: number | null
  progress?: string
}
export interface CandidateWork {
  id: string; original_task_id: string; source_session_id: string; title: string
  remaining_minutes: number | null; source: 'interrupted_session' | 'explicitly_deferred_session'
  status: 'pending' | 'scheduled'; deadline: string | null; planning_period_end: string
}
export interface RuntimeSnapshot {
  profile: { timezone: string; onboarding_completed: boolean; onboarding_submitted?: boolean; user_id: string }
  gate: DailyGate; sessions: WorkSession[]; candidates: CandidateWork[] | null
  plan_id: string; plan_revision: number; state_id: string | null
  state: RuntimeState | null; now: number; clock_rate?: number
  active_session_id?: string | null; fixed_events?: FixedCommitment[]
}
export type ReviewOutcome = { kind: 'keep' | 'adjust' | 'insufficient' | 'error'; reason: string; missing: string[]; raw: DailyPlanReview | null }
export interface SessionReport {
  request_id: string; source_session_id: string; original_task_id: string
  plan_id: string; plan_revision: number; outcome: 'completed' | 'interrupted'
  state: StateValues; reason?: string; progress?: string; remaining_minutes: number | null
  retain_candidate: boolean
  next_step?: string; result?: 'done' | 'unfinished' | 'interrupted'
}
export interface PlanAuthorization {
  request_id: string; base_plan_id: string; base_plan_revision: number; base_state_id: string | null
  adjustable_session_ids: string[]; authorized_candidate_ids: string[]
  scope: 'today' | 'remaining_planning_period'; local_date: string
  candidate_duration_minutes?: Record<string, number>
}
export interface RuntimeProposal {
  id: string; authorization: PlanAuthorization; valid: boolean; status: 'proposed' | 'applied'
  changes: Array<{ session_id: string; title: string; before: string | null; after: string }>
  unallocated_candidate_ids: string[]
}
export interface InteractionService {
  mode: 'live' | 'isolated-development'
  snapshot(): Promise<RuntimeSnapshot>
  start(command: StartWorkCommand): Promise<void>
  saveState(values: StateValues, requestId: string, source: string): Promise<{ runtime_state: RuntimeState; daily_plan_review: DailyPlanReview | null }>
  review(): Promise<DailyPlanReview>
  report(command: SessionReport): Promise<{ runtime_state: RuntimeState; daily_plan_review: DailyPlanReview | null }>
  defer(command: { request_id: string; session_id: string; confirmed_not_started: true; base_plan_revision: number }): Promise<void>
  propose(command: PlanAuthorization): Promise<RuntimeProposal>
  apply(proposal: RuntimeProposal, requestId: string): Promise<void>
}
export type OverlayRequest =
  | { id: string; kind: 'switch'; session: WorkSession }
  | { id: string; kind: 'missed'; session: WorkSession }
  | { id: string; kind: 'overlap' }
  | { id: string; kind: 'inbox' }
  | { id: string; kind: 'state'; source: 'daily' | 'manual' }
  | { id: string; kind: 'report'; session: WorkSession; outcome: 'completed' | 'interrupted' }
  | { id: string; kind: 'reminders'; session_id?: string }
  | { id: string; kind: 'review' }
  | { id: string; kind: 'candidate'; candidate: CandidateWork }
