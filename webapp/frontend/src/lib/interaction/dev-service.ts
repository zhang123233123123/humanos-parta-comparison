/** Isolated development model. Never imported by the live service or an API route.
 * No fetch, database, authentication override, scheduling provider, or production fallback.
 */
import type { DailyPlanReview, RuntimeState } from '../contracts/checkin-contracts'
import type { CandidateWork, InteractionService, PlanAuthorization, RuntimeProposal, RuntimeSnapshot, SessionReport, StateValues, WorkSession } from './contracts'
import { isOpenSession, localDate, validState, validateProposal } from './core'
export interface LabFaults { save: boolean; report: boolean; apply: boolean; capacity: boolean; review: 'keep' | 'adjust' | 'insufficient' | 'error' }
export interface LabData {
  snapshot: RuntimeSnapshot; faults: LabFaults; parentRemaining: Record<string, number>
  anchors: Array<{title:string;start:string;end:string}>
  history: Record<string, {signature:string; result:unknown}>; proposals: Record<string, RuntimeProposal>; sequence: number
}
const copy = <T>(value:T):T => JSON.parse(JSON.stringify(value))
export function createLabData(accountId = 'lab-alice'): LabData {
  const session = (id:string,task_id:string,title:string,ordinal:number,start:string,end:string): WorkSession => ({id,task_id,title,ordinal,start:`2026-09-24T${start}:00Z`,end:`2026-09-24T${end}:00Z`,status:'ready',plan_id:'lab-plan',plan_revision:1,kind:'work',block_id:id})
  return { snapshot:{profile:{timezone:'Europe/Amsterdam',onboarding_completed:true,user_id:accountId},
    gate:{required:true,local_date:'2026-09-24',last_daily_checkin_date:null,evaluated_at:'2026-09-24T09:44:00Z'},
    now:Date.parse('2026-09-24T09:44:00Z'),clock_rate:0,plan_id:'lab-plan',plan_revision:1,state_id:null,state:null,candidates:[],
    sessions:[session('A1','A','论文写作',1,'09:00','09:45'),session('B1','B','处理研究邮件',1,'09:45','10:15'),session('A2','A','论文写作',2,'10:30','11:15'),session('A3','A','论文写作',3,'12:00','12:30')]},
    faults:{save:false,report:false,apply:false,capacity:true,review:'keep'}, parentRemaining:{A:120,B:30},
    anchors:[{title:'固定会议（不可移动）',start:'2026-09-24T11:30:00Z',end:'2026-09-24T12:00:00Z'}], history:{},proposals:{},sequence:0 }
}
export function createLabService(data: LabData, persist: (data:LabData)=>void = () => {}): InteractionService {
  const snapshot = ():RuntimeSnapshot => {const s=data.snapshot; const date=localDate(s.now,s.profile.timezone); s.gate={...s.gate,local_date:date,required:s.gate.last_daily_checkin_date!==date,evaluated_at:new Date(s.now).toISOString()}; return copy(s)}
  function transact<T>(id:string,command:unknown,operation:()=>T):T {
    const signature=JSON.stringify(command);const previous=data.history[id]
    if(previous){if(previous.signature!==signature)throw new Error('idempotency_key_reused');return copy(previous.result) as T}
    // Failed operations must leave state, candidate pool and plan unchanged.
    const before=copy(data)
    try {const result=operation();data.history[id]={signature,result:result===undefined?null:result};persist(copy(data));return copy(result===undefined?null:result) as T}
    catch(error){Object.assign(data,before);throw error}
  }
  function state(values:StateValues):RuntimeState {
    if(!validState(values))throw new Error('missing_explicit_state')
    const s=snapshot();const value:RuntimeState={...values,id:`lab-state-${++data.sequence}`,reported_fields:['mood','energy','focus','stress','daily_note'],reported_at:new Date(s.now).toISOString(),local_date:s.gate.local_date,current_eligible:true,observation_status:'recorded'}
    data.snapshot.state=value;data.snapshot.state_id=String(value.id);data.snapshot.gate.last_daily_checkin_date=s.gate.local_date;data.snapshot.gate.required=false;return value
  }
  function review():DailyPlanReview {
    if(data.faults.review==='error')return {assessment_status:'unavailable',decision:null,reason:'',requires_plan_adjustment:false,first_session:null,reason_codes:[],options:[]}
    const kind=data.faults.review
    return {assessment_status:'completed',decision:kind==='keep'?'keep_plan':kind==='adjust'?'suggest_adjustment':'insufficient_information',reason:kind==='keep'?'当前安排与本次报告没有明显冲突。':kind==='adjust'?'本次状态与今天部分后续工作可能不匹配。':'还需要确认后续工作是否已经开始。',requires_plan_adjustment:kind==='adjust',first_session:null,reason_codes:[],options:[],missing_information:kind==='insufficient'?['后续工作是否已开始']:[],state_id:data.snapshot.state_id,plan_id:data.snapshot.plan_id}
  }
  function segment(id:string):WorkSession {const item=data.snapshot.sessions.find(s=>s.id===id);if(!item||!isOpenSession(item))throw new Error('session_not_adjustable');return item}
  const candidate=(s:WorkSession,minutes:number|null,source:CandidateWork['source'])=>{if(data.snapshot.candidates!.some(c=>c.source_session_id===s.id&&c.source===source))throw new Error('portion_already_retained');const c:CandidateWork={id:`lab-candidate-${s.id}`,original_task_id:s.task_id,source_session_id:s.id,title:`${s.title} · 第${s.ordinal}段剩余`,remaining_minutes:minutes,source,status:'pending',deadline:'2026-09-27T16:00:00Z',planning_period_end:'2026-09-30T21:59:59Z'};data.snapshot.candidates!.push(c)}
  function propose(command:PlanAuthorization):RuntimeProposal {
    const s=snapshot();const empty:RuntimeProposal={id:`lab-proposal-${++data.sequence}`,authorization:copy(command),valid:true,status:'proposed',changes:[],unallocated_candidate_ids:[]}
    validateProposal(empty,s)
    const allowed=new Set(command.adjustable_session_ids)
    for(const id of allowed){const item=segment(id);if(Date.parse(item.start)<s.now)throw new Error('session_already_started_by_clock_is_not_whitelisted');if(command.scope==='today'&&localDate(Date.parse(item.start),s.profile.timezone)!==command.local_date)throw new Error('outside_today')}
    // Demo adjustments preserve existing sessions and only move a selected future
    // session within its reserved window; no parent-task re-splitting or Rest block.
    if(!command.authorized_candidate_ids.length){const item=s.sessions.find(x=>allowed.has(x.id));if(item){const start=Date.parse(item.start)+5*60000,end=Date.parse(item.end)+5*60000; const conflict=[...data.anchors,...s.sessions.filter(x=>x.id!==item.id&&isOpenSession(x))].some(x=>Date.parse(x.start)<end&&Date.parse(x.end)>start);if(!conflict&&localDate(end,s.profile.timezone)===localDate(Date.parse(item.end),s.profile.timezone))empty.changes.push({session_id:item.id,title:item.title,before:item.start,after:new Date(start).toISOString()})}}
    for(const id of command.authorized_candidate_ids){const item=s.candidates?.find(c=>c.id===id&&c.status==='pending');if(!item)throw new Error('candidate_not_pending');const minutes=item.remaining_minutes??command.candidate_duration_minutes?.[id];if(!minutes||!Number.isInteger(minutes)||minutes<=0)throw new Error('duration_required');
      const day=command.scope==='today'?command.local_date:localDate(s.now+86400000,s.profile.timezone)
      // Lab fixtures have a pre-existing, unoccupied 16:00–17:00Z availability slot.
      const start=Date.parse(`${day}T16:00:00Z`),end=start+minutes*60000
      const upper=Math.min(Date.parse(item.planning_period_end),item.deadline?Date.parse(item.deadline):Infinity)
      const occupied=[...data.anchors,...s.sessions.filter(isOpenSession)].some(x=>Date.parse(x.start)<end&&Date.parse(x.end)>start)
      if((command.scope==='today'&&!data.faults.capacity)||minutes>60||start<s.now||end>upper||occupied){empty.unallocated_candidate_ids.push(id);continue}
      empty.changes.push({session_id:id,title:item.title,before:null,after:new Date(start).toISOString()})
    }
    data.proposals[empty.id]=copy(empty);return empty
  }
  return {mode:'isolated-development',async snapshot(){return snapshot()},
    async start(command){transact(command.request_id,command,()=>{
      if(command.base_plan_revision!==data.snapshot.plan_revision || (command.expected_active_id||null)!==(data.snapshot.active_session_id||null))throw new Error('stale_start')
      const s=segment(command.session_id)
      if(localDate(Date.parse(s.start),data.snapshot.profile.timezone)!==snapshot().gate.local_date)throw new Error('not_today')
      const old=data.snapshot.sessions.find(x=>x.id===data.snapshot.active_session_id)
      if(old&&old.id!==s.id){old.status='interrupted';if(command.retain_previous)candidate(old,command.remaining_minutes??null,'interrupted_session')}
      data.snapshot.active_session_id=s.id;s.started_at=new Date(data.snapshot.now).toISOString()
    })},
    async saveState(values,requestId,source){return transact(requestId,{values,source},()=>{if(data.faults.save)throw new Error('injected_save_failure');const runtime_state=state(values);return {runtime_state,daily_plan_review:review()}})},
    async review(){return review()},
    async report(command:SessionReport){return transact(command.request_id,command,()=>{
      if(data.faults.report)throw new Error('injected_report_failure');const s=segment(command.source_session_id)
      if(command.plan_id!==s.plan_id||command.plan_revision!==data.snapshot.plan_revision||command.original_task_id!==s.task_id)throw new Error('stale_session_report')
      if(command.outcome==='interrupted'&&command.retain_candidate)candidate(s,command.remaining_minutes,'interrupted_session')
      s.status=command.outcome==='completed'?'completed':'interrupted'
      if(data.snapshot.active_session_id===s.id)data.snapshot.active_session_id=null
      const runtime_state=state(command.state);return {runtime_state,daily_plan_review:review()}
    })},
    async defer(command){transact(command.request_id,command,()=>{if(command.confirmed_not_started!==true||command.base_plan_revision!==data.snapshot.plan_revision)throw new Error('explicit_not_started_confirmation_required');const s=segment(command.session_id);if(s.started_at||s.id===data.snapshot.active_session_id)throw new Error('already_started');candidate(s,Math.round((Date.parse(s.end)-Date.parse(s.start))/60000),'explicitly_deferred_session');s.status='deferred';data.snapshot.plan_revision++;for(const item of data.snapshot.sessions)item.plan_revision=data.snapshot.plan_revision})},
    async propose(command){return transact(command.request_id,command,()=>propose(command))},
    async apply(proposal,requestId){transact(requestId,proposal,()=>{
      if(data.faults.apply)throw new Error('injected_apply_failure');validateProposal(proposal,snapshot());const stored=data.proposals[proposal.id];if(!stored||JSON.stringify(stored)!==JSON.stringify(proposal))throw new Error('proposal_mismatch')
      for(const change of proposal.changes){const c=data.snapshot.candidates?.find(x=>x.id===change.session_id&&x.status==='pending');if(c){const minutes=c.remaining_minutes??proposal.authorization.candidate_duration_minutes?.[c.id];if(!minutes)throw new Error('duration_required');c.status='scheduled';data.snapshot.sessions.push({id:`lab-restored-${c.id}`,task_id:c.original_task_id,title:c.title,ordinal:1,start:change.after,end:new Date(Date.parse(change.after)+minutes*60000).toISOString(),status:'ready',kind:'work',plan_id:data.snapshot.plan_id,plan_revision:data.snapshot.plan_revision+1,block_id:`restored-${c.id}`})}else{const s=segment(change.session_id);const duration=Date.parse(s.end)-Date.parse(s.start);s.start=change.after;s.end=new Date(Date.parse(change.after)+duration).toISOString()}}
      data.snapshot.plan_revision++;for(const item of data.snapshot.sessions)item.plan_revision=data.snapshot.plan_revision;stored.status='applied'
    })}
  }
}
