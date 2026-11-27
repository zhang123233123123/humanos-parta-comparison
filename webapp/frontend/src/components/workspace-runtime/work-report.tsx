'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DurationInput } from '@/components/ui/duration-input'
import { Input } from '@/components/ui/input'
import { OtherOptionInput, otherOptionValue } from '@/components/other-option-input'
import { useTranslation } from '@/i18n/LanguageProvider'
import { DEMO_MODE } from '@/lib/demo/config'
import { demoScheduleTask, demoWorkCommand, demoWorkState } from '@/lib/demo/work-actions'
import type { OverlayRequest } from '@/lib/interaction/contracts'
import { useWorkspaceRuntime } from './provider'
import { StateFields } from './state-fields'
import { emptyState } from '@/lib/interaction/contracts'
import { validState } from '@/lib/interaction/core'
import { requestId } from '@/lib/client/request-id'
import { useEvents } from '@/hooks/use-events'

export function WorkReportPanel({ request }: { request: Extract<OverlayRequest, {kind:'report'}> }) {
  const r = useWorkspaceRuntime()!, zh = useTranslation().locale === 'zh'
  const interrupted = request.outcome === 'interrupted'
  const key = `humanos:work-form:${DEMO_MODE ? 'demo' : 'live'}:${r.snapshot?.profile.user_id}:${request.session.id}:${interrupted ? 'pause' : 'end'}`
  const cached = useRef<any>(null)
  if (!cached.current) { try { cached.current = JSON.parse(sessionStorage.getItem(key) || 'null') || (DEMO_MODE ? demoWorkState().notes[request.session.id] : null) || {} } catch { cached.current = {} } }
  const savedReason = String(cached.current.reason || '')
  const [reason,setReason] = useState(savedReason.startsWith('other: ') ? 'other' : savedReason), [other,setOther] = useState(cached.current.other || (savedReason.startsWith('other: ') ? savedReason.slice(7) : ''))
  const [progress,setProgress] = useState(cached.current.progress || ''), [next,setNext] = useState(cached.current.next || '')
  const [result,setResult] = useState(cached.current.result || '')
  const [remaining,setRemaining] = useState(cached.current.remaining || '')
  const [values,setValues] = useState(() => cached.current.values || emptyState())
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const saving = useRef(false), savedState = useRef(Boolean(cached.current.savedState)), savedWork = useRef(Boolean(cached.current.savedWork))
  const checked = useRef(Boolean(cached.current.checked)), savedReview = useRef(cached.current.review ?? null)
  const attempt = useRef(cached.current.request_id || requestId('work-feedback')), lastPayload = useRef(cached.current.signature || '')
  const persistDraft = () => { try { sessionStorage.setItem(key, JSON.stringify({reason,other,progress,next,result,remaining,values,request_id:attempt.current,signature:lastPayload.current,savedState:savedState.current,savedWork:savedWork.current,checked:checked.current,review:savedReview.current})) } catch { /* optional draft cache */ } }
  useEffect(persistDraft,[key,reason,other,progress,next,result,remaining,values])
  const save = async () => {
    if (saving.current || (!interrupted && !result)) return
    if (!validState(values)) { setError(zh ? '请选择心情、精力、专注和压力。' : 'Please choose mood, energy, focus and stress.'); return }
    const minutes = (interrupted || result === 'unfinished') && remaining.trim() ? Number(remaining) : null
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)) { setError(zh ? '请填写有效的分钟数，或留空。' : 'Enter a valid number of minutes, or leave it blank.'); return }
    const signature = JSON.stringify({values,reason,other,progress,next,result,remaining})
    if (!savedState.current && lastPayload.current && lastPayload.current !== signature) attempt.current = requestId('work-feedback')
    lastPayload.current = signature
    persistDraft()
    saving.current = true
    setBusy(true);r.setSubmitting(true);setError('')
    try {
      if (DEMO_MODE && !savedState.current) {
        await r.service.saveState(values, attempt.current, 'manual')
        savedState.current = true
      }
      if (!savedWork.current) {
        // An interruption ends this session. Only an explicit estimate becomes
        // an independent candidate; it is not authorization to schedule it.
        if (DEMO_MODE) {
          if (interrupted && minutes !== null) demoScheduleTask(request.session.task_id, request.session.title, minutes, request.session.id)
          demoWorkCommand({action:'end',sessionId:request.session.id,completed:!interrupted && result==='done',energy:values.energy!,note:{reason:otherOptionValue(reason,other),progress,next,feedback:{...values},result:interrupted?'interrupted':result,remaining_minutes:minutes,...(interrupted ? {unfinished:false} : {})}})
        } else {
          await r.service.report({ request_id: attempt.current, source_session_id: request.session.id,
            original_task_id: request.session.task_id, plan_id: request.session.plan_id,
            plan_revision: request.session.plan_revision, outcome: !interrupted && result==='done' ? 'completed' : 'interrupted',
            result: interrupted ? 'interrupted' : result === 'done' ? 'done' : 'unfinished', state: values,
            reason: interrupted ? otherOptionValue(reason,other) : '', progress: interrupted || result==='unfinished' ? progress : '',
            next_step: interrupted || result==='unfinished' ? next : '', remaining_minutes: minutes, retain_candidate: minutes !== null })
          savedState.current = true
        }
        savedWork.current = true
        persistDraft()
      }
      if (!checked.current) {
        try { savedReview.current = await r.service.review() } catch { savedReview.current = null }
        checked.current = true
        persistDraft()
      }
      if (!await r.refresh(true)) throw new Error('saved_feedback_refresh_failed')
      r.showReview(savedReview.current)
      try { sessionStorage.removeItem(key) } catch { /* optional draft cleanup */ }
      r.finish(); window.dispatchEvent(new Event('humanos:current-work'))
      window.dispatchEvent(new Event('humanos:daily-state-saved'))
      void useEvents.getState().refetchEvents().catch(e => console.error('Session calendar refresh failed', e))
    } catch { setError(savedWork.current ? (zh ? '反馈已保存，暂时无法刷新。请重试加载，不会重复保存。' : 'Feedback saved; could not refresh. Retry loading without saving again.') : (zh ? '暂时无法保存反馈，输入已保留，请重试。' : 'Could not save feedback. Your input is preserved; please retry.')) }
    finally {saving.current=false;setBusy(false);r.setSubmitting(false)}
  }
  return <div className="grid gap-4" data-testid="work-report" aria-busy={busy}>
    <p className="text-sm font-medium">{request.session.title}</p>
    <fieldset disabled={busy || savedState.current} className="grid min-w-0 gap-3">
    <legend className="mb-2 text-sm font-medium">{zh?'工作记录':'Work record'}</legend>
    {!interrupted && <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm">{zh ? '本次工作内容完成了吗？' : 'Did you finish this session’s work?'}</legend>{[['done','本次已完成','Finished this portion'],['unfinished','还有未完成','Still unfinished']].map(([v,c,e])=><Button key={v} variant={result===v?'default':'outline'} onClick={()=>setResult(v)}>{zh?c:e}</Button>)}</fieldset>}
    {interrupted && <><label className="grid gap-1 text-sm">{zh?'原因（可选）':'Reason (optional)'}<select aria-label={zh?'中断原因':'Interruption reason'} className="h-10 rounded-md border bg-background px-2" value={reason} onChange={e=>setReason(e.target.value)}><option value="">{zh?'不填写':'Leave blank'}</option>{[['tired','想休息一下','Need a break'],['stuck','卡住了','Stuck'],['interrupted','被打断','Interrupted'],['other','其他','Other']].map(([v,c,e])=><option key={v} value={v}>{zh?c:e}</option>)}</select></label><OtherOptionInput selected={reason} value={other} onChange={setOther} zh={zh}/></>}
    {(interrupted || result==='unfinished') && <><label className="grid gap-1 text-sm">{zh?'做到哪里（可选）':'Where you stopped (optional)'}<Input maxLength={240} value={progress} onChange={e=>setProgress(e.target.value)}/></label><label className="grid gap-1 text-sm">{zh?'回来第一步（可选）':'First step when you return (optional)'}<Input maxLength={240} value={next} onChange={e=>setNext(e.target.value)}/></label></>}
    {(interrupted || result === 'unfinished') && <label className="grid gap-1 text-sm">{zh?'这一工作段未完成的部分，之后大约还需要多久？（可选）':'How much time will this session’s unfinished portion need later? (optional)'}<DurationInput aria-label={zh?'本段剩余分钟':'Session remaining minutes'} value={remaining} onValueChange={setRemaining} maxMinutes={10080} zh={zh} placeholder={zh?'不确定可留空':'Leave blank if unsure'}/></label>}
    </fieldset>
    <section className="grid gap-3 border-t pt-3"><h3 className="text-sm font-medium">{zh?'状态反馈（必填）':'State feedback (required)'}</h3><StateFields value={values} onChange={setValues} disabled={busy || savedState.current}/></section>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div className="flex justify-end gap-2"><Button disabled={busy || (!interrupted && !result)} onClick={()=>void save()}>{busy?(zh?'正在提交…':'Submitting…'):savedWork.current?(zh?'重新加载':'Reload'):(zh?'提交反馈':'Submit feedback')}</Button></div>
  </div>
}
