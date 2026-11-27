'use client'
import { DEMO_MODE } from '@/lib/demo/config'
import { TaskDetailsLink } from '@/components/task-details-link'
import { SessionWorkRecord } from '@/components/session-work-record'

import { useEffect, useState } from 'react'
import { segmentStatus, localTime } from '@/lib/presentation/task'
import type { EventInput } from '@fullcalendar/core'
import { useModal } from '@/hooks/use-modal'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { useTranslation } from '@/i18n/LanguageProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isOpenSession, localDate } from '@/lib/interaction/core'
import { apiRequest } from '@/lib/client/api'
import { draftInstant, wallParts } from '@/lib/calendar-draft-time'
import type { ExecutionSession } from '@/lib/contracts/execution-contracts'

type Selection = NonNullable<ReturnType<typeof useModal>['activeEvent']>
const hhmm = (hour: number) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round(hour % 1 * 60)).padStart(2, '0')}`

export function WorkspaceSessionDetails({ selection, event, onAdjust }: {
  selection: Selection; event?: EventInput; onAdjust: (start: Date, end: Date) => void
}) {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const runtime = useWorkspaceRuntime()
  const zone = runtime?.snapshot?.profile.timezone || 'UTC'
  const [session, setSession] = useState<ExecutionSession | null>(null)
  const [readError, setReadError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    let alive = true
    setSession(null); setReadError(false); setEditing(false); setError('')
    if (selection.start && selection.end) {
      const from = wallParts(new Date(selection.start), zone), to = wallParts(new Date(selection.end), zone)
      setDate(from.date); setStart(hhmm(from.hour)); setEnd(hhmm(to.hour))
    }
    if (selection.executionSessionId) void apiRequest<{data:{execution_sessions:ExecutionSession[]}}>('/api/execution-sessions')
      .then(result => { if (alive) setSession(result.data.execution_sessions.find(item => item.execution_session_id === selection.executionSessionId) || null) })
      .catch(() => { if (alive) setReadError(true) })
    return () => { alive = false }
  }, [selection.uniqueId, selection.start, selection.end, selection.executionSessionId, zone])
  const related = (runtime?.snapshot?.sessions || []).filter(item => item.task_id === String(selection.taskId || selection.id) && !['superseded', 'cancelled'].includes(item.status))
  const current = related.find(item => item.id === selection.executionSessionId)
  const work = session?.planned_work_minutes
  const formatTime = (value: Date) => localTime(value, zone, locale, 'time')
  const canAdjust = Boolean(event && event.editable !== false && selection.start && selection.end && !selection.isPreview)
  function submit() {
    try {
      if (!date || !start || !end || end <= start) throw new Error(zh ? '结束时间必须晚于开始时间。' : 'End time must be later than start time.')
      const asHour = (value: string) => Number(value.slice(0, 2)) + Number(value.slice(3)) / 60
      onAdjust(new Date(draftInstant(date, 0, asHour(start), zone)), new Date(draftInstant(date, 0, asHour(end), zone)))
      setError(''); setEditing(false)
    } catch (e) { setError(e instanceof Error ? e.message : (zh ? '请检查时间。' : 'Check the time.')) }
  }
  return <section className="grid min-h-0 content-start gap-4 overflow-y-auto p-4" aria-label={zh ? '工作段详情' : 'Session details'}>
    <div><h3 className="text-base font-semibold">{selection.title}</h3>
      {current && related.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{zh ? `第 ${current.ordinal} / ${related.length} 段` : `Session ${current.ordinal} / ${related.length}`}</p>}
    </div>
    <dl className="grid gap-3 text-sm">
      {selection.start && <div><dt className="text-xs text-muted-foreground">{zh ? '日期' : 'Date'}</dt><dd className="mt-1">{new Date(selection.start).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', { timeZone: zone, month: 'long', day: 'numeric', weekday: 'short' })}</dd></div>}
      {selection.start && selection.end && <div><dt className="text-xs text-muted-foreground">{zh ? '时间' : 'Time'}</dt><dd className="mt-1">{formatTime(selection.start)}–{formatTime(selection.end)}</dd></div>}
      {selection.executionSessionId && <div><dt className="text-xs text-muted-foreground">{zh ? '本段工作量' : 'Session workload'}</dt><dd className="mt-1">{typeof work === 'number' && Number.isFinite(work) ? `${work} ${zh ? '分钟' : 'minutes'}` : (zh ? '未提供' : 'Not provided')}</dd></div>}
      {current && <div><dt className="text-xs text-muted-foreground">{zh ? '本段状态' : 'Session status'}</dt><dd className="mt-1">{segmentStatus(current.status, zh)}</dd></div>}
    </dl>
    {selection.executionSessionId && ['completed', 'ended', 'interrupted'].includes(current?.status || session?.status || '') && <SessionWorkRecord sessionId={selection.executionSessionId} session={session} locale={locale} />}
    {readError && <p role="alert" className="text-xs text-destructive">{zh ? '暂时无法读取本段工作量，请重新打开详情。' : 'Could not load the session workload. Reopen the details to retry.'}</p>}
    {current && isOpenSession(current) && localDate(Date.parse(current.start), zone) === localDate(runtime!.now, zone) && <Button disabled={starting || Boolean(runtime?.blocked || runtime?.overlay || runtime?.readError)} onClick={async () => {
      if (!runtime || starting) return
      if (runtime.activeWork?.id === current.id) { window.dispatchEvent(new Event('humanos:current-work')); return }
      if (runtime.activeWork) { runtime.open({ id: 'switch:' + current.id, kind: 'switch', session: current }); return }
      setStarting(true); setError('')
      try { await runtime.startWork(current) }
      catch { setError(zh ? '暂时无法记录开始，原计划没有改变，请重试。' : 'Could not record the start. Your plan is unchanged. Please retry.') }
      finally { setStarting(false) }
    }}>{starting ? (zh ? '正在开始…' : 'Starting…') : runtime?.activeWork?.id === current.id ? (zh ? '返回当前工作' : 'Return to current work') : (zh ? '开始这段工作' : 'Start this session')}</Button>}
    {!editing && error && <p role="alert" className="text-xs">{error}</p>}
    {canAdjust && <Button variant="outline" size="sm" className="justify-self-start" disabled={Boolean(runtime?.blocked || runtime?.overlay)} onClick={() => setEditing(value => !value)}>{zh ? '调整时间' : 'Adjust time'}</Button>}
    {editing && <div className="grid gap-3 rounded-lg border p-3">
      <label className="grid gap-1.5 text-xs">{zh ? '日期' : 'Date'}<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="grid gap-1.5 text-xs">{zh ? '开始时间' : 'Start time'}<Input type="time" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label className="grid gap-1.5 text-xs">{zh ? '结束时间' : 'End time'}<Input type="time" value={end} onChange={e => setEnd(e.target.value)} /></label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button size="sm" onClick={submit}>{zh ? '预览调整' : 'Preview change'}</Button>
    </div>}
    {(selection.taskId || selection.id) && <TaskDetailsLink taskId={String(selection.taskId || selection.id)} className="text-xs text-muted-foreground underline underline-offset-4">{zh ? '查看任务详情' : 'View task details'}</TaskDetailsLink>}
  </section>
}
