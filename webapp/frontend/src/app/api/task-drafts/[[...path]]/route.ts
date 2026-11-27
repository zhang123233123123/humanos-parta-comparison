import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'
import { humanosRequest, humanosErrorResponse } from '@/lib/server/humanos-api'

async function forward(req: Request, context: { params: { path?: string[] } }) {
  const user = await getHumanOSUserId()
  if (!user) return unauthorizedResponse()
  const segments = context.params.path || []
  const path = '/api/task-drafts' + (segments.length ? '/' + segments.map(encodeURIComponent).join('/') : '')
  try {
    if (req.method === 'GET') return Response.json(await humanosRequest('GET', `${path}?user_id=${encodeURIComponent(user)}`))
    const body = await req.json()
    if (!Number.isInteger(body.version)) return Response.json({ error: 'Draft version required' }, { status: 400 })
    return Response.json(await humanosRequest(req.method as 'POST' | 'PATCH', path, { ...body, user_id: user }))
  } catch (error) { return humanosErrorResponse(error) }
}
export { forward as GET, forward as POST, forward as PATCH }
