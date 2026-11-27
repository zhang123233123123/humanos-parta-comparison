"""Persisted simulation state machine. No writes to the ordinary planning aggregates."""
import csv
import io
import json
import uuid
import hashlib
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
from ...repositories.simulation import SimulationRepository, encode
from ...domain.simulation.contracts import Configuration, Scenario, PlanDecision, NodeDecision, instant, answer_value
from ...domain.simulation.planning import allocate, validate_blocks
from .live_workspace import LiveWorkspaceMixin
from .prompts import build_context, messages_for
from .onboarding import initial_setup, saved_setup, compile_input
from .profile import current_form, get_profile, validate_profile_form, validate_values, canonical_profile


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix+'_'+uuid.uuid4().hex


class SimulationError(Exception):
    def __init__(self, message, status=400):
        self.status=status
        super().__init__(message)


class SimulationService(LiveWorkspaceMixin):
    def __init__(self, path, *, researchers, complete, model, user_exists, threaded=True, clock=None):
        self.clock=clock or (lambda: datetime.now(timezone.utc))
        self.scheduler_stop=threading.Event()
        self.scheduler_thread=None
        self.repo=SimulationRepository(path)
        self.researchers=set(researchers)
        self.complete=complete
        self.model=model
        self.user_exists=user_exists
        self.pool=ThreadPoolExecutor(max_workers=3, thread_name_prefix='sim') if threaded else None
        self.jobs_to_run=[]
        # After restart a half-written model call is failed, never treated as a result.
        with self.repo.transaction() as db:
            form=current_form(db)
            db.execute('INSERT OR IGNORE INTO sim_profile_forms VALUES(?,?,?)',(form['id'],form['revision'],encode(form)))
            for row in db.execute('SELECT id,run_id,body FROM sim_jobs').fetchall():
                job=json.loads(row['body'])
                if job['status'] in ('pending','running'):
                    run=self.repo.run(db,row['run_id'])
                    if run.get('mode')!='live':continue  # Preserve archived jobs verbatim.
                    job.update(status='failed',error='服务重启中断了调用，请重新生成',finished_at=now())
                    db.execute('UPDATE sim_jobs SET body=? WHERE id=?',(encode(job),row['id']))
                    run.update(pending_job_id=None,error=job['error'],revision=run['revision']+1)
                    self.repo.save_run(db,run)

        if threaded:
            self.scheduler_thread=threading.Thread(target=self.scheduler_loop,name='humanos-inquiry-clock',daemon=True)
            self.scheduler_thread.start()

    def close(self):
        self.scheduler_stop.set()
        if self.scheduler_thread:self.scheduler_thread.join(timeout=6)
        if self.pool:self.pool.shutdown(wait=True)

    def is_researcher(self, actor):
        return actor in self.researchers

    def require_researcher(self, actor):
        if not self.is_researcher(actor):raise SimulationError('仅研究者可执行此操作',403)

    def visible_run(self, db, run_id, actor):
        run=self.repo.run(db,run_id)
        if run['participant_id']!=actor and not self.is_researcher(actor):raise SimulationError('没有此会话的访问权限',403)
        return run

    def event(self, db, run, kind, actor, detail=None, public=None):
        e={'id':uid('event'),'kind':kind,'actor':actor,'recorded_at':now(),'simulated_at':run['simulated_at'],
           'revision':run['revision'],'detail':detail or {},'public':public}
        db.execute('INSERT INTO sim_events(run_id,body) VALUES(?,?)',(run['id'],encode(e)))
        return e

    def batch(self, run, phases, ids=None):
        qs=[deepcopy(q) for q in run['configuration']['questions'] if q['enabled'] and q['phase'] in phases and (ids is None or q['question_id'] in ids)]
        if not qs:return None
        return {'id':uid('batch'),'questions':qs,'config_version_id':run['config_version_id'],
                'created_at':now(),'simulated_at':run['simulated_at'],'phase':phases[0]}

    def projected(self, run, actor):
        if run.get('mode')=='live':
            run={**run,'simulated_at':self.clock_stamp()}
        # Present only the participant's own saved reports, never inferred defaults.
        state={'values':{},'reported_at':'','simulated_at':''}
        profile={}
        for batch in run['answer_batches']:
            for answer in batch['answers']:
                q=answer['question']
                if q['model_usage']=='evaluation_only':continue
                binding=q.get('semantic_binding')
                if binding == 'mood':
                    labels=dict(zip(q.get('option_values',[]),q['options']))
                    state['mood']=labels.get(answer['value'],str(answer['value']))
                if binding in ('energy','focus','stress'):
                    state['values'][binding]=answer['value']
                    state['reported_at']=batch['submitted_at']
                    state['simulated_at']=batch['simulated_at']
                if q['phase']=='profile':
                    labels=dict(zip(q.get('option_values',[]),q['options']))
                    v=answer['value']
                    display='、'.join(str(labels.get(x,x)) for x in v) if isinstance(v,list) else str(labels.get(v,v))
                    profile[q['question_id']]={'title':q['title'],'value':v,'display_value':display}
        day=instant(run['simulated_at']).astimezone(ZoneInfo(run['scenario']['timezone'])).date().isoformat()
        own_display={'read_only':run.get('mode')!='live','mode':run.get('mode','simulation'),'reported_state':state,'profile_answers':list(profile.values()),'participant_setup_complete':run.get('participant_setup_complete',True), 'daily_feedback':{'date':day,'available':any(q['enabled'] and q['phase']=='daily_feedback' for q in run['configuration']['questions']),'submitted':any(b.get('review_date')==day and b['phase']=='daily_feedback' for b in run['answer_batches'])}}
        if self.is_researcher(actor):return {**run,**own_display}
        public={k:deepcopy(run[k]) for k in ['id','status','revision','simulated_at','pending_batch','active_plan','proposed_plan','pending_job_id','error','initial_submitted']}
        public['scenario']={k:deepcopy(run['scenario'][k]) for k in ['name','description','timezone','start_at','end_at','tasks','availability','fixed_events']}
        public['remaining']=run['remaining']
        public['unavailable']=run['unavailable']
        public['revealed_events']=run['revealed_events']
        public['setup_draft']=deepcopy(run.get('setup_draft'))
        public['onboarding_input']=deepcopy(run.get('onboarding_input'))
        public['scenario'].update(keep_buffer=run['scenario'].get('keep_buffer',False),planning_goal=run['scenario'].get('planning_goal',''))
        # User-facing reasons may refer to their own facts, not future/private nodes.
        return {**public,**own_display}

    def get(self, actor, parts, query):
        if parts and parts[0]=='scenarios':
            raise SimulationError('旧场景功能已移除，请使用参与者自主设置的工作台',410)
        if parts==['capabilities']:
            return {'enabled':True,'role':'researcher' if self.is_researcher(actor) else 'participant','user_id':actor}
        with self.repo.transaction() as db:
            if parts==['profile']:return get_profile(db,actor)
            if parts==['planning-setup']:return initial_setup(db,get_profile(db,actor))
            if parts==['profile-form']:
                self.require_researcher(actor)
                return current_form(db)
            if parts==['participants']:
                self.require_researcher(actor)
                return {'participants':[{'participant_id':p['participant_id'],'submitted_at':p.get('submitted_at'),'form_version_id':p['form']['id']} for row in db.execute('SELECT body FROM sim_profiles') if (p:=json.loads(row[0]))]}
            if parts[0]=='configs':
                self.require_researcher(actor)
                kind=parts[0]
                if len(parts)==1:
                    return {'documents':[json.loads(r[0]) for r in db.execute('SELECT body FROM sim_documents WHERE kind=? ORDER BY rowid DESC',(kind,))]}
                row=db.execute('SELECT body FROM sim_documents WHERE id=? AND kind=?',(parts[1],kind)).fetchone()
                if not row:raise KeyError(parts[1])
                doc=json.loads(row[0]);doc['versions']=[json.loads(r[0]) for r in db.execute('SELECT body FROM sim_versions WHERE document_id=? ORDER BY rowid DESC',(parts[1],))]
                return doc
            if parts==['runs']:
                rows=db.execute('SELECT body FROM sim_runs ORDER BY rowid DESC').fetchall()
                return {'runs':[{'id':r['id'],'name':r['scenario']['name'],'participant_id':r['participant_id'],'status':r['status'],'simulated_at':r['simulated_at'],'mode':r.get('mode','simulation')} for row in rows if (r:=json.loads(row[0])) and (self.is_researcher(actor) or (r['participant_id']==actor and r.get('mode')=='live'))]}
            if len(parts)>=2 and parts[0]=='runs':
                run=self.visible_run(db,parts[1],actor)
                if len(parts)==2:
                    view=self.projected(run,actor)
                    if not run.get('participant_setup_complete',True) and not run.get('setup_draft'):
                        account_setup=get_profile(db,run['participant_id']).get('planning_setup')
                        if account_setup:view['onboarding_input']=deepcopy(account_setup['input'])
                    if self.is_researcher(actor):
                        view['events']=self.repo.events(db,run['id'])
                        view['jobs']=[json.loads(r[0]) for r in db.execute('SELECT body FROM sim_jobs WHERE run_id=? ORDER BY rowid DESC',(run['id'],))]
                    return view
                if parts[2]=='export':
                    self.require_researcher(actor)
                    events=self.repo.events(db,run['id'])
                    jobs=[json.loads(r[0]) for r in db.execute('SELECT body FROM sim_jobs WHERE run_id=?',(run['id'],))]
                    fmt=query.get('format',['json'])
                    if (fmt[0] if isinstance(fmt,list) else fmt)=='csv':
                        output=io.StringIO();writer=csv.writer(output)
                        writer.writerow(['run_id','participant_id','record_type','recorded_at','simulated_at','config_version_id','question_id','question_revision','question','value','response_seconds','payload_json'])
                        def row(kind, at, simulated, payload, question=None, value='', elapsed=''):
                            q=question or {}
                            cells=[run['id'],run['participant_id'],kind,at,simulated,payload.get('config_version_id',''),q.get('question_id',''),q.get('revision',''),q.get('title',''),value,elapsed,encode(payload)]
                            # Spreadsheet formulas must remain literal participant text.
                            writer.writerow(["'"+str(v) if str(v).lstrip().startswith(('=','+','-','@')) else v for v in cells])
                        for batch in run['answer_batches']:
                            for a in batch['answers']:row('answer',batch['submitted_at'],batch['simulated_at'],batch,a['question'],encode(a['value']),batch.get('response_seconds'))
                        for e in events:row('event',e['recorded_at'],e['simulated_at'],e)
                        for p in run['plans']:row('plan',p.get('confirmed_at',p.get('generated_at','')),'',p)
                        for j in jobs:row('model_job',j['created_at'],'',j)
                        return {'filename':run['id']+'.csv','content':output.getvalue()}
                    return {'format':'humanos_simulation_v1','data_origin':'live' if run.get('mode')=='live' else 'simulation','run':run,'events':events,'jobs':jobs}
                if parts[2]=='jobs' and len(parts)==4:
                    row=db.execute('SELECT body FROM sim_jobs WHERE id=? AND run_id=?',(parts[3],run['id'])).fetchone()
                    if not row:raise KeyError(parts[3])
                    job=json.loads(row[0])
                    return job if self.is_researcher(actor) else {k:job.get(k) for k in ['id','status','error','finished_at']}
        raise KeyError('/'.join(parts))

    def profile_mutation(self,db,actor,parts,body):
        if parts==['profile-form']:
            self.require_researcher(actor)
            old=current_form(db)
            if body.get('expected_revision')!=old['revision']:raise SimulationError('Profile 配置已变化，请重新读取',409)
            data=validate_profile_form(body['content'])
            previous={q['question_id']:q for q in old['content']['questions']}
            for q in data['questions']:
                before=previous.get(q['question_id'])
                q['revision']=before['revision']+int(any(v!=before.get(k) for k,v in q.items() if k!='revision')) if before else 1
            form={'id':uid('profile_form'),'revision':old['revision']+1,'content':data,'updated_at':now(),'updated_by':actor}
            db.execute('INSERT INTO sim_profile_forms VALUES(?,?,?)',(form['id'],form['revision'],encode(form)))
            return form
        profile=get_profile(db,actor)
        if body.get('expected_revision')!=profile['revision']:raise SimulationError('Profile 已更新，请刷新后重试',409)
        revising=body.get('action')=='revise'
        if profile.get('submitted_at') and not revising:raise SimulationError('Profile 已提交，请通过返回编辑保存新版本',409)
        if revising and not profile.get('submitted_at'):raise SimulationError('尚未提交的 Profile 请使用首次填写流程',409)
        version=body.get('form_version_id')
        if profile['revision'] and version!=profile['form']['id']:raise SimulationError('填写中的 Profile 版本不匹配',409)
        row=db.execute('SELECT body FROM sim_profile_forms WHERE id=?',(version,)).fetchone()
        if not row:raise ValueError('Profile 表单版本不存在')
        form=json.loads(row[0]);complete=body.get('action') in ('submit','revise')
        if body.get('action') not in ('draft','submit','revise'):raise ValueError('无效 Profile 操作')
        values=body.get('values',{})
        answers=validate_values(form['content']['questions'],values,complete)
        step=body.get('step',0)
        if type(step) is not int or not 0<=step<=1:raise ValueError('Profile 页码不合法')
        if revising:
            profile.setdefault('first_submitted_at',profile['submitted_at'])
            profile['revised_at']=now()
        profile.update(form=form,values=values,answers=answers,step=step,revision=profile['revision']+1,updated_at=now(),submitted_at=profile['submitted_at'] if revising else now() if complete else None)
        profile['profile']=canonical_profile(answers)
        db.execute('INSERT INTO sim_profiles VALUES(?,?) ON CONFLICT(participant_id) DO UPDATE SET body=excluded.body',(actor,encode(profile)))
        db.execute('INSERT INTO sim_profile_history(participant_id,body) VALUES(?,?)',(actor,encode(profile)))
        return profile

    def refresh_setup_profile(self, db, run, actor):
        # Only a participant's not-yet-generated setup adopts their latest revision.
        if actor!=run['participant_id'] or run['initial_submitted'] or run['plans']:return
        profile=get_profile(db,actor)
        if profile['revision']==run['profile_snapshot']['revision']:return
        run.setdefault('profile_versions',[]).append({'recorded_at':now(),'snapshot':deepcopy(run['profile_snapshot'])})
        run['profile_snapshot']=deepcopy(profile)
        preferences=profile.get('profile',{}).get('task_preferences',{})
        run['scenario']['session_minutes']=preferences.get('preferred_session_minutes',45)
        run['scenario']['rest_minutes']=preferences.get('rest_between_tasks_minutes',10)
        run['answer_batches']=[b for b in run['answer_batches'] if b.get('source')!='account_profile']
        run['answer_batches'].insert(0,{'id':uid('profile_snapshot'),'phase':'profile','answers':deepcopy(profile['answers']),
            'questions':deepcopy(profile['form']['content']['questions']),'config_version_id':profile['form']['id'],
            'simulated_at':run['simulated_at'],'submitted_at':profile.get('revised_at',profile['submitted_at']),'source':'account_profile'})
        self.event(db,run,'setup_profile_revised',actor,{'profile_revision':profile['revision']}, {'title':'首次设置采用了本人修改后的个人资料'})

    def document(self, db, actor, method, parts, body):
        self.require_researcher(actor)
        kind='configs';model=Configuration
        if len(parts)==1 and method=='POST':
            data=model.model_validate(body['content']).model_dump()
            doc={'id':uid('config'),'revision':1,'content':data,'updated_at':now(),'latest_version_id':None}
        else:
            row=db.execute('SELECT body FROM sim_documents WHERE id=? AND kind=?',(parts[1],kind)).fetchone()
            if not row:raise KeyError(parts[1])
            doc=json.loads(row[0])
            if body.get('expected_revision')!=doc['revision']:raise SimulationError('方案已变化，请刷新后重试',409)
            if len(parts)==3 and parts[2]=='publish' and method=='POST':
                data=model.model_validate(doc['content']).model_dump()
                version={'id':uid('version'),'document_id':doc['id'],'revision':doc['revision'],'content':data,'created_at':now(),'hash':hashlib.sha256(encode(data).encode()).hexdigest()}
                db.execute('INSERT INTO sim_versions VALUES(?,?,?,?,?)',(version['id'],doc['id'],kind,encode(version),now()))
                doc['latest_version_id']=version['id'];doc['revision']+=1
            elif method=='PATCH' and len(parts)==2:
                data=model.model_validate(body['content']).model_dump()
                if kind=='configs':
                    old={q['question_id']:q for q in doc['content']['questions']}
                    for q in data['questions']:
                        before=old.get(q['question_id'])
                        q['revision']=(before['revision']+(any(v!=before.get(k) for k,v in q.items() if k!='revision'))) if before else 1
                doc.update(content=data,revision=doc['revision']+1,updated_at=now())
            else:raise KeyError('/'.join(parts))
        db.execute('INSERT INTO sim_documents VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body',(doc['id'],kind,actor,doc['revision'],encode(doc)))
        return doc

    def enqueue(self, db, run, actor):
        job={'id':uid('job'),'run_id':run['id'],'status':'pending','created_at':now(),'calls':[],'error':None}
        db.execute('INSERT INTO sim_jobs VALUES(?,?,?)',(job['id'],run['id'],encode(job)))
        run.update(pending_job_id=job['id'],error=None)
        self.event(db,run,'generation_requested',actor,{'job_id':job['id']})
        return job['id']

    def mutate(self, actor, method, parts, body):
        # Retired routes are rejected before idempotency replay as well as writes.
        if (parts and parts[0]=='scenarios') or parts==['runs'] or (len(parts)>=3 and parts[0]=='runs' and parts[2] in ('advance','finish')):
            raise SimulationError('旧场景分配和人工时间控制已移除',410)
        if not isinstance(body,dict):raise ValueError('请求必须是对象')
        rid=body.get('request_id')
        if not isinstance(rid,str) or not 8<=len(rid)<=128:raise ValueError('需要有效request_id')
        fingerprint=hashlib.sha256(encode([method,parts,body]).encode()).hexdigest()
        job_id=None
        with self.repo.transaction() as db:
            if len(parts)>=3 and parts[0]=='runs':
                existing=self.visible_run(db,parts[1],actor)
                if existing.get('mode')!='live':
                    raise SimulationError('旧版会话仅供查看和导出，不能继续操作',410)
                if parts[2]=='nodes' and (body.get('action') not in ('enable','disable') or set(body)-{'request_id','expected_revision','action'}):
                    raise SimulationError('研究者只能启用或停用 AI 返回的节点，不能改时间或立即触发',403)
            previous=db.execute('SELECT fingerprint,response FROM sim_requests WHERE actor=? AND request_id=?',(actor,rid)).fetchone()
            if previous:
                if previous[0]!=fingerprint:raise SimulationError('request_id不能用于不同操作',409)
                return json.loads(previous[1])
            if parts==['workspace','start'] and method=='POST':
                result=self.start_workspace(db,actor,body)
            elif parts==['planning-setup'] and method=='POST':
                profile=get_profile(db,actor)
                if not profile.get('submitted_at'):raise SimulationError('请先完成前两页 Profile',409)
                old=initial_setup(db,profile)
                if body.get('expected_revision')!=old['revision']:raise SimulationError('首次设置已更新，请重新读取后重试',409)
                result=saved_setup(db,profile,body,now())
                profile['planning_setup']=result
                db.execute('UPDATE sim_profiles SET body=? WHERE participant_id=?',(encode(profile),actor))
                db.execute('INSERT INTO sim_profile_history(participant_id,body) VALUES(?,?)',(actor,encode(profile)))
            elif parts in (['profile'],['profile-form']):
                result=self.profile_mutation(db,actor,parts,body)
            elif parts[0]=='configs':
                result=self.document(db,actor,method,parts,body)
            elif len(parts)>=3 and parts[0]=='runs' and method=='POST':
                run=self.visible_run(db,parts[1],actor)
                if actor!=run['participant_id'] and parts[2] not in ('nodes','configuration-switch'):
                    raise SimulationError('研究者只能启用或停用 AI 节点及修改问题配置，不能代替用户操作',403)
                run['simulated_at']=self.clock_stamp()
                if body.get('expected_revision')!=run['revision']:raise SimulationError('会话已更新，请刷新后重试',409)
                if run['pending_job_id']:raise SimulationError('模型正在处理，请等待本次处理完成',409)
                if run['status']=='completed':raise SimulationError('会话已结束',409)
                action=parts[2]
                if action!='presented':run['revision']+=1
                if not run.get('participant_setup_complete',True) and action not in ('personal-input','setup-draft'):raise SimulationError('请参与者先填写自己的任务和可用时间',409)
                if action=='setup-draft':
                    if actor!=run['participant_id']:raise SimulationError('仅参与者本人可保存首次设置',403)
                    if run.get('participant_setup_complete',True) and (run['initial_submitted'] or run['plans'] or run['status']=='awaiting_final' or (run['pending_batch'] and run['pending_batch']['phase']!='initial_state')):raise SimulationError('首次设置已完成，请在工作台修改任务与时间',409)
                    payload=body.get('input')
                    if 'onboarding_input' in body:
                        compiled=compile_input(body['onboarding_input'],False,run['scenario'])
                        payload={k:compiled[k] for k in ('availability','fixed_events','keep_buffer','planning_goal')}
                        run['onboarding_input']=deepcopy(body['onboarding_input'])
                    if not isinstance(payload,dict) or not {'availability','fixed_events'}<=set(payload)<= {'availability','fixed_events','keep_buffer','planning_goal'}:raise ValueError('请提交可用时间和固定活动')
                    candidate=Scenario.model_validate({**run['scenario'],**payload}).model_dump()
                    if not candidate['availability']:raise ValueError('请至少填写一个可用时间段')
                    run['setup_draft']={k:deepcopy(candidate[k]) for k in payload}
                    run['setup_draft'].update(next_step=3,saved_at=now())
                    self.event(db,run,'setup_draft_saved',actor,{'input':payload}, {'title':'参与者保存了可用时间草稿'})
                elif action=='personal-input':
                    if actor!=run['participant_id']:raise SimulationError('仅参与者本人可设置任务和时间',403)
                    initial_review=not run['initial_submitted'] and not run['plans'] and (not run['pending_batch'] or run['pending_batch']['phase']=='initial_state')
                    if (run['pending_batch'] and not initial_review) or run['proposed_plan'] or run['status']=='awaiting_final':raise SimulationError('请先完成当前填写和计划审核',409)
                    self.refresh_setup_profile(db,run,actor)
                    payload=body.get('input')
                    if 'onboarding_input' in body:
                        compiled=compile_input(body['onboarding_input'],True,run['scenario'])
                        payload={k:compiled[k] for k in ('tasks','availability','fixed_events','keep_buffer','planning_goal')}
                        run['onboarding_input']=deepcopy(body['onboarding_input'])
                    if not isinstance(payload,dict) or not {'tasks','availability','fixed_events'}<=set(payload)<= {'tasks','availability','fixed_events','keep_buffer','planning_goal'}:raise ValueError('只允许提交任务、可用时间和固定活动')
                    candidate=Scenario.model_validate({**run['scenario'],**payload}).model_dump()
                    if not candidate['tasks'] or not candidate['availability']:raise ValueError('请至少填写一个任务和一个可用时间段')
                    previous={t['id']:t for t in run['scenario']['tasks']}
                    remaining={}
                    for task in candidate['tasks']:
                        old=previous.get(task['id'])
                        completed=max(0,old['minutes']-run['remaining'].get(task['id'],old['minutes'])) if old else 0
                        if task['minutes']<completed:raise ValueError('总工作量不能小于已报告完成量')
                        remaining[task['id']]=task['minutes']-completed
                        if remaining[task['id']]>0 and instant(task['deadline_at'])<=instant(run['simulated_at']):raise ValueError('未完成任务的截止时间须晚于当前模拟时间')
                    first=not run.get('participant_setup_complete',True)
                    run['input_versions']=run.get('input_versions',[])+[{'recorded_at':now(),'actor':actor,'simulated_at':run['simulated_at'],'before':{k:deepcopy(run['scenario'].get(k,False if k=='keep_buffer' else '')) for k in payload},'input':deepcopy(payload)}]
                    run.update(scenario=candidate,remaining=remaining,participant_setup_complete=True,setup_draft=None,active_plan=None,proposed_plan=None,candidate_nodes=[],error=None,node_release_requested=False)
                    if first:
                        run['pending_batch']=self.batch(run,['initial_state'])
                        if not run['pending_batch']:run['initial_submitted']=True
                    run['status']='ready' if run['initial_submitted'] else 'setup'
                    self.event(db,run,'participant_input_saved',actor,{'input':payload,'invalidated_confirmed_plan':not first}, {'title':'参与者更新了任务与可用时间'})
                elif action=='daily-feedback':
                    if actor!=run['participant_id']:raise SimulationError('请由参与者本人填写每日反馈',403)
                    if run['pending_batch'] or run['proposed_plan'] or not run['initial_submitted'] or run['status']=='awaiting_final':raise SimulationError('请先完成当前填写或计划审核',409)
                    day=instant(run['simulated_at']).astimezone(ZoneInfo(run['scenario']['timezone'])).date().isoformat()
                    if any(b.get('review_date')==day and b['phase']=='daily_feedback' for b in run['answer_batches']):raise SimulationError('这一天的反馈已保存',409)
                    batch=self.batch(run,['daily_feedback'])
                    if not batch:raise ValueError('尚未配置每日反馈问题')
                    batch['review_date']=day;run['pending_batch']=batch
                    self.event(db,run,'daily_feedback_requested',actor,{'review_date':day})
                elif action=='presented':
                    if actor!=run['participant_id']:raise SimulationError('只能记录参与者本人展示',403)
                    batch=run['pending_batch']
                    if not batch or body.get('batch_id')!=batch['id']:raise SimulationError('问题已更新，请重新加载',409)
                    if not batch.get('first_presented_at'):
                        batch['first_presented_at']=now()
                        self.event(db,run,'questions_presented',actor,{'batch_id':batch['id'],'batch_question_ids':[q['question_id'] for q in batch['questions']]})
                elif action=='answers':
                    if not run['initial_submitted'] and run.get('setup_draft'):raise SimulationError('请先完成任务与时间的重新保存，再提交当前状态',409)
                    if actor!=run['participant_id']:raise SimulationError('请由参与者本人提交答案',403)
                    batch=run['pending_batch']
                    if not batch or body.get('batch_id')!=batch['id']:raise SimulationError('问题已更新，请重新加载',409)
                    raw=body.get('answers')
                    if not isinstance(raw,list):raise ValueError('answers必须是数组')
                    values={a['question_id']:a['value'] for a in raw}
                    if len(values)!=len(raw) or not set(values)<={q['question_id'] for q in batch['questions']}:raise ValueError('答案重复或包含未展示题目')
                    answered=[];visible={}
                    for q in batch['questions']:
                        rule=q['display_if']
                        if rule and visible.get(rule['question_id'])!=rule['equals']:
                            if q['question_id'] in values:raise ValueError('不能提交被条件隐藏的问题')
                            continue
                        if q['question_id'] not in values:
                            if q['required']:raise ValueError('请填写：'+q['title'])
                            continue
                        v=answer_value(q,values[q['question_id']]);visible[q['question_id']]=v
                        answered.append({'question':q,'value':v})
                    saved={**batch,'answers':answered,'submitted_at':now()}
                    saved['response_seconds']=(datetime.fromisoformat(saved['submitted_at'])-datetime.fromisoformat(batch['first_presented_at'])).total_seconds() if batch.get('first_presented_at') else None
                    run['answer_batches'].append(saved);run['pending_batch']=None
                    run['last_answer_phase']=batch['phase']
                    self.event(db,run,'answers_submitted',actor,{'batch_id':batch['id'],'phase':batch['phase']})
                    if batch['phase']=='final':run['status']='completed'
                    elif not run['initial_submitted']:
                        self.refresh_setup_profile(db,run,actor)
                        run.update(initial_submitted=True,status='ready')
                        job_id=self.enqueue(db,run,actor)
                    elif batch['phase']=='node' or any(a['question']['model_usage']!='evaluation_only' for a in answered):
                        job_id=self.enqueue(db,run,actor)
                elif action=='generate':
                    if run['pending_batch'] or run['proposed_plan'] or not run['initial_submitted']:raise SimulationError('请先完成当前填写或计划审核',409)
                    if run['status']=='awaiting_final':raise SimulationError('请先完成结束评价',409)
                    job_id=self.enqueue(db,run,actor)
                elif action=='check-in':
                    if actor!=run['participant_id']:raise SimulationError('请由参与者本人报告变化',403)
                    if run['pending_batch'] or run['proposed_plan'] or (not run['active_plan'] and run.get('mode')!='live') or run['status']=='awaiting_final':raise SimulationError('请先完成当前问题和计划审核',409)
                    ids=[q['question_id'] for q in run['configuration']['questions'] if q['enabled'] and q['phase']=='initial_state' and q['model_usage']!='evaluation_only']
                    if not ids:raise ValueError('尚未配置状态字段，请等待研究者发送询问')
                    run['pending_batch']=self.batch(run,['initial_state'],ids)
                    run.update(trigger={'title':'参与者主动报告变化'},last_answer_phase=None)
                    self.event(db,run,'participant_checkin_requested',actor,public=run['trigger'])
                elif action=='progress':
                    if actor!=run['participant_id']:raise SimulationError('请由参与者本人报告任务进展',403)
                    if run['pending_batch'] or run['proposed_plan'] or not run['active_plan'] or run['status']=='awaiting_final':raise SimulationError('请先完成当前问题和计划审核',409)
                    updates=body.get('remaining_minutes')
                    if not isinstance(updates,dict) or not updates or not set(updates)<=run['remaining'].keys() or any(type(v) is not int or not 0<=v<=14400 for v in updates.values()):raise ValueError('请填写明确的剩余工作量（0–14400整数分钟）')
                    run['remaining'].update(updates)
                    run.update(trigger={'title':'参与者报告任务进展','remaining_minutes':updates},last_answer_phase=None)
                    self.event(db,run,'progress_reported',actor,public=run['trigger'])
                    job_id=self.enqueue(db,run,actor)
                elif action=='nodes' and len(parts)==5 and parts[4]=='override':
                    self.require_researcher(actor)
                    if run['pending_batch'] or run['status']=='awaiting_final':raise SimulationError('请先处理当前问题',409)
                    node=next((n for n in run['candidate_nodes'] if n['id']==parts[3]),None)
                    if not node:raise ValueError('节点不存在')
                    if node.get('triggered_at'):raise SimulationError('该节点已触发，不能重复启用',409)
                    node['enabled']=body['action']=='enable'
                    self.event(db,run,'researcher_override',actor,body)
                    run['node_versions'].append({'at':now(),'nodes':deepcopy(run['candidate_nodes']),'source':'researcher_override'})
                elif action=='plans' and len(parts)==5 and parts[4]=='review':
                    if run['pending_batch']:raise SimulationError('请先完成当前问题',409)
                    if actor!=run['participant_id']:raise SimulationError('请由参与者本人审核计划',403)
                    plan=run['proposed_plan']
                    if not plan or plan['id']!=parts[3]:raise SimulationError('候选计划已变化',409)
                    response=body.get('response')
                    if response not in ('accept','modify','reject'):raise ValueError('无效计划反馈')
                    if response!='reject':
                        validation_run=run
                        if run.get('mode')=='live' and plan.get('planning_at'):
                            # Accept the exact reviewed candidate, even if the clock advanced during review.
                            validation_run={**run,'simulated_at':plan['planning_at']}
                            if plan['blocks'] and not any(instant(b['end_at'])>instant(run['simulated_at']) for b in plan['blocks']):
                                raise SimulationError('这份建议的工作时段已经结束，请拒绝后重新生成',409)
                        checked=validate_blocks(validation_run,body.get('edits',plan['blocks']) if response=='modify' else plan['blocks'],plan['session_minutes'],plan['rest_minutes'])
                        if checked['unscheduled'] and body.get('acknowledge_unscheduled') is not True:raise ValueError('存在未安排工作量，请明确确认后继续')
                        run['active_plan']={**plan,**checked,'status':'confirmed','review_response':response,'confirmed_at':now()}
                        run['plans'].append(deepcopy(run['active_plan']));run['status']='active'
                    self.event(db,run,'plan_reviewed',actor,{'plan_id':plan['id'],'response':response,'reason':body.get('reason',''),'edits':body.get('edits')}, {'response':response,'reason':body.get('reason','')})
                    run['proposed_plan']=None
                    run['pending_batch']=self.batch(run,['feedback'])
                elif action=='configuration-switch':
                    self.require_researcher(actor)
                    if run['pending_batch'] or run['proposed_plan']:raise SimulationError('当前有未完成问题或计划，请处理后切换',409)
                    if not str(body.get('reason','')).strip():raise ValueError('请填写切换原因')
                    row=db.execute("SELECT body FROM sim_versions WHERE id=? AND kind='configs'",(body['config_version_id'],)).fetchone()
                    if not row:raise ValueError('问题版本不存在')
                    run.update(configuration=json.loads(row[0])['content'],config_version_id=body['config_version_id'],candidate_nodes=[])
                    run['configuration']['questions']=[q for q in run['configuration']['questions'] if q['phase']!='profile']
                    self.event(db,run,'configuration_switched',actor,{'config_version_id':body['config_version_id'],'reason':body['reason']})
                else:raise KeyError('/'.join(parts))
                self.repo.save_run(db,run)
                result=self.projected(run,actor)
            else:raise KeyError('/'.join(parts))
            db.execute('INSERT INTO sim_requests VALUES(?,?,?,?)',(actor,rid,fingerprint,encode(result)))
        if job_id:
            if self.pool:self.pool.submit(self.execute_job,job_id)
            else:self.jobs_to_run.append(job_id)
        return result

    def validate_questions(self, run, ids):
        bank={q['question_id']:q for q in run['configuration']['questions'] if q['enabled'] and q['phase']=='node' and q['model_usage']!='evaluation_only'}
        if len(ids)!=len(set(ids)) or not set(ids)<=bank.keys():raise ValueError('模型引用了无效或仅评价用问题')
        for key in ids:
            rule=bank[key]['display_if']
            if rule and rule['question_id'] not in ids:raise ValueError('条件题需要同时包含其前置问题')

    def execute_job(self, job_id):
        with self.repo.transaction() as db:
            row=db.execute('SELECT body FROM sim_jobs WHERE id=?',(job_id,)).fetchone();job=json.loads(row[0])
            run=self.repo.run(db,job['run_id']);events=self.repo.events(db,run['id'])
            if run.get('mode')!='live':return  # Old queued jobs cannot reactivate archived runs.
            job.update(status='running',started_at=now());db.execute('UPDATE sim_jobs SET body=? WHERE id=?',(encode(job),job_id))
        try:
            context=build_context(run,events)
            job['context_truncation']=context['truncation']
            def call(purpose,model):
                messages=messages_for(context,model.model_json_schema(),purpose)
                error=None
                for attempt in range(2):
                    started=time.monotonic();raw=None
                    try:
                        if len(encode(messages).encode('utf-8'))>180000:raise ValueError('完整模型输入超过容量限制，请缩短场景或问题；本次不调用模型')
                        raw=self.complete(messages)
                        if raw is None:raise ValueError('模型未返回有效结果，请检查API配置或稍后重试')
                        value=model.model_validate(raw).model_dump()
                        if purpose=='nodes':
                            self.validate_questions(run,value['question_ids'])
                            if (value['ask_decision']=='ask')!=bool(value['question_ids']):raise ValueError('ask须包含问题，skip/defer不能包含当前问题')
                            if run.get('last_answer_phase')=='node' and value['ask_decision']=='ask':raise ValueError('刚完成节点回答，不可立即重复询问')
                            for n in value['candidate_nodes']:
                                self.validate_questions(run,n['question_ids'])
                                if not instant(run['simulated_at'])<instant(n['at'])<=instant(run['scenario']['end_at']):raise ValueError('候选节点不在未来场景内')
                            if value['ask_decision']=='defer' and not value['candidate_nodes']:raise ValueError('推迟需提供后续节点')
                        else:
                            if not run['active_plan'] and value['plan_action']!='revise':raise ValueError('初始规划必须生成计划')
                            # Apply only explicitly bound, eligible planning answers.
                            cap=run['scenario']['session_minutes'];rest=run['scenario']['rest_minutes']
                            for a in context['planning_answers']:
                                binding=a['question']['semantic_binding']
                                if binding=='session_minutes':cap=int(a['value'])
                                if binding=='rest_minutes':rest=int(a['value'])
                            if value['session_minutes']>cap or value['rest_minutes']<rest:raise ValueError('建议违反用户工作段上限或休息下限')
                            allocate(run,value['ordered_task_ids'],value['session_minutes'],value['rest_minutes'])
                            if value['plan_action']=='keep' and run['active_plan']:
                                future=[b for b in run['active_plan']['blocks'] if instant(b['end_at'])>instant(run['simulated_at'])]
                                validate_blocks(run,future,cap,rest)
                        entry={'purpose':purpose,'attempt':attempt+1,'model':self.model,'temperature':0.2,'messages':deepcopy(messages),'output':raw,'elapsed_seconds':time.monotonic()-started,'validation':'passed'}
                        job['calls'].append(entry)
                        return value
                    except Exception as exc:
                        error=str(exc)
                        job['calls'].append({'purpose':purpose,'attempt':attempt+1,'model':self.model,'temperature':0.2,'messages':deepcopy(messages),'output':raw,'elapsed_seconds':time.monotonic()-started,'validation':'failed','error':error})
                        messages=messages+[{'role':'user','content':encode({'validation_error':error,'instruction':'Correct your JSON without inventing new facts.'})}]
                    finally:
                        with self.repo.transaction() as db:db.execute('UPDATE sim_jobs SET body=? WHERE id=?',(encode(job),job_id))
                raise ValueError(error)
            plan=call('planning',PlanDecision)
            nodes=call('nodes',NodeDecision)
            proposed=None
            if plan['plan_action']=='revise':
                proposed={**allocate(run,plan['ordered_task_ids'],plan['session_minutes'],plan['rest_minutes']),
                          'id':uid('plan'),'status':'proposed','planning_at':run['simulated_at'],'explanation':plan['explanation'],'generated_at':now()}
            with self.repo.transaction() as db:
                live=self.repo.run(db,run['id'])
                if live['pending_job_id']!=job_id or live['revision']!=run['revision']:raise SimulationError('上下文已更新，本次结果不应用',409)
                live['revision']+=1
                before=deepcopy(live['candidate_nodes'])
                live['candidate_nodes']=[{**n,'id':uid('node'),'enabled':False} for n in nodes['candidate_nodes']]
                release=bool(run.get('node_release_requested'))
                if nodes['ask_decision']=='ask' and not release:
                    live['candidate_nodes'].insert(0,{'id':uid('node'),'at':live['simulated_at'],'title':'当前情况询问','description':'请报告此刻的情况。','reason':nodes['reason'],'question_ids':nodes['question_ids'],'enabled':False,'source':'ai_ask_suggestion'})
                live['node_versions'].append({'job_id':job_id,'at':now(),'before':before,'nodes':deepcopy(live['candidate_nodes']),'decision':nodes,'source':'ai'})
                live['proposed_plan']=None if release and nodes['ask_decision']=='ask' else proposed
                if proposed:live['plans'].append(deepcopy(proposed))
                live['pending_batch']=self.batch(live,['node'],nodes['question_ids']) if release and nodes['ask_decision']=='ask' else None
                live['node_release_requested']=False
                if release:
                    live['last_inquiry_decision']={'decision':nodes['ask_decision'],'question_ids':nodes['question_ids'],'reason':nodes['reason'],'simulated_at':live['simulated_at']}
                    self.event(db,live,'system_inquiry_decided','ai',live['last_inquiry_decision'])
                live.update(pending_job_id=None,error=None)
                self.event(db,live,'generation_succeeded','ai',{'job_id':job_id,'plan_action':plan['plan_action'],'ask_decision':nodes['ask_decision'],'reason':nodes['reason']})
                job.update(status='succeeded',finished_at=now(),result_revision=live['revision'])
                self.repo.save_run(db,live);db.execute('UPDATE sim_jobs SET body=? WHERE id=?',(encode(job),job_id))
        except Exception as exc:
            with self.repo.transaction() as db:
                live=self.repo.run(db,run['id'])
                job.update(status='failed',error=str(exc),finished_at=now())
                if live['pending_job_id']==job_id:
                    live.update(pending_job_id=None,error=str(exc),revision=live['revision']+1)
                    self.event(db,live,'generation_failed','ai',{'job_id':job_id,'error':str(exc)})
                    self.repo.save_run(db,live)
                db.execute('UPDATE sim_jobs SET body=? WHERE id=?',(encode(job),job_id))
