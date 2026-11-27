'use client'
import { SchedulePendingButton, type PendingSelection } from '@/components/pending-task-details'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/client/api'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import type { ExecutionSession } from '@/lib/contracts/execution-contracts'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/LanguageProvider'
import { dailyRecorded, localDate, MOODS } from '@/lib/interaction/core'
import { pendingMinutes, pendingWork, pendingSavedTasks } from '@/lib/pending-work'
import type { RuntimeState } from '@/lib/contracts/checkin-contracts'
import { useWorkspaceRuntime } from './provider'

export function formatStateUpdatedAt(state: RuntimeState, now: number, timezone: string, zh: boolean): string {
  let updatedAt = state.reported_at ? Date.parse(state.reported_at) : NaN
  if (!Number.isFinite(updatedAt) && typeof state.created_at === 'number') {
    updatedAt = state.created_at > 9999999999 ? state.created_at : state.created_at * 1000
  }
  if (!Number.isFinite(updatedAt)) return ''
  const reportedDay = localDate(updatedAt, timezone)
  const currentDay = localDate(now, timezone)
  const time = new Date(updatedAt).toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const date = reportedDay === currentDay ? '' : new Date(updatedAt).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', {
    timeZone: timezone, month: 'numeric', day: 'numeric',
    ...(reportedDay.slice(0, 4) === currentDay.slice(0, 4) ? {} : { year: 'numeric' as const }),
  })
  const stamp = date ? `${date} ${time}` : time
  return zh ? `${stamp} 更新` : `Updated ${stamp}`
}

export function TodayState() {
  const r = useWorkspaceRuntime()
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const state = r?.snapshot?.state
  const mood = MOODS.find(m => m.value === state?.mood)
  const updated = state ? formatStateUpdatedAt(state, r?.now || r?.snapshot?.now || Date.now(), r?.snapshot?.profile.timezone || 'UTC', zh) : ''
  const recorded = Boolean(r?.snapshot && dailyRecorded(r.snapshot.gate))
  return <section id="workspace-guide-state" tabIndex={-1} className="grid content-start gap-4 p-4">
    <h2 className="text-sm font-semibold">{zh ? '今日状态' : 'Today State'}</h2>
    {r?.loading ? <p className="text-xs text-muted-foreground">{zh ? '正在读取…' : 'Loading…'}</p>
      : r?.readError ? <p role="alert" className="text-xs text-muted-foreground">{zh ? '暂时无法读取状态' : 'Could not read your status'}</p>
      : !recorded && state ? <p className="text-xs text-muted-foreground">{zh ? '今天尚未更新' : 'Not updated today'}</p> : null}
    {state ? <>
      <p className="text-sm">{mood ? `${mood.emoji} ${zh ? mood.zh : mood.en}` : (zh ? '心情未报告' : 'Mood not reported')}</p>
      <dl className="grid gap-3 text-sm tabular-nums">
        {(['energy', 'focus', 'stress'] as const).map((key) => <div key={key} className="flex items-baseline justify-between gap-3 whitespace-nowrap">

          <dt className="text-muted-foreground">{zh ? { energy: '精力', focus: '专注', stress: '压力' }[key] : { energy: 'Energy', focus: 'Focus', stress: 'Stress' }[key]}</dt>
          <dd>{typeof state[key] === 'number' ? `${state[key]}/7` : '—'}</dd>
        </div>)}
      </dl>
      {updated && <p className="text-[11px] text-muted-foreground">{updated}</p>}
    </> : !r?.loading && !r?.readError ? <p className="text-xs text-muted-foreground">{zh ? '今天感觉怎么样？' : 'How are you feeling today?'}</p> : null}
    <Button id="workspace-guide-state-update" variant="outline" size="sm" className="justify-self-start" disabled={!r || r.blocked || Boolean(r.overlay)} onClick={() => r?.open({ id: 'manual-state', kind: 'state', source: 'manual' })}>{recorded ? (zh ? '更新状态' : 'Update state') : (zh ? '填写今日状态' : 'Fill today’s state')}</Button>
    {r?.readError && <Button variant="outline" size="sm" className="justify-self-start" onClick={() => void r.refresh()}>{zh ? '重新读取' : 'Retry loading'}</Button>}
  </section>
}

export function CandidatePanel({ onSelect }: { onSelect?: (selection: PendingSelection) => void } = {}) {
  const r = useWorkspaceRuntime()
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const preview = usePlanPreview()
  const pending = pendingWork(preview.plan?.unscheduled_tasks, r?.snapshot?.candidates)
  const [tasks, setTasks] = useState<HumanOSTask[]>([])
  const [sessions, setSessions] = useState<ExecutionSession[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [taskResult, sessionResult] = await Promise.all([
        apiRequest<{data:{tasks:HumanOSTask[]}}>('/api/tasks'),
        apiRequest<{data:{execution_sessions:ExecutionSession[]}}>('/api/execution-sessions'),
      ])
      if (!Array.isArray(taskResult.data?.tasks) || !Array.isArray(sessionResult.data?.execution_sessions)) throw new Error('Pending records could not be read')
      setTasks(taskResult.data.tasks); setSessions(sessionResult.data.execution_sessions); setReadError(false)
    } catch { setReadError(true) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const reload = () => { void refresh() }
    for (const name of ['humanos:tasks-updated', 'humanos:plan-updated', 'humanos:plan-revision', 'humanos:demo-feedback-scenario']) window.addEventListener(name, reload)
    return () => { for (const name of ['humanos:tasks-updated', 'humanos:plan-updated', 'humanos:plan-revision', 'humanos:demo-feedback-scenario']) window.removeEventListener(name, reload) }
  }, [refresh])
  const saved = pendingSavedTasks(tasks, sessions, preview.plan, r?.snapshot?.candidates)
  return <section className="grid min-h-0 content-start gap-3 overflow-y-auto p-4" id="workspace-candidate-list">
    {pending.count + saved.length > 0 && <p className="text-xs text-muted-foreground">{zh ? `${pending.count + saved.length} 项待安排` : `${pending.count + saved.length} to schedule`}</p>}
    {saved.map(task => <article key={`saved:${task.id}`} className="grid gap-1.5 rounded-xl border p-3 text-sm">
      <h3 className="font-medium"><button className="text-left hover:text-primary" onClick={() => onSelect?.({ taskId: String(task.id), title: task.title || '', minutes: pendingMinutes(task.duration) })}>{task.title || (zh ? '未命名任务' : 'Untitled task')}</button></h3>
      {pendingMinutes(task.duration) !== null && <p className="text-xs text-muted-foreground">{zh ? `预计 ${task.duration} 分钟` : `${task.duration} minutes`}</p>}
      <SchedulePendingButton selection={{taskId:String(task.id),title:task.title || '',minutes:pendingMinutes(task.duration)}}/>
    </article>)}
    {pending.unscheduled.map((item, index) => {
      const taskId = String(item.task_id || '')
      const title = preview.tasks[taskId]?.title || preview.titles[taskId] || (typeof item.title === 'string' ? item.title : '') || (zh ? '未命名任务' : 'Untitled task')
      const minutes = pendingMinutes(item.remaining_minutes)
      const suppliedReason = typeof item.message === 'string' && item.message.trim() ? item.message : typeof item.reason === 'string' ? item.reason : ''
      const diagnosticReason = /^[a-z0-9_.-]+$/i.test(suppliedReason.trim()) || /backend|service\s+(?:not|unavailable)|demo\s+state|session\s+state|debug|traceback|stack\s+trace|HTTP\s*\d{3}|后端|调试|未写入|内部字段/i.test(suppliedReason)
      const reason = diagnosticReason ? '' : suppliedReason
      return <article key={`unscheduled:${taskId}:${index}`} className="grid gap-1.5 rounded-xl border p-3 text-sm">
        <h3 className="font-medium"><button className="text-left hover:text-primary" onClick={() => onSelect?.({taskId, title, minutes})}>{title}</button></h3>
        <p className="text-xs text-muted-foreground">{minutes === null ? (zh ? '剩余用时未提供' : 'Remaining duration not provided') : (zh ? `剩余 ${minutes} 分钟` : `${minutes} minutes remaining`)}</p>
        {reason && <p className="text-xs text-muted-foreground">{reason}</p>}<SchedulePendingButton selection={{taskId,title,minutes}}/>
      </article>
    })}
    {pending.candidates.map(candidate => <article key={`candidate:${candidate.id}`} className="grid gap-2 rounded-xl border p-3">
      <h3 className="text-sm font-medium"><button className="text-left hover:text-primary" onClick={() => onSelect?.({taskId: candidate.original_task_id, title: candidate.title, minutes: candidate.remaining_minutes, candidate})}>{candidate.title}</button></h3>
      <p className="text-xs text-muted-foreground">{pendingMinutes(candidate.remaining_minutes) === null ? (zh ? '剩余用时未提供' : 'Remaining duration not provided') : (zh ? `剩余 ${candidate.remaining_minutes} 分钟` : `${candidate.remaining_minutes} minutes remaining`)}</p>
      <SchedulePendingButton selection={{taskId:candidate.original_task_id,title:candidate.title,minutes:candidate.remaining_minutes,candidate}}/><p className="text-xs text-muted-foreground">{zh ? '未安排' : 'Unscheduled'}</p>
    </article>)}
    {loading || r?.loading ? <p className="text-xs text-muted-foreground">{zh ? '正在读取…' : 'Loading…'}</p>
      : readError || r?.readError ? <div className="grid gap-2"><p role="alert" className="text-xs">{zh ? '读取失败，请重新加载。' : 'Could not load pending work.'}</p><Button size="sm" variant="outline" className="justify-self-start" onClick={() => { void refresh(); void r?.refresh() }}>{zh ? '重新读取' : 'Retry'}</Button></div>
      : pending.count + saved.length === 0 ? <p className="text-xs text-muted-foreground">{zh ? '没有待安排的任务' : 'No tasks waiting to be scheduled'}</p> : null}
  </section>
}
