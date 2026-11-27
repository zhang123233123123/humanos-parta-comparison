import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function GET(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  const query = new URL(req.url).searchParams
  if (!query.get('thread_id')) return Response.json({ error: 'thread_id is required' }, { status: 400 })
  const forwarded = new URLSearchParams({ user_id: userId, thread_id: query.get('thread_id')!, limit: '30' })
  if (query.get('before')) forwarded.set('before', query.get('before')!)
  try { return Response.json(await humanosRequest('GET', `/api/chat/turns?${forwarded}`)) }
  catch (error) { return humanosErrorResponse(error) }
}
