import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function GET() {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try { return Response.json(await humanosRequest('GET', `/api/chat/threads?user_id=${encodeURIComponent(userId)}`)) }
  catch (error) { return humanosErrorResponse(error) }
}
export async function POST(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const { title } = await req.json()
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) return Response.json({ error: 'Invalid title' }, { status: 400 })
    return Response.json(await humanosRequest('POST', '/api/chat/threads', { user_id: userId, title }), { status: 201 })
  } catch (error) { return humanosErrorResponse(error) }
}
