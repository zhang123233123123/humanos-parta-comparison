import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function POST(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const body = await req.json()
    if (body.stage === 'manual' ? (typeof body.request_id !== 'string' || !body.request_id.trim() || body.request_id.length > 200) : (!body.execution_session_id || !Number.isInteger(body.duration_minutes) || body.duration_minutes < 1 || body.duration_minutes > 480)) {
      return Response.json({ error: '请选择执行记录和 1–480 分钟的时长。' }, { status: 400 })
    }
    return Response.json(await humanosRequest('POST', '/api/execution-sessions/adjustment', { ...body, user_id: userId }))
  } catch (error) { return humanosErrorResponse(error) }
}
