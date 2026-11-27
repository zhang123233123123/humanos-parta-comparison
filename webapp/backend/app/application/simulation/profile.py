"""Original onboarding Profile fields, versioned independently of simulation scenes."""
import json
from copy import deepcopy
from ...domain.simulation.contracts import Configuration, answer_value
from ...repositories.simulation import encode

# Matches onboarding/page.tsx profilePayload (About you + Work rhythm).
# Scenario availability, activities, tasks and momentary state are separate inputs.
def original_profile():
    def q(key, title, type='text', **kw):
        return {'question_id':key,'title':title,'phase':'profile','type':type,'required':False,'model_usage':'both',**kw}
    questions=[
        q('role','你的主要学习 / 研究场景是什么？','single',required=True,options=['研究型学生','课程学习学生','论文写作阶段','项目开发阶段'],option_values=['research_student','coursework_student','thesis_stage','project_stage']),
        q('learning_mode','偏好的学习材料 / 方式','single',required=True,options=['阅读和写作','图表 / 视频 / 可视化','讨论 / 讲给别人听','做题 / 实操 / 项目推进','混合方式'],option_values=['reading_writing','visual','discussion','practice','mixed']),
        q('planning_failure_reasons','计划最容易失效的地方','multiple',options=['任务不够清楚','状态太累或焦虑','被外部事情打断','切换后回不来','低估任务时长','临时优先级变化'],option_values=['task_ambiguity','fatigue','interruption','context_loss','underduration','priority_change']),
        q('recent_plan_failure','最近一次“有计划但没有推进”的情况',help='例如：明明写在日历里，但到时间后不知道从哪里开始。'),
        q('task_switching_preference','任务之间怎么安排（可选）','single',options=['无明确偏好','尽量完成一个任务再换','喜欢不同任务交替'],option_values=['unspecified','finish_then_switch','interleave']),
        q('task_distribution_preference','同一任务跨天怎么安排（可选）','single',options=['无明确偏好','尽量集中在一天','倾向分散到多天'],option_values=['unspecified','concentrated','spread']),
        q('preferred_session_minutes','每次专注执行最长安排多久？','number',required=True,minimum=1,maximum=180,semantic_binding='session_minutes',help='填写你通常能够连续专注的分钟数。'),
        q('rest_between_tasks_minutes','专注之间通常休息多久？','number',required=True,minimum=0,maximum=120,semantic_binding='rest_minutes',help='填写两段工作之间通常需要休息的分钟数。'),
        *[q('typical_energy_'+key,title,'scale',required=True,minimum=1,maximum=7,low_label='低',high_label='高') for key,title in [('morning','早晨典型精力'),('afternoon','下午典型精力'),('evening','晚间典型精力')]],
    ]
    return Configuration.model_validate({'name':'原始 Profile 字段','questions':questions}).model_dump()

ORIGINAL_IDS={q['question_id'] for q in original_profile()['questions']}

def current_form(db):
    row=db.execute("SELECT body FROM sim_profile_forms ORDER BY revision DESC LIMIT 1").fetchone()
    if row:return json.loads(row[0])
    return {'id':'original-profile-v1','revision':1,'content':original_profile()}

def get_profile(db, actor):
    row=db.execute('SELECT body FROM sim_profiles WHERE participant_id=?',(actor,)).fetchone()
    if row:return json.loads(row[0])
    return {'participant_id':actor,'revision':0,'form':current_form(db),'values':{},'answers':[], 'step':0,'submitted_at':None}

def validate_profile_form(content):
    data=Configuration.model_validate(content).model_dump()
    if not ORIGINAL_IDS <= {q['question_id'] for q in data['questions']}:
        raise ValueError('请保留原 Profile 字段；不需要的字段可取消启用')
    if any(q['phase']!='profile' for q in data['questions']):raise ValueError('Profile 字段必须保留在首次填写阶段')
    return data

def validate_values(questions, values, complete):
    if not isinstance(values,dict) or not set(values)<={q['question_id'] for q in questions}:raise ValueError('Profile 包含未知字段')
    answers=[];visible={}
    for q in questions:
        if not q['enabled']:continue
        rule=q.get('display_if')
        if rule and visible.get(rule['question_id'])!=rule['equals']:continue
        value=values.get(q['question_id'])
        if value is None or value=='':
            if complete and q['required']:raise ValueError('请填写：'+q['title'])
            continue
        # Drafts may omit required answers but cannot store malformed ones.
        value=answer_value(q,value);visible[q['question_id']]=value
        answers.append({'question':deepcopy(q),'value':value})
    return answers

def canonical_profile(answers):
    values={a['question']['question_id']:a['value'] for a in answers if a['question']['model_usage']!='evaluation_only'}
    prefs={k:values[k] for k in ['learning_mode','task_switching_preference','task_distribution_preference','preferred_session_minutes','rest_between_tasks_minutes'] if k in values}
    prefs['typical_energy']={k:values['typical_energy_'+k] for k in ['morning','afternoon','evening'] if 'typical_energy_'+k in values}
    return {'role':values.get('role'),'blocker_patterns':values.get('planning_failure_reasons',[]),'task_preferences':prefs,'research_context':{k:values[k] for k in ['planning_failure_reasons','recent_plan_failure'] if k in values}}
