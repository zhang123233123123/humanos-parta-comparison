import { humanosErrorResponse, humanosRequest } from '@/lib/server/humanos-api'
import { getHumanOSUserId, unauthorizedResponse } from '@/lib/server/humanos-user'

function taskResourceValidationError(body: any): string | null {
  const allowedTags = new Set(['visual', 'auditory', 'verbal', 'motor'])
  if (body.resource_modality !== undefined && (!Array.isArray(body.resource_modality) || body.resource_modality.some((tag: unknown) => !allowedTags.has(String(tag))))) {
    return 'resource_modality must contain only visual, auditory, verbal, or motor'
  }
  if (body.attention_mode !== undefined && !['continuous', 'intermittent', 'passive'].includes(String(body.attention_mode))) {
    return 'attention_mode must be continuous, intermittent, or passive'
  }
  return null
}

function withUserQuery(url: string, userEmail: string | undefined): string {
  const target = new URL(url, `http://localhost`)
  if (userEmail) target.searchParams.set('user_id', userEmail)
  return target.pathname + target.search
}

export async function GET() {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()
  try {
    const query = withUserQuery('/api/tasks', userId)
    return Response.json(await humanosRequest('GET', query))
  } catch (error) {
    return humanosErrorResponse(error)
  }
}

export async function POST(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()

  try {
    const body = await req.json().catch(() => ({}))
    const validationError = taskResourceValidationError(body)
    if (validationError) return Response.json({ error: validationError }, { status: 400 })
    const normalized = {
      ...body,
      user_id: userId,
    }
    return Response.json(await humanosRequest('POST', '/api/tasks', normalized))
  } catch (error) {
    return humanosErrorResponse(error)
  }
}

export async function PUT(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()

  try {
    const body = await req.json().catch(() => ({}))
    const validationError = taskResourceValidationError(body)
    if (validationError) return Response.json({ error: validationError }, { status: 400 })
    const taskId = String(body?.id || body?.task_id || '').trim()
    if (!taskId) {
      return Response.json({ error: 'Task id is required' }, { status: 400 })
    }

    const normalized = {
      ...body,
      user_id: userId,
    }
    delete (normalized as { id?: unknown }).id
    return Response.json(await humanosRequest('PATCH', `/api/tasks/${taskId}`, normalized))
  } catch (error) {
    return humanosErrorResponse(error)
  }
}

export async function PATCH(req: Request) {
  return PUT(req)
}

export async function DELETE(req: Request) {
  const userId = await getHumanOSUserId()
  if (!userId) return unauthorizedResponse()

  try {
    const body = await req.json().catch(() => ({}))
    const taskId = String(body?.id || body?.task_id || '').trim()
    if (!taskId) {
      return Response.json({ error: 'Task id is required' }, { status: 400 })
    }

    const data = await humanosRequest('DELETE', `/api/tasks/${taskId}?user_id=${encodeURIComponent(userId)}`)
    return Response.json(data)
  } catch (error) {
    return humanosErrorResponse(error)
  }
}
