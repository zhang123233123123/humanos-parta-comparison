import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function PATCH(req: Request, { params }: { params: { threadId: string } }) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const { title, active } = await req.json()
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.trim().length > 100)) return Response.json({ error: 'Invalid title' }, { status: 400 })
    return Response.json(await humanosRequest('PATCH', `/api/chat/threads/${encodeURIComponent(params.threadId)}`, { user_id: userId, title, active: active === true }))
  } catch (error) { return humanosErrorResponse(error) }
}
