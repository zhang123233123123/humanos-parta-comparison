import { createHash, createHmac } from 'node:crypto'
import {
  getHumanOSUserId,
  unauthorizedResponse,
} from '@/lib/server/humanos-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function proxy(
  req: Request,
  { params }: { params: { path?: string[] } },
) {
  if (process.env.HUMANOS_SIMULATION_MODE !== '1')
    return Response.json({ message: '模拟模式未启用' }, { status: 404 })
  const actor = await getHumanOSUserId()
  if (!actor) return unauthorizedResponse()
  const secret = process.env.HUMANOS_SIMULATION_PROXY_SECRET || ''
  if (secret.length < 32)
    return Response.json({ message: '模拟代理尚未配置' }, { status: 503 })
  const body = req.method === 'GET' ? '' : await req.text()
  if (Buffer.byteLength(body) > 512000)
    return Response.json({ message: '请求过大' }, { status: 413 })
  const path =
    '/api/simulation/' +
    (params.path || []).map(encodeURIComponent).join('/') +
    new URL(req.url).search
  const timestamp = String(Math.floor(Date.now() / 1000))
  const digest = createHash('sha256').update(body).digest('hex')
  const signature = createHmac('sha256', secret)
    .update([timestamp, actor, req.method, path, digest].join('\n'))
    .digest('hex')
  try {
    const result = await fetch(
      (process.env.HUMANOS_BACKEND_URL || 'http://localhost:8787').replace(
        /\/$/,
        '',
      ) + path,
      {
        method: req.method,
        body: req.method === 'GET' ? undefined : body,
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: {
          'Content-Type': 'application/json',
          'X-Simulation-Actor': actor,
          'X-Simulation-Time': timestamp,
          'X-Simulation-Signature': signature,
        },
      },
    )
    return Response.json(await result.json(), { status: result.status })
  } catch {
    return Response.json(
      { message: '模拟后端暂时不可用，请刷新查看保存状态后重试。' },
      { status: 502 },
    )
  }
}
export const GET = proxy
export const POST = proxy
export const PATCH = proxy
