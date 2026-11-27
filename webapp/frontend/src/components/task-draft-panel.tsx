'use client'
import { TaskDetailsLink } from '@/components/task-details-link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { apiRequest, ApiResponseError } from '@/lib/client/api'
import { useTranslation } from '@/i18n/LanguageProvider'
import { Button } from '@/components/ui/button'
import { requestId } from '@/lib/client/request-id'
import { DraftSchedulingError, hasRunningDraftSchedules, scheduleSavedDraft } from '@/lib/client/draft-scheduling'
import { TaskDraftSupplement } from '@/components/task-draft-supplement'
import { TaskDraftEditor } from '@/components/task-draft-editor'
import type { DraftFields } from '@/lib/presentation/draft-fields'
import { DRAFT_CANCELLED_EVENT, visibleDrafts } from '@/lib/presentation/draft-lifecycle'
import { readyBatch, submitDraftBatch } from '@/lib/client/draft-batch'

type Draft = { draft_id: string; thread_id: string; version: number; status: string; task_id?: string; edit_timezone?: string | null; scheduling?: { job_id?: string; status: string; outcome?: string }; task: DraftFields & { title: string; missing_fields?: string[] } }
export function TaskDraftPanel() {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const [supplementId, setSupplementId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const actionLock = useRef(false)
  const scheduleRequests = useRef<Record<string, string>>({})
  const generation = useRef(0)
  const completedJobs = useRef(new Set<string>())
  const batchAttempt = useRef<{ drafts: ReturnType<typeof readyBatch>; id: string } | null>(null)
  const load = useCallback(async (quiet = false) => {
    const token = ++generation.current
    if (!quiet) { setLoading(true); setError(''); setDiagnostic('') }
    try {
      const result = await apiRequest<{ drafts: Draft[] }>('/api/task-drafts')
      if (token !== generation.current) return
      setDrafts(visibleDrafts(result.drafts))
      for (const draft of result.drafts) {
        const job = draft.scheduling
        if (job?.status === 'completed' && job.job_id && !completedJobs.current.has(job.job_id)) {
          completedJobs.current.add(job.job_id)
          window.dispatchEvent(new CustomEvent('humanos:plan-revision'))
        }
      }
    }
    catch (e) { if (token === generation.current) { setError(e instanceof Error ? e.message : 'Unable to load drafts'); setDiagnostic(e instanceof ApiResponseError ? `${e.status} ${e.code}\n${e.diagnostic}` : '') } }
    finally { if (token === generation.current) setLoading(false) }
  }, [])
  useEffect(() => {
    void load()
    const refresh = () => { void load(true) }
    window.addEventListener('humanos:drafts-updated', refresh)
    const guard = generation
    return () => { guard.current++; window.removeEventListener('humanos:drafts-updated', refresh) }
  }, [load])
  useEffect(() => {
    if (loading || error || busy || !hasRunningDraftSchedules(drafts)) return
    const timer = window.setTimeout(() => void load(true), 2000)
    return () => window.clearTimeout(timer)
  }, [drafts, loading, error, busy, load])
  const update = async (draft: Draft, action: string, fields?: Record<string, string | number | null>) => {
    if (actionLock.current) return false
    actionLock.current = true
    setBusy(draft.draft_id); setError(''); setNotice(''); setDiagnostic('')
    let taskSaved = draft.status === 'submitted'
    try {
      if (action !== 'schedule') await apiRequest(`/api/task-drafts/${draft.draft_id}${action === 'submit' ? '/submit' : ''}`, {
        method: action === 'submit' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: draft.version, fields, action: ['defer','resume','cancel'].includes(action) ? action : undefined }),
      })
      if (action === 'submit') taskSaved = true
      if (action === 'cancel') {
        generation.current++
        setDrafts(current => current.filter(item => item.draft_id !== draft.draft_id))
        window.dispatchEvent(new CustomEvent(DRAFT_CANCELLED_EVENT, { detail: { draft_id: draft.draft_id } }))
      }
      setNotice(action === 'cancel' ? (zh ? '已取消草稿；正式任务和历史对话未删除。' : 'Draft cancelled; existing tasks and conversation history are unchanged.') : (zh ? '已保存' : 'Saved'))
      await load()
      if (action === 'submit' || action === 'schedule') {
        window.dispatchEvent(new CustomEvent('humanos:plan-revision'))
        setNotice(zh ? '任务已保存。正在生成排程草案，日历尚未变更。' : 'Task saved. Generating a proposal; calendar unchanged.')
        const id = scheduleRequests.current[draft.draft_id] ||= requestId('draft-schedule')
        const complete = await scheduleSavedDraft(draft.draft_id, id, undefined, undefined, draft.scheduling?.job_id) === 'completed'
        if (complete) delete scheduleRequests.current[draft.draft_id]
        setNotice(complete ? (zh ? '任务已保存，排程结果已生成。请切换到“排程结果”检查，日历仍需确认。' : 'Task saved. Review the schedule result; calendar confirmation is still required.') : (zh ? '任务已保存，排程仍在后台进行。稍后查看排程结果。' : 'Task saved; scheduling continues in the background.'))
        window.dispatchEvent(new CustomEvent('humanos:plan-revision'))
        await load(true)
      }
      return true
    } catch (e) {
      setDiagnostic(e instanceof ApiResponseError ? `${e.status} ${e.code}\n${e.diagnostic}` : '')
      if (e instanceof DraftSchedulingError && e.terminal) delete scheduleRequests.current[draft.draft_id]
      setNotice('')
      setError(taskSaved ? (zh ? '任务已保存，但未能确认排程完成。重新加载后，可点击该任务的“生成／重试排程”；不会重复创建任务。' : 'Task saved, but scheduling completion is unconfirmed. Reload and use Generate/retry schedule; the task will not be created again.') : (e instanceof Error ? e.message : 'Unable to save'))
      return false
    }
    finally { actionLock.current = false; setBusy('') }
  }
  const submitAll = async () => {
    if (actionLock.current) return
    const selected = batchAttempt.current?.drafts || readyBatch(drafts)
    if (!selected.length) return
    if (!batchAttempt.current && !window.confirm(zh
      ? `保存这 ${selected.length} 项信息完整的任务，并统一生成排程？缺信息和暂存的任务不会处理，日历仍需单独确认。`
      : `Save ${selected.length} complete tasks and generate one proposal? Incomplete and deferred tasks are excluded; calendar confirmation remains separate.`)) return
    const attempt = batchAttempt.current ||= { drafts: selected, id: requestId('draft-batch') }
    actionLock.current = true
    setBusy('batch'); setError(''); setNotice(''); setDiagnostic('')
    try {
      const result = await submitDraftBatch(attempt.drafts, attempt.id)
      batchAttempt.current = null
      setNotice(zh
        ? (result === 'completed' ? '批量保存完成，统一排程已生成，请在“排程结果”中确认。' : '批量保存完成，统一排程仍在后台进行。')
        : (result === 'completed' ? 'Tasks saved. Review the combined schedule proposal.' : 'Tasks saved; combined scheduling continues in the background.'))
    } catch (e) {
      if (e instanceof DraftSchedulingError && e.terminal) attempt.id = requestId('draft-batch-retry')
      setError(zh ? '批量处理尚未完成，部分任务可能已保存。重试不会重复创建；也可以逐项检查已保存任务。' : 'Batch processing is incomplete; some tasks may be saved. Retry will not duplicate tasks.')
      setDiagnostic(e instanceof Error ? e.message : '')
    } finally {
      window.dispatchEvent(new CustomEvent('humanos:plan-revision'))
      await load(true)
      actionLock.current = false; setBusy('')
    }
  }
  const labels: Record<string,string> = zh ? { needs_input: '待补充', ready: '待确认保存', deferred: '已暂存', submitted: '已保存为任务', cancelled: '已取消' } : { needs_input: 'Needs input', ready: 'Ready to save', deferred: 'Deferred', submitted: 'Saved as task', cancelled: 'Cancelled' }
  const fields: Record<string,string> = zh ? { duration_minutes: '预计时长', start_at: '开始时间', deadline_at: '截止时间', priority: '优先级', clarification: '尚有歧义，请继续补充' } : {}
  const schedulingLabel = (d: Draft) => {
    const state = d.scheduling?.status
    if (d.scheduling?.outcome === 'confirmed') return zh ? '对应排程已确认' : 'The associated schedule is confirmed'
    if (d.scheduling?.outcome === 'outdated') return zh ? '对应排程已被替换或需要更新，请查看当前排程' : 'The associated schedule was replaced or needs updating'
    if (state === 'completed') return d.scheduling?.outcome === 'needs_correction' ? (zh ? '排程结果需要修改，日历未确认' : 'Schedule needs correction; calendar unconfirmed') : (zh ? '排程已生成，请审查并确认日历' : 'Schedule generated; review and confirm the calendar')
    const labels: Record<string,string> = zh ? { not_requested: '尚未请求排程', queued: '排程排队中，已恢复状态查询', running: '正在排程，已恢复状态查询', failed: '排程失败，可重试；任务仍已保存', unavailable: '排程记录不可用，请检查后再操作' } : { not_requested: 'Not scheduled yet', queued: 'Scheduling queued; monitoring resumed', running: 'Scheduling in progress; monitoring resumed', failed: 'Scheduling failed; task remains saved', unavailable: 'Scheduling record unavailable' }
    return labels[state || ''] || (zh ? '排程状态未知，请重新加载' : 'Unknown scheduling state; reload')
  }
  return <section className="min-h-0 flex-1 overflow-y-auto p-3">
    <p className="mb-3 text-xs text-muted-foreground">{zh ? '所有会话的待处理任务。暂存不会丢失，保存任务不等于确认日历。' : 'Drafts across conversations. Saving a task does not confirm its calendar placement.'}</p>
    <Button id="workspace-guide-schedule" className="mb-2 w-full" disabled={loading || !!busy || (!batchAttempt.current && !readyBatch(drafts).length)} onClick={() => void submitAll()}>
      {zh ? (busy === 'batch' ? '批量处理中…' : batchAttempt.current ? '重试本批处理' : `一键保存并排程（${readyBatch(drafts).length}）`) : (busy === 'batch' ? 'Processing…' : batchAttempt.current ? 'Retry batch' : `Save and schedule all (${readyBatch(drafts).length})`)}
    </Button>
    {batchAttempt.current && !busy && <Button className="mb-2" variant="ghost" onClick={() => { batchAttempt.current = null; setError(''); setNotice(zh ? '已停止本批重试；已保存任务仍然保留，可逐项查看和排程。' : 'Batch retry stopped. Saved tasks remain available for review and scheduling.') }}>{zh ? '停止本批重试' : 'Stop batch retry'}</Button>}
    <p className="mb-3 text-xs text-muted-foreground">{zh ? '只处理信息完整的待确认任务；待补充和已暂存任务保留。' : 'Only complete ready drafts are included; incomplete and deferred drafts remain.'}</p>
    {loading && <p role="status">{zh ? '加载中…' : 'Loading…'}</p>}
    {error && <div role="alert" className="mb-3 rounded-xl border border-destructive p-3 text-xs">{error}<Button variant="ghost" disabled={!!busy} onClick={() => void load()}>{zh ? '重新加载' : 'Reload'}</Button></div>}
    {notice && <p role="status" className="mb-3 text-xs">{notice}</p>}
    {error && diagnostic && <details className="mb-3 text-xs"><summary>{zh ? '查看诊断信息' : 'View diagnostics'}</summary><code className="block whitespace-pre-wrap break-words">{diagnostic}</code></details>}
    {!loading && !drafts.length && <p className="text-sm">{zh ? '还没有任务草稿。在左侧描述新任务即可。' : 'No drafts yet. Describe a task in chat.'}</p>}
    {drafts.map(d => <article key={d.draft_id} className="mb-3 rounded-xl border bg-card p-3">
      <h3 className="text-sm font-semibold">{d.task.title}</h3><p className="my-1 text-xs text-muted-foreground">{labels[d.status] || (zh ? '待确认' : 'To confirm')}</p>
      {d.status === 'submitted' && <p role="status" className="mb-2 text-xs">{schedulingLabel(d)}</p>}
      {d.task.recurrence === 'daily' && <p className="text-xs text-primary">{zh ? `每天 · 每次 ${d.task.duration ?? '—'} 分钟 · 按可用时段安排` : `Daily · ${d.task.duration ?? '—'} min each · Within availability`}</p>}
      {!!d.task.missing_fields?.length && !['submitted','cancelled'].includes(d.status) && <p className="text-xs">{d.task.missing_fields.map(f => f === 'recurrence_time_scope' ? (zh ? '请确认重复活动的时间范围；灵活活动无需固定开始或截止时间' : 'Clarify repeating time scope; flexible activities need no fixed start/deadline') : fields[f] || f).join(' · ')}</p>}
      {d.status === 'submitted' ? <div className="space-y-2">{d.task.recurrence === 'daily' ? <Link className="text-xs text-primary" href="/app/settings/profile">{zh ? '管理重复活动' : 'Manage recurring activity'}</Link> : <TaskDetailsLink taskId={String(d.task_id)}>{zh ? '查看任务详情' : 'View task details'}</TaskDetailsLink>}<Button size="sm" variant="outline" disabled={!!busy || loading || !d.scheduling || ['queued','running','unavailable'].includes(d.scheduling.status)} onClick={() => void update(d, 'schedule')}>{zh ? '生成／重试排程' : 'Generate/retry schedule'}</Button><p className="text-xs text-muted-foreground">{zh ? '生成当前任务的周排程草案，不会自动确认日历。' : 'Generates a weekly proposal for current tasks; calendar confirmation remains separate.'}</p></div> : d.status !== 'cancelled' && <>
        {d.status !== 'deferred' && <TaskDraftEditor task={d.task} version={d.version} timezone={d.edit_timezone} disabled={!!busy} locale={locale} onSave={(fields, version) => update({ ...d, version }, 'fields', fields)} />}
        <div className="mt-2 flex flex-wrap gap-1">
          {d.status !== 'deferred' && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setSupplementId(d.draft_id)}>{zh ? '继续补充' : 'Continue'}</Button>}
          {d.status === 'ready' && <Button size="sm" disabled={!!busy} onClick={() => void update(d, 'submit')}>{zh ? '确认保存任务' : 'Confirm task'}</Button>}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void update(d, d.status === 'deferred' ? 'resume' : 'defer')}>{zh ? (d.status === 'deferred' ? '恢复' : '暂存') : (d.status === 'deferred' ? 'Resume' : 'Defer')}</Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { if (window.confirm(zh ? '取消这份草稿？不会删除正式任务。' : 'Cancel this draft? Existing tasks are unchanged.')) void update(d, 'cancel') }}>{zh ? '取消草稿' : 'Cancel'}</Button>
        </div></>}
    </article>)}
    {supplementId && <TaskDraftSupplement key={supplementId} draftId={supplementId} locale={locale} onClose={() => setSupplementId(null)} />}
  </section>
}
