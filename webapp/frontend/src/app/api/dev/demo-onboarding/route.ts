import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getServerSession } from 'next-auth'
import authOptions from '@/app/api/auth/[...nextauth]/authOptions'
import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'

// Local fixture recovery only. Credentials never enter this receipt or response.
export async function GET() {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 })
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return new Response(null, { status: 401 })
  if (session.user.email !== 'humanos.demo@example.com') return new Response(null, { status: 403 })
  try {
    const receipt = JSON.parse(await readFile(path.join(process.cwd(), 'logs/demo-import.json'), 'utf8'))
    if (receipt.fixture_id !== 'humanos-demo-profile-v1' || receipt.user_id !== session.user.id) {
      return new Response(null, { status: 403 })
    }
    const userQuery = `user_id=${encodeURIComponent(session.user.id)}`
    const profile = await humanosRequest<{ data: { profile: { research_context?: { onboarding_completed?: boolean } } } }>(
      'GET', `/api/profile?${userQuery}`,
    )
    if (profile.data.profile.research_context?.onboarding_completed) {
      return Response.json({ message: 'This account has already completed setup.' }, { status: 409 })
    }
    let preview = false
    if (receipt.plan_id) {
      const result = await humanosRequest<{ plan: { plan_id: string; plan_status: string; week_id: string } | null }>(
        'GET', `/api/plans/proposed?${userQuery}&week_id=${encodeURIComponent(receipt.week_id)}`,
      )
      preview = result.plan?.plan_id === receipt.plan_id
        && result.plan?.plan_status === 'proposed' && result.plan?.week_id === receipt.week_id
    }
    return Response.json({ draft: { ...receipt.draft, preview, publishedPlanId: '' } }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return humanosErrorResponse(error)
  }
}
