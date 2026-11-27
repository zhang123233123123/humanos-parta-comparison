'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { MousePointer2 } from 'lucide-react'
const steps = [
  ['workspace-guide-calendar','选择一段工作','点击日历安排，在右侧查看本次内容。','Choose work','Select a calendar session to see its details on the right.'],
  ['workspace-guide-review','开始工作','在当天工作段详情中点击“开始这段工作”。右侧显示当前工作及中断、结束操作；查看其他任务后，可点击“返回当前工作”。','Start','Start a session from its details. The right panel shows current work with interrupt and end actions. Return to current work after viewing another task.'],
  ['workspace-guide-review','中断与结束','中断时可记录原因、进度和回来第一步，并选填本段未完成部分所需分钟。心情、精力、专注、压力必填，提交成功后本段结束，再检查今天后续安排。填写的分钟单独保留为待安排，不自动补排；留空不估算。保存失败保留输入，检查失败只重试检查。结束时仍选择本次完成情况。','Interrupt and end','On interruption, optionally record the reason, progress, first step back and minutes needed for the unfinished portion. Mood, energy, focus and stress are required. Submission ends the session, then checks today’s upcoming schedule. Entered minutes become a separate pending item, never automatically scheduled; blank means no estimate. Save failures preserve input; check failures retry only the check. Ending still asks what you completed.'],
  ['workspace-guide-floating','查看调整','从 HumanOS 主动求助，或查看结束后的建议。先预览，再应用调整。','Review adjustments','Ask HumanOS for help or review advice after ending work. Preview before applying.'],
  ['workspace-guide-notifications','待处理事项','待处理提醒保留在顶部铃铛。','Pending items','Pending reminders remain in the bell.'],
] as const
export function WorkspaceGuide({step,locale,onStep}:{step:number|null;locale:string;onStep:(step:number|null)=>void}) {
  const zh=locale==='zh'
  useEffect(() => { if(step===null)return; const el=document.getElementById(steps[step][0]); el?.classList.add('ring-2','ring-blue-500','ring-offset-2'); el?.scrollIntoView({block:'nearest'}); return()=>el?.classList.remove('ring-2','ring-blue-500','ring-offset-2') },[step])
  const locate=()=>{if(step===null)return; const el=document.getElementById(steps[step][0]); el?.scrollIntoView({block:'nearest'}); el?.focus({preventScroll:true})}
  if(step===null)return <div className="flex shrink-0 justify-end border-b px-3 py-1"><Button variant="ghost" size="sm" onClick={()=>onStep(0)}><MousePointer2 className="mr-1 h-4 w-4"/>{zh?'新手指引':'Workspace guide'}</Button></div>
  return <aside aria-label={zh?'工作台新手指引':'Workspace guide'} className="shrink-0 border-b border-blue-300 bg-blue-50 p-3 text-slate-900"><div aria-live="polite" className="flex gap-2"><MousePointer2 className="h-5 w-5 shrink-0 text-blue-600"/><div><p className="font-medium">{step+1}/{steps.length} · {steps[step][zh?1:3]}</p><p className="mt-1 text-sm">{steps[step][zh?2:4]}</p></div></div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={locate}>{zh?'定位操作位置':'Locate action'}</Button><Button size="sm" variant="ghost" disabled={step===0} onClick={()=>onStep(step-1)}>{zh?'上一项':'Back'}</Button><Button size="sm" onClick={()=>onStep(step===steps.length-1?null:step+1)}>{step===steps.length-1?(zh?'完成指引':'Finish guide'):(zh?'下一项':'Next')}</Button><Button size="sm" variant="ghost" onClick={()=>onStep(null)}>{zh?'跳过指引':'Skip guide'}</Button></div></aside>
}
