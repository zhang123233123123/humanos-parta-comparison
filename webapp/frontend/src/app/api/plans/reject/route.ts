import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'
export async function POST(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const body = await req.json()
    return Response.json(await humanosRequest('POST', '/api/plans/reject', { plan_id: body.plan_id, plan_revision: body.plan_revision, user_id: userId }))
  } catch (error) { return humanosErrorResponse(error) }
}
