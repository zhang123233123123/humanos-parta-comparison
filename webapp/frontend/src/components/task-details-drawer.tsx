'use client'
import { taskText } from '@/lib/task-fields'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SchedulePendingButton } from '@/components/pending-task-details'
import { TaskDialog } from '@/components/task-dialog'
import { SessionWorkRecord } from '@/components/session-work-record'
import { useInteractionBlock, useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { useTranslation } from '@/i18n/LanguageProvider'
import { apiRequest } from '@/lib/client/api'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import type { ExecutionSession, InterruptionEpisode } from '@/lib/contracts/execution-contracts'
import { arrangement, localTime, priorityLabel, segmentStatus, taskStatus } from '@/lib/presentation/task'

type Detail = { task: HumanOSTask; current_sessions?: ExecutionSession[]; history_sessions?: ExecutionSession[]; interruption_episodes?: InterruptionEpisode[] }

export function TaskDetailsDrawer() {
  const { locale } = useTranslation(), zh = locale === 'zh'
  const runtime = useWorkspaceRuntime(), path = usePathname()
  const zone = runtime?.snapshot?.profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const [id, setId] = useState(''), [data, setData] = useState<Detail | null>(null)
  const [editing, setEditing] = useState(false), [error, setError] = useState(false)
  useInteractionBlock('task-details', Boolean(id))
  useEffect(() => {
    const open = (event: Event) => { setId((event as CustomEvent).detail.taskId); setEditing(false) }
    window.addEventListener('humanos:task-details', open)
    return () => window.removeEventListener('humanos:task-details', open)
  }, [])
  useEffect(() => {
    if (path !== '/app') { setId(''); setEditing(false) }
    const url = new URL(window.location.href), legacyId = url.searchParams.get('task')
    if (legacyId && path === '/app') { setId(legacyId); url.searchParams.delete('task'); window.history.replaceState(window.history.state, '', url) }
  }, [path])
  const load = useCallback(async () => {
    if (!id) return
    const result = await apiRequest<{ data: Detail }>(`/api/tasks/${encodeURIComponent(id)}`)
    if (!result.data?.task) throw new Error('Missing task')
    return result.data
  }, [id])
  useEffect(() => {
    let live = true; setData(null); setError(false)
    if (id) void load().then(value => { if (live && value) setData(value) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [id, load])
  const task = data?.task
  const info = task ? arrangement(task, data?.current_sessions || []) : null
  const pending = runtime?.snapshot?.candidates?.filter(c => c.original_task_id === id && c.status === 'pending') || []
  const allSessions = Array.from(new Map([...(data?.current_sessions || []), ...(data?.history_sessions || [])].map(s => [s.execution_session_id, s])).values()).sort((a,b) => String(a.planned_start_at).localeCompare(String(b.planned_start_at)))
  const history = allSessions.filter(s => ['completed', 'ended', 'paused', 'interrupted'].includes(s.status))
  const close = () => { setId(''); setEditing(false) }
  const due = task?.deadline_at
  return <Dialog open={Boolean(id)} onOpenChange={open => { if (!open) close() }}><DialogContent className="z-[100] left-auto right-0 top-0 h-dvh w-full max-w-[420px] translate-x-0 translate-y-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-5 sm:max-w-[420px]" aria-describedby="task-details-description">
    <div className="grid content-start gap-5" data-testid="task-details-drawer">
      <Button variant="ghost" size="sm" className="absolute right-3 top-3" onClick={close} aria-label={zh ? '关闭任务详情' : 'Close task details'}>×</Button>
      <div className="pr-7"><DialogTitle className="break-words leading-6">{editing ? (zh ? '编辑任务' : 'Edit task') : task?.title || (zh ? '任务详情' : 'Task details')}</DialogTitle><DialogDescription id="task-details-description" className="mt-2">{zh ? '任务整体信息与安排' : 'Task information and arrangements'}</DialogDescription></div>
      {error ? <div role="alert" className="grid gap-3 text-sm"><p>{zh ? '暂时无法读取任务。' : 'Could not load the task.'}</p><Button variant="outline" onClick={() => { setError(false); void load().then(value => value && setData(value)).catch(() => setError(true)) }}>{zh ? '重试' : 'Retry'}</Button></div> : !task || !info ? <p className="text-sm">{zh ? '正在读取…' : 'Loading…'}</p> : editing ? <TaskDialog key={id} timezone={zone} open presentation="inline" onOpenChange={open => { if (!open) setEditing(false) }} initialData={{
        id, task_type: task.task_type || undefined, title: task.title || '', deadline_at: due, duration: info.estimate || undefined, priority: ({high:'高',medium:'中',low:'低'} as Record<string,string>)[String(task.priority)] || task.priority || '中', context: task.context || '', expected_difficulty: task.expected_difficulty, dependency: taskText(task, 'dependency'),
      }} onSave={async value => {
        await apiRequest('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
        const updated = await load(); if (updated) setData(updated)
        window.dispatchEvent(new Event('humanos:tasks-updated')); await runtime?.refresh()
      }} /> : <>
        <div className="flex items-center justify-between"><span className="rounded-full bg-muted px-3 py-1 text-xs" aria-label={zh ? '任务完成状态' : 'Task completion'}>{taskStatus(task.status, zh)}</span><Button size="sm" variant="outline" onClick={() => setEditing(true)}>{zh ? '编辑任务' : 'Edit task'}</Button></div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">{zh ? '截止时间' : 'Deadline'}</dt><dd className="mt-1">{localTime(due, zone, locale)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{zh ? '预计总时长' : 'Estimated total'}</dt><dd className="mt-1">{info.estimate === null ? '—' : `${info.estimate} ${zh ? '分钟' : 'minutes'}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{zh ? '优先级' : 'Priority'}</dt><dd className="mt-1">{priorityLabel(task.priority, zh)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{zh ? '难度' : 'Difficulty'}</dt><dd className="mt-1">{typeof task.expected_difficulty === 'number' ? `${task.expected_difficulty} / 10` : (zh ? '未填写' : 'Not set')}</dd></div>
          {task.dependency && <div className="col-span-2"><dt className="text-xs text-muted-foreground">{zh ? '需要先完成' : 'Depends on'}</dt><dd>{task.dependency}</dd></div>}
        </dl>
        {task.context && <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm">{task.context}</p>}
        <section className="grid gap-3 border-t pt-4"><h3 className="text-sm font-semibold">{zh ? '安排情况' : 'Arrangements'}</h3>
          <p className="text-xs text-muted-foreground">{info.planned === 0 ? (zh ? '未安排' : 'Unscheduled') : pending.length || (info.estimate !== null && info.planned < info.estimate) ? (zh ? '部分已安排' : 'Partly scheduled') : (zh ? '已安排' : 'Scheduled')}{info.planned > 0 && ` · ${info.planned} ${zh ? '分钟' : 'minutes'}`}</p>
          {info.sessions.map(s => <p key={s.execution_session_id} className="rounded-lg border p-3 text-sm">{localTime(s.planned_start_at, zone, locale)}–{localTime(s.planned_end_at, zone, locale, 'time')}</p>)}
          {info.actual !== null && <p className="text-xs text-muted-foreground">{zh ? `实际已投入约 ${info.actual} 分钟` : `About ${info.actual} minutes actually spent`}</p>}
          {pending.map(c => <div key={c.id} className="grid gap-2 text-sm"><p>{typeof c.remaining_minutes === 'number' ? (zh ? `还有约 ${c.remaining_minutes} 分钟未安排` : `About ${c.remaining_minutes} minutes unscheduled`) : (zh ? '还有工作待安排' : 'Work remains unscheduled')}</p><Button size="sm" variant="outline" onClick={() => { close(); window.setTimeout(() => runtime?.open({id:'candidate:'+c.id,kind:'candidate',candidate:c}), 0) }}>{zh ? '安排' : 'Schedule'}</Button></div>)}
          {task.task_type !== 'fixed_event' && !pending.length && (info.planned === 0 || (info.estimate !== null && info.planned < info.estimate)) && <SchedulePendingButton onBeforeOpen={close} selection={{taskId:id,title:task.title || '',minutes:info.estimate===null?null:Math.max(0,info.estimate-info.planned)}}/>}
        </section>
        <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">{zh ? '执行记录' : 'Work history'}</summary><div className="mt-3 grid gap-3">
          {!history.length && <p className="text-muted-foreground">{zh ? '暂无执行记录' : 'No work history yet'}</p>}
          {history.map((s) => { const episode = data?.interruption_episodes?.find(e => e.source_execution_session_id === s.execution_session_id); return <article key={s.execution_session_id} className="grid gap-2 border-t pt-2"><p>{localTime(s.planned_start_at, zone, locale, 'date')}</p><p>{zh ? `第 ${allSessions.indexOf(s)+1} 段` : `Session ${allSessions.indexOf(s)+1}`} · {segmentStatus(s.status, zh)} · {localTime(s.planned_start_at, zone, locale, 'time')}–{localTime(s.planned_end_at, zone, locale, 'time')}</p><SessionWorkRecord sessionId={s.execution_session_id} session={s} reason={episode?.pause_reason} locale={locale} showTitle={false} /></article> })}
        </div></details>
      </>}
    </div>
  </DialogContent></Dialog>
}
