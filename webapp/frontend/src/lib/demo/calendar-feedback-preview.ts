import { apiRequest } from '../client/api'
import type { PlanDecision } from '../contracts/planning-contracts'
import type { HumanOSTask } from '../contracts/task-contracts'
import type { RuntimeProposal, RuntimeSnapshot } from '../interaction/contracts'
import { validateProposal } from '../interaction/core'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { useEvents } from '@/hooks/use-events'
import { DEMO_MODE } from './config'

/** Present a fixture proposal through the same calendar and confirmation flow.
 * Loading this preview neither confirms the patch nor writes the active plan. */
export async function presentDemoFeedbackPreview(proposal: RuntimeProposal, snapshot: RuntimeSnapshot): Promise<void> {
  if (!DEMO_MODE) throw new Error('Demo preview requires explicit frontend preview mode.')
  validateProposal(proposal, snapshot)
  const [proposed, active, tasks] = await Promise.all([
    apiRequest<{ data: { plan: PlanDecision | null } }>('/api/plans/proposed', { cache: 'no-store' }),
    apiRequest<{ data: { plan: PlanDecision | null } }>('/api/plans/active', { cache: 'no-store' }),
    apiRequest<{ data: { tasks: HumanOSTask[] } }>('/api/tasks', { cache: 'no-store' }),
  ])
  const plan = proposed.data.plan, base = active.data.plan
  if (!plan || plan.plan_id !== proposal.id || plan.plan_status !== 'proposed' ||
    !base || base.plan_id !== snapshot.plan_id || (base.plan_revision || 0) !== snapshot.plan_revision) {
    throw new Error('The demo proposal no longer matches the current calendar.')
  }
  const list = tasks.data.tasks
  usePlanPreview.getState().load(plan, base, snapshot.profile.user_id!, snapshot.state_id,
    Object.fromEntries(list.map(task => [task.id, task.title])), snapshot.profile.timezone,
    Object.fromEntries(list.map(task => [task.id, task])))
  await useEvents.getState().refetchEvents()
  window.dispatchEvent(new CustomEvent('humanos:navigate-week', { detail: { week: snapshot.gate.local_date } }))
}
