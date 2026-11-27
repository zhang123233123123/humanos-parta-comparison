import { humanosErrorResponse, humanosRequest } from './humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from './humanos-user'

export async function workspacePost(request: Request, path: string) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  let body: Record<string, unknown>
  try {
    body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.request_id !== 'string' || !body.request_id.trim()) throw new Error('request_id is required')
  } catch { return Response.json({ error: 'validation_error', message: 'A JSON object with request_id is required' }, { status: 400 }) }
  const report = path.endsWith('/report'), proposal = path.endsWith('/propose')
  const ids = report ? ['source_session_id', 'original_task_id', 'plan_id'] : proposal ? ['base_plan_id', 'local_date'] : ['session_id']
  const revision = report ? 'plan_revision' : 'base_plan_revision'
  if (ids.some(key => typeof body[key] !== 'string' || !(body[key] as string).trim()) || !Number.isInteger(body[revision])
    || (report && (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)))
    || (proposal && (!Array.isArray(body.adjustable_session_ids) || !Array.isArray(body.authorized_candidate_ids)))
    || (path.endsWith('/workspace-start') && !('expected_active_id' in body))
    || (path.endsWith('/defer') && body.confirmed_not_started !== true)) {
    return Response.json({ error: 'validation_error', message: 'Required workspace execution fields are missing or invalid' }, { status: 400 })
  }
  try {
    const result = await humanosRequest('POST', path, { ...body, user_id: userId })
    return Response.json(result, { status: 201 })
  } catch (error) { return humanosErrorResponse(error) }
}
