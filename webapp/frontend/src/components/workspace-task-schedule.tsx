'use client'
import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/client/api'
import { currentScheduleResult } from '@/lib/client/current-schedule-result'
import { requestId } from '@/lib/client/request-id'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { useEvents } from '@/hooks/use-events'
import { useTranslation } from '@/i18n/LanguageProvider'
import type { PlanDecision } from '@/lib/contracts/planning-contracts'

export function WorkspaceTaskSchedule({ taskId, title, onClose, onPreview }: { taskId: string; title: string; onClose: () => void; onPreview?: () => void }) {
  const runtime = useWorkspaceRuntime(); const { locale } = useTranslation(); const zh = locale === 'zh'
  const [scope, setScope] = useState('local'); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const attempt = useRef(requestId('workspace-task'))
  const jobRef = useRef<{id: string; week: string} | null>(null)
  async function generate() {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!jobRef.current) {
        const status = await apiRequest<{current_week_id: string}>('/api/weeks/status')
        const accepted = await apiRequest<{job: {job_id: string}}>('/api/schedules/decide', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({week_id: status.current_week_id, replan_scope: scope, affected_task_ids: [taskId], request_id: attempt.current})
        })
        jobRef.current = {id: accepted.job.job_id, week: status.current_week_id}
      }
      const pending = jobRef.current
      let result: PlanDecision | undefined
      for (let i = 0; i < 180; i++) {
        const {job} = await apiRequest<{job: {status: string; result?: PlanDecision; error?: string}}>(`/api/background-jobs?job_id=${encodeURIComponent(pending.id)}`)
        if (job.status === 'failed') { jobRef.current = null; attempt.current = requestId('workspace-task'); throw new Error(zh ? '生成草案失败，请重试。原计划没有改变。' : 'Draft generation failed. Retry; your plan is unchanged.') }
        if (job.status === 'completed') { result = job.result; break }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      if (!result) throw new Error(zh ? '仍在等待排程结果，请点击继续读取。' : 'Still waiting for the draft. Continue reading the result.')
      const plan = await currentScheduleResult(result, pending.week, locale)
      const [active, tasks, profile, snapshot] = await Promise.all([
        apiRequest<any>('/api/plans/active'), apiRequest<any>('/api/tasks'), apiRequest<any>('/api/profile'), runtime?.refresh()
      ])
      usePlanPreview.getState().load(plan, active.data.plan, profile.data.profile.user_id, snapshot?.state_id || null,
        Object.fromEntries(tasks.data.tasks.map((t: any) => [t.id, t.title])), profile.data.profile.timezone,
        Object.fromEntries(tasks.data.tasks.map((t: any) => [t.id, t])))
      window.dispatchEvent(new Event('humanos:plan-revision'))
      await useEvents.getState().refetchEvents()
      onClose(); onPreview?.()
    } catch (e) { setError(e instanceof Error ? e.message : (zh ? '读取草案失败，请重试。' : 'Could not read the draft. Retry.')) }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>{zh ? '安排任务' : 'Schedule task'} · {title}</DialogTitle><DialogDescription>{zh ? '任务会按工作段拆分。生成后在工作台日历预览，确认后才更改正式安排。' : 'Work is split into sessions. Preview on the workspace calendar and confirm before changing your schedule.'}</DialogDescription></DialogHeader>
    <label className="grid gap-2">{zh ? '安排范围' : 'Scheduling scope'}<select className="rounded border bg-background p-2" disabled={busy || Boolean(jobRef.current)} value={scope} onChange={e => { setScope(e.target.value); attempt.current = requestId('workspace-task') }}><option value="local">{zh ? '本周内，只安排这项任务' : 'This week, this task only'}</option><option value="today">{zh ? '今天，允许调整今天后续工作' : 'Today, allow adjusting upcoming work today'}</option></select></label>
    <p className="text-sm text-muted-foreground">{scope === 'today' ? (zh ? '可能移动今天其他尚未开始的工作；排不下的部分仍保留为待安排。' : 'Other unstarted work today may move. Work that does not fit remains unscheduled.') : (zh ? '保留其他任务的安排，使用剩余可用时间。' : 'Preserve other tasks and use the remaining available time.')}</p>
    {busy && <p role="status">{zh ? '正在生成并读取草案…' : 'Generating and reading the draft…'}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button disabled={busy} onClick={generate}>{jobRef.current ? (zh ? '继续读取' : 'Continue reading') : (zh ? '生成安排草案' : 'Generate draft')}</Button>
  </DialogContent></Dialog>
}
