export type HumanOSTaskStatus =
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'terminated'
  | 'blocked'
  | string

export type CalendarStatus =
  | 'pending'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'blocked'
  | 'terminated'
  | string

export type TaskValueSource = 'user_input' | 'ai_extracted' | 'local_rules' | 'execution_feedback' | 'system_derived' | 'legacy_persisted' | 'user_or_persisted' | 'execution_session' | 'default_unconfirmed'

export interface TaskFieldProvenanceRecord {
  source: TaskValueSource
  source_id?: string
  confidence?: number
  updated_at?: number
}

export interface HumanOSTaskExecutionSnapshot {
  original_estimate_minutes?: number | null
  accumulated_actual_minutes?: number | null
  remaining_duration_minutes?: number | null
  progress_percent?: number | null
  sessions?: unknown[]
  history_sessions?: unknown[]
  [key: string]: unknown
}

export interface HumanOSTask {
  id?: string
  user_id?: string
  title?: string
  type?: string | null
  task_type?: string | null
  schedule_constraints?: {
    occurrence_mode: 'one_off' | 'repeat_selected_days'
    date?: string
    days?: number[]
    start_date?: string
    start_time?: string
    end_time?: string
  } | null
  deadline_at?: string | null
  duration?: number | string | null
  start_at?: string | null
  timezone?: string | null
  status?: HumanOSTaskStatus
  priority?: string | null
  context?: string | null
  contextWindow?: Record<string, unknown> | null
  context_window?: Record<string, unknown> | null
  execution?: HumanOSTaskExecutionSnapshot | null
  progress?: string | null
  next_step?: string | null
  open_questions?: string | null
  start_time?: string | null
  end_time?: string | null
  start?: string | null
  end?: string | null
  attendees?: string[]
  all_day?: boolean
  is_preview?: boolean
  missing_fields?: string[]
  expected_difficulty?: number | null
  energy_demand?: 'unknown' | 'low' | 'medium' | 'high'
  energy_demand_source?: string
  energy_assessment?: { reason_code: string; reported_energy: number | null; reported_at?: string; created_at?: number }
  resource_modality?: Array<'visual' | 'auditory' | 'verbal' | 'motor'>
  attention_mode?: 'continuous' | 'intermittent' | 'passive'
  parallelizable?: boolean
  dependency?: string | null
  create_request_id?: string | null
  created_at?: number | string | null
  updated_at?: number | string | null
  field_provenance?: Record<string, TaskFieldProvenanceRecord>
  [key: string]: unknown
}

export interface HumanOSMapEventInput {
  editable?: boolean
  id: string
  title: string
  start: string
  end: string | undefined
  allDay: boolean
  extendedProps: {
    description: string
    status: CalendarStatus
    priority: string
    attendees: string[]
    context: string
    progress: string
    nextStep: string
    openQuestions: string
    execution?: HumanOSTaskExecutionSnapshot
    executionSessionId?: string
    blockId?: string
    taskType?: string
    start_at?: string
    isPreview?: boolean
    planRevision?: number
    taskId?: string
    duration?: number
    deadline_at?: string
    expectedDifficulty?: number | null
    dependency?: string
    resourceModality?: Array<'visual' | 'auditory' | 'verbal' | 'motor'>
    attentionMode?: 'continuous' | 'intermittent' | 'passive'
    parallelizable?: boolean
    fieldSources?: Record<string, TaskValueSource>
    fieldProvenance?: Record<string, TaskFieldProvenanceRecord>
  }
}

export interface TaskAdapterContext {
  sourceTimezone?: string
  referenceDate?: Date
}
