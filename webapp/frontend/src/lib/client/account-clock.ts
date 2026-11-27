import type { AccountCapabilities, TestClock } from '../contracts/qa-contracts'

export type ClockAnchor = { simulatedAt: number; observedAt: number; rate: number }

export function clockAnchor(clock: TestClock, observedAt: number): ClockAnchor {
  const simulatedAt = Date.parse(clock.simulated_now)
  const rate = clock.using_real_time ? 1 : clock.time_scale
  if (!Number.isFinite(simulatedAt) || !Number.isFinite(rate) || rate < 0) {
    throw new Error('Invalid account clock response')
  }
  return { simulatedAt, observedAt, rate }
}

// Use a monotonic elapsed time so changing the computer clock cannot move QA time.
export function accountNow(anchor: ClockAnchor | null, monotonicNow: number, wallNow: number): number {
  return anchor ? anchor.simulatedAt + Math.max(monotonicNow - anchor.observedAt, 0) * anchor.rate : wallNow
}

export async function loadAccountClock(
  request: <T>(url: string, init?: RequestInit) => Promise<T>, monotonicNow: () => number,
): Promise<ClockAnchor | null> {
  const capabilities = await request<AccountCapabilities>('/api/account/capabilities', { cache: 'no-store' })
  if (!capabilities.test_clock) return null
  const clock = await request<TestClock>('/api/test-clock', { cache: 'no-store' })
  return clockAnchor(clock, monotonicNow())
}

export const CLOCK_CHANGE_KEY = 'humanos:account-clock-changed'
export function announceClockChange() {
  window.dispatchEvent(new Event(CLOCK_CHANGE_KEY))
  // Notify another open Focus tab. No account or simulated state is shared here;
  // each recipient fetches its own signed-in clock and execution records.
  try { window.localStorage.setItem(CLOCK_CHANGE_KEY, String(Date.now())) } catch { /* polling also resynchronizes */ }
}
