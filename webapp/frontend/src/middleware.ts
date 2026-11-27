import { withAuth } from 'next-auth/middleware'
import { NextRequest, NextResponse, NextFetchEvent } from 'next/server'

const protectedRoutes = withAuth({ pages: { signIn: '/login' } })

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // Next.js may expose an internal origin behind the HTTPS reverse proxy.
  // Use the configured deployment origin, never an arbitrary forwarded host.
  const publicOrigin = process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL).origin
    : request.nextUrl.origin
  if (process.env.HUMANOS_SIMULATION_MODE === '1' && request.nextUrl.pathname.startsWith('/app/') && !request.nextUrl.pathname.startsWith('/app/simulation')) {
    return NextResponse.redirect(new URL('/app', publicOrigin))
  }
  if (process.env.HUMANOS_DEMO_MODE === '1' && process.env.NEXT_PUBLIC_HUMANOS_DEMO_MODE === '1') {
    if (request.nextUrl.pathname.startsWith('/api/') || request.method !== 'GET') {
      return NextResponse.json({ error: 'demo_network_blocked', message: '演示接口只在浏览器会话中运行，真实服务已隔离。' }, { status: 503 })
    }
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', "connect-src 'self' ws://localhost:3100 ws://127.0.0.1:3100; img-src 'self' data: blob:; frame-src 'none'; form-action 'self'")
    return response
  }
  // Preserve the original protected /app scope in normal mode.
  if (request.nextUrl.pathname === '/app' || request.nextUrl.pathname.startsWith('/app/')) {
    const response = await (protectedRoutes as any)(request, event)
    const location = response?.headers.get('location')
    if (location) {
      const target = new URL(location, request.url)
      if (target.origin === request.nextUrl.origin) {
        response.headers.set('location', new URL(target.pathname + target.search + target.hash, publicOrigin).toString())
      }
    }
    return response
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
