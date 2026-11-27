'use client'
import { TaskDetailsLink } from '@/components/task-details-link'
import { DEMO_MODE } from '@/lib/demo/config'
import { demoWorkCommand, demoWorkState, demoScheduleTask } from '@/lib/demo/work-actions'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/LanguageProvider'
import { dailyRecorded, sessionKey } from '@/lib/interaction/core'
import { requestId } from '@/lib/client/request-id'
import type { WorkSession } from '@/lib/interaction/contracts'
import { useWorkspaceRuntime } from './provider'


export function CurrentWorkPanel() {
  const r = useWorkspaceRuntime()!, zh = useTranslation().locale === 'zh'
  const demo = demoWorkState(), s = r.activeWork
  const [error,setError] = useState(''), [suggestion,setSuggestion] = useState('')
  if (!s) return <p className="p-4 text-sm text-muted-foreground">{zh?'选择日历中的工作段开始。':'Choose a calendar session to begin.'}</p>
  const handedOff = r.snapshot?.candidates?.find(c=>c.source_session_id===s.id)
  const note = DEMO_MODE ? demo.notes[s.id] || {} : { progress: s.progress, next: s.next_step }, paused=s.status==='paused', ended=['completed','interrupted'].includes(s.status)
  const change = async (action:'resume') => {
    try { if (DEMO_MODE) { demoWorkCommand({action,sessionId:s.id}); await r.refresh() } else await r.startWork(s) }
    catch {setError(zh?'当前无法改变这段工作的状态。':'This work state cannot be changed.')}
  }
  const suggestions=demo.suggestions.filter(a=>a.kind!=='switch' || r.snapshot?.sessions.some(x=>x.id===a.session_id && x.id!==s.id && ['ready','scheduled','paused','running'].includes(x.status)))
  const retained = Object.entries(demo.notes).filter(([id,n])=>id!==s.id && n.unfinished && !r.snapshot?.candidates?.some(c=>c.source_session_id===id))
  return <section className="grid content-start gap-4 overflow-y-auto p-4 pb-24" data-testid="current-work">
    <p className="text-xs text-primary">{ended?(zh?'本次已结束':'Session ended'):paused?(zh?'已暂停':'Paused'):(zh?'进行中':'In progress')}</p>
    <div><h3 className="text-lg font-medium">{s.title}</h3><p className="mt-1 text-sm text-muted-foreground">{note.content || (zh?'本次：第 '+s.ordinal+' 段 · '+(s.planned_work_minutes ?? '—')+' 分钟':'Session '+s.ordinal+' · '+(s.planned_work_minutes ?? '—')+' min')}</p></div>
    {(note.progress || note.next) && <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-sm">{note.progress && <p><span className="text-muted-foreground">{zh?'上次做到：':'Last progress: '}</span>{note.progress}</p>}{note.next && <p><span className="text-muted-foreground">{zh?'回来第一步：':'Next step: '}</span>{note.next}</p>}</div>}
    <p className="text-xs text-muted-foreground">{new Date(s.start).toLocaleTimeString(zh?'zh-CN':'en-GB',{hour:'2-digit',minute:'2-digit',timeZone:r.snapshot!.profile.timezone})}–{new Date(s.end).toLocaleTimeString(zh?'zh-CN':'en-GB',{hour:'2-digit',minute:'2-digit',timeZone:r.snapshot!.profile.timezone})}</p>
    {!ended && <div className="grid grid-cols-2 gap-2"><Button disabled={r.readError || r.blocked || Boolean(r.overlay)} onClick={()=>paused?void change('resume'):r.open({id:'pause:'+s.id,kind:'report',session:s,outcome:'interrupted'})}>{paused?(zh?'继续':'Resume'):(zh?'中断':'Interrupt')}</Button><Button variant="outline" disabled={r.readError || r.blocked || Boolean(r.overlay)} onClick={()=>r.open({id:'end:'+s.id,kind:'report',session:s,outcome:'completed'})}>{zh?'结束本次':'End session'}</Button></div>}
    {ended && <p className="text-sm">{s.status==='completed'?(zh?'本次内容已完成。':'This portion is finished.'):handedOff?(handedOff.status==='pending'?(zh?'未完成部分已移至待安排。':'Unfinished work is in To schedule.'):(zh?'未完成部分已安排到新的工作段。':'Unfinished work has a new session.')):note.unfinished===false?(zh?'本次已中断。':'This session was interrupted.'):(zh?'未完成部分已保留。':'Unfinished work is retained.')}</p>}
    {ended && typeof note.energy==='number' && <p className="text-xs text-muted-foreground">{zh?'本次精力记录：':'Session energy: '}{note.energy}/7</p>}
    {ended && s.status !== 'completed' && note.unfinished!==false && !handedOff && <div className="grid grid-cols-2 gap-2"><Button onClick={()=>void change('resume')}>{zh?'恢复这部分':'Resume this portion'}</Button><Button variant="outline" onClick={async()=>{const candidate=demoScheduleTask(s.task_id,s.title,null,s.id);await r.refresh();window.dispatchEvent(new CustomEvent('humanos:pending-work',{detail:{taskId:s.task_id,title:s.title,minutes:candidate.remaining_minutes,candidate}}))}}>{zh?'稍后安排':'Schedule later'}</Button></div>}
    {DEMO_MODE && paused && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer">{zh?'调整工作方式':'Adjust how you work'}</summary><div className="mt-3 grid gap-2"><Button variant="ghost" onClick={()=>r.open({id:'pause:'+s.id,kind:'report',session:s,outcome:'interrupted'})}>{zh?'补充恢复记录':'Add a recovery note'}</Button>{suggestions.length>0 && <label className="grid gap-1">{zh?'演示建议':'Demo suggestions'}<select className="h-10 rounded-md border bg-background px-2" value={suggestion} onChange={e=>{const value=e.target.value;setSuggestion(value);if(value==='switch'){const target=r.snapshot?.sessions.find(x=>x.id===demo.suggestions.find(a=>a.kind==='switch')?.session_id);if(target)r.open({id:'switch:'+target.id,kind:'switch',session:target})}}}><option value="">{zh?'选择一种方式':'Choose an option'}</option>{suggestions.map(a=><option key={a.kind} value={a.kind}>{zh?({rest:'先休息一下',scope:'缩小本次内容',switch:'切换到轻松任务'} as Record<string,string>)[a.kind]:a.kind==='rest'?'Take a break':a.kind==='scope'?'Reduce this portion':'Switch to lighter work'}</option>)}</select></label>}{suggestion==='scope' && <label className="grid gap-1">{zh?'缩小本次内容':'Focus this session on'}<Input defaultValue={note.content || ''} placeholder={zh?'例如：先整理一篇文献':'For example: review one paper'} onBlur={async e=>{demoWorkCommand({action:'note',sessionId:s.id,note:{content:e.target.value}});await r.refresh()}}/></label>}{suggestion==='rest' && <p className="text-xs text-muted-foreground">{zh?'准备好后，点击继续。':'Resume when you are ready.'}</p>}</div></details>}
    {retained.length>0 && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">{zh?'保留的未完成工作':'Retained work'}</summary>{retained.map(([id])=>{const target=r.snapshot?.sessions.find(x=>x.id===id);return target && <Button className="mt-2 h-auto w-full whitespace-normal text-left" variant="ghost" key={id} onClick={()=>r.open({id:'switch:'+id,kind:'switch',session:target})}>{target.title}</Button>})}</details>}
    {error && <p role="alert" className="text-sm">{error}</p>}
    <TaskDetailsLink taskId={s.task_id}>{zh?'查看任务详情':'View task details'}</TaskDetailsLink>
  </section>
}

export function SwitchWorkPanel({ session }: { session: WorkSession }) {
  const r=useWorkspaceRuntime()!, zh=useTranslation().locale==='zh'
  const key='humanos:switch-note:'+r.snapshot?.profile.user_id+':'+session.id
  const [progress,setProgress]=useState(()=>{try{return sessionStorage.getItem(key)||''}catch{return ''}}), [error,setError]=useState('')
  return <div className="grid gap-4"><p className="text-sm">{zh?'切换到「'+session.title+'」？':'Switch to '+session.title+'?'}</p><label className="grid gap-1 text-sm">{zh?'当前工作做到哪里（可选）':'Current progress (optional)'}<Input maxLength={240} value={progress} onChange={e=>{setProgress(e.target.value);sessionStorage.setItem(key,e.target.value)}}/></label>{error && <p role="alert">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={r.finish}>{zh?'取消':'Cancel'}</Button><Button disabled={r.readError || r.submitting} onClick={async()=>{r.setSubmitting(true);try{if(DEMO_MODE && r.activeWork)demoWorkCommand({action:'note',sessionId:r.activeWork.id,note:{progress:progress || demoWorkState().notes[r.activeWork.id]?.progress,unfinished:true}});await r.startWork(session,false,null,progress);sessionStorage.removeItem(key);r.finish()}catch{setError(zh?'工作已变化，请重新选择。':'Work has changed. Select it again.')}finally{r.setSubmitting(false)}}}>{zh?'确认切换':'Confirm switch'}</Button></div></div>
}

export function MissedWorkPanel({ session }: { session: WorkSession }) {
  const r = useWorkspaceRuntime()!; const zh = useTranslation().locale === 'zh'
  const [error, setError] = useState(''); const busy = useRef(false), attempt = useRef(requestId('defer-work'))
  const defer = async () => {
    if (busy.current) return
    busy.current = true; r.setSubmitting(true)
    try { await r.service.defer({ request_id: attempt.current, session_id: session.id, confirmed_not_started: true, base_plan_revision: r.snapshot!.plan_revision }); if (!await r.refresh()) throw new Error('Deferral saved but refresh failed'); r.finish(); window.dispatchEvent(new Event('humanos:plan-updated')) }
    catch { setError(zh ? '暂时无法保存这次选择。原计划没有改变，请重试。' : 'Could not save this choice. Your original plan is unchanged. Please retry.') }
    finally { busy.current = false; r.setSubmitting(false) }
  }
  return <div className="grid gap-4"><p className="text-sm">{zh ? `要把「${session.title}」这一工作段放到待安排吗？` : `Move this session of ${session.title} to To schedule?`}</p>{error && <p role="alert" className="text-sm">{error}</p>}<div className="flex gap-2"><Button disabled={r.readError || r.submitting} onClick={() => void defer()}>{zh ? '放到待安排' : 'Move to To schedule'}</Button><Button variant="outline" disabled={r.submitting} onClick={r.close}>{zh ? '先不处理' : 'Not now'}</Button></div></div>
}

export function OverlapPanel() {
  const r=useWorkspaceRuntime()!, zh=useTranslation().locale==='zh', overlap=r.overlap
  if(!overlap)return <p>{zh?'这项提醒已处理。':'This reminder has been handled.'}</p>
  const {previous,next}=overlap
  return <div className="grid gap-3"><p className="text-sm">{zh?'「'+previous.title+'」仍在进行，「'+next.title+'」已到计划时间。':previous.title+' is still active as '+next.title+' is due.'}</p><div className="grid gap-2"><Button onClick={r.acknowledgeNext}>{zh?'继续 '+previous.title:'Continue '+previous.title}</Button>{next.kind==='work'?<Button variant="outline" disabled={r.readError || r.submitting} onClick={()=>r.replace({id:'switch:'+next.id,kind:'switch',session:next})}>{zh?'切换到 '+next.title:'Switch to '+next.title}</Button>:<Button variant="outline" disabled={r.readError || r.submitting} onClick={()=>r.replace({id:'pause:'+previous.id,kind:'report',session:previous,outcome:'interrupted'})}>{zh?'中断当前工作':'Interrupt current work'}</Button>}<Button variant="ghost" onClick={r.close}>{zh?'稍后决定':'Decide later'}</Button></div></div>
}

export function PendingInbox() {
  const r = useWorkspaceRuntime()!; const zh = useTranslation().locale === 'zh'
  const reports = (r.pendingRequests || []).filter(x => x.kind === 'report')
  const due = r.due.filter(s => !reports.some(x => x.kind === 'report' && x.session.id === s.id))
  return <div className="grid gap-2" data-testid="pending-inbox">
    {(r.pendingRequests || []).filter(x => x.kind === 'state' && x.source === 'manual' || x.kind === 'candidate' || x.kind === 'switch' || x.kind === 'review' && !r.outcome).map(x => <Button key={x.id} variant="outline" className="h-auto justify-start whitespace-normal text-left" onClick={() => r.replace(x)}>{x.kind === 'state' ? (zh ? '继续更新状态' : 'Continue updating state') : x.kind === 'candidate' ? `${x.candidate.title} · ${zh ? '继续安排' : 'Continue scheduling'}` : x.kind === 'switch' ? (zh ? '继续确认工作切换' : 'Continue switching work') : (zh ? '继续查看调整' : 'Continue reviewing adjustment')}</Button>)}
    {reports.map(x => <Button className="h-auto justify-start whitespace-normal text-left" variant="outline" key={x.id} onClick={() => r.replace(x)}>{x.kind === 'report' ? `${x.session.title} · ${zh ? '继续填写反馈' : 'Continue feedback'}` : ''}</Button>)}
    {r.snapshot && !dailyRecorded(r.snapshot.gate) && <Button variant="outline" onClick={() => r.replace({ id: `daily:${r.snapshot!.gate.local_date}`, kind: 'state', source: 'daily' })}>{zh ? '今日状态尚未填写' : 'Today’s check-in is pending'}</Button>}
    {due.map(s => <Button className="h-auto justify-start whitespace-normal text-left" variant="outline" key={s.id} onClick={() => r.replace({ id: 'reminders', kind: 'reminders', session_id: s.id })}>{s.title} · {zh ? `第 ${s.ordinal} 段等待反馈` : `Session ${s.ordinal} awaiting feedback`}</Button>)}
    {r.overlap && <Button variant="outline" onClick={() => r.replace({ id: 'overlap', kind: 'overlap' })}>{zh ? '当前工作与接下来的安排重叠' : 'Current work overlaps the next session'}</Button>}
    {r.outcome && r.outcome.kind !== 'keep' && <Button variant="outline" onClick={() => { r.finish(); r.revealReview() }}>{zh ? r.reviewStale ? '之前的建议已失效，重新检查' : '有一条安排检查结果待查看' : 'Review the pending schedule advice'}</Button>}
    {!r.pendingCount && <p className="text-sm text-muted-foreground">{zh ? '没有待处理事项。' : 'Nothing pending.'}</p>}
  </div>
}
