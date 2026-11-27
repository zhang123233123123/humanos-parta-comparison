import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import { projectCalendarEvents, projectDraftPlanEvents, projectProfileActivityEvents } from '@/lib/server/calendar-event-projection'
import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function GET(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  const { searchParams } = new URL(req.url)
  try {
    const [taskEnvelope, executionData, proposedEnvelope, activeEnvelope, profileEnvelope] = await Promise.all([
      humanosRequest('GET', `/api/tasks?user_id=${encodeURIComponent(userId)}`),
      humanosRequest('GET', `/api/execution-sessions?user_id=${encodeURIComponent(userId)}`),
      humanosRequest('GET', `/api/plans/proposed?user_id=${encodeURIComponent(userId)}`),
      humanosRequest('GET', `/api/plans/active?user_id=${encodeURIComponent(userId)}`),
      humanosRequest('GET', `/api/profile?user_id=${encodeURIComponent(userId)}`),
    ]) as [any, any, any, any, any]
    const timezone = profileEnvelope?.data?.profile?.timezone
    if (!timezone) throw new Error('Calendar timezone is unavailable')
    const tasks = (taskEnvelope?.data?.tasks || []) as HumanOSTask[]
    const sessions = Array.isArray(executionData?.execution_sessions) ? executionData.execution_sessions : []
    const proposedPlan = searchParams.get('formal_only') === '1' ? null : proposedEnvelope?.data?.plan || proposedEnvelope?.plan || null
    const proposedTaskIds = new Set(
      (proposedPlan?.plan_patch || [])
        .map((block: Record<string, unknown>) => String(block.task_id || ''))
        .filter(Boolean),
    )
    const persistedEvents = projectCalendarEvents(tasks, sessions, searchParams.get('start'), searchParams.get('end'))
      .filter((event) => !proposedTaskIds.has(String(event.extendedProps.taskId || '')))
    const draftEvents = projectDraftPlanEvents(proposedPlan, tasks, searchParams.get('start'), searchParams.get('end'), timezone)
    const activePlan = activeEnvelope?.data?.plan || activeEnvelope?.plan || null
    const proposedActivityIds = new Set((proposedPlan?.plan_patch || []).filter((b: any) => ['fixed_event', 'recurring_routine', 'flexible_activity'].includes(b.kind)).map((b: any) => b.block_id))
    const activityEvents = projectProfileActivityEvents(activePlan, searchParams.get('start'), searchParams.get('end'), tasks, timezone)
      .filter(event => !proposedActivityIds.has(event.extendedProps.blockId))
    return Response.json({
      data: { events: [...persistedEvents, ...activityEvents, ...draftEvents] },
      resources: { tasks: '/api/tasks?view=resource', execution_sessions: '/api/execution-sessions', active_plan: '/api/plans/active', proposed_plan: '/api/plans/proposed' },
      meta: { resource: 'calendar_events', read_only: true },
    })
  } catch (error) {
    return humanosErrorResponse(error)
  }
}
