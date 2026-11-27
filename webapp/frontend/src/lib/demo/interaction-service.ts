import { apiRequest } from '../client/api'
import type { DailyPlanReview, RuntimeState } from '../contracts/checkin-contracts'
import type { CandidateWork, InteractionService, RuntimeProposal } from '../interaction/contracts'
import { createLiveService } from '../interaction/live-service'
import { DEMO_MODE } from './config'

interface DemoInteractionSnapshot {
  candidates: CandidateWork[]
  fixture_loaded?: boolean
  now?: number
  clock_rate?: number
  active_session_id?: string | null
  started?: Record<string, string>
}

/** Demo-only adapter. The browser mock transport owns all fixture persistence;
 * this adapter never changes live service capabilities or retries a real error
 * with fake data. Both the caller and this factory require explicit Demo mode.
 */
export function createDemoInteractionService(
  userId: string,
  locale: string,
  options: { delayMs?: number } = {},
): InteractionService {
  if (!DEMO_MODE) throw new Error('Demo interactions require explicit frontend preview mode.')

  // These ordinary read/state contracts are intercepted by the existing Demo
  // transport. Session reports and proposals use separately namespaced fixtures.
  const base = createLiveService(userId, locale)
  const delayMs = options.delayMs === undefined ? 600 : Math.max(0, Math.min(1500, options.delayMs))
  const wait = () => delayMs > 0 ? new Promise<void>(resolve => setTimeout(resolve, delayMs)) : Promise.resolve()
  const failure = () => new Error(locale === 'zh' ? '演示反馈暂时无法完成，请重试。' : 'The demo interaction could not finish. Please retry.')
  const post = async <T>(action: string, command: unknown): Promise<T> => {
    await wait()
    const result = await apiRequest<{ data: T }>(`/api/demo/interaction/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    })
    if (!result || !('data' in result)) throw failure()
    return result.data
  }
  const review = async (): Promise<DailyPlanReview> => {
    const data = await post<{ daily_plan_review: DailyPlanReview }>('review', { locale })
    if (!data?.daily_plan_review) throw failure()
    return data.daily_plan_review
  }

  return {
    mode: 'isolated-development',
    async snapshot() {
      const [snapshot, response] = await Promise.all([
        base.snapshot(),
        apiRequest<{ data: DemoInteractionSnapshot }>('/api/demo/interaction/snapshot', { cache: 'no-store' }),
      ])
      const extra = response.data
      if (!extra || !Array.isArray(extra.candidates)) throw failure()
      return {
        ...snapshot,
        candidates: extra.candidates,
        active_session_id: extra.active_session_id || null,
        sessions: snapshot.sessions?.map(s => ({ ...s, started_at: extra.started?.[s.id] || null })),
        ...(extra.fixture_loaded && Number.isFinite(extra.now) && extra.clock_rate === 0
          ? { now: extra.now!, clock_rate: 0 } : {}),
      }
    },
    async saveState(values, requestId, source) {
      await wait()
      // A review outage must not turn an acknowledged save into a save error.
      // The shared report flow checks the plan separately after this acknowledgement.
      return base.saveState(values, requestId, source)
    },
    review,
    async start(command) { await post('start', command) },
    async report(command) {
      const data = await post<{ runtime_state: RuntimeState; daily_plan_review: DailyPlanReview | null }>('report', command)
      if (!data?.runtime_state?.id) throw failure()
      return data
    },
    async defer(command) { await post('defer', command) },
    async propose(command) {
      const data = await post<{ runtime_proposal: RuntimeProposal }>('propose', command)
      if (!data?.runtime_proposal?.id) throw failure()
      return data.runtime_proposal
    },
    async apply(proposal, requestId) { await post('apply', { proposal, request_id: requestId }) },
  }
}
