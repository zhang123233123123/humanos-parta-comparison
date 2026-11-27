'use client'
import { useState } from 'react'
import { apiRequest } from '@/lib/client/api'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import { Button } from '@/components/ui/button'

export function TaskEnergyEditor({ task, locale, onSaved }: { task: HumanOSTask; locale: string; onSaved: () => Promise<void> }) {
  const zh = locale === 'zh'
  const [level, setLevel] = useState(task.energy_demand || 'unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const labels = zh ? { unknown: '未知／不填写', low: '低', medium: '中', high: '高' } : { unknown: 'Unknown', low: 'Low', medium: 'Medium', high: 'High' }
  const save = async () => {
    setBusy(true); setError(''); setSaved(false)
    try {
      await apiRequest('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, energy_demand: level }) })
      setSaved(true)
      await onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') }
    finally { setBusy(false) }
  }
  const assessment = task.energy_assessment
  return <section className="rounded-xl border bg-card p-4 space-y-3">
    <h3 className="font-semibold">{zh ? '预计精力需求' : 'Expected energy demand'}</h3>
    <p className="text-xs text-muted-foreground">{zh ? '与任务难度独立，不自动换算。仅用于建议，不会改动正式日历。' : 'Independent of difficulty. Advisory only; saving does not change the calendar.'}</p>
    <select aria-label={zh ? '预计精力需求' : 'Expected energy demand'} className="w-full rounded-md border bg-background p-2" disabled={busy} value={level} onChange={e => { setLevel(e.target.value as typeof level); setSaved(false) }}>
      {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <p className="text-xs">{zh ? '已保存来源：' : 'Saved source: '}{task.energy_demand_source === 'user_confirmed' ? (zh ? '用户确认' : 'User confirmed') : (zh ? '未知' : 'Unknown')}</p>
    {assessment && <p className="text-xs">{assessment.reason_code === 'high_demand_low_reported_energy' ? (zh ? '你自报精力较低，而此任务精力需求较高。可考虑较短的执行段；总工作量不变。' : 'Reported energy is low for this high-demand task. Consider a shorter session without reducing total work.') : (zh ? '仅作参考；缺少当日精力或任务需求时不作匹配结论。' : 'Advisory only. Missing current-day energy or demand does not imply a match.')}</p>}
    {assessment?.reported_at && <p className="text-xs text-muted-foreground">{zh ? '自报时间：' : 'Reported: '}{new Date(assessment.reported_at).toLocaleString()}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {saved && <p role="status">{zh ? '已保存' : 'Saved'}</p>}
    <Button disabled={busy} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存精力需求' : 'Save energy demand')}</Button>
  </section>
}
