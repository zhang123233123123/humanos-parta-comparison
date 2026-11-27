import { apiRequest } from '../client/api'
import { accountNow, loadAccountClock } from '../client/account-clock'
import type { RuntimeState, DailyPlanReview } from '../contracts/checkin-contracts'
import type { InteractionService, RuntimeSnapshot, StateValues, WorkSession } from './contracts'
import { validateProposal } from './core'
export function createLiveService(userId: string, locale: string): InteractionService {
  let recent: RuntimeState | null = null
  let stateId: string | null = null
  const cacheKey = `humanos:acknowledged-state:v1:${encodeURIComponent(userId)}`
  const remember = (state: RuntimeState) => {
    recent = state; stateId = typeof state.id === 'string' ? state.id : null
    try { localStorage.setItem(cacheKey, JSON.stringify(state)) } catch { /* cache is optional; never the daily gate */ }
  }
  try { const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (cached?.id && cached.reported_at) { recent = cached; stateId = cached.id } } catch { /* no local report */ }
  return {
    mode: 'live',
    async snapshot(): Promise<RuntimeSnapshot> {
      try { const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (cached?.id && cached.reported_at) { recent = cached; stateId = cached.id } } catch { /* cache is not the daily gate */ }

      const [profileResult, gate, sessionResult, activeResult, tasksResult, anchor, pendingResult] = await Promise.all([
        apiRequest<any>('/api/profile', { cache: 'no-store' }), apiRequest<any>('/api/state-checkins', { cache: 'no-store' }),
        apiRequest<any>('/api/execution-sessions', { cache: 'no-store' }), apiRequest<any>('/api/plans/active', { cache: 'no-store' }),
        apiRequest<any>('/api/tasks', { cache: 'no-store' }), loadAccountClock(apiRequest, () => performance.now()),
        apiRequest<any>('/api/pending-work', { cache: 'no-store' }),
      ])
      if (typeof gate.required !== 'boolean' || !gate.local_date) throw new Error('Invalid daily status')
      if ('runtime_state' in gate) {
        if (gate.runtime_state?.id) remember(gate.runtime_state)
        else { recent = null; stateId = null }
      }
      const p = profileResult.data?.profile
      if (!p?.timezone) throw new Error('Account timezone unavailable')
      const plan = activeResult.data?.plan
      const tasks = new Map<string, any>((tasksResult.data?.tasks || []).map((t: any) => [String(t.id), t]))
      const blocks = new Set((plan?.plan_patch || []).map((b: any) => String(b.block_id || '')).filter(Boolean))
      const sessions: WorkSession[] = []
      for (const s of sessionResult.data?.execution_sessions || []) {
        const task = tasks.get(String(s.task_id)); const kind = String(task?.task_type || '')
        if (!plan?.plan_id || !blocks.has(String(s.block_id)) || !['flexible_task', 'work', 'task'].includes(kind)) continue
        if (!s.planned_start_at || !s.planned_end_at || ['superseded', 'cancelled'].includes(s.status)) continue
        sessions.push({ id: s.execution_session_id, task_id: String(s.task_id), title: task?.title || s.task_title || '',
          start: s.planned_start_at, end: s.planned_end_at, status: s.status, kind: 'work', block_id: s.block_id,
          planned_work_minutes: s.planned_work_minutes, started_at: s.actual_start_at || null,
          plan_id: plan.plan_id, plan_revision: Number(plan.plan_revision || 0), ordinal: 1,
          progress: s.interruption_snapshot?.progress, next_step: s.interruption_snapshot?.next_step || s.interruption_snapshot?.next_action })
      }
      const ordered = [...sessions].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      const counts = new Map<string, number>(); for (const s of ordered) { s.ordinal = (counts.get(s.task_id) || 0) + 1; counts.set(s.task_id, s.ordinal) }
      return { profile: { user_id: userId, timezone: p.timezone, onboarding_completed: p.research_context?.onboarding_completed === true, onboarding_submitted: p.research_context?.onboarding_submitted === true },
        gate, sessions: ordered, candidates: pendingResult.data.pending_work, active_session_id: ordered.find(s => s.status === 'running')?.id || ordered.find(s => s.status === 'paused')?.id || null,
        fixed_events: [...tasks.values()].flatMap(t => {
          if (t.task_type !== 'fixed_event' || !t.start_at) return []
          const start = Date.parse(t.start_at), minutes = Number(t.duration)
          if (!Number.isFinite(start) || !Number.isInteger(minutes) || minutes <= 0) return []
          return [{ id: String(t.id), title: t.title, start: t.start_at,
            end: new Date(start + minutes * 60000).toISOString(), kind: 'fixed' as const }]
        }),
        plan_id: plan?.plan_id || '', plan_revision: Number(plan?.plan_revision || 0),
        state_id: stateId, state: recent, clock_rate: anchor?.rate ?? 1, now: accountNow(anchor, performance.now(), Date.now()) }
    },
    async saveState(values: StateValues, requestId: string, source: string) {
      const response = await apiRequest<{ data: { runtime_state: RuntimeState; daily_plan_review: DailyPlanReview | null } }>('/api/state-checkins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, request_id: requestId, source, daily_checkin: true, locale }),
      })
      if (!response.data?.runtime_state?.id) throw new Error('State persistence not confirmed')
      remember(response.data.runtime_state); return response.data
    },
    async review() { const r = await apiRequest<{ data: { daily_plan_review: DailyPlanReview } }>('/api/state-checkins/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }),
    }); return r.data.daily_plan_review },
    async start(command) {
      const r = await apiRequest<any>('/api/execution-sessions/workspace-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
      if (r.data?.execution_session?.execution_session_id !== command.session_id || r.data.execution_session.status !== 'running') throw new Error('Start persistence not confirmed')
    },
    async report(command) {
      const r = await apiRequest<any>('/api/execution-sessions/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, locale }) })
      if (!r.data?.runtime_state?.id || r.data.execution_session?.execution_session_id !== command.source_session_id || !['completed', 'interrupted'].includes(r.data.execution_session.status)) throw new Error('Report persistence not confirmed')
      remember(r.data.runtime_state)
      return r.data
    },
    async defer(command) {
      const r = await apiRequest<any>('/api/execution-sessions/defer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
      if (r.data?.execution_session?.execution_session_id !== command.session_id || r.data.execution_session.status !== 'not_started') throw new Error('Deferral persistence not confirmed')
    },
    async propose(command) {
      const r = await apiRequest<any>('/api/execution-sessions/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, locale }) })
      if (!r.data?.proposal?.id) throw new Error('Proposal persistence not confirmed')
      return r.data.proposal
    },
    async apply(proposal, requestId) {
      validateProposal(proposal, await this.snapshot())
      const saved = await apiRequest<any>('/api/plans/proposed', {cache:'no-store'})
      const plan = saved.data?.plan
      if (!plan || plan.plan_id !== proposal.id || plan.plan_status !== 'proposed') throw new Error('Proposal changed')
      const post = (path:string, body:unknown) => apiRequest<any>(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      const checked = await post('/api/schedules/validate', plan)
      if (!(checked.validation || checked.data?.validation || checked).valid) throw new Error('Candidate failed constraint validation')
      const result = await post('/api/schedules/confirm', {...plan,request_id:requestId,expected_active_plan_id:proposal.authorization.base_plan_id,
        expected_active_plan_revision:proposal.authorization.base_plan_revision,expected_state_id:proposal.authorization.base_state_id})
      if (result.requires_rationale) throw new Error('Open the calendar preview to provide the requested change reason')
      if (result.plan?.plan_id !== proposal.id || result.plan.plan_status !== 'confirmed') throw new Error('Plan persistence not confirmed')
    },
  }
}
