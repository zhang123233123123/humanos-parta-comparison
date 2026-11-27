'use client'
import { OtherOptionInput, otherOptionValue } from '@/components/other-option-input'
import { ProposalPanel } from './proposal-panel'
import { WorkReportPanel } from './work-report'
import { MissedWorkPanel, OverlapPanel, PendingInbox, SwitchWorkPanel } from './work-panels'
import { CalendarPlanFlow } from './calendar-plan-flow'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { useChat } from '@/hooks/use-chat'
import { DraggableAssistantEntry } from '@/components/draggable-assistant-entry'

import { useEffect, useRef, useState } from 'react'
import { Bell, Check, Pause, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DurationInput } from '@/components/ui/duration-input'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/LanguageProvider'
import { requestId } from '@/lib/client/request-id'
import { isOpenSession, sessionKey, validState } from '@/lib/interaction/core'
import { emptyState } from '@/lib/interaction/contracts'
import type { OverlayRequest, WorkSession } from '@/lib/interaction/contracts'
import { useWorkspaceRuntime } from './provider'
import { saveThenReview } from '@/lib/interaction/report-flow'
import { StateFields } from './state-fields'
import { DEMO_MODE } from '@/lib/demo/config'
import { ScheduleExplanation } from '@/components/schedule-explanation'

function sessionLabel(s: WorkSession, timezone: string, locale: string) {
  const format = (date: string) => new Date(date).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })
  return `${s.title} · ${locale === 'zh' ? `第${s.ordinal}段` : `Session ${s.ordinal}`} · ${format(s.start)}–${format(s.end)}`
}
export function SessionActions({ sessionId, taskId, onBeforeOpen }: { sessionId?: string; taskId?: string; onBeforeOpen?: () => void }) {
  const runtime = useWorkspaceRuntime(); const { locale } = useTranslation(); const zh = locale === 'zh'
  const [selected, setSelected] = useState('')
  if (!runtime?.snapshot) return null
  const sessions = runtime.snapshot.sessions.filter(s => isOpenSession(s) && (sessionId ? s.id === sessionId : s.task_id === taskId))
  if (!sessions.length) return null
  const session = sessionId ? sessions[0] : sessions.find(s => s.id === selected)
  const openReport = (outcome: 'completed' | 'interrupted') => {
    if (!session) return
    onBeforeOpen?.(); runtime.open({ id: `report:${sessionKey(session)}`, kind: 'report', session, outcome })
  }
  return <div className="grid gap-2 rounded-xl border bg-muted/20 p-3" data-testid="session-actions">
    {sessionId ? <p className="text-xs text-muted-foreground">{sessionLabel(sessions[0], runtime.snapshot.profile.timezone, locale)}</p> : <label className="grid gap-1 text-xs">{zh ? '选择要反馈的工作段' : 'Choose a session to report'}<select aria-label={zh ? '工作段' : 'Work session'} className="h-9 max-w-full rounded-md border bg-background px-2" value={selected} onChange={e => setSelected(e.target.value)}><option value="">{zh ? '请选择，不代表整个任务' : 'Select; not the entire task'}</option>{sessions.map(s => <option key={s.id} value={s.id}>{sessionLabel(s, runtime.snapshot!.profile.timezone, locale)}</option>)}</select></label>}
    <div className="flex gap-2"><Button type="button" size="sm" disabled={!session} onClick={() => openReport('completed')}><Check className="mr-1 h-3.5 w-3.5" />{zh ? '完成本段' : 'Complete session'}</Button><Button type="button" size="sm" variant="outline" disabled={!session} onClick={() => openReport('interrupted')}><Pause className="mr-1 h-3.5 w-3.5" />{zh ? '中断' : 'Interrupt'}</Button></div>
  </div>
}

function StateReportForm({ request }: { request: Extract<OverlayRequest, { kind: 'state' | 'report' }> }) {
  const runtime = useWorkspaceRuntime()!; const { locale } = useTranslation(); const zh = locale === 'zh'
  const draftKey = 'humanos:form:' + runtime.snapshot?.profile.user_id + ':' + request.id
  const cached = useRef<any>(null)
  if (!cached.current) { try { cached.current = JSON.parse(sessionStorage.getItem(draftKey) || 'null') || {} } catch { cached.current = {} } }
  const [otherReason, setOtherReason] = useState(cached.current.otherReason || '')
  const [values, setValues] = useState(() => cached.current.values || emptyState())
  const [reason, setReason] = useState(cached.current.reason || ''); const [progress, setProgress] = useState(cached.current.progress || ''); const [remaining, setRemaining] = useState(cached.current.remaining || '')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const requestRef = useRef(cached.current.request_id || requestId('state-report')); const lastPayload = useRef(cached.current.signature || ''); const busyRef = useRef(false)
  const savedResult = useRef<Awaited<ReturnType<typeof saveThenReview>> | null>(cached.current.savedResult || null)
  const persistDraft = () => { try { sessionStorage.setItem(draftKey, JSON.stringify({ values, reason, otherReason, progress, remaining, request_id: requestRef.current, signature: lastPayload.current, savedResult: savedResult.current })) } catch { /* optional form cache */ } }
  useEffect(persistDraft, [draftKey, values, reason, otherReason, progress, remaining])
  const interrupted = request.kind === 'report' && request.outcome === 'interrupted'
  const save = async () => {
    if (busyRef.current) return
    if (!validState(values)) { setError(zh ? '请分别选择心情、精力、专注和压力。' : 'Please choose mood, energy, focus and stress separately.'); return }
    const minutes = interrupted && remaining.trim() ? Number(remaining) : null
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)) { setError(zh ? '请填入有效的分钟数，或留空。' : 'Enter a valid number of minutes, or leave it blank.'); return }
    const signature = JSON.stringify({ values, reason, otherReason, progress, remaining })
    if (lastPayload.current && lastPayload.current !== signature) requestRef.current = requestId('state-report')
    lastPayload.current = signature
    persistDraft()
    busyRef.current = true; setBusy(true); runtime.setSubmitting?.(true); setError('')
    try {
      if (!savedResult.current) savedResult.current = await saveThenReview(() => request.kind === 'state'
        ? runtime.service.saveState(values, requestRef.current, request.source)
        : runtime.service.report({ request_id: requestRef.current, source_session_id: request.session.id, original_task_id: request.session.task_id,
          plan_id: request.session.plan_id, plan_revision: request.session.plan_revision, outcome: request.outcome, state: values,
          reason: otherOptionValue(reason, otherReason), progress, remaining_minutes: minutes, retain_candidate: interrupted && minutes !== null }), () => runtime.service.review())
      persistDraft()
      if (!await runtime.refresh(true)) throw new Error('saved_state_refresh_failed')
      // Assessment is a suggestion, not authorization to create or apply a plan.
      // Both Demo and live mode wait for the explicit View adjustment action.
      runtime.showReview(savedResult.current.daily_plan_review)
      try { sessionStorage.removeItem(draftKey) } catch { /* optional draft */ }
      if (runtime.finish) runtime.finish(); else runtime.close()
      if (request.kind === 'report') window.dispatchEvent(new Event('humanos:current-work'))
      window.dispatchEvent(new Event('humanos:daily-state-saved'))
    } catch (e) {
      console.error('HumanOS report not acknowledged', e)
      setError(savedResult.current ? (zh ? '反馈已保存，暂时无法刷新。请重试加载，不会重复保存。' : 'Feedback saved; could not refresh. Retry loading without saving again.') : (zh ? '暂时无法保存这次反馈。输入已保留，计划没有改变。请重试。' : 'Could not save this report. Your input is preserved and the plan is unchanged. Please retry.'))
    } finally { busyRef.current = false; setBusy(false); runtime.setSubmitting?.(false) }
  }
  return <div className="grid gap-4" aria-busy={busy}>
    {request.kind === 'report' && <p className="rounded-lg border bg-muted/30 p-3 text-sm">{sessionLabel(request.session, runtime.snapshot?.profile.timezone || 'UTC', locale)}<span className="mt-1 block text-xs text-muted-foreground">{zh ? '只反馈这一工作段，不代表整个任务。' : 'This reports only this session, not the entire task.'}</span></p>}
    {request.kind === 'state' && <p className="text-sm leading-6 text-muted-foreground">{zh ? '告诉 HumanOS 你现在的状态，我们会检查今天剩下的安排是否仍然合适。' : 'Tell HumanOS how you feel so we can check today’s remaining schedule.'}</p>}
    <StateFields value={values} onChange={setValues} disabled={busy || Boolean(savedResult.current)} />
    {interrupted && <fieldset disabled={busy || Boolean(savedResult.current)} className="grid gap-3 border-t pt-3">
      <label className="grid gap-1 text-sm">{zh ? '中断原因（可选）' : 'Reason (optional)'}<select aria-label={zh ? '中断原因（可选）' : 'Reason (optional)'} className="h-10 rounded-md border bg-background px-2" value={reason} onChange={e => setReason(e.target.value)}><option value="">{zh ? '不填写' : 'Leave blank'}</option>{[['tired','累了 / 状态不好','Tired / not feeling well'],['stuck','卡住了','Stuck'],['missing_material','缺少资料','Missing material'],['interrupted','被打断','Interrupted'],['longer_than_expected','这段任务比预计更难','Harder than expected'],['priority_changed','优先级变化','Priority changed'],['other','其他','Other']].map(([v,c,e]) => <option key={v} value={v}>{zh ? c : e}</option>)}</select></label>
      <OtherOptionInput selected={reason} value={otherReason} onChange={setOtherReason} zh={zh} />
      <label className="grid gap-1 text-sm">{zh ? '简短记录进度（可选）' : 'Progress (optional)'}<Input value={progress} onChange={e => setProgress(e.target.value)} maxLength={1500} /></label>
      <label className="grid gap-1 text-sm">{zh ? '这一工作段未完成的部分，之后大约还需要多久？（可选）' : 'How much time will this unfinished portion need? (optional)'}<DurationInput aria-label={zh ? '本段剩余分钟' : 'Session remaining minutes'} value={remaining} onValueChange={setRemaining} maxMinutes={10080} zh={zh} /></label>
    </fieldset>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}</p>}
    <div className="flex justify-end gap-2">{request.kind === 'state' && !savedResult.current && <Button type="button" variant="outline" disabled={busy} onClick={runtime.close}>{zh ? '取消' : 'Cancel'}</Button>}<Button type="button" disabled={busy} onClick={() => void save()}>{busy ? (zh ? '正在检查接下来的安排…' : 'Checking your upcoming schedule…') : savedResult.current ? (zh ? '重新加载' : 'Reload') : (request.kind === 'state' && request.source === 'daily' ? (zh ? '开始今天' : 'Start today') : (zh ? '提交反馈' : 'Submit report'))}</Button></div>
  </div>
}

function RemindersPanel({ request }: { request: Extract<OverlayRequest, { kind: 'reminders' }> }) {
  const r = useWorkspaceRuntime()!; const { locale } = useTranslation(); const zh = locale === 'zh'
  const [error, setError] = useState(''); const busy = useRef(false)
  const s = r.due.find(session => session.id === request.session_id) || r.due[0]
  if (!s) return <p className="text-sm text-muted-foreground">{zh ? '目前没有待反馈的工作段。' : 'No session reports are pending.'}</p>
  const report = (outcome: 'completed' | 'interrupted') => r.replace({ id: `report:${sessionKey(s)}`, kind: 'report', session: s, outcome })
  return <div className="grid gap-4">
    <p className="text-sm text-muted-foreground">{s.started_at ? sessionLabel(s, r.snapshot!.profile.timezone, locale) : (zh ? `原计划的「${s.title}」工作时间已经结束。实际情况是？` : `The planned time for ${s.title} has ended. What actually happened?`)}</p>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div className="grid gap-2 sm:grid-cols-3">
      <Button type="button" variant="outline" className="h-11" disabled={r.readError || r.submitting} onClick={() => report('completed')}>{zh ? '完成了' : 'Completed'}</Button>
      <Button type="button" variant="outline" className="h-11" disabled={r.readError || r.submitting} onClick={async () => {
        if (busy.current) return
        if (r.activeWork && r.activeWork.id !== s.id) { r.replace({ id: 'switch:' + s.id, kind: 'switch', session: s }); return }
        busy.current = true; r.setSubmitting(true)
        try { if (r.activeWork?.id !== s.id) await r.startWork(s); r.markStillWorking(s); r.finish() }
        catch { setError(zh ? '暂时无法记录当前工作，请重试。' : 'Could not record current work. Please retry.') }
        finally { busy.current = false; r.setSubmitting(false) }
      }}>{zh ? '还在做' : 'Still working'}</Button>
      <Button type="button" variant="outline" className="h-11" disabled={r.readError || r.submitting} onClick={() => { if (s.started_at) report('interrupted'); else r.replace({ id: 'missed:' + s.id, kind: 'missed', session: s }) }}>{s.started_at ? (zh ? '中断' : 'Interrupt') : (zh ? '这次没有做' : 'Did not do it')}</Button>
    </div>
  </div>
}

export function RuntimeOverlays() {
  const r = useWorkspaceRuntime(); const { locale } = useTranslation(); const zh = locale === 'zh'
  if (!r?.overlay || r.blocked) return null
  const request = r.overlay
  const requiredFeedback = request.kind === 'report'
  const dismissBlocked = requiredFeedback || r.submitting
  const title = request.kind === 'state' ? (zh ? '今天感觉怎么样？' : 'How are you feeling today?') : request.kind === 'report' ? (request.outcome === 'completed' ? (zh ? '结束本次工作' : 'End this session') : (zh ? '中断反馈' : 'Interruption feedback')) : request.kind === 'reminders' ? (zh ? '这一工作段现在是什么情况？' : 'How is this work session going?') : request.kind === 'inbox' ? (zh ? 'HumanOS提醒' : 'HumanOS reminders') : request.kind === 'switch' ? (zh ? '切换当前工作' : 'Switch current work') : request.kind === 'overlap' ? (zh ? '接下来的安排' : 'Upcoming schedule') : request.kind === 'missed' ? (zh ? '这次没有做' : 'Did not do it') : (zh ? '查看调整' : 'Review adjustment')
  if (request.kind === 'reminders' || request.kind === 'overlap' || request.kind === 'missed' || request.kind === 'inbox') return <aside role="region" aria-label={title} data-runtime-dialog="true" className="fixed bottom-36 right-4 z-50 max-h-[65dvh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-background p-4 shadow-lg">
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={zh ? '关闭，稍后处理' : 'Close and handle later'} disabled={r.submitting} onClick={r.close}><X className="h-4 w-4" /></Button></div>
    {request.kind === 'reminders' ? <RemindersPanel key={request.session_id} request={request} /> : request.kind === 'inbox' ? <PendingInbox /> : request.kind === 'overlap' ? <OverlapPanel /> : <MissedWorkPanel session={request.session} />}
  </aside>
  return <Dialog open onOpenChange={open => { if (!open && !dismissBlocked) r.close() }}><DialogContent onEscapeKeyDown={event => { if (dismissBlocked) event.preventDefault() }} onInteractOutside={event => { if (dismissBlocked) event.preventDefault() }} className="z-[100] max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-runtime-dialog="true"><div className="flex items-center justify-between gap-2"><DialogTitle>{title}</DialogTitle>{!requiredFeedback && <Button aria-label={zh ? '关闭，稍后处理' : 'Close and handle later'} size="icon" variant="ghost" disabled={r.submitting} onClick={r.close}><X className="h-4 w-4" /></Button>}</div><DialogDescription className="sr-only">{zh ? '一次处理当前事项。' : 'Handle the current item.'}</DialogDescription>
    {request.kind === 'report' ? <WorkReportPanel key={request.id} request={request} /> : request.kind === 'state' ? <StateReportForm key={request.id} request={request} /> : request.kind === 'switch' ? <SwitchWorkPanel session={request.session} /> : <ProposalPanel key={request.id} candidate={request.kind === 'candidate' ? request.candidate : undefined} />}
  </DialogContent></Dialog>
}
export function RuntimeNotifications() {
  const r = useWorkspaceRuntime(); const { locale } = useTranslation(); const zh = locale === 'zh'
  const count = r?.pendingCount || 0
  const label = zh ? `通知 · ${count}项待处理` : `Notifications · ${count} pending items`
  return <Button id="workspace-guide-notifications" type="button" variant="ghost" size="icon" className="relative h-9 w-9 rounded-full text-muted-foreground" aria-label={label} title={label} disabled={!r || r.blocked || Boolean(r.overlay) || !count} onClick={() => r?.reopenPending()}><Bell className="h-4 w-4" />{count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full border bg-background px-1 text-[10px] text-foreground">{count}</span>}</Button>
}

export function RuntimeFloatingEntry() {
  const r = useWorkspaceRuntime(); const { locale } = useTranslation(); const zh = locale === 'zh'
  const [retrying, setRetrying] = useState(false); const retryBusy = useRef(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const setChatOpen = useChat(s => s.setChatOpen)
  const plan = usePlanPreview(s => s.plan)
  const kind = r?.reviewStale ? 'stale' : r?.outcome?.kind === 'keep' ? 'keep' : r?.outcome?.kind === 'adjust' ? 'adjust' : r?.outcome?.kind === 'insufficient' ? 'insufficient' : 'error'
  useEffect(() => { setWhyOpen(false) }, [r?.outcome])
  useEffect(() => {
    if (kind !== 'keep' || !r?.outcome || r.reviewDismissed || r.overlay || r.blocked || plan || whyOpen) return
    const timer = setTimeout(() => r.clearReview(), 3000)
    return () => clearTimeout(timer)
  }, [kind, r?.outcome, r?.clearReview, r?.reviewDismissed, r?.overlay, r?.blocked, plan, whyOpen])
  const normalWorkspace = Boolean(r?.snapshot?.profile.onboarding_completed && !plan)
  const retry = async () => {
    if (!r || retryBusy.current) return
    retryBusy.current = true; setRetrying(true)
    try { const review = await r.service.review(); await r.refresh(); r.showReview(review) }
    catch (e) { console.error('Review retry failed', e); r.showReview(null) }
    finally { retryBusy.current = false; setRetrying(false) }
  }
  const canShowResult = normalWorkspace && r?.outcome && !r.reviewDismissed && !r.overlay && !r.blocked
  const resultClass = kind === 'adjust'
    ? 'w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-4 shadow-lg'
    : 'w-[min(21rem,calc(100vw-2rem))] rounded-xl p-3 shadow-sm'
  return <>
    <CalendarPlanFlow />
    {r?.snapshot?.profile.onboarding_completed && r && <DraggableAssistantEntry locale={locale} disabled={r.blocked || Boolean(r.overlay) || Boolean(plan)} onOpen={() => setChatOpen('Hello!')} />}
    {canShowResult && r && <aside className={`fixed bottom-[calc(10rem+env(safe-area-inset-bottom))] right-4 z-40 border bg-background ${resultClass}`} aria-live="polite" aria-busy={retrying} data-runtime-result={kind}>
      <div className="flex items-start justify-between gap-2">
        {kind === 'adjust' ? <h3 className="text-sm font-semibold">{zh ? '建议调整接下来的安排' : 'Consider adjusting your upcoming schedule'}</h3>
          : <p role={kind === 'error' ? 'alert' : 'status'} className="text-sm leading-5">{kind === 'keep'
            ? (zh ? '接下来的安排暂时不用调整。' : 'Your upcoming schedule does not need adjusting for now.')
            : kind === 'insufficient' ? (zh ? '状态已保存，还需要一些任务信息才能判断是否调整。原计划没有改变。' : 'Your state was saved. More task information is needed to assess an adjustment. Your plan is unchanged.')
            : kind === 'stale' ? (zh ? '你的状态或计划已经更新，这条建议已失效。' : 'Your state or plan changed. This advice has expired.') : (zh ? '状态已保存，但暂时无法检查接下来的安排。原计划没有改变。' : 'Your state was saved, but we could not check your upcoming schedule. Your original plan is unchanged.')}</p>}
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground" aria-label={zh ? '关闭提示' : 'Dismiss message'} disabled={retrying} onClick={kind === 'keep' ? r.clearReview : r.dismissReview}><X className="h-4 w-4" /></Button>
      </div>
      {kind === 'keep' && <details className="mt-1 text-xs text-muted-foreground" onToggle={event => setWhyOpen(event.currentTarget.open)}>
        <summary className="w-fit cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">{zh ? '为什么？' : 'Why?'}</summary>
        <div className="mt-2"><ScheduleExplanation context="keep" review={r.outcome!.raw} snapshot={r.snapshot} locale={locale} compact /></div>
      </details>}
      {kind === 'adjust' && <>
        <div className="mt-2"><ScheduleExplanation context="adjustment" review={r.outcome!.raw} snapshot={r.snapshot} locale={locale} showTitle={false} compact /></div>
        <Button id="workspace-review-adjustment" className="mt-3" size="sm" onClick={() => r.open({ id: 'runtime-review', kind: 'review' })}>{zh ? '查看调整' : 'View adjustment'}</Button>
      </>}
      {kind === 'insufficient' && <div className="mt-2 space-y-2 text-xs text-muted-foreground">
        {r.outcome?.reason && <p>{r.outcome.reason}</p>}
        {r.outcome?.missing.map((item, index) => <p key={index}>{item}</p>)}
        <p>{zh ? '请在任务详情中补充这些信息，再重新检查。' : 'Add these details to the task, then check again.'}</p>
      </div>}
      {(kind === 'error' || kind === 'stale' || kind === 'insufficient') && <Button disabled={retrying} className="mt-2" size="sm" variant="outline" onClick={() => void retry()}>{retrying ? (zh ? '正在检查接下来的安排…' : 'Checking your upcoming schedule…') : (zh ? '重新检查' : 'Retry check')}</Button>}
    </aside>}
  </>
}
