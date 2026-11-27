from copy import deepcopy
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import hashlib
import json
import re

from ...domain.simulation.planning import free_windows, validate_blocks

VERSION = 'part-a-one-day-v2'
CONDITIONS = [('native','AI-native'), ('task','Task-only'),
              ('difficulty','Task + difficulty'), ('humanos','HumanOS')]
GUIDANCE = '''你是 HumanOS 的单日学习规划助手。任务内容、交付物和预计工作量必须保持不变。
只在给定当天可用时间内规划，避开固定事项及保留休息，满足每项最早开始、截止和拆分规则。
截止和优先级用于约束取舍，优先级不代表强制按高到低排序。不得遗漏、增加任务或减少工作量。
在有选择空间时合理组织工作块、休息、顺序和切换。仅依据本条件实际提供的个人信息，
不要推断未提供的难度、精力或偏好。有难度感受时把它视为用户自报，有 Profile 时把它视为软偏好。
典型精力不代表当前状态；缺失信息不是某种偏好。解释关键安排；无法满足硬约束时如实说明。
你负责生成具体开始结束时间；Python 只做事后时间校验，不替你排程。'''
OUTPUT = '''输出 JSON 对象：{"blocks":[{"task_id":"原任务ID","start_at":"带时区偏移的ISO时间","end_at":"带时区偏移的ISO时间"}],"explanation":"安排理由"}。
blocks 仅包含任务工作段，休息以空档表达，固定事项已在上下文中给出，不复制成任务。
所有时间精确到整分钟。允许按规则拆分任务，但各段合计必须等于给定工作量。'''

class PartAError(ValueError):
    def __init__(self,message,status=400):super().__init__(message);self.status=status

def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(value):return hashlib.sha256(encoded(value).encode()).hexdigest()

def instant(value):
    if not isinstance(value,str):raise ValueError('时间必须为带时区的 ISO 字符串')
    dt=datetime.fromisoformat(value)
    if dt.tzinfo is None:raise ValueError('时间缺少时区偏移')
    if dt.second or dt.microsecond:raise ValueError('时间必须精确到整分钟')
    return dt

def build_preview(scenario, person, payload, model):
    mode=payload.get('difficulty_mode')
    if mode not in ('level','score','text'):raise PartAError('请选择高/中/低、0–100分或文字三种难度之一')
    values=payload.get('difficulties');overrides=payload.get('duration_overrides',{})
    deadlines=payload.get('deadline_overrides',{})
    tasks=deepcopy(scenario['tasks']);ids={t['task_id'] for t in tasks}
    if not isinstance(values,dict) or set(values)!=ids:raise PartAError('每项任务都必须填写同一种难度，不能遗漏或额外添加任务')
    if not isinstance(overrides,dict) or set(overrides)-ids:raise PartAError('时长覆盖包含未知任务')
    if not isinstance(deadlines,dict) or set(deadlines)-ids:raise PartAError('截止时间覆盖包含未知任务或格式无效')
    for tid,v in deadlines.items():
        if not isinstance(v,str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',v):
            raise PartAError('截止时间必须为当天的 HH:mm，范围00:00–23:59')
    for tid,v in values.items():
        if mode=='level' and v not in ('high','medium','low'):raise PartAError('难度等级必须为高、中或低')
        if mode=='score' and (type(v) is not int or not 0<=v<=100):raise PartAError('难度分数必须是0–100整数')
        if mode=='text' and (not isinstance(v,str) or not 1<=len(v.strip())<=500):raise PartAError('每项难度描述需要1–500字')
    day=deepcopy(person.get('first_day_context'))
    if not day:raise PartAError('画像缺少首日上下文，请重新提取资料',422)
    zone=ZoneInfo(day['timezone']);start=datetime.fromisoformat(day['date']).replace(tzinfo=zone)
    def at(clock):return datetime.fromisoformat(day['date']+'T'+clock).replace(tzinfo=zone).isoformat()
    common_tasks=[]
    for t in tasks:
        minutes=overrides.get(t['task_id'],t['estimated_minutes'])
        if type(minutes) is not int or not 1<=minutes<=1440:raise PartAError('预计时长必须为1–1440整数分钟')
        chunk=t.get('minimum_chunk_minutes',1)
        if minutes<chunk:raise PartAError('任务时长不能小于素材规定的最小工作块')
        deadline=deadlines.get(t['task_id'],t['deadline'])
        if instant(at(deadline))<=instant(at(t['earliest_start'])):
            raise PartAError(t['title']+'的截止时间必须晚于最早开始时间 '+t['earliest_start'])
        common_tasks.append({'id':t['task_id'],'title':t['title'],'deliverable':t['deliverable'],
            'minutes':minutes,'priority':t['priority'],'earliest_start_at':at(t['earliest_start']),
            'deadline_at':at(deadline),'splittable':t.get('splittable',False),
            'minimum_chunk_minutes':chunk,'depends_on':t.get('depends_on',[])})
    fixed=[{**x,'source':'profile_first_day'} for x in day['fixed_events']]
    fixed.extend({'title':r['label'],'start_at':at(r['start']),'end_at':at(r['end']),
                  'source':'scenario_reserved'} for r in scenario.get('reserved_periods',[]))
    common={'date':day['date'],'timezone':day['timezone'],'context':scenario['context'],
            'tasks':common_tasks,'availability':day['availability'],'fixed_events':fixed,
            'rules':{'single_day':True,'all_work_required':True,'overlap_allowed':False}}
    p=person['original_profile_fields'];pp=p.get('personal_profile',{})
    work_profile={'typical_day_energy':pp.get('day_energy'),
        'preferred_session_minutes':p.get('session_minutes'),'preferred_break_minutes':p.get('break_minutes'),
        'task_switching_preference':pp.get('task_switching_preference'),'additional_preferences':p.get('preferences'),
        'missing_dimensions':['task_order','natural_breakpoint','break_form','applicability_and_exceptions'],
        'interpretation':'历史自报，未按新版五维重新确认。finish_then_switch=集中完成后切换；interleave=交替任务；null/空串=未明确，不补值。'}
    difficulty={'mode':mode,'values':values,'meaning':{'level':'high=高、medium=中、low=低',
                  'score':'0=主观最容易，100=主观最难；不自动转成等级','text':'保留填写者原始主观描述'}[mode],
                'source':'研究者内部预试填写，非原参与者对新任务的已采集评分'}
    conditions=[]
    for cid,label in CONDITIONS:
        facts=deepcopy(common)
        if cid in ('difficulty','humanos'):facts['perceived_difficulty']=deepcopy(difficulty)
        if cid=='humanos':facts['work_profile']=work_profile
        messages=[{'role':'system','content':('帮我安排今天的学习计划。' if cid=='native' else GUIDANCE)+'\n'+OUTPUT},
                  {'role':'user','content':encoded(facts)}]
        conditions.append({'id':cid,'label':label,'messages':messages})
    run=validation_run(common)
    windows=free_windows(run);capacity=sum(int((b-a).total_seconds()/60) for a,b in windows)
    total=sum(t['minutes'] for t in common_tasks)
    issues=[]
    if not windows:issues.append('该 Profile 首日没有扣除固定事项后可用的时间，不能生成有效计划。')
    if total>capacity:issues.append(f'任务共{total}分钟，净可用仅{capacity}分钟，无法足额安排。')
    for task in common_tasks:
        available=sum(max(0,int((min(b,instant(task['deadline_at']))-max(a,instant(task['earliest_start_at']))).total_seconds()/60)) for a,b in windows)
        if available<task['minutes']:issues.append(task['title']+'在开始下限与截止之间没有足够时间。')
    # Necessary cumulative deadline test catches jointly impossible workloads.
    for deadline in sorted({t['deadline_at'] for t in common_tasks}):
        due=[t for t in common_tasks if instant(t['deadline_at'])<=instant(deadline)]
        release=min(instant(t['earliest_start_at']) for t in due)
        capacity_before=sum(max(0,int((min(b,instant(deadline))-max(a,release)).total_seconds()/60)) for a,b in windows)
        required=sum(t['minutes'] for t in due)
        if required>capacity_before:
            issues.append(f'截至{deadline[11:16]}需完成{required}分钟，但共同可用时间仅{capacity_before}分钟。')
    result={'version':VERSION,'scenario_id':scenario['scenario_id'],'scenario_title':scenario['title'],
        'original_constraint_label':scenario['constraint_condition'],'profile_id':person['participant'],
        'profile_submitted_at':person['submitted_at'],'common':common,'conditions':conditions,'model':model,
        'parameters':{'temperature':0.2,'response_format':{'type':'json_object'},'thinking':{'type':'disabled'}},
        'policy':{'max_attempts_per_condition':3,'validation':'共同时间质检；不通过交回模型修正','native_label':'通用指令＋共同时间质检'},
        'precheck':{'can_attempt':not issues,'issues':issues,'work_minutes':total,'net_available_minutes':capacity,
                    'note':'仅必要条件检查；是否有效以生成后的完整校验为准。'},
        'source_hashes':{'scenario':digest(scenario),'profile':digest(person)},
        'warnings':['个人首日可用时间已替代场景原窗口；宽松/紧张只是原素材标签，不保证原约束强度。',
                    '本次任务截止钟点锚定到 Profile 首日；场景午休/固定休息和首日固定事项共同保留。',
                    '高/中/低、分数和文字是三种不同输入表达，不自动互相换算。']}
    result['preview_hash']=digest(result)
    return result

def validation_run(common):
    return {'scenario':{'availability':common['availability'],'fixed_events':common['fixed_events'],
                        'tasks':common['tasks'],'keep_buffer':False},
            'simulated_at':datetime.fromisoformat(common['date']).replace(tzinfo=ZoneInfo(common['timezone'])).isoformat(),
            'remaining':{t['id']:t['minutes'] for t in common['tasks']}}

def validate_output(common, output):
    violations=[];blocks=output.get('blocks') if isinstance(output,dict) else None
    if not isinstance(blocks,list) or len(blocks)>300:
        return {'valid':False,'violations':['模型输出必须包含blocks数组（最多300段）'],'blocks':[]}
    if not isinstance(output.get('explanation',''),str):
        violations.append('explanation 必须为文字说明')
    task_map={t['id']:t for t in common['tasks']};totals={k:0 for k in task_map};counts=CounterLike()
    parsed=[];canonical=[];zone=ZoneInfo(common['timezone']);date=common['date']
    for i,b in enumerate(blocks):
        try:
            if not isinstance(b,dict) or b.get('task_id') not in task_map:raise ValueError('未知或缺失任务ID')
            t=task_map[b['task_id']];a=instant(b.get('start_at'));end=instant(b.get('end_at'))
            minutes=int((end-a).total_seconds()/60)
            if a.astimezone(zone).date().isoformat()!=date or end.astimezone(zone)>datetime.fromisoformat(date).replace(tzinfo=zone)+timedelta(days=1):raise ValueError('超出首日范围')
            if minutes<t['minimum_chunk_minutes']:raise ValueError('工作块短于素材规定下限')
            if a<instant(t['earliest_start_at']):raise ValueError('早于任务最早开始时间')
            totals[t['id']]+=minutes;counts[t['id']]+=1;parsed.append((t['id'],a,end))
            canonical.append({'task_id':t['id'],'start_at':a.astimezone(zone).isoformat(),'end_at':end.astimezone(zone).isoformat()})
        except (ValueError,TypeError,KeyError) as exc:violations.append(f'第{i+1}段：{exc}')
    normalized=[]
    if not violations:
        try:
            checked=validate_blocks(validation_run(common),canonical,1440,0)
            normalized=[{**b,'start_at':instant(b['start_at']).astimezone(zone).isoformat(),
                         'end_at':instant(b['end_at']).astimezone(zone).isoformat()} for b in checked['blocks']]
        except (ValueError,TypeError,KeyError) as exc:violations.append(str(exc))
    for tid,t in task_map.items():
        if totals[tid]!=t['minutes']:violations.append(f"{tid} 要求{t['minutes']}分钟，输出{totals[tid]}分钟（缺失或超额）")
        if not t['splittable'] and counts[tid]>1:violations.append(tid+'不可拆分')
        mine=[a for k,a,b in parsed if k==tid]
        for pred in t['depends_on']:
            previous=[b for k,a,b in parsed if k==pred]
            if not previous or not mine or max(previous)>min(mine):violations.append(tid+'违反前置任务约束')
    return {'valid':not violations,'violations':violations,'blocks':normalized,
            'checked_by':'existing_validate_blocks + part_a_completeness_and_day_checks'}

class CounterLike(dict):
    def __missing__(self,key):return 0
