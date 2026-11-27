import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

export async function POST(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const body = await req.json()
    const data = await humanosRequest('POST', '/api/state-checkins/review', {
      user_id: userId, locale: body.locale === 'en' ? 'en' : 'zh',
    })
    return Response.json({ data })
  } catch (error) {
    return humanosErrorResponse(error)
  }
}
