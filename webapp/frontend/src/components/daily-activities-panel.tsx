'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/client/api'
import { Button } from '@/components/ui/button'

type Activity = { id: string; title: string; duration_minutes: number }
export function DailyActivitiesPanel({ locale }: { locale: string }) {
  const zh = locale === 'zh'
  const [items, setItems] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await apiRequest<any>('/api/profile')
      if (!result.data?.profile) throw new Error('Profile unavailable')
      setItems((result.data?.profile?.weekly_context?.context_items || []).filter((a: Activity) => a.id?.startsWith('draft-activity-')))
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load activities') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const save = async (item: Activity, remove = false) => {
    if (busy) return
    if (!remove && (!item.title.trim() || !Number.isInteger(item.duration_minutes) || item.duration_minutes < 1 || item.duration_minutes > 1440)) {
      setError(zh ? '请填写名称和 1–1440 的整数分钟。' : 'Provide a title and 1–1440 whole minutes.'); return
    }
    if (remove && !window.confirm(zh ? '删除这条重复活动规则？已有日历需重新排程后确认更新。' : 'Delete this repeating rule? Regenerate and confirm to update the calendar.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await apiRequest<any>('/api/profile')
      const profile = result.data?.profile
      if (!profile) throw new Error('Profile unavailable')
      const weekly = profile.weekly_context || {}
      if (!(weekly.context_items || []).some((a: Activity) => a.id === item.id)) throw new Error(zh ? '活动已被删除，请重新加载。' : 'Activity was deleted; reload.')
      const context_items = (weekly.context_items || []).filter((a: Activity) => !remove || a.id !== item.id)
        .map((a: Activity) => a.id === item.id ? { ...a, title: item.title.trim(), duration_minutes: item.duration_minutes } : a)
      await apiRequest('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...profile, weekly_context: { ...weekly, context_items } }) })
      await load()
      setNotice(zh ? '规则已保存。请重新生成并确认排程以更新日历。' : 'Rule saved. Regenerate and confirm the schedule to update the calendar.')
      window.dispatchEvent(new CustomEvent('humanos:drafts-updated'))
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') }
    finally { setBusy(false) }
  }
  return <section className="my-6 rounded-2xl border bg-card p-5" id="daily-activities">
    <h2 className="text-xl font-semibold">{zh ? '每天重复的活动' : 'Daily activities'}</h2>
    <p className="my-2 text-sm text-muted-foreground">{zh ? '每天一次，在可用时间内安排完整时长，不需要一次性截止时间。' : 'Once daily, with the full duration inside your availability. No one-off deadline needed.'}</p>
    {loading ? <p role="status">{zh ? '正在加载…' : 'Loading…'}</p> : !items.length && !error ? <p>{zh ? '暂无重复活动，可在工作台对话中添加。' : 'No daily activities. Add one in Workspace chat.'}</p> : null}
    {error && <div role="alert">{error}<Button onClick={() => void load()} disabled={busy}>{zh ? '重新加载' : 'Reload'}</Button></div>}
    {notice && <p role="status">{notice}</p>}
    {items.map(item => <div key={item.id} className="my-3 flex flex-wrap items-center gap-2">
      <input aria-label={zh ? '活动名称' : 'Activity title'} className="rounded border bg-background p-2" value={item.title} disabled={busy || loading} onChange={e => setItems(old => old.map(a => a.id === item.id ? { ...a, title: e.target.value } : a))} />
      <input aria-label={zh ? '每次分钟数' : 'Minutes per occurrence'} type="number" min={1} max={1440} className="w-24 rounded border bg-background p-2" value={item.duration_minutes} disabled={busy || loading} onChange={e => setItems(old => old.map(a => a.id === item.id ? { ...a, duration_minutes: Number(e.target.value) } : a))} />
      <span>{zh ? '分钟／每天' : 'minutes / day'}</span>
      <Button disabled={busy || loading} onClick={() => void save(item)}>{zh ? '保存' : 'Save'}</Button>
      <Button variant="outline" disabled={busy || loading} onClick={() => void save(item, true)}>{zh ? '删除规则' : 'Delete rule'}</Button>
    </div>)}
  </section>
}
