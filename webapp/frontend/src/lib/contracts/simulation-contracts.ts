export interface Question {
  question_id: string
  revision: number
  phase:
    | 'profile'
    | 'initial_state'
    | 'node'
    | 'feedback'
    | 'daily_feedback'
    | 'final'
  title: string
  help: string
  type: 'text' | 'single' | 'multiple' | 'number' | 'scale'
  option_values?: string[]
  options: string[]
  minimum: number
  maximum: number
  step: number
  low_label: string
  high_label: string
  required: boolean
  enabled: boolean
  model_usage: 'planning' | 'node_decision' | 'both' | 'evaluation_only'
  semantic_binding:
    | ''
    | 'energy'
    | 'focus'
    | 'stress'
    | 'mood'
    | 'session_minutes'
    | 'rest_minutes'
  display_if: { question_id: string; equals: string | number | boolean } | null
}
export interface SimTask {
  id: string
  title: string
  minutes: number
  deadline_at: string
  difficulty: number
  demand: string
  description: string
}
export interface SimWindow {
  start_at: string
  end_at: string
}
export interface SimEvent {
  id: string
  at: string
  title: string
  description: string
  remaining_minutes: Record<string, number>
  unavailable: SimWindow[]
}
export interface Scenario {
  keep_buffer?: boolean
  planning_goal?: string
  participant_input?: boolean
  name: string
  description: string
  timezone: string
  start_at: string
  end_at: string
  tasks: SimTask[]
  availability: SimWindow[]
  fixed_events: SimWindow[]
  events: SimEvent[]
  session_minutes: number
  rest_minutes: number
}
export interface Configuration {
  name: string
  questions: Question[]
}
export interface SimDocument<T> {
  id: string
  revision: number
  content: T
  latest_version_id: string | null
  versions?: { id: string; content: T; revision: number }[]
}
export interface SimBlock extends SimWindow {
  task_id: string
  title?: string
  minutes?: number
}
export interface SimPlan {
  id: string
  status: string
  blocks: SimBlock[]
  unscheduled: { task_id: string; title: string; minutes: number }[]
  explanation: string
  session_minutes: number
  rest_minutes: number
}
export interface SimNode {
  enabled?: boolean
  triggered_at?: string

  id: string
  at: string
  title: string
  description: string
  reason: string
  question_ids: string[]
}
export interface SimBatch {
  id: string
  phase: string
  questions: Question[]
  created_at: string
  first_presented_at?: string
}
export interface SimRun {
  mode?: 'live' | 'simulation'
  read_only?: boolean
  last_inquiry_decision?: {
    decision: 'ask' | 'skip' | 'defer'
    reason: string
    simulated_at: string
  }
  onboarding_input?: PlanningInput | null
  participant_setup_complete?: boolean
  setup_draft?: {
    availability: SimWindow[]
    fixed_events: SimWindow[]
    next_step: number
    saved_at: string
  } | null
  daily_feedback?: { date: string; available: boolean; submitted: boolean }
  id: string
  revision: number
  status: string
  simulated_at: string
  participant_id?: string
  scenario: Scenario
  configuration?: Configuration
  config_version_id?: string
  pending_batch: SimBatch | null
  active_plan: SimPlan | null
  proposed_plan: SimPlan | null
  pending_job_id: string | null
  error: string | null
  initial_submitted: boolean
  remaining: Record<string, number>
  unavailable?: SimWindow[]
  candidate_nodes?: SimNode[]
  triggered_event_ids?: string[]
  revealed_events: { title: string; description: string; at: string }[]
  events?: Record<string, unknown>[]
  jobs?: Record<string, unknown>[]
  node_versions?: Record<string, unknown>[]
  reported_state?: {
    mood?: string
    values: Partial<Record<'energy' | 'focus' | 'stress', number>>
    reported_at: string
    simulated_at: string
  }
  profile_answers?: { title: string; value: unknown; display_value?: string }[]
}

export interface ProfileFormVersion {
  id: string
  revision: number
  content: Configuration
}
export interface ParticipantProfile {
  participant_id: string
  revision: number
  form: ProfileFormVersion
  values: Record<string, unknown>
  answers: { question: Question; value: unknown }[]
  step: number
  submitted_at: string | null
}

export interface PlanningInput {
  start_date: string
  end_date: string
  timezone: string
  availability: SimWindow[]
  activities: import('@/lib/onboarding-activities').ActivityDraft[]
  tasks: SimTask[]
  keep_buffer: boolean
  planning_goal: string
}
export interface PlanningSetup {
  revision: number
  step: number
  submitted_at: string | null
  state_form: { id: string; questions: Question[] }
  state_values: Record<string, unknown>
  input: PlanningInput
}
