'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { changedDraftFields, draftForm, type DraftFields, type DraftForm } from '@/lib/presentation/draft-fields'

type Props = { task: DraftFields; version: number; timezone?: string | null; disabled: boolean; locale: string; onSave: (fields: Record<string, string | number | null>, version: number) => Promise<boolean> }
export function TaskDraftEditor({ task, version, timezone, disabled, locale, onSave }: Props) {
  const zh = locale === 'zh'
  const [open, setOpen] = useState(false)
  const [baseline, setBaseline] = useState<DraftForm | null>(null)
  const [form, setForm] = useState<DraftForm | null>(null)
  const [baseVersion, setBaseVersion] = useState(version)
  const [error, setError] = useState('')
  const [explicitOffset, setExplicitOffset] = useState(false)
  const reset = () => {
    try { const next = draftForm(task, timezone); setForm(next); setBaseline(next); setBaseVersion(version); setError(''); setOpen(true) }
    catch { setError(zh ? '无法读取草稿时区，请核对设置' : 'Unable to read draft timezone; check settings') }
  }
  const set = (key: keyof DraftForm, value: string) => setForm(old => old ? { ...old, [key]: value } : old)
  const stale = version !== baseVersion
  return <div className="mt-2">
    {!open && <Button size="sm" variant="outline" disabled={disabled} onClick={reset}>{zh ? '编辑任务信息' : 'Edit task fields'}</Button>}
    {error && <p role="alert" className="my-2 text-xs text-destructive">{error}</p>}
    {open && form && baseline && <form className="space-y-2 rounded-lg bg-muted/40 p-2 text-xs" onSubmit={async e => {
      e.preventDefault(); setError('')
      try {
        const fields = changedDraftFields(baseline, form)
        if (!Object.keys(fields).length) { setOpen(false); return }
        if (await onSave(fields, baseVersion)) setOpen(false)
      } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') }
    }}>
      {stale && <p role="alert">{zh ? '草稿已在另一处更新，输入暂时保留。请加载最新版本后再编辑。' : 'Draft changed elsewhere. Your inputs are retained; load the latest version before editing.'}<Button type="button" size="sm" variant="ghost" onClick={() => { if (window.confirm(zh ? '放弃未保存输入，加载最新版本？' : 'Discard unsaved inputs and load the latest version?')) reset() }}>{zh ? '加载最新版本' : 'Load latest'}</Button></p>}
      <fieldset disabled={disabled || stale} className="space-y-2 disabled:opacity-60">
        <label className="block">{zh ? '重复频率' : 'Repeat'}<select className="mt-1 w-full rounded border bg-background p-2" value={form.recurrence} onChange={e => set('recurrence', e.target.value)}><option value="none">{zh ? '不重复' : 'Does not repeat'}</option><option value="daily">{zh ? '每天' : 'Every day'}</option></select></label>
        {form.recurrence === 'daily' && <p>{zh ? '每天一次，每次使用下方时长。灵活安排不需要截止时间，请清空不适用的开始／截止时间。提交后保存到 Profile，可在那里修改或删除重复活动。' : 'Once each day, using the duration below. Flexible activities need no deadline; clear inapplicable start/deadline values. Saved activities can be edited or deleted in Profile.'}</p>}
        <label className="block">{zh ? '任务名称' : 'Title'}<input className="mt-1 w-full rounded border bg-background p-2" maxLength={200} value={form.title} onChange={e => set('title', e.target.value)} /></label>
        <label className="block">{zh ? '任务类型' : 'Task type'}<select className="mt-1 w-full rounded border bg-background p-2" value={form.task_type} onChange={e => set('task_type', e.target.value)}><option value="" disabled>{zh ? '请选择' : 'Select'}</option><option value="fixed_event">{zh ? '固定任务' : 'Fixed task'}</option><option value="flexible_task">{zh ? '普通任务' : 'Ordinary task'}</option></select></label>
        <p className="text-muted-foreground">{zh ? '时间使用时区：' : 'Time zone: '}{timezone || (zh ? '未知，请填写带 UTC 偏移的完整时间' : 'Unknown; include a UTC offset')}</p>
        {timezone && <label className="flex gap-2"><input type="checkbox" checked={explicitOffset} onChange={e => setExplicitOffset(e.target.checked)} />{zh ? '填写带 UTC 偏移的时间（处理夏令时歧义）' : 'Enter an explicit UTC offset (for ambiguous daylight-saving times)'}</label>}
        {(['start_at', 'deadline_at'] as const).map(key => <label key={key} className="block">{key === 'start_at' ? (zh ? '开始时间（没有固定开始可留空）' : 'Start (leave blank if flexible)') : (zh ? '截止时间' : 'Deadline')}<input className="mt-1 w-full rounded border bg-background p-2" type={timezone && !explicitOffset ? 'datetime-local' : 'text'} placeholder="2026-09-11T09:00:00+08:00" value={form[key]} onChange={e => set(key, e.target.value)} /></label>)}
        <label className="block">{zh ? '预计时长（分钟）' : 'Duration (minutes)'}<input className="mt-1 w-full rounded border bg-background p-2" type="number" min={1} max={1440} step={1} value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)} /></label>
        <label className="block">{zh ? '优先级' : 'Priority'}<select className="mt-1 w-full rounded border bg-background p-2" value={form.priority} onChange={e => set('priority', e.target.value)}><option value="">{zh ? '未设置' : 'Not set'}</option><option value="高">{zh ? '高' : 'High'}</option><option value="中">{zh ? '中' : 'Medium'}</option><option value="低">{zh ? '低' : 'Low'}</option></select></label>
        <label className="block">{zh ? '任务上下文' : 'Context'}<textarea className="mt-1 w-full rounded border bg-background p-2" rows={3} value={form.context} onChange={e => set('context', e.target.value)} /></label>
        <Button size="sm" type="submit">{zh ? '保存草稿修改' : 'Save draft changes'}</Button>
      </fieldset>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { if (JSON.stringify(form) === JSON.stringify(baseline) || window.confirm(zh ? '放弃未保存修改？' : 'Discard unsaved changes?')) setOpen(false) }}>{zh ? '关闭编辑' : 'Close'}</Button>
      <p className="text-muted-foreground">{zh ? '这里只更新草稿。仍需单独确认保存任务及日历。' : 'Edits update only the draft. Task and calendar confirmation remain separate.'}</p>
    </form>}
  </div>
}
