"""Account-owned onboarding, independent of researcher scene assignment.

Original form drafts and validated scheduling inputs are stored separately. Nothing
here creates a plan, advances a simulation, or rewrites historical Profile answers.
"""
from copy import deepcopy
from datetime import datetime, timedelta
import json
from zoneinfo import ZoneInfo
from ...domain.simulation.contracts import Scenario, Question, instant
from .profile import validate_values


def _initial_questions(row):
    data=json.loads(row['body'])
    return [q for q in data['content']['questions'] if q['enabled'] and q['phase']=='initial_state']


def state_form(db, version=None):
    # Profile-only and node-only publications are not initial-state forms.
    # Once a form is shown, its exact version must remain pinned on submission.
    if version and version!='original-initial-state-v1':
        row=db.execute("SELECT id,body FROM sim_versions WHERE kind='configs' AND id=?",(version,)).fetchone()
        if not row:raise ValueError('状态表单版本不存在，请重新读取状态题目')
        questions=_initial_questions(row)
        if not questions:raise ValueError('此版本没有初始状态题目，请重新读取状态题目')
        return {'id':row['id'], 'questions':questions}
    if not version:
        for row in db.execute("SELECT id,body FROM sim_versions WHERE kind='configs' ORDER BY rowid DESC"):
            questions=_initial_questions(row)
            if questions:return {'id':row['id'], 'questions':questions}
    # Original product questions, not fallback answers or generated mock data.
    questions=[Question(question_id=k,phase='initial_state',title=t,type='scale',semantic_binding=k).model_dump()
               for k,t in [('energy','现在精力如何？'),('focus','现在专注程度如何？'),('stress','现在压力如何？')]]
    questions.insert(0,Question(question_id='mood',phase='initial_state',title='现在心情怎么样？',type='single',semantic_binding='mood',options=['心情不错','平静','低落','焦虑'],option_values=['positive','neutral','low','anxious']).model_dump())
    return {'id':'original-initial-state-v1','questions':questions}


def initial_setup(db, profile):
    saved=profile.get('planning_setup')
    if saved:
        result=deepcopy(saved)
        # Repair only unanswered drafts in the read projection. GET stays read-only;
        # the next explicit save persists the corrected form through normal history.
        if (not saved.get('submitted_at') and not saved.get('state_values')
                and not saved.get('state_answers') and not saved.get('state_form',{}).get('questions')):
            result['state_form']=state_form(db)
        return result
    today=datetime.now(ZoneInfo('Asia/Shanghai')).date()
    return {'revision':0,'step':2,'submitted_at':None,'state_form':state_form(db), 'state_values':{},
            'input':{'start_date':str(today),'end_date':str(today+timedelta(days=4)),'timezone':'Asia/Shanghai',
                     'availability':[],'activities':[],'tasks':[],'keep_buffer':True,'planning_goal':''}}


def compile_input(raw, complete=True, bounds=None):
    if not isinstance(raw,dict) or set(raw)!={'start_date','end_date','timezone','availability','activities','tasks','keep_buffer','planning_goal'}:
        raise ValueError('首次设置字段不完整或包含未知字段')
    if not isinstance(raw['timezone'],str):raise ValueError('时区无效')
    zone=ZoneInfo(raw['timezone'])
    def date(value):
        if not isinstance(value,str):raise ValueError('请填写有效日期')
        d=datetime.strptime(value,'%Y-%m-%d').date()
        if str(d)!=value:raise ValueError('日期格式须为 YYYY-MM-DD')
        return d
    start,end=date(raw['start_date']),date(raw['end_date'])
    if not 0<=(end-start).days<31:raise ValueError('规划日期须为1–31天')
    def stamp(day,clock):
        if not isinstance(clock,str):raise ValueError('请填写有效时间')
        parsed=datetime.strptime(clock,'%H:%M')
        if parsed.strftime('%H:%M')!=clock:raise ValueError('请填写有效时间')
        return datetime.combine(day,parsed.time(),zone).isoformat()
    tasks=deepcopy(raw['tasks']) if complete else []
    fixed=[]
    activities=raw['activities']
    if not isinstance(activities,list) or len(activities)>100:raise ValueError('活动数量不能超过100')
    ids=set()
    for a in activities:
        if not isinstance(a,dict) or a.get('version')!=2:raise ValueError('活动格式不正确')
        aid=a.get('id');title=a.get('title','').strip();kind=a.get('type');freq=a.get('frequency')
        if not isinstance(aid,str) or not aid or len(aid)>65 or aid in ids:raise ValueError('活动编号无效或重复')
        ids.add(aid)
        if not title or len(title)>200:raise ValueError('请填写活动名称（最多200字）')
        if kind not in ('fixed_event','recurring_routine','flexible_activity') or freq not in ('once','daily','weekly'):raise ValueError('活动类型无效')
        effective=date(a['date'] if freq=='once' else a['startDate'])
        if not start<=effective<=end:raise ValueError('活动开始日期必须位于规划范围内')
        weekdays=a.get('weekdays',[])
        if freq=='weekly' and (not weekdays or any(type(d) is not int or not 0<=d<=6 for d in weekdays)):raise ValueError('请选择活动的重复日期')
        days=[start+timedelta(days=i) for i in range((end-start).days+1)]
        days=[d for d in days if (d==effective if freq=='once' else d>=effective and (freq=='daily' or d.weekday() in weekdays))]
        if not days:raise ValueError('规划范围内没有活动日期')
        mode=a['fixed' if kind=='fixed_event' else 'preferred' if kind=='recurring_routine' else 'flexible']
        window=kind!='flexible_activity' or mode.get('window')=='limited'
        if kind!='fixed_event':
            value=str(mode.get('minutes',''))
            if not value.isdigit() or not 0<int(value)<=14400:raise ValueError('活动用时须为正整数分钟')
            minutes=int(value)
        for d in days:
            w={'start_at':stamp(d,mode['start']),'end_at':stamp(d,mode['end'])} if window else None
            if w:
                span=int((instant(w['end_at'])-instant(w['start_at'])).total_seconds()/60)
                if span<=0:raise ValueError('活动结束时间须晚于开始时间')
                if kind=='flexible_activity' and minutes>span:raise ValueError('灵活活动用时超过限定时段')
            if kind=='fixed_event':fixed.append(w)
            elif complete:
                day_window={'start_at':stamp(d,'00:00'),'end_at':stamp(d,'23:59')}
                if bounds:
                    day_window={'start_at':max(instant(day_window['start_at']),instant(bounds['start_at'])).isoformat(),'end_at':min(instant(day_window['end_at']),instant(bounds['end_at'])).isoformat()}
                    if instant(day_window['start_at'])>=instant(day_window['end_at']):raise ValueError('活动日期不在本次会话范围内，请核对日期')
                tasks.append({'id':aid+'_'+str(d),'title':title,'minutes':minutes,'deadline_at':day_window['end_at'],
                              'description':'参与者填写的日常活动','allowed_windows':[w if kind=='flexible_activity' and w else day_window],
                              'preferred_windows':[w] if kind=='recurring_routine' else []})
    if type(raw['keep_buffer']) is not bool:raise ValueError('缓冲设置须为布尔值')
    candidate=Scenario.model_validate({'name':'我的任务与时间','participant_input':True,'timezone':raw['timezone'],
        'start_at':stamp(start,'00:00'),'end_at':stamp(end,'23:59'),'tasks':tasks,'availability':raw['availability'],
        'fixed_events':fixed,'keep_buffer':raw['keep_buffer'],'planning_goal':raw['planning_goal']}).model_dump()
    if not candidate['availability']:raise ValueError('请至少选择一个可用时间段')
    if complete and not raw['tasks']:raise ValueError('请至少填写一个自己的任务')
    return candidate


def saved_setup(db, profile, body, timestamp):
    old=initial_setup(db,profile)
    if body.get('expected_revision')!=old['revision']:raise ValueError('首次设置已更新，请重新读取后重试')
    action=body.get('action')
    if action not in ('draft','submit'):raise ValueError('无效首次设置操作')
    complete=action=='submit'
    form=old['state_form'] if old['revision'] else state_form(db,body.get('state_form_id'))
    if body.get('state_form_id')!=form['id']:raise ValueError('状态问题版本已变化，请重新读取')
    if complete and not any(q['enabled'] for q in form['questions']):raise ValueError('初始状态题目为空，请重新读取状态题目后填写')
    raw=deepcopy(body.get('input'))
    scenario=compile_input(raw,complete)
    values=body.get('state_values',{})
    answers=validate_values(form['questions'],values,complete)
    return {'revision':old['revision']+1,'step':3,'submitted_at':timestamp if complete else None,'updated_at':timestamp,
            'input':raw,'scenario':scenario,'state_form':form,'state_values':values,'state_answers':answers}
