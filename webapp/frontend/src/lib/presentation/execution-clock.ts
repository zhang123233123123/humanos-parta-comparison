import type { ExecutionSession } from '../contracts/execution-contracts'

function interruptionSnapshot(session: ExecutionSession | null): Record<string, unknown> {
  if (session?.interruption_snapshot) return session.interruption_snapshot
  try {
    const parsed: unknown = JSON.parse(session?.interruption_snapshot_json ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function timestamp(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? (value > 9999999999 ? value : value * 1000) : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function executionClock(session: ExecutionSession | null, now: number) {
  const accumulated = Math.max(Number(session?.accumulated_active_minutes ?? session?.actual_minutes ?? 0), 0)
  const started = timestamp(session?.resumed_at ?? session?.actual_start_at ?? session?.started_at)
  const running = session?.status === 'running'
  const segment = running && started != null ? Math.max(Math.floor((now - started) / 1000), 0) : 0
  const elapsedSeconds = accumulated * 60 + segment
  const baseline = Math.max(Number(interruptionSnapshot(session).continuation_active_baseline_minutes ?? 0), 0)
  // Backend session_remaining_minutes already includes the live segment.
  // Recompute from the total budget, never subtract that segment twice.
  const remainingMinutes = running
    ? Math.max(Number(session?.planned_work_minutes ?? 0) - Math.max(Math.floor(elapsedSeconds / 60) - baseline, 0), 0)
    : Math.max(Number(session?.session_remaining_minutes ?? Number(session?.planned_work_minutes ?? 0) - accumulated), 0)
  return { elapsedSeconds, remainingMinutes }
}

export function executionFeedbackDefaults(session: ExecutionSession, task: ExecutionSession['task']) {
  const actualMinutes = Math.max(Number(session.accumulated_active_minutes ?? session.actual_minutes ?? 0), 0)
  const previous = task?.execution?.remaining_duration_minutes
  const settled = Number(interruptionSnapshot(session).actual_minutes ?? 0)
  return {
    actualMinutes,
    // A Session's remainder is never a substitute for the whole Task's work.
    remainingMinutes: typeof previous === 'number' ? Math.max(previous + settled - actualMinutes, 0) : undefined,
  }
}

// Derive the confirmed interval from persisted active time; pauses consume no budget.
export function confirmedWorkRemainingSeconds(session: ExecutionSession | null, now: number): number | null {
  if (session?.confirmed_work_minutes == null || session.confirmed_work_baseline_seconds == null) return null
  const { elapsedSeconds } = executionClock(session, now)
  return Math.max(Math.ceil(session.confirmed_work_minutes * 60 - Math.max(elapsedSeconds - session.confirmed_work_baseline_seconds, 0)), 0)
}
