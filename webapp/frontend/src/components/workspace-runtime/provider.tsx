'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from '@/i18n/LanguageProvider'
import { createWorkspaceService } from '@/lib/interaction/workspace-service'
import { demoWorkCommand } from '@/lib/demo/work-actions'
import { DEMO_MODE } from '@/lib/demo/config'
import { dailyRecorded, dueSessions, isOpenSession, localDate, nextAfterStillWorking, reviewOutcome, sessionKey } from '@/lib/interaction/core'
import { CLOCK_CHANGE_KEY } from '@/lib/client/account-clock'
import type { DailyPlanReview } from '@/lib/contracts/checkin-contracts'
import { requestId } from '@/lib/client/request-id'
import type { FixedCommitment, InteractionService, OverlayRequest, ReviewOutcome, RuntimeSnapshot, WorkSession } from '@/lib/interaction/contracts'

interface RuntimeContextValue {
  service: InteractionService; snapshot: RuntimeSnapshot | null; now: number
  loading: boolean; readError: boolean; refresh: (fresh?: boolean) => Promise<RuntimeSnapshot | null>
  overlay: OverlayRequest | null; open: (request: OverlayRequest) => void; replace: (request: OverlayRequest) => void; close: () => void
  block: (id: string, active: boolean) => void; blocked: boolean; interactionBlocks: string[]
  due: WorkSession[]; stillWorking: Record<string, number>; markStillWorking: (s: WorkSession) => void
  overlap: { previous: WorkSession; next: WorkSession | FixedCommitment } | null; acknowledgeNext: () => void
  outcome: ReviewOutcome | null; showReview: (review: DailyPlanReview | null) => void; clearReview: () => void
  reviewDismissed: boolean; revealReview: () => void; dismissReview: () => void; pendingCount: number; reopenPending: () => void
  activeWork: WorkSession | null; startWork: (session: WorkSession, retain?: boolean, minutes?: number | null, progress?: string) => Promise<void>
  pendingRequests: OverlayRequest[]; finish: () => void; reviewStale: boolean; submitting: boolean; setSubmitting: (busy: boolean) => void
  currentSnapshot: () => RuntimeSnapshot | null
}
const RuntimeContext = createContext<RuntimeContextValue | null>(null)
export const useWorkspaceRuntime = () => useContext(RuntimeContext)

export function WorkspaceRuntimeRoot({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const { locale } = useTranslation()
  const accountId = session?.user?.id || ''
  const service = useMemo(() => accountId ? createWorkspaceService(accountId, locale) : null, [accountId, locale])
  if (!service) return <>{children}</>
  return <WorkspaceRuntimeProvider key={`${accountId}:${locale}`} accountId={accountId} service={service}>{children}</WorkspaceRuntimeProvider>
}

export function WorkspaceRuntimeProvider({ children, service, accountId }: { children: React.ReactNode; service: InteractionService; accountId: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState(false)
  const [overlay, setOverlay] = useState<OverlayRequest | null>(null)
  const [queue, setQueue] = useState<OverlayRequest[]>([])
  const [pendingRequests, setPendingRequests] = useState<OverlayRequest[]>([])
  const [pendingHydrated, setPendingHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reviewBase, setReviewBase] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<string[]>([])
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null)
  const [reviewDismissed, setReviewDismissed] = useState(false)
  const [stillWorking, setStillWorking] = useState<Record<string, number>>({})
  const [handledNext, setHandledNext] = useState<string[]>([])
  const offered = useRef(new Set<string>())
  const resetting = useRef(false)
  const inFlight = useRef<Promise<RuntimeSnapshot | null> | null>(null)
  const mounted = useRef(true)
  const clock = useRef<{ snapshot: RuntimeSnapshot; observed: number } | null>(null)
  const startAttempt = useRef<{ signature: string; id: string } | null>(null)
  const storageKey = `humanos:session-intent:v1:${encodeURIComponent(accountId)}`
  const offeredKey = `humanos:offered:v1:${encodeURIComponent(accountId)}`
  const pendingKey = `humanos:pending:v1:${encodeURIComponent(accountId)}`
  useEffect(() => { if (service.mode === 'live' && snapshot && !snapshot.profile.onboarding_completed && !snapshot.profile.onboarding_submitted && pathname?.startsWith('/app') && !pathname.startsWith('/app/onboarding')) router.replace('/app/onboarding') }, [service.mode, snapshot?.profile.onboarding_completed, pathname, router, snapshot])
  const isSetup = pathname?.startsWith('/app/onboarding') || !snapshot?.profile.onboarding_completed
  const blocked = blocks.length > 0 || Boolean(isSetup)
  const block = useCallback((id: string, active: boolean) => setBlocks(b => active ? (b.includes(id) ? b : [...b, id]) : b.filter(x => x !== id)), [])
  const currentSnapshot = useCallback(() => {
    if (!clock.current) return null
    const { snapshot: s, observed } = clock.current
    return { ...s, now: s.now + Math.max(0, performance.now() - observed) * (s.clock_rate ?? 1) }
  }, [])
  const refresh: RuntimeContextValue['refresh'] = useCallback((fresh = false): Promise<RuntimeSnapshot | null> => {
    // A read begun before a mutation cannot acknowledge its persisted result.
    if (fresh && inFlight.current) return inFlight.current.then(() => refresh(true))
    if (inFlight.current) return inFlight.current
    const request = service.snapshot().then(s => {
      if (!mounted.current) return null
      clock.current = { snapshot: s, observed: performance.now() }; setSnapshot(s); setNow(s.now); setReadError(false)
      return s
    }).catch(e => { console.error('HumanOS runtime read', e); if (mounted.current) setReadError(true); return null })
      .finally(() => { inFlight.current = null; if (mounted.current) setLoading(false) })
    inFlight.current = request; return request
  }, [service])
  useEffect(() => {
    mounted.current = true
    try { const x = JSON.parse(localStorage.getItem(storageKey) || '{}'); setStillWorking(x.still || {}); setHandledNext(x.next || []) } catch { /* no UI intent cache */ }
    try { offered.current = new Set(JSON.parse(sessionStorage.getItem(offeredKey) || '[]')) } catch { /* no dismissal cache */ }
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null')
      if (Array.isArray(saved?.requests)) setPendingRequests(saved.requests)
      if (saved?.outcome) { setOutcome(saved.outcome); setReviewBase(saved.base || null); setReviewDismissed(true) }
    } catch { /* optional pending presentation cache */ }
    setPendingHydrated(true)
    const update = () => { void refresh() }
    const visible = () => { if (document.visibilityState === 'visible') update() }
    const storage = (e: StorageEvent) => {
      if (e.key === storageKey) { try { const x = JSON.parse(e.newValue || '{}'); setStillWorking(x.still || {}); setHandledNext(x.next || []) } catch { /* ignore invalid cache */ } }
      if (e.key === CLOCK_CHANGE_KEY || e.key?.startsWith('humanos:acknowledged-state:')) update()
    }
    update(); const timer = window.setInterval(visible, 30000)
    for (const name of ['focus', 'humanos:daily-state-saved', 'humanos:tasks-updated', 'humanos:plan-revision', 'humanos:plan-updated', 'humanos:profile-updated', CLOCK_CHANGE_KEY]) window.addEventListener(name, update)
    document.addEventListener('visibilitychange', visible); window.addEventListener('storage', storage)
    return () => {
      mounted.current = false; window.clearInterval(timer)
      for (const name of ['focus', 'humanos:daily-state-saved', 'humanos:tasks-updated', 'humanos:plan-revision', 'humanos:plan-updated', 'humanos:profile-updated', CLOCK_CHANGE_KEY]) window.removeEventListener(name, update)
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('storage', storage)
    }
  }, [refresh, storageKey, offeredKey, pendingKey])
  useEffect(() => {
    if (!pendingHydrated) return
    try { sessionStorage.setItem(pendingKey, JSON.stringify({ requests: pendingRequests.filter(x => x.kind !== 'inbox' && x.kind !== 'reminders' && x.kind !== 'overlap'), outcome: outcome?.kind === 'keep' ? null : outcome, base: reviewBase })) } catch { /* optional UI cache */ }
  }, [pendingKey, pendingRequests, outcome, reviewBase, pendingHydrated])
  useEffect(() => { const timer = window.setInterval(() => {
    const s = currentSnapshot(); if (!s || readError) return
    setNow(s.now)
    if (localDate(s.now, s.profile.timezone) !== s.gate.local_date) void refresh()
  }, 1000); return () => window.clearInterval(timer) }, [currentSnapshot, readError, refresh])
  const offer = useCallback((id: string) => {
    offered.current.add(id)
    try { sessionStorage.setItem(offeredKey, JSON.stringify([...offered.current].slice(-300))) } catch { /* optional UI-only cache */ }
  }, [offeredKey])
  const enqueue = useCallback((request: OverlayRequest) => { if (overlay?.id === request.id) return; setQueue(q => q.some(x => x.id === request.id) ? q.map(x => x.id === request.id ? request : x) : [...q, request]) }, [overlay?.id, overlay?.kind])
  const open = useCallback((request: OverlayRequest) => {
    setReviewDismissed(true)
    setPendingRequests(q => q.some(x => x.id === request.id) ? q.map(x => x.id === request.id ? request : x) : [...q, request])
    if (['report', 'candidate'].includes(request.kind) && overlay && ['reminders', 'overlap', 'inbox', 'missed'].includes(overlay.kind)) { setOverlay(request); return }
    enqueue(request)
  }, [enqueue, overlay])
  useEffect(() => {
    if (!DEMO_MODE || service.mode !== 'isolated-development') return
    let generation = 0
    const start = async (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.fixture_loaded || typeof detail.source_session_id !== 'string') return
      const attempt = ++generation
      resetting.current = true
      setOverlay(null); setQueue([]); setPendingRequests([]); setOutcome(null); setReviewDismissed(false)
      setStillWorking({}); setHandledNext([]); offered.current.clear()
      try { localStorage.removeItem(storageKey); sessionStorage.removeItem(offeredKey) } catch { /* UI-only cache */ }
      // A previous read may have started before the fixture was replaced.
      if (inFlight.current) await inFlight.current
      if (attempt !== generation) return
      const current = await refresh()
      resetting.current = false
      if (!current || !mounted.current || attempt !== generation) return
      setOverlay(null); setQueue([])
      const source = current.sessions.find(s => s.id === detail.source_session_id && isOpenSession(s))
      if (!source) return
      dueSessions(current.sessions, current.now).forEach(s => offer(`end:${s.id}`))
      if (dueSessions(current.sessions, current.now).length) setQueue([{ id: 'reminders', kind: 'reminders', session_id: source.id }])
    }
    window.addEventListener('humanos:demo-feedback-scenario', start)
    return () => { generation++; window.removeEventListener('humanos:demo-feedback-scenario', start) }
  }, [service, refresh, offer, storageKey, offeredKey])
  // Promote only one request. External dialogs, teaching and initial review hold
  // the slot. A dismissed reminder remains reconstructible from session records.
  useEffect(() => {
    if (resetting.current || blocked || overlay || !queue.length || !snapshot) return
    // Recheck queued requests against the latest acknowledged data. An old daily
    // prompt or an already reported session must not replace a newer state.
    const priority = (x: OverlayRequest) => x.kind === 'report' || x.kind === 'switch' ? 0 : x.kind === 'state' ? 1 : x.kind === 'reminders' ? 2 : x.kind === 'overlap' ? 3 : 4
    const request = [...queue].sort((a, b) => priority(a) - priority(b))[0]
    if (outcome && outcome.kind !== 'keep' && !reviewDismissed && request.kind !== 'state' && request.kind !== 'report') return
    const current = request.kind === 'state' && request.source === 'daily' ? !dailyRecorded(snapshot.gate)
      : request.kind === 'report' ? snapshot.sessions.some(s => s.id === request.session.id && isOpenSession(s))
      : request.kind === 'overlap' ? Boolean(snapshot.active_session_id) : request.kind === 'reminders' ? dueSessions(snapshot.sessions, now).length > 0 : true
    if (current) setOverlay(request)
    setQueue(q => q.filter(x => x.id !== request.id))
  }, [blocked, overlay, outcome, reviewDismissed, queue, snapshot, now])
  const close = useCallback(() => {
    if (submitting) return
    setOverlay(null)
    // X dismisses presentation, never answers a reminder. Keep automatic work
    // in the notification count instead of immediately opening another prompt.
    setQueue([])
  }, [submitting])
  const finish = useCallback(() => { setPendingRequests(q => q.filter(x => x.id !== overlay?.id && !((overlay?.kind === 'state' || overlay?.kind === 'report') && x.kind === 'state'))); setOverlay(null); setQueue(q => q.filter(x => x.id !== overlay?.id)) }, [overlay?.id])
  const activeWork = snapshot?.sessions.find(s => s.id === snapshot.active_session_id && isOpenSession(s)) || null
  const startWork = useCallback(async (s: WorkSession, retain = false, minutes: number | null = null, progress = '') => {
    if (DEMO_MODE) demoWorkCommand({ action: 'resume', sessionId: s.id })
    else {
      const command = { session_id: s.id, base_plan_revision: snapshot!.plan_revision, expected_active_id: snapshot?.active_session_id || null, retain_previous: retain, remaining_minutes: retain ? minutes : null, progress }
      const signature = JSON.stringify(command)
      if (startAttempt.current?.signature !== signature) startAttempt.current = { signature, id: requestId('start-work') }
      await service.start({ ...command, request_id: startAttempt.current.id })
    }
    if (!await refresh(true)) throw new Error('Start saved, but runtime refresh failed')
    window.dispatchEvent(new Event('humanos:current-work'))
  }, [service, snapshot, refresh])
  const due = useMemo(() => dueSessions(snapshot?.sessions || [], now).filter(s => s.status !== 'paused'), [snapshot, now])
  const overlap = useMemo(() => {
    if (!activeWork || activeWork.status === 'paused') return null
    const options = [...(snapshot?.sessions || []).filter(s => isOpenSession(s)), ...(snapshot?.fixed_events || [])]
      .filter(s => s.id !== activeWork.id && Date.parse(s.start) >= Date.parse(activeWork.started_at || activeWork.start) && Date.parse(s.start) <= now && Date.parse(s.end) > now
        && !handledNext.includes(activeWork.id + ':' + s.id))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    return options[0] ? { previous: activeWork, next: options[0] } : null
  }, [snapshot, activeWork, handledNext, now])
  useEffect(() => {
    if (resetting.current || !overlap || blocked || overlay || queue.length || pathname !== '/app') return
    const id = 'overlap:' + overlap.previous.id + ':' + overlap.next.id
    if (!offered.current.has(id)) { offer(id); enqueue({ id, kind: 'overlap' }) }
  }, [overlap, blocked, overlay, queue.length, offer, enqueue, pathname])
  useEffect(() => {
    if (resetting.current || !snapshot || readError || isSetup || pathname !== '/app') return
    const dailyId = `daily:${snapshot.gate.local_date}`
    if (!dailyRecorded(snapshot.gate) && !offered.current.has(dailyId)) { offer(dailyId); enqueue({ id: dailyId, kind: 'state', source: 'daily' }); return }
    // Continuing never opens a second prompt when the following session starts.
    // The original session remains in due and can be reopened from notifications.
    const nextReminder = due.find(s => !stillWorking[s.id] && !offered.current.has(`end:${s.id}`))
    const reminderId = nextReminder ? `end:${nextReminder.id}` : null
    if (!reminderId || offered.current.has(reminderId) || blocked) return
    // A short cross-tab presentation lease, never a completion marker.
    const leaseKey = `humanos:reminder-lease:${accountId}`
    try { const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null'); if (lease && lease.expires > Date.now() && lease.id === reminderId) return; localStorage.setItem(leaseKey, JSON.stringify({ id: reminderId, expires: Date.now() + 30000 })) } catch { /* best-effort coordination */ }
    due.forEach(s => offer(`end:${s.id}`)); offer(reminderId)
    enqueue({ id: 'reminders', kind: 'reminders', session_id: nextReminder?.id })
  }, [snapshot, readError, isSetup, blocked, due, stillWorking, accountId, enqueue, offer, pathname])
  const persistIntent = useCallback((still: Record<string, number>, next: string[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ still, next })) } catch { /* no claim of server persistence */ }
  }, [storageKey])
  const markStillWorking = useCallback((s: WorkSession) => {
    const still = { [s.id]: now }; setStillWorking(still); persistIntent(still, handledNext)
    // Still working closes this prompt; do not immediately reopen a second one
    // at an A.end == B.start boundary that has already passed.
    const next = nextAfterStillWorking(s, snapshot?.sessions || [], now)
    if (next) offer(`overlap:${sessionKey(s)}:${next.id}`)
    close()
  }, [stillWorking, now, persistIntent, handledNext, snapshot, offer, close])
  const acknowledgeNext = useCallback(() => {
    if (!overlap) return
    const next = [...handledNext, `${overlap.previous.id}:${overlap.next.id}`]
    setHandledNext(next); persistIntent(stillWorking, next); close()
  }, [overlap, handledNext, persistIntent, stillWorking, close])
  const signature = (s: RuntimeSnapshot | null) => s ? [s.plan_id, s.plan_revision, s.state_id, s.gate.local_date].join(':') : ''
  const showReview = useCallback((review: DailyPlanReview | null) => { setReviewBase(signature(clock.current?.snapshot || null)); setOutcome(reviewOutcome(review)); setReviewDismissed(false) }, [])
  const assessed = outcome?.raw
  const assessedAt = assessed?.evaluated_at ? Date.parse(assessed.evaluated_at) : NaN
  const reviewStale = Boolean(outcome && (reviewBase !== signature(snapshot)
    || (snapshot && assessed && ('plan_id' in assessed && assessed.plan_id !== (snapshot.plan_id || null)
      || 'state_id' in assessed && assessed.state_id !== snapshot.state_id
      || Number.isFinite(assessedAt) && localDate(assessedAt, snapshot.profile.timezone) !== snapshot.gate.local_date))))
  useEffect(() => {
    if (!snapshot) return
    setPendingRequests(q => q.filter(x => x.kind === 'report' || x.kind === 'missed' || x.kind === 'switch' ? snapshot.sessions.some(s => s.id === x.session.id && isOpenSession(s)) : x.kind === 'state' && x.source === 'daily' ? !dailyRecorded(snapshot.gate) : true))
  }, [snapshot])
  const clearReview = useCallback(() => { setOutcome(null); setReviewDismissed(false) }, [])
  const dismissReview = useCallback(() => setReviewDismissed(true), [])
  const dailyPending = Boolean(snapshot && !dailyRecorded(snapshot.gate))
  const pendingCount = useMemo(() => {
    const ids = new Set(due.map(s => `session:${s.id}`))
    if (dailyPending) ids.add('state')
    if (outcome && outcome.kind !== 'keep') ids.add('review')
    if (overlap) ids.add('overlap')
    for (const request of [...queue, ...pendingRequests]) {
      if (request.kind === 'report' || request.kind === 'switch') ids.add(`session:${request.session.id}`)
      if (request.kind === 'state') ids.add('state')
      if (request.kind === 'review') ids.add('review')
      if (request.kind === 'candidate') ids.add(`candidate:${request.candidate.id}`)
    }
    return ids.size
  }, [due, dailyPending, outcome, queue, pendingRequests, overlap])
  const reopenPending = useCallback(() => { if (!blocked && !overlay) open({ id: 'inbox', kind: 'inbox' }) }, [blocked, overlay, open])
  const value: RuntimeContextValue = { service, snapshot, now, loading, readError, refresh, overlay, open, replace: (request) => { setPendingRequests(q => q.some(x => x.id === request.id) ? q.map(x => x.id === request.id ? request : x) : [...q, request]); setOverlay(request) }, close,
    block, blocked, interactionBlocks: blocks, due, stillWorking, markStillWorking, overlap, acknowledgeNext, outcome, showReview, clearReview, reviewDismissed, dismissReview, pendingCount, reopenPending, revealReview: () => setReviewDismissed(false), currentSnapshot, activeWork, startWork, pendingRequests, finish, reviewStale, submitting, setSubmitting }
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}
export function useInteractionBlock(id: string, active: boolean) {
  const runtime = useWorkspaceRuntime(); const block = runtime?.block
  useEffect(() => { block?.(id, active); return () => block?.(id, false) }, [block, id, active])
}
