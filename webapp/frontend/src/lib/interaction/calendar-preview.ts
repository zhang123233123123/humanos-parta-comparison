import { apiRequest } from '../client/api'
import type { PlanDecision } from '../contracts/planning-contracts'
import type { HumanOSTask } from '../contracts/task-contracts'
import type { RuntimeProposal, RuntimeSnapshot } from './contracts'
import { validateProposal } from './core'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { useEvents } from '@/hooks/use-events'

/** An acknowledged candidate uses the existing editable calendar confirmation flow. */
export async function presentLiveFeedbackPreview(proposal: RuntimeProposal, snapshot: RuntimeSnapshot) {
  validateProposal(proposal, snapshot)
  const [p, a, t] = await Promise.all([
    apiRequest<{data:{plan:PlanDecision|null}}>('/api/plans/proposed', {cache:'no-store'}),
    apiRequest<{data:{plan:PlanDecision|null}}>('/api/plans/active', {cache:'no-store'}),
    apiRequest<{data:{tasks:HumanOSTask[]}}>('/api/tasks', {cache:'no-store'}),
  ])
  const plan=p.data.plan, base=a.data.plan
  if (!plan || plan.plan_id!==proposal.id || plan.plan_status!=='proposed' || !base || base.plan_id!==snapshot.plan_id || base.plan_revision!==snapshot.plan_revision) throw new Error('Proposal changed')
  usePlanPreview.getState().load(plan,base,snapshot.profile.user_id,snapshot.state_id,
    Object.fromEntries(t.data.tasks.map(task=>[task.id,task.title])),snapshot.profile.timezone,
    Object.fromEntries(t.data.tasks.map(task=>[task.id,task])))
  await useEvents.getState().refetchEvents()
  window.dispatchEvent(new CustomEvent('humanos:navigate-week',{detail:{week:snapshot.gate.local_date}}))
}
