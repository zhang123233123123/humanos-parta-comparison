import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function PATCH(req: Request, { params }: { params: { patternId: string } }) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'status') || !['active', 'paused', 'deleted'].includes(body.status)) {
      return Response.json({ error: 'invalid_status', message: 'Only active, paused or deleted status may be submitted.' }, { status: 400 })
    }
    return Response.json(await humanosRequest('PATCH', `/api/behavior-patterns/${encodeURIComponent(params.patternId)}`, { status: body.status, user_id: userId }))
  } catch (error) { return humanosErrorResponse(error) }
}
