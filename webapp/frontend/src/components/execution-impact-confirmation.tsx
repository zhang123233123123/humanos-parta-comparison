'use client'
import Link from 'next/link'
import { Button } from './ui/button'
import type { ExecutionImpact } from '@/lib/contracts/execution-contracts'

export function ExecutionImpactConfirmation({ impact, locale, busy, onConfirm, onCancel }: {
  impact: ExecutionImpact; locale: string; busy: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const zh = locale === 'zh'
  return <section role="alert" className="rounded-xl border border-amber-500/50 bg-background p-4 space-y-3">
    <h3 className="font-semibold">{zh ? '执行前需要确认时间冲突' : 'Review the schedule impact before starting'}</h3>
    <p className="text-sm">{zh ? '继续执行可能挤占后续安排，或超过截止时间。确认执行不会自动解决冲突，也不会修改正式日历。' : 'Continuing may overlap later work or exceed a deadline. Confirmation does not resolve conflicts or change your calendar.'}</p>
    {impact.affected_sessions.map(item => <p key={item.execution_session_id} className="text-sm">{item.task_title || item.task_id} · {item.overlap_minutes} {zh ? '分钟重叠' : 'min overlap'}</p>)}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} variant="outline" onClick={onConfirm}>{zh ? '已了解冲突，仍然执行' : 'Proceed despite conflicts'}</Button>
      <Button disabled={busy} variant="ghost" onClick={onCancel}>{zh ? '暂不执行' : 'Not now'}</Button>
      <Button variant="secondary" asChild><Link href="/app/plan?adjust=manual">{zh ? '先调整日程' : 'Adjust schedule first'}</Link></Button>
    </div>
  </section>
}
