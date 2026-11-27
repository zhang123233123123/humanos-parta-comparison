import { DEMO_MODE } from './config'
import { createDemoApi } from './api'

let installed = false
export function installDemoTransport() {
  if (!DEMO_MODE || typeof window === 'undefined' || installed) return
  installed = true
  // Existing components keep their draft storage calls, scoped to this tab only.
  // Demo runs on a separate origin and this substitution never runs in normal mode.
  Object.defineProperty(window, 'localStorage', { configurable: true, value: window.sessionStorage })
  const handle = createDemoApi(window.sessionStorage, new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin)
    if (url.origin !== window.location.origin) return Response.json({ message: '演示模式不连接外部服务。' }, { status: 503 })
    if (url.pathname.startsWith('/api/')) {
      const request = input instanceof Request ? new Request(input, init) : new Request(url, init)
      const response = await handle(request)
      if (url.pathname === '/api/schedules/confirm' && response.ok) window.dispatchEvent(new Event('humanos:demo-confirmed'))
      return response
    }
    // Next.js navigation/assets remain local. Server actions cannot invoke AI.
    if ((init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET') return Response.json({ message: '演示模式未连接服务器操作。' }, { status: 503 })
    return original(input, init)
  }
}

installDemoTransport()
