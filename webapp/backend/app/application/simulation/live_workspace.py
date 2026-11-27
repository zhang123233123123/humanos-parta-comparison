"""Account-owned workspaces and server-clock inquiry delivery.

Legacy simulated runs are never migrated or advanced by this module.
"""
from copy import deepcopy
from datetime import datetime, timezone
import json
import logging
import uuid
from ...domain.simulation.contracts import Configuration, Question, instant
from ...repositories.simulation import encode
from .onboarding import compile_input, state_form
from .profile import get_profile


def key(prefix):
    return prefix+'_'+uuid.uuid4().hex


def default_configuration(db):
    questions=state_form(db,'original-initial-state-v1')['questions']
    questions.append(Question(question_id='current_change',phase='node',title='当前任务进展和状态有什么变化？你希望如何继续？',type='text').model_dump())
    titles=['今天的计划让我满意。','我对今天执行计划的情况感到满意。','使用系统帮助我更高效地工作。','今天的计划符合我的精力、专注和压力状态。']
    questions += [Question(question_id='daily_d'+str(i+1),phase='daily_feedback',title=t,type='scale',model_usage='evaluation_only',low_label='非常不同意',high_label='非常同意').model_dump() for i,t in enumerate(titles)]
    questions.append(Question(question_id='daily_d5',phase='daily_feedback',title='今天计划的工作，你大约完成了多少？',type='single',options=['0–20%','21–40%','41–60%','61–80%','81–100%'],model_usage='evaluation_only').model_dump())
    return Configuration(name='日常工作台问题方案',questions=questions).model_dump()


class LiveWorkspaceMixin:
    def clock_stamp(self):
        return self.clock().astimezone(timezone.utc).replace(second=0,microsecond=0).isoformat()

    def ensure_workspace_configuration(self, db):
        for row in db.execute("SELECT body FROM sim_versions WHERE kind='configs' ORDER BY rowid DESC"):
            version=json.loads(row[0])
            if any(q['phase']!='profile' for q in version['content']['questions']):return version
        # Product defaults are persisted and editable, never fabricated participant answers.
        content=default_configuration(db);stamp=self.clock_stamp()
        doc={'id':key('config'),'revision':1,'content':content,'updated_at':stamp,'latest_version_id':key('version')}
        version={'id':doc['latest_version_id'],'document_id':doc['id'],'revision':1,'content':content,'created_at':stamp}
        db.execute('INSERT INTO sim_documents VALUES(?,?,?,?,?)',(doc['id'],'configs','system',1,encode(doc)))
        db.execute('INSERT INTO sim_versions VALUES(?,?,?,?,?)',(version['id'],doc['id'],'configs',encode(version),stamp))
        return version

    def start_workspace(self, db, actor, body):
        if set(body)-{'request_id'}:raise ValueError('工作台只能使用本人已保存的首次设置')
        # Transaction serializes concurrent tabs and different idempotency keys.
        for row in db.execute('SELECT body FROM sim_runs WHERE participant_id=? ORDER BY rowid DESC',(actor,)):
            run=json.loads(row[0])
            if run.get('mode')=='live' and run['status']!='completed':return self.projected(run,actor)
        profile=get_profile(db,actor);setup=profile.get('planning_setup')
        if not profile.get('submitted_at') or not setup or not setup.get('submitted_at'):
            raise ValueError('请先完成首次设置并保存任务、可用时间和状态')
        scenario=compile_input(setup['input'])
        stamp=self.clock_stamp()
        if instant(scenario['end_at'])<=instant(stamp):raise ValueError('规划日期已结束，请修改任务与时间设置后再进入工作台')
        prefs=profile.get('profile',{}).get('task_preferences',{})
        scenario.update(name='我的工作台',description='',session_minutes=prefs.get('preferred_session_minutes',45),rest_minutes=prefs.get('rest_between_tasks_minutes',10))
        version=self.ensure_workspace_configuration(db)
        config=deepcopy(version['content'])
        # Preserve exactly the initial form and answers actually completed by this account.
        config['questions']=[q for q in config['questions'] if q['phase'] not in ('profile','initial_state')]+deepcopy(setup['state_form']['questions'])
        Configuration.model_validate(config)
        run={'id':key('run'),'mode':'live','participant_id':actor,'researcher_id':None,'revision':1,'status':'ready',
             'config_version_id':version['id'],'scenario_version_id':None,'configuration':config,'scenario':scenario,
             'simulated_at':stamp,'created_at':datetime.now(timezone.utc).isoformat(),'remaining':{t['id']:t['minutes'] for t in scenario['tasks']},'unavailable':[],
             'profile_snapshot':deepcopy(profile),'account_setup_snapshot':deepcopy(setup),'onboarding_input':deepcopy(setup['input']),
             'node_control':'ai_time_researcher_enable','participant_setup_complete':True,'input_versions':[],
             'initial_submitted':True,'active_plan':None,'proposed_plan':None,'plans':[],'candidate_nodes':[],'node_versions':[],
             'answer_batches':[],'revealed_events':[],'triggered_event_ids':[],'pending_job_id':None,'pending_batch':None,
             'error':None,'trigger':None,'last_answer_phase':'initial_state'}
        for phase,source,answers,questions,vid,submitted in [
            ('profile','account_profile',profile['answers'],profile['form']['content']['questions'],profile['form']['id'],profile['submitted_at']),
            ('initial_state','account_setup',setup['state_answers'],setup['state_form']['questions'],setup['state_form']['id'],setup['submitted_at'])]:
            run['answer_batches'].append({'id':key('snapshot'),'phase':phase,'source':source,'answers':deepcopy(answers),'questions':deepcopy(questions),'config_version_id':vid,'submitted_at':submitted,'simulated_at':datetime.fromisoformat(submitted).astimezone(timezone.utc).replace(second=0,microsecond=0).isoformat()})
        self.repo.save_run(db,run)
        self.event(db,run,'workspace_started',actor,{'setup_revision':setup['revision']}, {'title':'首次设置已载入工作台'})
        return self.projected(run,actor)

    def dispatch_due_nodes(self):
        jobs=[]
        with self.repo.transaction() as db:
            stamp=self.clock_stamp()
            for row in db.execute('SELECT body FROM sim_runs').fetchall():
                run=json.loads(row[0])
                if run.get('mode')!='live' or run['status'] in ('completed','awaiting_final'):continue
                if run['pending_job_id'] or run['pending_batch'] or run['proposed_plan'] or not run['active_plan']:continue
                if instant(stamp)>instant(run['scenario']['end_at']):continue
                due=sorted([n for n in run['candidate_nodes'] if n.get('enabled') and not n.get('triggered_at') and instant(n['at'])<=instant(stamp)],key=lambda n:instant(n['at']))
                if not due:continue
                node=due[0];self.validate_questions(run,node['question_ids'])
                run.update(simulated_at=stamp,revision=run['revision']+1,node_release_requested=True,last_answer_phase=None,
                           trigger={'title':node['title'],'description':node['description'],'node_id':node['id'],'scheduled_at':node['at']})
                node.update(enabled=False,triggered_at=stamp)
                self.event(db,run,'enabled_node_due','system',{'node_id':node['id'],'scheduled_at':node['at']})
                jobs.append(self.enqueue(db,run,'system'))
                self.repo.save_run(db,run)
        for job in jobs:
            if self.pool:self.pool.submit(self.execute_job,job)
            else:self.jobs_to_run.append(job)
        return len(jobs)

    def scheduler_loop(self):
        while not self.scheduler_stop.wait(5):
            try:self.dispatch_due_nodes()
            except Exception:logging.getLogger(__name__).exception('Inquiry-node scheduler failed')
