'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DurationInput } from '@/components/ui/duration-input'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/LanguageProvider'
import { ApiResponseError } from '@/lib/client/api'
import { requestId } from '@/lib/client/request-id'
import { localTime } from '@/lib/presentation/task'
import { authorization, proposalIsCurrent, validateProposal } from '@/lib/interaction/core'
import type { CandidateWork, RuntimeProposal } from '@/lib/interaction/contracts'
import { useWorkspaceRuntime } from './provider'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { DEMO_MODE } from '@/lib/demo/config'
import { presentDemoFeedbackPreview } from '@/lib/demo/calendar-feedback-preview'
import { presentLiveFeedbackPreview } from '@/lib/interaction/calendar-preview'

export function ProposalPanel({ candidate }: { candidate?: CandidateWork }) {
  const r = useWorkspaceRuntime()!; const { locale } = useTranslation(); const zh = locale === 'zh'
  const [proposal, setProposal] = useState<RuntimeProposal | null>(null); const [busy, setBusy] = useState(false)
  const draftKey='humanos:schedule-form:'+r.snapshot?.profile.user_id+':'+(candidate?.id || 'review')
  const cached=useRef<any>(null)
  if(!cached.current){try{cached.current=JSON.parse(sessionStorage.getItem(draftKey) || 'null') || {}}catch{cached.current={}}}
  const [error, setError] = useState(''); const [extend, setExtend] = useState(Boolean(cached.current.extend ?? !candidate)); const [duration, setDuration] = useState(cached.current.duration || '')
  useEffect(()=>{if(candidate){try{sessionStorage.setItem(draftKey,JSON.stringify({extend,duration}))}catch{}}},[draftKey,candidate,extend,duration])
  const started = useRef(false); const attempt = useRef(requestId('runtime-proposal')); const applyId = useRef(requestId('apply-runtime-proposal'))
  const attemptSignature = useRef('')
  const generate = async () => {
    if (busy) return
    if (candidate?.remaining_minutes === null && (!Number.isInteger(Number(duration)) || Number(duration) < 1)) { setError(zh ? '安排前需要知道这段工作大约需要多少分钟。' : 'Please estimate this portion before scheduling it.'); return }
    setBusy(true); setError('')
    try {
      const snapshot = await r.refresh(); if (!snapshot) throw new Error('Snapshot unavailable')
      const command = authorization({ ...snapshot, now: r.currentSnapshot()?.now || snapshot.now }, attempt.current, candidate ? [candidate.id] : [], extend)
      if (candidate?.remaining_minutes === null) command.candidate_duration_minutes = { [candidate.id]: Number(duration) }
      const { request_id: _, ...facts } = command
      const signature = JSON.stringify(facts)
      if (attemptSignature.current && attemptSignature.current !== signature) command.request_id = attempt.current = requestId('runtime-proposal')
      attemptSignature.current = signature
      const result = await r.service.propose(command)
      const current = (await r.refresh()) || snapshot
      validateProposal(result, current)
      if (DEMO_MODE && r.service.mode === 'isolated-development') {
        await presentDemoFeedbackPreview(result, current)
        if (candidate) { const block=usePlanPreview.getState().plan?.plan_patch.find(b=>b.source_candidate_id===candidate.id); if(block?.block_id)usePlanPreview.getState().select(block.block_id) }
        try { sessionStorage.removeItem(draftKey) } catch {}
        r.clearReview(); r.finish()
      } else {
        await presentLiveFeedbackPreview(result, current)
        if (candidate) { const block=usePlanPreview.getState().plan?.plan_patch.find(b=>b.source_candidate_id===candidate.id); if(block?.block_id)usePlanPreview.getState().select(block.block_id) }
        r.clearReview(); r.finish()
      }
    } catch (e) { console.error('Proposal generation failed', e); setError(e instanceof ApiResponseError ? e.message : (zh ? '暂时无法生成调整草案，请刷新后重试。原计划和待安排工作都没有改变。' : 'Could not generate an adjustment. Refresh and retry. Your plan and pending work are unchanged.')) }
    finally { setBusy(false) }
  }
  // The user explicitly opened this preview; remounting a different request resets it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (candidate || started.current) return; started.current = true; void generate() }, []) // user opened View adjustment
  const apply = async () => {
    if (!proposal || busy) return; setBusy(true); setError('')
    try {
      const snapshot = await r.service.snapshot(); validateProposal(proposal, snapshot)
      await r.service.apply(proposal, applyId.current); await r.refresh(); r.clearReview(); r.finish()
      window.dispatchEvent(new Event('humanos:plan-updated'))
    } catch (e) { console.error('Proposal apply rejected', e); setError(zh ? '没有应用调整。请检查计划是否已变化，或重试；待安排工作仍保留。' : 'Adjustment was not applied. Check for changes or retry; pending work is preserved.') }
    finally { setBusy(false) }
  }
  const stale = Boolean(proposal && r.snapshot && !proposalIsCurrent(proposal, r.snapshot))
  return <div className="grid gap-4">
    {candidate && <><p className="text-sm font-medium">{candidate.title} · {candidate.remaining_minutes === null ? (zh ? '时长待确认' : 'Duration unknown') : `${candidate.remaining_minutes} ${zh ? '分钟' : 'min'}`}</p>{candidate.remaining_minutes === null && <label className="grid gap-1 text-sm">{zh ? '这部分预计需要几分钟？' : 'Estimated minutes for this portion?'}<DurationInput value={duration} zh={zh} onValueChange={value => { setDuration(value); setProposal(null); attempt.current = requestId('runtime-proposal') }} /></label>}</>}<label className="grid gap-1 text-sm">{zh?'安排范围':'Schedule within'}<select aria-label={zh?'安排范围':'Schedule within'} disabled={busy} className="h-10 rounded-md border bg-background px-2" value={extend?'period':'today'} onChange={e=>{setExtend(e.target.value==='period');setProposal(null);attempt.current=requestId('runtime-proposal')}}><option value="today">{zh?'今天':'Today'}</option><option value="period">{zh?'本周内，优先今天':'This week, preferably today'}</option></select></label>
    <p className="text-xs text-muted-foreground">{zh ? '可从本周其他天选择更合适的工作。生成后先预览，确认后才会更改日历。' : 'Suitable work may come from other days this week. Review and confirm before your calendar changes.'}</p>
    {busy && <p role="status" aria-live="polite" className="rounded-lg bg-primary/10 p-3 text-sm">{zh ? '正在结合你的状态检查时间冲突并生成安排，请稍候…' : 'Checking your state and calendar constraints to prepare a draft…'}</p>}
    {proposal && <><div className="grid gap-2">{proposal.changes.map(c => <article key={c.session_id} className="rounded-xl border border-dashed p-3 text-sm"><p className="font-medium">{c.title}</p><p className="mt-1 text-xs text-muted-foreground">{c.before ? localTime(c.before, r.snapshot?.profile.timezone || 'UTC', locale) : (zh ? '待安排' : 'To schedule')} → {localTime(c.after, r.snapshot?.profile.timezone || 'UTC', locale)}</p></article>)}</div>{proposal.unallocated_candidate_ids.length > 0 && <p role="status" className="rounded-lg border p-3 text-sm">{zh ? '本次可用时间不足，这部分继续保留在待安排。可明确授权尝试后续日期。' : 'This portion does not fit and remains in To schedule. You may explicitly allow later dates.'}</p>}{stale && <p role="alert" className="text-sm text-destructive">{zh ? '计划或状态已变化，这份草案已过期，请重新生成。' : 'The plan or state changed. This draft is stale; regenerate it.'}</p>}</>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">{(!proposal || stale) && <Button disabled={busy} onClick={() => { if (stale) attempt.current = requestId('runtime-proposal'); void generate() }}>{zh ? '生成调整草案' : 'Generate draft'}</Button>}{proposal && <><Button variant="outline" disabled={busy} onClick={() => { r.clearReview(); r.close() }}>{zh ? '保持原计划' : 'Keep original plan'}</Button><Button disabled={busy || stale || !proposal.valid || !proposal.changes.length} onClick={() => void apply()}>{zh ? '应用调整' : 'Apply adjustment'}</Button></>}</div>
  </div>
}

