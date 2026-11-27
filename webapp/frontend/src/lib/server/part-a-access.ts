import { createHash, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const PART_A_COOKIE = 'humanos_parta_access'

export function validPartALink(token: string | undefined): boolean {
  const expected = process.env.HUMANOS_PARTA_LINK_HASH || ''
  if (process.env.HUMANOS_PARTA_MODE !== '1' || !/^[a-f0-9]{64}$/.test(expected)) return false
  if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) return false
  return timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(expected, 'hex'))
}

export function getPartAActor(): string | null {
  const actor = process.env.HUMANOS_PARTA_LINK_ACTOR || ''
  if (!/^parta_link_[a-f0-9]{32}$/.test(actor)) return null
  return validPartALink(cookies().get(PART_A_COOKIE)?.value) ? actor : null
}
