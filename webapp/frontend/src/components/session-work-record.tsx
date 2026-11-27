'use client'

import type { ExecutionSession } from '@/lib/contracts/execution-contracts'
import { demoWorkState } from '@/lib/demo/work-actions'
import { DEMO_MODE } from '@/lib/demo/config'
import { MOODS } from '@/lib/interaction/core'
import { interruptionReason } from '@/lib/presentation/task'

// Always read by execution session ID, never from the latest account state or
// the parent task: another session's feedback must not replace this record.
export function SessionWorkRecord({ sessionId, session, reason, locale, showTitle = true }: {
  sessionId: string; session?: ExecutionSession | null; reason?: string | null; locale: string; showTitle?: boolean
}) {
  const zh = locale === 'zh'
  const note = DEMO_MODE ? demoWorkState().notes[sessionId] : undefined
  const saved = note?.ended ? note : undefined
  const source = session?.execution_session_id === sessionId ? session : undefined
  const snapshot = source?.interruption_snapshot || {}
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const report = source?.work_report as {result?:string;reason?:string;progress?:string;next_step?:string;remaining_minutes?:number|null;feedback?:{mood?:string;energy?:number;focus?:number;stress?:number;daily_note?:string}} | undefined
  const feedback = saved?.feedback || report?.feedback
  const rows: [string, string][] = []
  const add = (label: string, value: unknown) => { const content = text(value); if (content) rows.push([label, content]) }
  if (saved?.result) add(zh ? '本次完成情况' : 'Session outcome', saved.result === 'done' ? (zh ? '本次已完成' : 'Finished this portion') : saved.result === 'unfinished' ? (zh ? '还有未完成' : 'Still unfinished') : (zh ? '已中断' : 'Interrupted'))
  if (!saved?.result && report?.result) add(zh ? '本次完成情况' : 'Session outcome', report.result === 'done' ? (zh ? '本次已完成' : 'Finished this portion') : report.result === 'unfinished' ? (zh ? '还有未完成' : 'Still unfinished') : (zh ? '已中断' : 'Interrupted'))
  const savedReason = saved?.reason || report?.reason || reason || source?.pause_reason
  if (savedReason) add(zh ? '中断原因' : 'Interruption reason', interruptionReason(savedReason, zh))
  add(zh ? '进度记录' : 'Progress', saved?.progress || snapshot.progress)
  add(zh ? '回来第一步' : 'First step back', saved?.next || snapshot.next_action || snapshot.next_step)
  if (typeof saved?.remaining_minutes === 'number') add(zh ? '本段未完成部分预计用时' : 'Estimated unfinished portion', `${saved.remaining_minutes} ${zh ? '分钟' : 'min'}`)
  else if (typeof report?.remaining_minutes === 'number') add(zh ? '本段未完成部分预计用时' : 'Estimated unfinished portion', `${report.remaining_minutes} ${zh ? '分钟' : 'min'}`)
  const mood = MOODS.find(item => item.value === feedback?.mood)
  if (mood) add(zh ? '心情' : 'Mood', `${mood.emoji} ${zh ? mood.zh : mood.en}`)
  for (const key of ['energy', 'focus', 'stress'] as const) {
    const value = feedback?.[key] ?? (key === 'energy' ? saved?.energy : undefined)
    if (typeof value === 'number') add(zh ? { energy: '精力', focus: '专注', stress: '压力' }[key] : { energy: 'Energy', focus: 'Focus', stress: 'Stress' }[key], `${value}/7`)
  }
  add(zh ? '补充说明' : 'Note', feedback?.daily_note)
  if (!rows.length) return null
  return <section className="grid gap-2 text-sm" data-session-record={sessionId}>
    {showTitle && <h3 className="font-medium">{zh ? '本段笔记与反馈' : 'Session notes and feedback'}</h3>}
    <dl className="grid gap-2">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
  </section>
}
