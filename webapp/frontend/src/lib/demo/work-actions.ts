import { DEMO_MODE } from './config'
import type { CandidateWork, StateValues } from '../interaction/contracts'
import { draftInstant } from '../calendar-draft-time'

export type WorkNote = { reason?: string; progress?: string; next?: string; content?: string; unfinished?: boolean; ended?: boolean; energy?: number; feedback?: StateValues; result?: 'done' | 'unfinished' | 'interrupted'; remaining_minutes?: number | null }
type Data = Record<string, any>
type Command = { action: 'pause' | 'resume' | 'note' | 'end'; sessionId: string; note?: WorkNote; completed?: boolean; energy?: number }

// UI-only commands bound to the existing in-memory Demo fixture. They do not
// create HTTP endpoints or extend any live request/response contract.
export function createDemoWorkController(store: Data, save: () => void, id: () => string) {
  const state = () => (store.interaction ||= { candidates: [], session_status: {}, started: {} })
  const read = () => ({ focus: state().last_session_id as string | undefined, notes: (state().work_notes || {}) as Record<string, WorkNote>, suggestions: (state().work_suggestions || []) as Array<{kind:string;session_id?:string}> })
  function command(command: Command) {
    const block = store.active?.plan_patch?.find((b: Data) => `session-${b.block_id}` === command.sessionId && b.kind === 'task_session')
    if (!block) throw new Error('This work session is no longer available.')
    const s = state(), key = command.sessionId
    s.work_notes ||= {}; s.session_status ||= {}; s.started ||= {}
    const note = s.work_notes[key] ||= {}
    if (command.action === 'resume') {
      const previous = s.active_session_id
      if (previous && previous !== key) { s.session_status[previous] = 'paused'; s.work_notes[previous] = { ...s.work_notes[previous], unfinished: true } }
      s.active_session_id = key; s.session_status[key] = 'running'; s.last_session_id = key
      s.started[key] ||= new Date(s.now || Date.now()).toISOString()
      Object.assign(note, { ended: false, unfinished: true })
    }
    if (command.action === 'pause') {
      if (s.active_session_id !== key) throw new Error('This session is not the current work.')
      s.session_status[key] = 'paused'; note.unfinished = true
    }
    if (command.action === 'end') {
      s.session_status[key] = command.completed ? 'completed' : 'interrupted'
      if (s.active_session_id === key) s.active_session_id = null
      s.last_session_id = key; note.ended = true; note.unfinished = !command.completed
      // Parent task completion and duration are deliberately unchanged.
      if (command.energy !== undefined) note.energy = command.energy
    }
    Object.assign(note, command.note || {})
    save()
  }
  function schedule(taskId: string, title: string, minutes: number | null, sessionId = ''): CandidateWork {
    const s = state(); s.candidates ||= []
    const existing = s.candidates.find((c: CandidateWork) => c.original_task_id === taskId && c.source_session_id === sessionId && c.status === 'pending')
    if (existing) return existing
    const task = store.tasks.find((t: Data) => t.id === taskId)
    if (!task || task.task_type === 'fixed_event') throw new Error('Task unavailable')
    const candidate: CandidateWork = { id: id(), original_task_id: taskId, source_session_id: sessionId, title,
      remaining_minutes: minutes, status: 'pending', source: sessionId ? 'interrupted_session' : 'explicitly_deferred_session',
      deadline: task.deadline_at || task.deadline_at || null, planning_period_end: draftInstant(store.profile.active_week_id, 6, 24, store.profile.timezone) }
    s.candidates.push(candidate)
    save(); return candidate
  }
  return { read, command, schedule }
}
let controller: ReturnType<typeof createDemoWorkController> | null = null
export function registerDemoWorkController(value: ReturnType<typeof createDemoWorkController>) { controller = value }
function available() { if (!DEMO_MODE || !controller) throw new Error('This action is available only in frontend Demo mode.'); return controller }
export function demoWorkState() { return DEMO_MODE && controller ? controller.read() : { focus: undefined, notes: {} as Record<string, WorkNote>, suggestions: [] as Array<{kind:string;session_id?:string}> } }
export function demoWorkCommand(command: Command) { available().command(command) }
export function demoScheduleTask(taskId: string, title: string, minutes: number | null, sessionId = '') { return available().schedule(taskId, title, minutes, sessionId) }
