'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiRequest } from '@/lib/client/api'
import { usePlanPreview, planVersion } from '@/hooks/use-plan-preview'
import { useEvents } from '@/hooks/use-events'
import { useInteractionBlock, useWorkspaceRuntime } from './provider'
import { ScheduleExplanation } from '@/components/schedule-explanation'
import { DEMO_MODE } from '@/lib/demo/config'
import { isEmptyInitialPlan } from '@/lib/empty-initial-plan'
import { calendarChangeSummary } from '@/lib/calendar-change-summary'
import type { PlanDecision } from '@/lib/contracts/planning-contracts'

const get = (url: string) => apiRequest<any>(url, { cache: 'no-store' })
const post = (url: string, body: unknown, method = 'POST') => apiRequest<any>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function CalendarPlanFlow() {
  const r = useWorkspaceRuntime(); const pathname = usePathname(); const router = useRouter()
  const preview = usePlanPreview(); const [busy, setBusy] = useState(false); const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(''); const [collapsed, setCollapsed] = useState(false); const [retry, setRetry] = useState(0)
  const [rationaleRequired, setRationaleRequired] = useState(false); const [rationale, setRationale] = useState('')
  const [backendReady, setBackendReady] = useState(false)
  const [savedPlan, setSavedPlan] = useState<PlanDecision | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [needsRegenerate, setNeedsRegenerate] = useState(false)
  const [readError, setReadError] = useState('')
  const visibleError = error || readError
  const calendarReadPending = useRef(false)
  const published = useRef<PlanDecision | null>(null)
  const failedDraft = useRef(false)
  const finalizing = useRef(false)
  const successVisible = useRef(false)
  const guidePending = useRef(false)
  const refreshPending = useRef(false)
  const resetEpoch = useRef(0)
  const savedExplanation = useRef<Parameters<typeof ScheduleExplanation>[0] | null>(null)
  const user = r?.snapshot?.profile.user_id
  const enabled = pathname === '/app' && Boolean(user && (r?.snapshot?.profile.onboarding_submitted || r?.snapshot?.profile.onboarding_completed))
  useEffect(function installDemoPlanReset() {
    if (!DEMO_MODE) return
    const reset = () => {
      resetEpoch.current++
      published.current = null; failedDraft.current = false; finalizing.current = false
      successVisible.current = false; guidePending.current = false; refreshPending.current = false
      savedExplanation.current = null; calendarReadPending.current = false; setReadError('')
      setBusy(false); setGenerating(false); setError(''); setCollapsed(false)
      setRationaleRequired(false); setRationale(''); setBackendReady(false)
      setSavedPlan(null); setSaveFailed(false); setSetupError(''); setNeedsRegenerate(false)
      if (user) localStorage.removeItem(`humanos:onboarding-job:${encodeURIComponent(user)}`)
      setRetry(value => value + 1)
    }
    window.addEventListener('humanos:demo-feedback-scenario', reset)
    return () => window.removeEventListener('humanos:demo-feedback-scenario', reset)
  }, [user])
  useEffect(() => {
    // Comparison is no longer a separate card action. Recover older UI state so
    // the calendar always shows the candidate being reviewed.
    if (preview.plan && preview.original) preview.toggle()
  }, [preview.original, preview.base?.plan_id, preview.plan?.plan_id])
  useEffect(() => {
    if (visibleError || preview.stale) setCollapsed(false)
    else if (preview.selected && window.matchMedia('(max-width: 1023px)').matches) setCollapsed(true)
  }, [preview.selected, preview.stale, visibleError])
  const pendingInteraction = Boolean(preview.plan || generating || visibleError)
  const otherInteraction = Boolean(r?.overlay || r?.interactionBlocks?.some(id => id !== 'calendar-plan-preview') || (!pendingInteraction && r?.outcome && !r.reviewDismissed))
  // A saved-plan acknowledgement is not another pending decision and must not
  // keep everyday reminders blocked after the save has succeeded.
  useInteractionBlock('calendar-plan-preview', enabled && !r?.snapshot?.profile.onboarding_completed && pendingInteraction && !otherInteraction)
  useEffect(() => {
    if (!preview.plan || !preview.base || !r?.snapshot) return
    if (preview.stateId !== r.snapshot.state_id || preview.base.plan_id !== r.snapshot.plan_id || preview.base.plan_revision !== r.snapshot.plan_revision) usePlanPreview.setState({ stale: true })
  }, [preview.plan, preview.base, preview.stateId, r?.snapshot])
  useEffect(() => {
    if (!enabled || !user) return
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; let running = false
    const key = `humanos:onboarding-job:${encodeURIComponent(user)}`
    const poll = async () => {
      if (running) return
      running = true
      const epoch = resetEpoch.current
      try {
        const [p, a, profile, gate, tasks] = await Promise.all([get('/api/plans/proposed'), get('/api/plans/active'), get('/api/profile'), get('/api/state-checkins'), get('/api/tasks')])
        if (cancelled || epoch !== resetEpoch.current) return
        // The original GET contract returns the daily gate without state details.
        // Optional runtime_state enriches freshness checks; its absence is not a failed request.
        if (typeof gate.required !== 'boolean' || !gate.local_date) { setBackendReady(false); throw new Error('签到状态响应无效，请重新读取。') }
        setBackendReady(true)
        const research = profile.data.profile.research_context || {}
        // Deleting the final task can leave a valid empty proposal. Complete
        // setup without publishing a plan or replaying the old generation job.
        if (isEmptyInitialPlan(p.data.plan, a.data.plan, tasks.data?.tasks)) {
          usePlanPreview.getState().clear()
          localStorage.removeItem(key)
          setGenerating(false); setError(''); setReadError(''); setSaveFailed(false); setNeedsRegenerate(false)
          failedDraft.current = false
          try { await finishSetup(); setSetupError('') }
          catch (e) {
            console.error('HumanOS empty setup finalization failed', e)
            setSetupError('当前没有待安排任务，暂未完成初始化，请重新加载。')
          }
          return
        }
        const request = research.initial_plan_request_id
        let jobId = localStorage.getItem(key)
        // The stable request ID is persisted before leaving setup. Server idempotency
        // also protects refreshes and multiple tabs before the job response arrives.
        if (!jobId && request && !research.onboarding_completed && !published.current && !a.data.plan) {
          const accepted = await post('/api/schedules/decide', { source: 'onboarding', request_id: request })
          if (cancelled || epoch !== resetEpoch.current) return
          jobId = accepted.job?.job_id
          if (!jobId) throw new Error('未收到生成任务，请重试。')
          localStorage.setItem(key, jobId)
        }
        if (jobId && !published.current) {
          const result = await get(`/api/background-jobs?job_id=${encodeURIComponent(jobId)}`)
          if (cancelled || epoch !== resetEpoch.current) return
          if (result.job.status === 'failed' || result.job.result?.unavailable || result.job.result?.error) {
            console.error('HumanOS plan generation failed', result.job.error || result.job.result?.error)
            throw new Error('暂时无法生成计划，请重试。当前安排没有改变。')
          }
          if (result.job.status !== 'completed') { setGenerating(true); return }
          setGenerating(false)
        }
        const titles = Object.fromEntries((tasks.data?.tasks || []).map((t: any) => [t.id, t.title]))
        const current = usePlanPreview.getState()
        const previous = planVersion(current.plan)
        const proposalVersion = planVersion(p.data.plan)
        const alreadySaved = Boolean(proposalVersion && (proposalVersion === planVersion(published.current) || (a.data.plan?.plan_status === 'confirmed' && proposalVersion === planVersion(a.data.plan))))
        if (alreadySaved && current.plan && previous === proposalVersion) {
          const confirmed = a.data.plan?.plan_status === 'confirmed' && planVersion(a.data.plan) === proposalVersion ? a.data.plan : published.current
          useEvents.getState().acknowledgePlan({ ...current.plan, ...confirmed })
          current.clear(confirmed || undefined)
        }
        // A late proposal response cannot resurrect a plan we have acknowledged
        // as saved. A failed edited draft stays intact until the user retries.
        const nextPlan = alreadySaved ? null : failedDraft.current && current.plan ? current.plan : p.data.plan
        if (nextPlan && planVersion(nextPlan) !== planVersion(published.current)) { setSavedPlan(null); successVisible.current = false; published.current = null }
        current.load(nextPlan, a.data.plan, user, 'runtime_state' in gate ? gate.runtime_state?.id || null : r?.snapshot?.state_id || null, titles, profile.data.profile.timezone, Object.fromEntries((tasks.data?.tasks || []).map((task: any) => [task.id, task])))
        if (previous !== planVersion(nextPlan)) {
          calendarReadPending.current = true
          setCollapsed(false)
          if (!failedDraft.current) { setError(''); setSaveFailed(false); setNeedsRegenerate(false) }
        }
        if (calendarReadPending.current) {
          await useEvents.getState().refetchEvents()
          if (cancelled || epoch !== resetEpoch.current) return
          calendarReadPending.current = false
        }
        if (published.current && refreshPending.current) {
          const [, runtime] = await Promise.all([useEvents.getState().refetchEvents(), r?.refresh(true)])
          if (r && !runtime) throw new Error('已保存，暂时无法刷新工作台。')
          if (cancelled || epoch !== resetEpoch.current) return
          refreshPending.current = false
        }
        // Finalization is an independent profile write. Its failure never turns
        // a confirmed calendar plan back into an unsaved candidate.
        if (!research.onboarding_completed && a.data.plan?.plan_status === 'confirmed' && (!nextPlan || published.current)) {
          published.current ||= a.data.plan
          await completeSetup()
        } else if (research.onboarding_completed) setSetupError('')
        setReadError('')
      } catch (e) { if (!cancelled && epoch === resetEpoch.current) {
        setGenerating(false)
        if (published.current) { console.error('HumanOS saved-plan refresh failed', e); setSetupError('计划已保存，暂未完成页面初始化。') }
        else setReadError(e instanceof Error ? e.message : '读取计划失败，请重试。')
      } }
      finally { running = false; if (!cancelled && epoch === resetEpoch.current) timer = setTimeout(poll, 3000) }
    }
    void poll()
    const refresh = () => { calendarReadPending.current = true; clearTimeout(timer); void poll() }
    window.addEventListener('humanos:plan-revision', refresh)
    window.addEventListener('humanos:tasks-updated', refresh)
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('humanos:plan-revision', refresh); window.removeEventListener('humanos:tasks-updated', refresh) }
  }, [enabled, user, retry])

  const finishSetup = async () => {
    const profile = (await get('/api/profile')).data.profile
    if (!profile.research_context?.onboarding_completed) {
      await post('/api/profile', { research_context: { ...profile.research_context, onboarding_submitted: true, onboarding_completed: true } }, 'PUT')
      localStorage.removeItem(`humanos:onboarding-job:${encodeURIComponent(user!)}`)
      localStorage.removeItem(`humanos:onboarding-draft:v3:${encodeURIComponent(user!)}`)
      if (r && !await r.refresh(true)) throw new Error('已保存，暂时无法刷新工作台。')
      // Let the saved acknowledgement finish before teaching takes the same
      // floating interaction slot. Recovery on a later visit has no such card.
      guidePending.current = true
      if (!successVisible.current) { guidePending.current = false; router.replace('/app?guide=workspace') }
    } else if (r && !r.snapshot?.profile.onboarding_completed && !await r.refresh(true)) {
      throw new Error('已保存，暂时无法刷新工作台。')
    }
  }
  const completeSetup = async () => {
    if (finalizing.current) return
    finalizing.current = true
    try { await finishSetup(); setSetupError('') }
    catch (e) {
      console.error('HumanOS plan saved; workspace initialization incomplete', e)
      setSetupError('计划已保存，暂未完成页面初始化。')
    } finally { finalizing.current = false }
  }
  const confirm = async () => {
    if (busy || readError || preview.stale || needsRegenerate || !preview.plan) return
    setBusy(true); setError(''); setSaveFailed(false)
    failedDraft.current = true
    let acknowledged = false
    try {
      const [a, p, gate] = await Promise.all([get('/api/plans/active'), get('/api/plans/proposed'), get('/api/state-checkins')])
      if (typeof gate.required !== 'boolean' || !gate.local_date) throw new Error('签到状态响应无效，请重新读取。')
      if (planVersion(a.data.plan) !== planVersion(preview.base) || planVersion(p.data.plan) !== planVersion(preview.plan) || ('runtime_state' in gate && (gate.runtime_state?.id || null) !== preview.stateId)) {
        setNeedsRegenerate(true)
        throw new Error('计划或当前状态已经变化，请重新生成后查看，不能应用旧草案。')
      }
      const validation = await post('/api/schedules/validate', preview.plan)
      const result = validation.validation || validation.data?.validation || validation
      if (!result.valid) throw new Error(result.violations?.[0]?.message || '安排未通过约束校验，请修改草案。')
      const confirmed = await post('/api/schedules/confirm', { ...preview.plan,
        // Send a state precondition only when the server has supplied a state ID
        // or explicitly reported no state. Do not invent null for the legacy gate.
        ...('runtime_state' in gate || preview.stateId ? { expected_state_id: preview.stateId } : {}), expected_active_plan_id: preview.base?.plan_id || null,
        expected_active_plan_revision: preview.base?.plan_revision || 0,
        ...(rationaleRequired ? { rationale: { raw_user_response: rationale } } : {}) })
      if (confirmed.requires_rationale) { setRationaleRequired(true); throw new Error('请简要填写修改原因后再次确认，草案尚未生效。') }
      if (!confirmed.plan?.plan_id || confirmed.plan.plan_id !== preview.plan.plan_id || confirmed.plan.plan_status !== 'confirmed') throw new Error('尚未收到计划保存确认，请重试。')
      published.current = confirmed.plan
      acknowledged = true
      const saved = { ...preview.plan, ...confirmed.plan }
      savedExplanation.current = { locale: 'zh', context: preview.base ? 'adjustment' : 'initial', base: preview.base, tasks: preview.tasks, titles: preview.titles, timezone: preview.timezone, review: r?.outcome?.raw, snapshot: r?.snapshot }
      successVisible.current = true
      setSavedPlan(saved); setCollapsed(false); setGenerating(false)
      failedDraft.current = false
      useEvents.getState().acknowledgePlan(saved)
      preview.clear(confirmed.plan)
      // All failures after the explicit save acknowledgement are refresh/setup
      // failures, never a failed confirmation and never a reason to resend it.
      await completeSetup()
      const refreshed = await Promise.allSettled([useEvents.getState().refetchEvents(), r?.refresh(true)])
      if (refreshed.some(result => result.status === 'rejected') || (r && refreshed[1].status === 'fulfilled' && !refreshed[1].value)) {
        console.error('HumanOS confirmed-plan refresh incomplete', refreshed)
        refreshPending.current = true
        setSetupError('计划已保存，暂未完成页面初始化。')
      }
      window.dispatchEvent(new Event('humanos:plan-updated'))
    } catch (e) {
      if (acknowledged) {
        console.error('HumanOS plan saved; follow-up refresh failed', e)
        refreshPending.current = true
        setSetupError('计划已保存，暂未完成页面初始化。')
      } else { setSaveFailed(true); setError(e instanceof Error ? e.message : '保存失败，草案已保留。') }
    }
    finally { setBusy(false) }
  }
  const regenerate = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (preview.base && r) {
        await post('/api/plans/reject', { plan_id: preview.plan?.plan_id })
        preview.clear(); setError(''); setNeedsRegenerate(false); setSaveFailed(false)
        const result = await r.service.review(); await r.refresh(); r.showReview(result)
        return
      }
      const accepted = await post('/api/schedules/decide', { source: 'workspace_retry', request_id: crypto.randomUUID() })
      localStorage.setItem(`humanos:onboarding-job:${encodeURIComponent(user!)}`, accepted.job.job_id)
      failedDraft.current = false; setSaveFailed(false); setNeedsRegenerate(false); setGenerating(true); setError(''); setRetry(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : '生成请求失败。') } finally { setBusy(false) }
  }
  if (!enabled || otherInteraction || (!preview.plan && !generating && !visibleError && !savedPlan && !setupError)) return null
  const start = (savedPlan || preview.plan)?.week_id
  const end = start ? new Date(`${start}T12:00:00`) : null
  end?.setDate(end.getDate() + 6)
  const formatDay = (date: Date) => date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const range = start && end ? <p className="text-sm font-medium">{formatDay(new Date(`${start}T12:00:00`))}–{formatDay(end)}</p> : null
  const explanation = (plan: PlanDecision) => <details className="text-xs text-muted-foreground"><summary className="cursor-pointer list-none underline underline-offset-4 hover:text-foreground [&::-webkit-details-marker]:hidden">为什么这样安排？</summary><div className="mt-2"><ScheduleExplanation {...(savedPlan ? savedExplanation.current : { context: preview.base ? 'adjustment' as const : 'initial' as const, base: preview.base, tasks: preview.tasks, titles: preview.titles, timezone: preview.timezone, review: r?.outcome?.raw, snapshot: r?.snapshot })} decision={plan} locale="zh" compact showTitle={false} /></div></details>
  const changes = preview.plan && preview.base ? calendarChangeSummary(preview.plan, preview.base, preview.titles, preview.timezone) : null
  const cardClass = 'humanos-plan-flow fixed bottom-4 right-4 z-40 max-h-[45dvh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-background p-4 shadow-md'
  if (savedPlan) return <aside className={cardClass} aria-live="polite" data-plan-flow-state="saved">
    <strong className="text-sm">计划已确认</strong>
    <div className="mt-3 grid gap-3">{range}<p className="text-xs leading-5 text-muted-foreground">你可以随时在日历中查看或调整安排。</p>
      <Button onClick={() => {
        setSavedPlan(null); successVisible.current = false
        if (guidePending.current) { guidePending.current = false; router.replace('/app?guide=workspace') }
      }}>知道了</Button>{explanation(savedPlan)}
    </div>
  </aside>
  if (setupError && !preview.plan && !generating) return <aside className={cardClass} aria-live="polite" data-plan-flow-state="initialization-retry">
    <p role="alert" className="text-sm">{setupError}</p>
    <Button className="mt-3" variant="outline" disabled={busy} onClick={() => setRetry(v => v + 1)}>重新加载</Button>
  </aside>
  return <aside className={cardClass} aria-live="polite" data-plan-flow-state={saveFailed ? 'save-failed' : generating ? 'generating' : 'pending'}>
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><strong className="text-sm">{generating ? '正在生成计划…' : saveFailed ? '计划还没有保存成功' : preview.plan ? preview.base ? '调整预览' : '计划已生成' : '暂时无法读取计划'}</strong>{preview.plan && !generating && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">待确认</span>}</div><Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '打开确认' : '收起'}</Button></div>
    {!collapsed && <div className="mt-3 grid gap-3">{(generating || (preview.plan && (!preview.base || saveFailed))) && <p className="text-xs leading-5 text-muted-foreground">{generating ? '完成后可在日历中查看。' : saveFailed ? '你的预览仍然保留。' : '先看看安排，需要的话可以直接调整。'}</p>}
      {!preview.base && range}
      {changes && !generating && <section aria-label="建议变化" className="grid gap-2 text-xs">
        <p className="text-muted-foreground">建议变化</p>
        {changes.entries.map(change => <div key={change.key} className="grid gap-0.5"><p className="break-words font-medium">{change.title}</p><p className="tabular-nums text-muted-foreground">{change.detail}</p></div>)}
        {changes.remaining > 0 && <p className="text-muted-foreground">另有 {changes.remaining} 处变化，请在日历中查看。</p>}
        {!changes.entries.length && <p className="text-muted-foreground">请在日历中查看本次安排。</p>}
      </section>}
      {(visibleError || preview.stale) && <p role="alert" className="text-sm text-destructive">{visibleError || '你的状态或计划已经更新，这条建议已失效。'}</p>}
      {rationaleRequired && <label className="grid gap-1 text-sm">修改原因<Input value={rationale} onChange={e => setRationale(e.target.value)} /></label>}
      {visibleError && !saveFailed && <Button variant="outline" disabled={busy} onClick={() => { setError(''); setRetry(v => v + 1) }}>重新读取</Button>}
      {backendReady && (preview.stale || needsRegenerate || (!saveFailed && visibleError)) && <Button variant="outline" disabled={busy} onClick={() => void regenerate()}>{preview.base ? '重新检查' : '重新生成'}</Button>}
      {!generating && preview.plan && <Button disabled={!backendReady || busy || Boolean(readError) || preview.stale || needsRegenerate || (rationaleRequired && !rationale.trim()) || !preview.plan.plan_patch?.some(b => b.kind === 'task_session')} onClick={() => void confirm()}>{busy ? '正在保存……' : saveFailed ? '重试保存' : preview.base ? '应用调整' : '确认计划'}</Button>}
      {saveFailed && <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)}>稍后处理</Button>}
      {preview.base && preview.plan && !generating && !saveFailed && <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true)
        try { await post('/api/plans/reject', { plan_id: preview.plan?.plan_id, plan_revision: preview.plan?.plan_revision }); preview.clear(); await useEvents.getState().refetchEvents(); r?.clearReview(); setError(''); setRetry(v => v + 1) }
        catch(e) { setError((e as Error).message) } finally { setBusy(false) }
      }}>保持原计划</Button>}
      {preview.plan && !generating && !saveFailed && explanation(preview.plan)}
    </div>}
  </aside>
}

export { DraftBlockDetails } from './candidate-block-details'
