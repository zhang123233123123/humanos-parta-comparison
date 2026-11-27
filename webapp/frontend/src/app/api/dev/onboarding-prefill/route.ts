import { createHash } from 'node:crypto'
import { getServerSession } from 'next-auth'
import authOptions from '@/app/api/auth/[...nextauth]/authOptions'
import fixture from '@/lib/fixtures/onboarding-demo.json'
import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'

// Read-only defaults for fresh accounts in the local development app.
// Saving, checking in, and generating a plan remain normal form actions.
export async function GET() {
  if (process.env.NODE_ENV !== 'development' || process.env.HUMANOS_DEMO_MODE !== '1') return new Response(null, { status: 404 })
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return new Response(null, { status: 401 })
  const userId = session.user.id
  try {
    const query = `user_id=${encodeURIComponent(session.user.id)}`
    const [profileResult, tasksResult] = await Promise.all([
      humanosRequest<{ data: { profile: {
        active_week_id: string; last_daily_checkin_date?: string;
        research_context?: { onboarding_completed?: boolean; onboarding_step?: number; revision?: number };
        weekly_context?: { weekly_goal?: string; context_items?: unknown[] };
      } } }>('GET', `/api/profile?${query}`),
      humanosRequest<{ data: { tasks: unknown[] } }>('GET', `/api/tasks?${query}`),
    ])
    const profile = profileResult.data.profile
    const research = profile.research_context
    if (research?.onboarding_completed || research?.onboarding_step !== undefined
      || (research?.revision || 0) > 1 || profile.last_daily_checkin_date
      || tasksResult.data.tasks.length || profile.weekly_context?.weekly_goal
      || profile.weekly_context?.context_items?.length) {
      return Response.json({ draft: null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: fixture.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date())
    const part = (name: string) => parts.find(p => p.type === name)!.value
    const day0 = `${part('year')}-${part('month')}-${part('day')}`
    const shift = (date: string, days: number) => {
      const result = new Date(`${date}T12:00:00Z`)
      result.setUTCDate(result.getUTCDate() + days)
      return result.toISOString().slice(0, 10)
    }
    const start = profile.active_week_id.slice(0, 10)
    const end = shift(start, 6)
    const id = (key: string) => `prefill-${createHash('sha256')
      .update(`${userId}:humanos-demo-profile-v1:${day0}:${key}`).digest('hex').slice(0, 24)}`
    const tasks = fixture.draft.tasks.map(task => {
      const rule = fixture.deadlines.find(r => r.draft_task_id === task.id)!
      const date = shift(day0, rule.local_day_offset)
      if (date < start || date > end) throw new Error('测试任务日期超出当前七天规划期，未自动填入。')
      return { ...task, id: id(task.id), deadline_at: `${date}T${rule.local_time}` }
    })
    return Response.json({ draft: {
      ...fixture.draft, timezone: fixture.timezone, tasks,
      contextItems: fixture.draft.contextItems.map(item => ({ ...item, id: id(item.id) })),
      stateRequestId: id('state'), stateSaved: '', preview: false, publishedPlanId: '',
    } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return humanosErrorResponse(error)
  }
}
