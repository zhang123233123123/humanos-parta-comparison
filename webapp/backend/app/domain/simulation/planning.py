"""Date-based simulation adapter around the existing interval subtraction engine."""
from datetime import timedelta
from .contracts import instant
from ..timeline import WeeklySegment, WeeklyTimeAxis


def free_windows(run):
    s = run['scenario']
    now = instant(run['simulated_at'])
    occupied = [*s['fixed_events'], *run.get('unavailable', [])]
    windows = []
    # Adapt arbitrary scene dates in seven-day chunks; no calendar-week rollover.
    for w in s['availability']:
        a, end = max(instant(w['start_at']), now), instant(w['end_at'])
        while a < end:
            b = min(a+timedelta(days=7), end)
            blockers = []
            for block in occupied:
                x, y = max(a, instant(block['start_at'])), min(b, instant(block['end_at']))
                if x < y:
                    blockers.append(WeeklySegment(int((x-a).total_seconds()/60), int((y-a).total_seconds()/60)))
            free = WeeklyTimeAxis.subtract([WeeklySegment(0, int((b-a).total_seconds()/60))], blockers)
            windows.extend((a+timedelta(minutes=x.start), a+timedelta(minutes=x.end)) for x in free)
            a = b
    merged = []
    for a,b in sorted(windows):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b,merged[-1][1]))
        else:
            merged.append((a,b))
    if s.get("keep_buffer",False):
        merged=[(a,b-timedelta(minutes=int((b-a).total_seconds()/60)//10)) for a,b in merged]
    return merged


def allocate(run, order, cap, rest):
    tasks = {t['id']:t for t in run['scenario']['tasks']}
    expected = {k for k,v in run['remaining'].items() if v > 0}
    if len(order)!=len(set(order)) or set(order)!=expected:
        raise ValueError('模型必须恰好包含所有未完成任务ID，不能遗漏或重复')
    windows = free_windows(run)
    blocks = []
    if any(t.get('allowed_windows') or t.get('preferred_windows') for t in tasks.values()):
        # Reserve preferred activities first; ordinary work then uses the gaps.
        ordered=sorted(order,key=lambda tid:not bool(tasks[tid].get('preferred_windows')))
        for tid in ordered:
            task=tasks[tid];left=run['remaining'][tid]
            permitted=task.get('allowed_windows') or [{'start_at':a.isoformat(),'end_at':b.isoformat()} for a,b in windows]
            candidates=[]
            for a,b in windows:
                for w in permitted:
                    x,y=max(a,instant(w['start_at'])),min(b,instant(w['end_at']),instant(task['deadline_at']))
                    if x<y:candidates.append((x,y))
            preferred=[]
            for a,b in candidates:
                for w in task.get('preferred_windows',[]):
                    x,y=max(a,instant(w['start_at'])),min(b,instant(w['end_at']))
                    if x<y:preferred.append((x,y))
            for a,b in preferred+candidates:
                cursor=a
                while left and cursor<b:
                    occupied=sorted((instant(v['start_at'])-timedelta(minutes=rest),instant(v['end_at'])+timedelta(minutes=rest)) for v in blocks)
                    available_end=b
                    for x,y in occupied:
                        if x<=cursor<y:cursor=y
                        elif cursor<x:
                            available_end=min(available_end,x);break
                    minutes=min(left,cap,int((available_end-cursor).total_seconds()/60))
                    if minutes<=0:break
                    end=cursor+timedelta(minutes=minutes)
                    blocks.append({'task_id':tid,'start_at':cursor.isoformat(),'end_at':end.isoformat()})
                    left-=minutes;cursor=end+timedelta(minutes=rest)
        return validate_blocks(run,blocks,cap,rest)
    cursor = instant(run['simulated_at'])
    for task_id in order:
        left = run['remaining'][task_id]
        deadline = instant(tasks[task_id]['deadline_at'])
        for a,b in windows:
            a,b = max(a,cursor), min(b,deadline)
            while left and a < b:
                minutes = min(left, cap, int((b-a).total_seconds()/60))
                if minutes <= 0:
                    break
                end = a+timedelta(minutes=minutes)
                blocks.append({'task_id':task_id,'start_at':a.isoformat(),'end_at':end.isoformat()})
                left -= minutes
                a = end+timedelta(minutes=rest)
                cursor = a
    return validate_blocks(run, blocks, cap, rest)


def validate_blocks(run, blocks, cap, rest):
    if not isinstance(blocks,list) or len(blocks)>3000:
        raise ValueError('计划工作段格式无效')
    windows = free_windows(run)
    tasks = {t['id']:t for t in run['scenario']['tasks']}
    used = {t:0 for t in tasks}
    result=[]
    for b in blocks:
        task_id=b.get('task_id')
        if task_id not in tasks or run['remaining'][task_id]<=0:
            raise ValueError('工作段引用无效任务')
        a,end=instant(b.get('start_at')),instant(b.get('end_at'))
        minutes=int((end-a).total_seconds()/60)
        if not 0<minutes<=cap or end>instant(tasks[task_id]['deadline_at']) or not any(x<=a<end<=y for x,y in windows):
            raise ValueError('工作段超出可用时间、截止时间或工作段上限')
        allowed=tasks[task_id].get('allowed_windows',[])
        if allowed and not any(instant(w['start_at'])<=a<end<=instant(w['end_at']) for w in allowed):raise ValueError('活动超出限定时间范围')
        used[task_id]+=minutes
        result.append({'task_id':task_id,'title':tasks[task_id]['title'],'start_at':a.isoformat(),'end_at':end.isoformat(),'minutes':minutes})
    result.sort(key=lambda x:x['start_at'])
    for p,n in zip(result,result[1:]):
        if instant(n['start_at'])<instant(p['end_at'])+timedelta(minutes=rest):
            raise ValueError('工作段重叠或休息间隔不足')
    if any(used[t]>run['remaining'][t] for t in tasks):
        raise ValueError('排入的任务量超过剩余工作量')
    return {'blocks':result,'unscheduled':[{'task_id':t,'title':tasks[t]['title'],'minutes':run['remaining'][t]-used[t]} for t in tasks if used[t]<run['remaining'][t]],'session_minutes':cap,'rest_minutes':rest}
