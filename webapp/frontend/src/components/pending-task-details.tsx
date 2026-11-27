'use client'
import { WorkspaceTaskSchedule } from '@/components/workspace-task-schedule'
import { useState } from 'react'
import { DEMO_MODE } from '@/lib/demo/config'
import { demoScheduleTask } from '@/lib/demo/work-actions'
import type { CandidateWork } from '@/lib/interaction/contracts'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { useTranslation } from '@/i18n/LanguageProvider'
import { Button } from '@/components/ui/button'
import { TaskDetailsLink } from '@/components/task-details-link'
import { localTime } from '@/lib/presentation/task'

export type PendingSelection = { taskId: string; title: string; minutes?: number | null; candidate?: CandidateWork }
export function PendingTaskDetails({ selection }: { selection: PendingSelection }) {
  const { locale } = useTranslation(), zh = locale === 'zh', runtime = useWorkspaceRuntime()
  const candidate = selection.candidate
  return <section aria-label={zh ? '待安排任务详情' : 'Pending task details'} className="grid content-start gap-4 overflow-y-auto p-4">
    <h3 className="font-semibold">{selection.title}</h3>
    <p className="text-xs text-muted-foreground">{zh ? '未安排' : 'Unscheduled'}</p>
    {typeof selection.minutes === 'number' && <p className="text-sm">{zh ? `待安排约 ${selection.minutes} 分钟` : `About ${selection.minutes} minutes to schedule`}</p>}
    {candidate?.deadline && <p className="text-sm">{zh ? '截止：' : 'Deadline: '}{localTime(candidate.deadline, runtime?.snapshot?.profile.timezone || 'UTC', locale)}</p>}
    <SchedulePendingButton selection={selection}/>
    <TaskDetailsLink taskId={selection.taskId}>{zh ? '查看任务详情' : 'View task details'}</TaskDetailsLink>
  </section>
}

export function SchedulePendingButton({selection,onBeforeOpen}:{selection:PendingSelection;onBeforeOpen?:()=>void}) {
 const r=useWorkspaceRuntime(),zh=useTranslation().locale==='zh';const [error,setError]=useState('');const [scheduling,setScheduling]=useState(false)
 if(!DEMO_MODE && !selection.candidate)return <><Button size="sm" variant="outline" onClick={()=>setScheduling(true)}>{zh?'安排':'Schedule'}</Button>{scheduling && <WorkspaceTaskSchedule taskId={selection.taskId} title={selection.title} onClose={()=>setScheduling(false)} onPreview={onBeforeOpen}/>}</>
 return <><Button size="sm" variant="outline" disabled={Boolean(r?.overlay || (onBeforeOpen ? r?.interactionBlocks?.some(id=>id!=='task-details') : r?.blocked))} onClick={async()=>{try{onBeforeOpen?.();const candidate=selection.candidate || demoScheduleTask(selection.taskId,selection.title,selection.minutes??null);await r?.refresh();r?.open({id:'candidate:'+candidate.id,kind:'candidate',candidate})}catch{setError(zh?'任务已变化，请重新打开详情。':'Task changed. Reopen its details.')}}}>{zh?'安排':'Schedule'}</Button>{error && <p role="alert" className="text-xs">{error}</p>}</>
}
