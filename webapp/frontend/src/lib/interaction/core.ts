import type { DailyPlanReview } from '../contracts/checkin-contracts'
import type { DailyGate, PlanAuthorization, ReviewOutcome, RuntimeProposal, RuntimeSnapshot, StateValues, WorkSession } from './contracts'

export const MOODS = [
  { value: 'positive', emoji: '🙂', zh: '心情不错', en: 'Good' },
  { value: 'neutral', emoji: '😐', zh: '平静', en: 'Neutral' },
  { value: 'low', emoji: '😔', zh: '低落', en: 'Low' },
  { value: 'anxious', emoji: '😟', zh: '焦虑', en: 'Anxious' },
] as const
export function validState(value: StateValues): boolean {
  return MOODS.some(m => m.value === value.mood) && ['energy', 'focus', 'stress'].every(key => {
    const n = value[key as 'energy']; return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 7
  })
}
export function dailyRecorded(gate: DailyGate): boolean {
  return gate.required === false && gate.last_daily_checkin_date === gate.local_date
}
export function localDate(now: number, timezone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (name: string) => p.find(x => x.type === name)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function sessionKey(s: WorkSession): string { return `${s.plan_id}:${s.plan_revision}:${s.id}` }
export function isOpenSession(s: WorkSession): boolean { return ['ready', 'scheduled', 'running', 'paused'].includes(s.status) }
export function dueSessions(sessions: WorkSession[], now: number): WorkSession[] {
  return sessions.filter(s => s.kind === 'work' && isOpenSession(s) && Number.isFinite(Date.parse(s.end)) && Date.parse(s.end) <= now)
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))
}
export function nextAfterStillWorking(a: WorkSession, sessions: WorkSession[], now: number): WorkSession | undefined {
  return sessions.filter(b => b.id !== a.id && b.kind === 'work' && isOpenSession(b)
    && Date.parse(b.start) >= Date.parse(a.end) && Date.parse(b.start) <= now)
    .sort((x, y) => Date.parse(x.start) - Date.parse(y.start))[0]
}
export function reviewOutcome(review: DailyPlanReview | null | undefined): ReviewOutcome {
  if (!review || review.assessment_status === 'unavailable') return { kind: 'error', reason: review?.reason || '', missing: [], raw: review || null }
  if (review.decision === 'insufficient_information') return { kind: 'insufficient', reason: review.reason || '', missing: review.missing_information || [], raw: review }
  if (review.decision === 'keep_plan') return { kind: 'keep', reason: review.reason || '', missing: [], raw: review }
  if (review.decision === 'suggest_adjustment') return { kind: 'adjust', reason: review.reason || '', missing: [], raw: review }
  // Missing decision/transport success is not evidence for keeping the plan.
  return { kind: 'error', reason: '', missing: [], raw: review }
}
export function authorization(snapshot: RuntimeSnapshot, requestId: string, candidateIds: string[] = [], extend = false): PlanAuthorization {
  return {
    request_id: requestId, base_plan_id: snapshot.plan_id, base_plan_revision: snapshot.plan_revision,
    base_state_id: snapshot.state_id, authorized_candidate_ids: [...new Set(candidateIds)],
    adjustable_session_ids: snapshot.sessions.filter(s => s.id !== snapshot.active_session_id && !s.started_at && isOpenSession(s) && Date.parse(s.start) >= snapshot.now
      && (extend || localDate(Date.parse(s.start), snapshot.profile.timezone) === snapshot.gate.local_date)).map(s => s.id),
    scope: extend ? 'remaining_planning_period' : 'today', local_date: snapshot.gate.local_date,
  }
}
export function proposalIsCurrent(proposal: RuntimeProposal, snapshot: RuntimeSnapshot): boolean {
  const a = proposal.authorization
  return a.base_plan_id === snapshot.plan_id && a.base_plan_revision === snapshot.plan_revision
    && a.base_state_id === snapshot.state_id && a.local_date === snapshot.gate.local_date
}
export function validateProposal(proposal: RuntimeProposal, snapshot: RuntimeSnapshot): void {
  if (!proposalIsCurrent(proposal, snapshot)) throw new Error('stale_proposal')
  const allowed = new Set([...proposal.authorization.adjustable_session_ids, ...proposal.authorization.authorized_candidate_ids])
  if (proposal.changes.some(c => !allowed.has(c.session_id))) throw new Error('outside_authorized_scope')
  if (proposal.changes.some(c => snapshot.sessions.some(s => s.id === c.session_id && (s.started_at || s.id === snapshot.active_session_id || !isOpenSession(s))))) throw new Error('work_already_started_or_closed')
  if (!proposal.valid || proposal.status !== 'proposed') throw new Error('invalid_proposal')
}
