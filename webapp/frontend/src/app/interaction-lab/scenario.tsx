'use client'
import { useEffect, useMemo, useState } from 'react'
import { WorkspaceRuntimeProvider, useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { RuntimeFloatingEntry, RuntimeOverlays, SessionActions } from '@/components/workspace-runtime/overlays'
import { TodayState, CandidatePanel } from '@/components/workspace-runtime/today-state'
import { createLabData, createLabService, type LabData } from '@/lib/interaction/dev-service'
import { Button } from '@/components/ui/button'
import { WorkspaceGuide } from '@/components/workspace-guide'
import { useTranslation } from '@/i18n/LanguageProvider'
export function InteractionLab() {
  const [account,setAccount]=useState('lab-alice');const [generation,setGeneration]=useState(0)
  return <><header className="border-b bg-amber-100 p-3 text-sm text-amber-950">隔离交互测试 / ISOLATED TEST DATA — 不连接后端，不上传数据，不改变真实账户。<select aria-label="测试账户" className="ml-4 border" value={account} onChange={e=>setAccount(e.target.value)}><option>lab-alice</option><option>lab-bob</option></select><Button size="sm" variant="outline" className="ml-3" onClick={()=>{localStorage.removeItem(`humanos:lab-model:${account}`);sessionStorage.removeItem(`humanos:offered:v1:${account}`);localStorage.removeItem(`humanos:session-intent:v1:${account}`);setGeneration(x=>x+1)}}>重置此测试账户</Button></header><LabAccount key={`${account}:${generation}`} account={account}/></>
}
function LabAccount({account}:{account:string}) {
  const [data,setData]=useState<LabData|null>(null)
  useEffect(()=>{let model=createLabData(account);try{const raw=JSON.parse(localStorage.getItem(`humanos:lab-model:${account}`)||'null');if(raw?.snapshot?.profile?.user_id===account)model=raw}catch{}setData(model)},[account])
  const service=useMemo(()=>data?createLabService(data,value=>localStorage.setItem(`humanos:lab-model:${account}`,JSON.stringify(value))):null,[data,account])
  if(!data||!service)return null
  return <WorkspaceRuntimeProvider service={service} accountId={account}><LabSurface data={data}/><RuntimeOverlays/><RuntimeFloatingEntry/></WorkspaceRuntimeProvider>
}
function LabSurface({data}:{data:LabData}) {
  const r=useWorkspaceRuntime()!;const {locale}=useTranslation();const [guide,setGuide]=useState<number|null>(null)
  const update=()=>{localStorage.setItem(`humanos:lab-model:${data.snapshot.profile.user_id}`,JSON.stringify(data));void r.refresh()}
  return <main><WorkspaceGuide step={guide} locale={locale} onStep={setGuide}/><section className="flex flex-wrap gap-2 border-b p-3 text-sm" aria-label="测试场景控制"><Button size="sm" onClick={()=>{data.snapshot.now=Date.parse('2026-09-24T09:45:00Z');update()}}>A1结束 = B开始</Button><Button size="sm" onClick={()=>{data.snapshot.now+=86400000;update()}}>次日同一时间</Button><select aria-label="评估结果" value={data.faults.review} onChange={e=>{data.faults.review=e.target.value as LabData['faults']['review'];update()}}>{['keep','adjust','insufficient','error'].map(x=><option key={x}>{x}</option>)}</select>{(['save','report','apply'] as const).map(key=><label key={key} className="flex items-center gap-1"><input type="checkbox" checked={data.faults[key]} onChange={e=>{data.faults[key]=e.target.checked;update()}}/>{key}失败</label>)}<label className="flex items-center gap-1"><input type="checkbox" checked={!data.faults.capacity} onChange={e=>{data.faults.capacity=!e.target.checked;update()}}/>今天排不下</label><Button variant="outline" size="sm" onClick={()=>{data.snapshot.plan_revision++;data.snapshot.sessions.forEach(x=>x.plan_revision=data.snapshot.plan_revision);update()}}>模拟其他窗口修改计划</Button></section>
    <div className="grid min-h-[70vh] gap-3 p-3 lg:grid-cols-[288px_1fr_320px]"><aside><TodayState/><Button id="workspace-guide-add-task" disabled className="mt-3">新增任务：正式工作台复用 TaskDialog</Button></aside><section id="workspace-guide-calendar" tabIndex={-1} className="space-y-3 rounded-xl border p-3"><h1 className="font-semibold">隔离日历 · {r.snapshot?.gate.local_date} · {new Date(r.now||data.snapshot.now).toISOString()}</h1>{r.snapshot?.sessions.map(s=><article key={s.id} className="rounded-xl border p-3"><p>{s.title} / {s.id} / {s.status}</p><SessionActions sessionId={s.id}/></article>)}{data.anchors.map(x=><article key={x.title} className="rounded-xl border bg-muted p-3">{x.title} · {x.start}</article>)}<p className="text-xs">测试观察：父任务剩余量 A={data.parentRemaining.A}，B={data.parentRemaining.B}；中断反馈不得改写。</p></section><aside><h2 id="workspace-guide-candidate" tabIndex={-1} className="p-3 font-semibold">待安排</h2><CandidatePanel/></aside></div></main>
}
