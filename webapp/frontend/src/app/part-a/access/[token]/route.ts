import { NextRequest, NextResponse } from 'next/server'
import { PART_A_COOKIE, validPartALink } from '@/lib/server/part-a-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }
  if (!validPartALink(params.token))
    return new NextResponse('专属链接无效，请使用有效的 Part A 访问链接。', { status: 404, headers })
  const origin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : req.nextUrl.origin
  const response = NextResponse.redirect(new URL('/part-a', origin), { status: 303, headers })
  response.cookies.set(PART_A_COOKIE, params.token, {
    httpOnly: true, secure: origin.startsWith('https://'), sameSite: 'strict', path: '/', maxAge: 7 * 24 * 60 * 60,
  })
  return response
}
