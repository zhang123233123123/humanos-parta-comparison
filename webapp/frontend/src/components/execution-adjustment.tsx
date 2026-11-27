'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './ui/button'
import { apiRequest } from '@/lib/client/api'

type Review = {
  confirmation_token: string
  facts: { active_minutes: number; task_remaining_minutes: number | null; reported_task_remaining_minutes?: number }
  feasibility: { can_continue: boolean; reason_codes: string[]; available_minutes: number; estimated_end_at: string;
    conflicts: Array<{ block_id: string; title: string; kind: string; start_at: string; end_at: string; overlap_minutes: number; rest_remaining_minutes: number | null }> }
}

export function ExecutionAdjustment({ sessionId, locale, onApplied, onCheckpoint }: { sessionId: string; locale: string; onApplied: () => void; onCheckpoint: () => void }) {
  const zh = locale === 'zh'
  const router = useRouter()
  const [minutes, setMinutes] = useState<number | ''>('')
  const [remaining, setRemaining] = useState<number | ''>('')
  const [progress, setProgress] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [pendingChoice, setPendingChoice] = useState<string | null>(null)
  const invalidate = () => { setReview(null); setRequestId(null); setPendingChoice(null); setError('') }
  const preview = async () => {
    setBusy(true); setError('')
    try {
      const response = await apiRequest<{ data: { review: Review } }>('/api/execution-sessions/adjustment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_session_id: sessionId, duration_minutes: minutes, next_step: nextStep, task_remaining_minutes: remaining === '' ? undefined : remaining, stage: 'preview' }),
      })
      setReview(response.data.review); setRequestId(null); setPendingChoice(null)
    } catch (e) { setReview(null); setError(e instanceof Error ? e.message : 'Review failed') }
    finally { setBusy(false) }
  }
  const replan = async (checkpoint: any) => {
    const accepted = await apiRequest<any>('/api/plans/replan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'today', trigger: 'execution_adjustment', affected_task_ids: [checkpoint.task_id],
        week_id: checkpoint.week_id, request_id: checkpoint.replan_request_id }) })
    const job = accepted?.data?.replan?.job || accepted?.replan?.job || accepted?.job
    if (!job?.job_id) throw new Error(zh ? '未取得重排任务，现场已保存，可以重试。' : 'No replan job returned. Your checkpoint is saved; retry.')
    let latest = job
    for (let attempt = 0; attempt < 180 && !['completed', 'failed'].includes(latest.status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const response = await apiRequest<any>(`/api/background-jobs?job_id=${encodeURIComponent(job.job_id)}`)
      latest = response?.job || response?.data?.job || latest
    }
    if (latest.status !== 'completed') throw new Error(latest.error || (zh ? '草案尚未完成。任务已暂停，现场已保存，请到计划页查看处理状态。' : 'Draft not ready. Execution is paused and saved; check the plan page.'))
    window.dispatchEvent(new CustomEvent('humanos:plan-revision'))
    router.push('/app?review=replan')
  }
  const manual = async (checkpoint: any) => {
    await apiRequest('/api/execution-sessions/adjustment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'manual', request_id: checkpoint.replan_request_id.replace(/:replan$/, ''),
        execution_session_id: sessionId, duration_minutes: minutes }) })
    router.push('/app/plan?adjust=execution-adjustment')
  }
  const confirm = async (choice: string) => {
    if (!review) return
    setBusy(true); setError('')
    const id = requestId || `adjust-${crypto.randomUUID()}`
    setRequestId(id); setPendingChoice(choice)
    try {
      const response = await apiRequest<any>('/api/execution-sessions/adjustment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          stage: 'confirm', execution_session_id: sessionId, duration_minutes: minutes,
          next_step: nextStep, progress, task_remaining_minutes: remaining === '' ? undefined : remaining, choice, confirmation_token: review.confirmation_token, request_id: id,
        }),
      })
      setResult(response.data)
      if (choice !== 'continue') onCheckpoint()
      if (choice === 'continue') onApplied()
      else if (choice === 'replan') await replan(response.data)
      else if (choice === 'manual' || choice === 'borrow_rest') await manual(response.data)
    } catch (e) { setError(e instanceof Error ? e.message : 'Adjustment failed') }
    finally { setBusy(false) }
  }
  if (result && result.status !== 'running') return <section className="space-y-3 rounded-xl border p-4">
    <p role="status">{zh ? '任务已暂停，实际工作与恢复现场已保存。剩余工作仍需安排，尚未修改正式计划。' : 'Execution paused and checkpoint saved. Remaining work still needs scheduling; the active plan is unchanged.'}</p>
    {busy && <p>{zh ? '正在生成待确认草案…' : 'Preparing a draft…'}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button disabled={busy} onClick={() => { setBusy(true); setError(''); void replan(result).catch(e => setError(e.message)).finally(() => setBusy(false)) }}>{zh ? '生成／查看调整草案' : 'Prepare / check draft'}</Button>
    <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(''); void manual(result).catch(e => setError(e.message)).finally(() => setBusy(false)) }}>{zh ? '我自己调整' : 'Adjust manually'}</Button>
  </section>
  return <section className="space-y-4 rounded-xl border p-4">
    <h3 className="font-semibold">{zh ? '复核下一段执行' : 'Review the next interval'}</h3>
    <p className="text-sm text-muted-foreground">{zh ? '检查期间仍记录实际工作。涉及日程变化时，先保存并暂停，再查看草案；确认计划后从 Focus 恢复。' : 'Work continues during review. Schedule changes first pause and save execution; review the draft, confirm the plan, then resume from Focus.'}</p>
    <fieldset disabled={busy || pendingChoice !== null} className="grid gap-3">
      <label className="grid gap-1 text-sm">{zh ? '做到哪里（可选）' : 'Progress (optional)'}<input className="rounded border bg-background p-2" value={progress} onChange={e => { setProgress(e.target.value); invalidate() }} /></label>
      <label className="grid gap-1 text-sm">{zh ? '本次要完成的步骤／停止点' : 'Next step / stopping point'}<input className="rounded border bg-background p-2" value={nextStep} onChange={e => { setNextStep(e.target.value); invalidate() }} /></label>
      <label className="grid gap-1 text-sm">{zh ? '修正整个任务剩余分钟（可选，保存后重新规划）' : 'Correct total task minutes remaining (optional; requires replanning)'}<input type="number" min={0} className="rounded border bg-background p-2" value={remaining} onChange={e => { setRemaining(e.target.value === '' ? '' : Number(e.target.value)); invalidate() }} /></label>
      <label className="grid gap-1 text-sm">{zh ? '希望继续多少分钟' : 'Minutes to continue'}<input type="number" min={1} max={480} className="rounded border bg-background p-2" value={minutes} onChange={e => { setMinutes(e.target.value === '' ? '' : Number(e.target.value)); invalidate() }} /></label>
    </fieldset>
    <Button disabled={busy || minutes === '' || !Number.isInteger(minutes) || minutes < 1 || minutes > 480} onClick={() => void preview()}>{zh ? '检查最新进度与日程' : 'Check current work and schedule'}</Button>
    {busy && <p role="status">{zh ? '正在处理…' : 'Processing…'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {review && <div className="space-y-3">
      <p>{zh ? `已工作 ${review.facts.active_minutes} 分钟；任务预计剩余 ${review.facts.task_remaining_minutes ?? '未知'} 分钟。` : `${review.facts.active_minutes} min worked; ${review.facts.task_remaining_minutes ?? 'unknown'} min task work remaining.`}</p>
      {review.facts.reported_task_remaining_minutes !== undefined && <p className="text-sm">{zh ? `你修正的剩余工作量：${review.facts.reported_task_remaining_minutes} 分钟；确认保存后生效。` : `Your corrected remainder: ${review.facts.reported_task_remaining_minutes} minutes, applied when you save.`}</p>}
      {review.feasibility.conflicts.map(c => <div key={c.block_id} className="rounded border border-amber-400 p-3 text-sm">
        <p>{c.title} · {new Date(c.start_at).toLocaleTimeString()}–{new Date(c.end_at).toLocaleTimeString()}</p>
        <p>{zh ? `会占用 ${c.overlap_minutes} 分钟` : `${c.overlap_minutes} min overlap`}</p>
        {c.kind === 'rest_buffer' && <p>{zh ? (c.rest_remaining_minutes === 0 ? '这会取消本次休息；系统不会自动采用。' : `休息将只剩 ${c.rest_remaining_minutes} 分钟；需要在调整草案中复核并确认。`) : `Rest would have ${c.rest_remaining_minutes} min left; explicit plan review is required.`}</p>}
      </div>)}
      {review.feasibility.can_continue ? <Button disabled={busy || (pendingChoice !== null && pendingChoice !== 'continue')} onClick={() => void confirm('continue')}>{zh ? `确认继续 ${minutes} 分钟` : `Confirm ${minutes} minutes`}</Button> : <>
        <p className="text-sm">{zh ? '请求超出原确认时间块、剩余工作量或遇到冲突。需要先调整计划。' : 'This exceeds the confirmed block or remaining work, or conflicts with the schedule. Review a plan adjustment first.'}</p>
        {review.feasibility.available_minutes > 0 && review.feasibility.available_minutes < Number(minutes) && <Button variant="outline" disabled={busy || pendingChoice !== null || !nextStep.trim()} onClick={() => { setMinutes(review.feasibility.available_minutes); invalidate() }}>{zh ? `仅复核本次小步骤（最多 ${review.feasibility.available_minutes} 分钟）` : `Review a smaller step (up to ${review.feasibility.available_minutes} min)`}</Button>}
        <p className="text-xs text-muted-foreground">{zh ? '缩小本次范围需要填写明确停止点，不改变整个任务要求。其余工作保留在任务中。' : 'A smaller step needs an explicit stopping point; remaining task work is preserved.'}</p>
        {review.feasibility.conflicts.some(c => c.kind === 'rest_buffer') && <Button variant="outline" disabled={busy || (pendingChoice !== null && pendingChoice !== 'borrow_rest')} onClick={() => void confirm('borrow_rest')}>{zh ? '保存暂停，预览占用休息的方案' : 'Pause and preview using rest time'}</Button>}
        <div className="flex flex-wrap gap-2">{(['replan', 'manual', 'defer'] as const).map((choice, i) => <Button key={choice} variant={i === 0 ? 'default' : 'outline'} disabled={busy || (pendingChoice !== null && pendingChoice !== choice)} onClick={() => void confirm(choice)}>{(zh ? ['保存暂停，让 HumanOS 重排', '保存暂停，我自己调整', '保存暂停，稍后安排'] : ['Pause and replan', 'Pause and edit manually', 'Pause and arrange later'])[i]}</Button>)}</div>
      </>}
    </div>}
  </section>
}
