import type { HumanOSTask, HumanOSMapEventInput } from '@/lib/contracts/task-contracts'
import { draftInstant } from '@/lib/calendar-draft-time'
import { taskText } from '@/lib/task-fields'

function toISOString(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'number') {
    const date = new Date(value > 9999999999 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function asNumber(input: unknown, fallback = 0): number {
  const value = Number(input)
  return Number.isFinite(value) ? value : fallback
}

function normalizeStatus(value: unknown): HumanOSMapEventInput['extendedProps']['status'] {
  const raw = String(value || '').toLowerCase().trim()
  return (raw || 'pending') as HumanOSMapEventInput['extendedProps']['status']
}

function normalizePriority(value: unknown): string {
  const aliases: Record<string, string> = { 高: 'high', 中: 'medium', 低: 'low' }
  const raw = aliases[String(value || 'medium').toLowerCase().trim()] || String(value || 'medium').toLowerCase().trim()
  return ['high', 'medium', 'low'].includes(raw) ? raw : 'medium'
}

function contextWindow(task: HumanOSTask): Record<string, unknown> {
  return task.contextWindow || {}
}

function estimateMinutes(task: HumanOSTask): number {
  if (asNumber(task.duration) > 0) return asNumber(task.duration)
  return 0
}

function mapTaskToEvent(task: HumanOSTask, session?: Record<string, any>): HumanOSMapEventInput | null {
  const context = contextWindow(task)
  const sessionStart = toISOString(session?.planned_start_at)
  const taskStart = toISOString(task.start_at) || toISOString(context.startAt) || toISOString(context.start_at) || toISOString(task.start_time) || toISOString(task.start)
  const start = sessionStart || taskStart
  if (!start) return null
  const sessionEnd = toISOString(session?.planned_end_at)
  const taskEnd = toISOString(task.end_time) || toISOString(task.end)
  let end = sessionEnd || taskEnd
  const endWasDerived = !end
  if (!end) {
    const minutes = estimateMinutes(task)
    if (minutes <= 0) return null
    const date = new Date(start)
    date.setMinutes(date.getMinutes() + minutes)
    end = date.toISOString()
  }
  return {
    id: String(session?.execution_session_id || task.id || `tmp-${Date.now()}`),
    title: task.title || 'Untitled',
    start,
    end,
    allDay: Boolean(task.all_day),
    extendedProps: {
      description: task.context || '',
      status: normalizeStatus(session?.status === 'ready' ? task.status || 'scheduled' : session?.status || task.status),
      priority: normalizePriority(task.priority),
      attendees: task.attendees || [],
      context: task.context || '',
      progress: taskText(task, 'progress'),
      nextStep: taskText(task, 'next_step'),
      openQuestions: taskText(task, 'open_questions'),
      execution: task.execution || {},
      executionSessionId: session?.execution_session_id,
      blockId: session?.block_id,
      taskType: String(task.task_type || ''),
      start_at: task.start_at || undefined,
      taskId: String(task.id || ''),
      planRevision: session?.plan_revision,
      duration: asNumber(task.duration) || undefined,
      deadline_at: toISOString(task.deadline_at) || undefined,
      expectedDifficulty: task.expected_difficulty ?? null,
      dependency: taskText(task, 'dependency'),
      resourceModality: task.resource_modality || [],
      attentionMode: task.attention_mode,
      parallelizable: task.parallelizable,
      fieldSources: {
        start: sessionStart ? 'execution_session' : 'user_or_persisted',
        end: sessionEnd ? 'execution_session' : endWasDerived ? 'system_derived' : 'user_or_persisted',
        title: task.title ? 'user_or_persisted' : 'default_unconfirmed',
        priority: task.priority ? 'user_or_persisted' : 'default_unconfirmed',
        status: session?.status ? 'execution_session' : task.status ? 'user_or_persisted' : 'default_unconfirmed',
        attentionMode: task.attention_mode ? 'user_or_persisted' : 'default_unconfirmed',
        context: task.context ? 'user_or_persisted' : 'default_unconfirmed',
        progress: taskText(task, 'progress') ? 'user_or_persisted' : 'default_unconfirmed',
        nextStep: taskText(task, 'next_step') ? 'user_or_persisted' : 'default_unconfirmed',
        openQuestions: taskText(task, 'open_questions') ? 'user_or_persisted' : 'default_unconfirmed',
        duration: task.duration ? 'user_or_persisted' : 'default_unconfirmed',
        deadline: task.deadline_at ? 'user_or_persisted' : 'default_unconfirmed',
        dependency: taskText(task, 'dependency') || task.dependency ? 'user_or_persisted' : 'default_unconfirmed',
        resourceModality: task.resource_modality?.length ? 'user_or_persisted' : 'default_unconfirmed',
        parallelizable: typeof task.parallelizable === 'boolean' ? 'user_or_persisted' : 'default_unconfirmed',
      },
      fieldProvenance: task.field_provenance || {},
    },
  }
}

function inRange(event: HumanOSMapEventInput, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true
  const eventStart = Date.parse(event.start || '')
  const eventEnd = Date.parse(event.end || event.start)
  const left = Date.parse(start)
  const right = Date.parse(end)
  return [eventStart, eventEnd, left, right].some(Number.isNaN) || (eventStart < right && eventEnd > left)
}

export function projectCalendarEvents(
  tasks: HumanOSTask[],
  sessions: Array<Record<string, any>>,
  rangeStart?: string | null,
  rangeEnd?: string | null,
): HumanOSMapEventInput[] {
  const taskById = new Map(tasks.filter((task) => !task.is_preview && !task.id?.startsWith('preview-')).map((task) => [String(task.id), task]))
  const visibleSessions = sessions.filter((session) => !['superseded', 'cancelled'].includes(String(session.status || '').toLowerCase()))
  const sessionTaskIds = new Set(visibleSessions.map((session) => String(session.task_id || '')))
  const sessionEvents = visibleSessions.map((session) => {
    const task = taskById.get(String(session.task_id || ''))
    if (!task) return null
    return mapTaskToEvent(task, session)
  })
  const directTaskEvents = tasks
    .filter((task) => !task.schedule_constraints && !task.is_preview && !task.id?.startsWith('preview-') && !sessionTaskIds.has(String(task.id || '')))
    .map((task) => mapTaskToEvent(task))
  return [...sessionEvents, ...directTaskEvents]
    .filter((event): event is HumanOSMapEventInput => event !== null)
    .filter((event) => inRange(event, rangeStart, rangeEnd))
}

export function projectDraftPlanEvents(plan: Record<string, any> | null, tasks: HumanOSTask[], rangeStart?: string | null, rangeEnd?: string | null, timezone = 'UTC'): HumanOSMapEventInput[] {
  if (!plan || plan.plan_status === 'confirmed') return []
  const periodStart = new Date(`${plan.week_id}T00:00:00`)
  if (Number.isNaN(periodStart.getTime())) return []
  const taskById = new Map(tasks.map((task) => [String(task.id), task]))
  return (plan.plan_patch || []).map((block: Record<string, any>, index: number) => {
    const start = toISOString(block.start_at) || draftInstant(plan.week_id, Number(block.day_index), Number(block.start), timezone)
    const end = toISOString(block.end_at) || draftInstant(plan.week_id, Number(block.day_index), Number(block.end), timezone)
    const task = taskById.get(String(block.task_id))
    return {
      id: `draft-${plan.plan_id}-${block.block_id || index}`,
      title: task?.title || block.title || 'Untitled',
      start, end, allDay: false,
      extendedProps: {
        description: task?.context || '', status: 'proposed', priority: normalizePriority(task?.priority), attendees: [], context: task?.context || '', progress: taskText(task || {}, 'progress'), nextStep: taskText(task || {}, 'next_step'), openQuestions: taskText(task || {}, 'open_questions'), blockId: block.block_id, taskType: String(task?.task_type || ''), start_at: task?.start_at || undefined, taskId: String(task?.id || block.task_id || ''), isPreview: true, planRevision: plan.plan_revision, parallelGroupId: block.parallel_group_id, parallelRole: block.parallel_role,
        duration: asNumber(task?.duration) || undefined, deadline_at: toISOString(task?.deadline_at) || undefined, expectedDifficulty: task?.expected_difficulty ?? null, dependency: taskText(task || {}, 'dependency'), resourceModality: task?.resource_modality || [], attentionMode: task?.attention_mode, parallelizable: task?.parallelizable,
        fieldSources: { start: 'system_derived', end: 'system_derived', title: task?.title ? 'user_or_persisted' : 'default_unconfirmed', priority: task?.priority ? 'user_or_persisted' : 'default_unconfirmed', status: 'system_derived', context: task?.context ? 'user_or_persisted' : 'default_unconfirmed', progress: taskText(task || {}, 'progress') ? 'user_or_persisted' : 'default_unconfirmed', nextStep: taskText(task || {}, 'next_step') ? 'user_or_persisted' : 'default_unconfirmed', openQuestions: taskText(task || {}, 'open_questions') ? 'user_or_persisted' : 'default_unconfirmed', duration: task?.duration ? 'user_or_persisted' : 'default_unconfirmed', deadline: task?.deadline_at ? 'user_or_persisted' : 'default_unconfirmed', dependency: taskText(task || {}, 'dependency') || task?.dependency ? 'user_or_persisted' : 'default_unconfirmed', resourceModality: task?.resource_modality?.length ? 'user_or_persisted' : 'default_unconfirmed', attentionMode: task?.attention_mode ? 'user_or_persisted' : 'default_unconfirmed', parallelizable: typeof task?.parallelizable === 'boolean' ? 'user_or_persisted' : 'default_unconfirmed' },
        fieldProvenance: task?.field_provenance || {},
      },
    }
  }).filter((event: HumanOSMapEventInput) => inRange(event, rangeStart, rangeEnd)).map((event: HumanOSMapEventInput) => {
    const block = (plan.plan_patch || []).find((item: any) => item.block_id === event.extendedProps.blockId)
    return block && (['fixed_event', 'recurring_routine', 'flexible_activity'].includes(block.kind) || taskById.get(String(block.task_id))?.schedule_constraints) ? { ...event, editable: false,
      extendedProps: { ...event.extendedProps, taskType: block.kind } } : event
  })
}

export function projectProfileActivityEvents(plan: Record<string, any> | null, rangeStart?: string | null, rangeEnd?: string | null, tasks: HumanOSTask[] = [], timezone = 'UTC'): HumanOSMapEventInput[] {
  if (!plan || !['confirmed', 'needs_update'].includes(plan.plan_status)) return []
  const taskById = new Map(tasks.map(task => [String(task.id), task]))
  const blocks = (plan.plan_patch || []).filter((block: any) => block.kind === 'flexible_activity'
    || (['fixed_event', 'recurring_routine'].includes(block.kind)
      && (!taskById.has(String(block.task_id)) || taskById.get(String(block.task_id))?.schedule_constraints)))
  const events = projectDraftPlanEvents({ ...plan, plan_status: 'proposed', plan_patch: blocks }, tasks, rangeStart, rangeEnd, timezone)
  return events.map(event => ({ ...event, id: event.id.replace(/^draft-/, 'activity-'),
    extendedProps: { ...event.extendedProps, status: 'scheduled', isPreview: false,
      taskType: event.extendedProps.taskType || 'flexible_activity' } }))
}
