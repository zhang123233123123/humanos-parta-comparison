'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/client/api'
import { useTranslation } from '@/i18n/LanguageProvider'
import { useEvents } from '@/hooks/use-events'
import { nextPeriodCandidates } from '@/lib/client/next-period-candidates'
import type { PlanDecision } from '@/lib/contracts/planning-contracts'

type Task = { id: string; title: string; status: string; week_id?: string; removed_from_week?: boolean; duration?: number; deadline_at?: string; execution?: { remaining_duration_minutes?: number } }
type Preview = { preview_id: string; source_week: string; target_week: string; can_confirm: boolean; plan: PlanDecision; inherited_settings: { weekly_available_windows?: unknown; context_items?: Array<{ title?: string }> } }
export function NextWeekPlanner() {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const [tasks, setTasks] = useState<Task[]>([])
  const [week, setWeek] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const load = useCallback(async () => {
    setError('')
    try {
      const [p,t,a,d] = await Promise.all([
        apiRequest<{ data: { profile: { active_week_id?: string; weekly_context?: { week_id?: string } } } }>('/api/profile'),
        apiRequest<{ data: { tasks: Task[] } }>('/api/tasks'),
        apiRequest<{ data: { plan: PlanDecision | null } }>('/api/plans/active'),
        apiRequest<{ data: { plan: PlanDecision | null } }>('/api/plans/proposed'),
      ])
      const w = p.data.profile.active_week_id || p.data.profile.weekly_context?.week_id || ''
      const pending = nextPeriodCandidates(t.data.tasks, w, a.data.plan, d.data.plan)
      setWeek(w); setTasks(pending); setSelected(pending.map(t => t.id))
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not load pending tasks') }
    finally { setLoading(false) }
  },[])
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('humanos:plan-revision',refresh); window.addEventListener('humanos:plan-updated',refresh); return () => { window.removeEventListener('humanos:plan-revision',refresh); window.removeEventListener('humanos:plan-updated',refresh) } },[load])
  async function generate() {
    setBusy(true); setError(''); setPreview(null); setAccepted(false)
    try {
      const { job } = await apiRequest<{ job: { job_id: string } }>('/api/weeks/next/preview', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ task_ids:selected,source_week:week }) })
      for(let i=0;i<240;i++) {
        const { job: current } = await apiRequest<{ job: { status:string; error?:string; result?:Preview } }>(`/api/background-jobs?job_id=${encodeURIComponent(job.job_id)}`)
        if(current.status === 'failed') throw new Error(current.error || 'Preview failed')
        if(current.status === 'completed' && current.result) { setPreview(current.result); return }
        await new Promise(resolve => setTimeout(resolve,1500))
      }
      throw new Error(zh ? '下一周期预览仍在生成，请稍后重试。' : 'Preview is still running. Retry shortly.')
    } catch(e) { setError(e instanceof Error ? e.message : 'Preview failed') }
    finally { setBusy(false) }
  }
  async function confirm() {
    if(!preview || !accepted || !preview.can_confirm) return
    setBusy(true);setError('')
    try {
      const result = await apiRequest<{ target_week:string }>('/api/weeks/next/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preview_id:preview.preview_id,confirm:true})})
      toast.success(zh ? '已确认，任务已移入下一周期日历。' : 'Confirmed. Tasks are on next period’s calendar.')
      setPreview(null);await load();await useEvents.getState().refetchEvents()
      window.dispatchEvent(new CustomEvent('humanos:plan-revision'))
      window.dispatchEvent(new CustomEvent('humanos:navigate-week',{detail:{week:result.target_week}}))
    } catch(e) { setError(e instanceof Error ? e.message : 'Confirmation failed') }
    finally { setBusy(false) }
  }
  if(loading) return <p className="p-3 text-xs text-muted-foreground">{zh?'正在读取待安排任务…':'Loading pending tasks…'}</p>
  if(!tasks.length && !error) return null
  return <section className="m-3 max-h-[60vh] overflow-y-auto rounded-xl border border-amber-400/40 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
    <h3 className="font-semibold">{zh?'本周期存在未安排工作 · 可查看下一周期':'Unallocated work · review next period'}</h3>
    <p className="mt-1 text-xs font-medium">{zh?'当前 7 天周期起始日：':'Current seven-day period starts: '}{week}</p>
    <a className="mt-2 block underline" href="/app/plan">{zh?'先查看／生成本周期安排':'Review / generate this period’s plan'}</a>
    <p className="mt-1 text-xs text-muted-foreground">{zh?'本周期排程未找到这些任务的可行时段，可先调整本周期约束。预览下一周期不会修改安排，也不会延后截止时间。':'These tasks are not on the confirmed calendar. Previewing does not change the current plan.'}</p>
    {tasks.map(t=><label key={t.id} className="mt-3 flex items-start gap-2"><input type="checkbox" disabled={busy || !!preview} checked={selected.includes(t.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,t.id]:v.filter(id=>id!==t.id))}/><span>{t.title} · {t.execution?.remaining_duration_minutes ?? t.duration} {zh?'分钟':'min'}{t.deadline_at && <small className="block">{zh?'截止：':'Due: '}{t.deadline_at.replace('T',' ')}</small>}</span></label>)}
    {error && <div role="alert" className="mt-3 text-xs text-destructive">{error}{!tasks.length && <Button variant="outline" disabled={busy} onClick={()=>void load()}>{zh?'重新读取':'Retry loading'}</Button>}</div>}
    {!preview && <Button className="mt-3 w-full" disabled={busy || !selected.length} onClick={()=>void generate()}>{busy?(zh?'正在生成下一周期方案…':'Generating…'):(zh?'查看下一周期安排':'Preview next period')}</Button>}
    {preview && <div className="mt-3 space-y-3 border-t pt-3">
      <p className="font-medium">{preview.source_week} → {preview.target_week}</p>
      <p className="text-xs">{zh?'沿用可用时间和预留余量；只继承重复安排，不复制一次性事项。确认后将切换到下一周期，原周期未确认草案失效，其它正式安排保留。':'Uses current availability and buffer, carries recurring arrangements only, and switches to next period on confirmation. The previous unconfirmed draft is retired; other confirmed arrangements remain.'}</p>
      <p className="break-words text-xs">{typeof preview.inherited_settings.weekly_available_windows === 'string' ? preview.inherited_settings.weekly_available_windows : JSON.stringify(preview.inherited_settings.weekly_available_windows)}{(preview.inherited_settings.context_items || []).map(x=>x.title).filter(Boolean).join(' · ')}</p>
      {(preview.plan.plan_patch || []).map((b,i)=><p key={b.block_id || i} className="rounded border p-2 text-xs">{b.title || tasks.find(t=>t.id===b.task_id)?.title || b.task_id}<br/>{String(b.start_at || '').replace('T',' ')} — {String(b.end_at || '').replace('T',' ')}</p>)}
      {!preview.can_confirm && <p role="alert">{zh?'下一周期也无法完整排入，请调整可用时间或任务截止时间。任务继续保留为待安排。':'Next week cannot fit all work. Adjust availability or deadlines; tasks remain pending.'}</p>}
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={accepted} disabled={!preview.can_confirm || busy} onChange={e=>setAccepted(e.target.checked)}/>{zh?'确认以上日期、时间及沿用设置':'I confirm these dates, times and inherited settings'}</label>
      <Button className="w-full" disabled={busy || !accepted || !preview.can_confirm} onClick={()=>void confirm()}>{busy?(zh?'正在保存…':'Saving…'):(zh?'确认移入下一周期日历':'Confirm next-period calendar')}</Button>
      <Button variant="outline" className="w-full" disabled={busy} onClick={()=>{setPreview(null);setAccepted(false)}}>{zh?'暂不安排／重新选择':'Keep pending / choose again'}</Button>
    </div>}
  </section>
}
