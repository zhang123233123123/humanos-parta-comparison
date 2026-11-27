'use client'
import { TaskDetailsLink } from '@/components/task-details-link'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { candidateDetails } from '@/lib/candidate-details'
import { draftInstant } from '@/lib/calendar-draft-time'

const time = (hour: number) => {
  const minutes = Math.round(hour * 60)
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}

// Offset-bearing deadlines use the account timezone. Plain dates/local inputs
// keep their supplied wall date and time, without assuming the browser timezone.
export function candidateDeadlineLabel(value: unknown, timezone: string) {
  if (typeof value !== 'string' || !value.trim()) return null
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(value)
  if (local) {
    const [, year, month, day, hour, minute] = local
    const date = new Date(`${year}-${month}-${day}T12:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || (hour && (Number(hour) > 23 || Number(minute) > 59))) return null
    return `${Number(month)}月${Number(day)}日${hour ? ` ${hour}:${minute}` : ''}`
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleString('zh-CN', { timeZone: timezone, month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function DraftBlockDetails() {
  const preview = usePlanPreview()
  const taskId = preview.plan?.plan_patch.find(block => block.block_id === preview.selected)?.task_id
  const task = taskId ? preview.tasks[taskId] : undefined
  const details = preview.plan ? candidateDetails(preview.plan, preview.selected, task) : null
  const block = details?.block
  const [day, setDay] = useState(0)
  const selectedDate = preview.plan?.week_id ? new Date(Date.parse(preview.plan.week_id+'T12:00:00Z')+day*86400000).toISOString().slice(0,10) : ''
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (block) { setDay(block.day_index); setStart(time(block.start)); setEnd(time(block.end)); setError('') }
  }, [block])
  if (!block || !details || !preview.plan) return null
  const hour = (value: string) => { const [h, m] = value.split(':').map(Number); return h + m / 60 }
  const amount = (value: number | null) => value === null ? '未提供' : `${value} 分钟`
  const startInstant = typeof block.start_at === 'string' ? block.start_at : preview.plan.week_id ? draftInstant(preview.plan.week_id, block.day_index, block.start, preview.timezone) : null
  const currentDate = startInstant ? new Date(startInstant).toLocaleDateString('zh-CN', { timeZone: preview.timezone, month: 'long', day: 'numeric', weekday: 'short' }) : null
  const deadline = candidateDeadlineLabel(task?.deadline_at, preview.timezone)
  const difficulty = typeof task?.expected_difficulty === 'number' && task.expected_difficulty >= 1 && task.expected_difficulty <= 10 ? task.expected_difficulty : null
  const editable = block.kind === 'task_session' && !preview.stale && !preview.original

  return <section className="grid min-h-0 content-start gap-4 overflow-y-auto p-4 pb-24 lg:pb-4" aria-label="工作段详情">
    <div>
      <h2 className="break-words font-semibold">{task?.title || block.title || preview.titles[block.task_id] || '未命名任务'}</h2>
      {details.segmentNumber !== null && <p className="mt-1 text-xs text-muted-foreground">第{details.segmentNumber}/{details.segmentCount}段</p>}
    </div>
    <div>
      {currentDate && <p className="text-xs text-muted-foreground">{currentDate}</p>}
      <p className="mt-1 text-lg font-medium tabular-nums">{time(block.start)}–{time(block.end)}</p>
    </div>
    <dl className="grid gap-2 text-sm">
      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">本段工作量</dt><dd>{amount(details.work)}</dd></div>
    </dl>
    {editable ? <details key={block.block_id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">调整时间</summary>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1 text-sm">日期<Input type="date" min={preview.plan.week_id} max={preview.plan.week_id ? new Date(Date.parse(preview.plan.week_id+'T12:00:00Z')+6*86400000).toISOString().slice(0,10) : undefined} value={selectedDate} onChange={event => { if(event.target.value) setDay(Math.round((Date.parse(event.target.value+'T12:00:00Z')-Date.parse(preview.plan!.week_id+'T12:00:00Z'))/86400000)) }} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm">开始时间<Input type="time" value={start} onChange={event => setStart(event.target.value)} /></label>
          <label className="grid gap-1 text-sm">结束时间<Input type="time" value={end} onChange={event => setEnd(event.target.value)} /></label>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button variant="outline" onClick={() => {
          try { preview.edit(preview.selected, day, hour(start), hour(end)); setError('') }
          catch (cause) { setError(cause instanceof Error ? cause.message : '调整失败，请检查时间。') }
        }}>更新草案</Button>
      </div>
    </details> : <p className="text-xs text-muted-foreground">{preview.stale ? '计划已更新，请重新生成后调整。' : preview.original ? '切回建议安排后可调整时间。' : '此活动暂不支持在这里调整时间。'}</p>}
    {block.task_id && <TaskDetailsLink taskId={block.task_id} className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">查看任务详情</TaskDetailsLink>}
  </section>
}
