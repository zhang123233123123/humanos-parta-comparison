"""Rebuild the research materials from pinned local source snapshots; stdlib only."""
from pathlib import Path
import csv
import hashlib
import html
import itertools
import json

ROOT = Path(__file__).resolve().parent
COMMIT = '2c823c234d7c25bae7f603d74eb8fd7d522b7243'
BASE = f'https://github.com/MaaniBeigy/calendar-bench/blob/{COMMIT}/'
SOURCE_MAP = {
    'example_event_config.yaml': 'src/experiments/persona/example_experiment/event_config.yaml',
    'student_event_config.yaml': 'src/experiments/persona/healthy_lifestyle_promotion/event_config.yaml',
    'student_persona_config.yaml': 'src/experiments/persona/healthy_lifestyle_promotion/persona_config.yaml',
    'student_environment.yaml': 'src/experiments/persona/healthy_lifestyle_promotion/environment.yaml',
}

def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def excerpt(key, title, filename, begin, end, after='', interpretation=''):
    text = (ROOT/'原始来源'/filename).read_text()
    offset = text.index(after) if after else 0
    start = text.index(begin, offset)
    stop = text.index(end, start + len(begin))
    body = text[start:stop].rstrip() + '\n'
    line = text[:start].count('\n') + 1
    last = line + len(body.splitlines()) - 1
    path = ROOT/'原文摘录'/f'{key}.yaml'
    path.write_text(body)
    return dict(id=key, title=title, source_file=filename, source_path=SOURCE_MAP[filename],
                source_lines=[line,last], url=BASE+SOURCE_MAP[filename]+f'#L{line}-L{last}',
                excerpt_path=str(path.relative_to(ROOT)), interpretation=interpretation,
                text=body, sha256=hashlib.sha256(body.encode()).hexdigest())

for name in ['原文摘录','改编场景','校验']:
    (ROOT/name).mkdir(exist_ok=True)
extracts = [
    excerpt('E01','通用示例：学习活动目录','example_event_config.yaml','  education:\n','  sports:\n',
            interpretation='包含 lecture、self-study 等标签；单次 1–8 小时是该示例的生成范围，不是教学建议。'),
    excerpt('E02','学生实验：学习活动目录','student_event_config.yaml','      studying:\n','      study_reading:\n',
            interpretation='包括 lecture、course、self-study、exam、quiz 等日历标签；单次通用范围 1–3 小时。标签不等于独立题本。'),
    excerpt('E03','学生实验：学习阅读目录','student_event_config.yaml','      study_reading:\n','  sports:\n',
            interpretation='通用单次范围 5–60 分钟；定义可拆分性和可出现的时间段。'),
    excerpt('E04','学生模板：学习阶段','student_persona_config.yaml','  - name: studying\n','  - name: office_work\n',
            after='- id: free_spirited_social_student',interpretation='模板将学习活动关联到工作日 10:00；这是合成人物设定，不是参与者实测偏好。'),
    excerpt('E05','学生模板：学习时长覆盖','student_persona_config.yaml','    studying:\n','    office_work:\n',
            after='- id: free_spirited_social_student',interpretation='人物覆盖配置：单次 120–240 分钟，每日总量 240–420 分钟，2–3 段；不能只引用 E02 忽略覆盖。'),
    excerpt('E06','学生模板：阅读时长覆盖','student_persona_config.yaml','    study_reading:\n','  contexts:\n',
            after='- id: free_spirited_social_student',interpretation='人物覆盖配置：单次 60–150 分钟，每日总量 120–240 分钟，1–2 段；这些合成参数未在我们的学生群体中验证。'),
    excerpt('E07','环境：时间段定义','student_environment.yaml','time_windows:','parallelism:',
            interpretation='定义早晨、下午等时间段，以及场景任务的起止范围；不是特定学生的空闲时间。'),
    excerpt('E08','学生模板：阅读阶段','student_persona_config.yaml','  - name: study_reading\n','  event_overrides:\n',
            after='- id: free_spirited_social_student',interpretation='学习阅读出现于人物阶段设置；与 E03/E06 是同类活动的不同配置层，不是新样本。'),
]
manifest = {'repository':'https://github.com/MaaniBeigy/calendar-bench','commit':COMMIT,
            'retrieved_on':'2026-11-25','license':'原始来源/LICENSE_CalendarBench.txt',
            'files':[{'local_path':'原始来源/'+name,'source_path':remote,
                      'sha256':hashlib.sha256((ROOT/'原始来源'/name).read_bytes()).hexdigest()}
                     for name,remote in SOURCE_MAP.items()],
            'excerpts':[{k:v for k,v in e.items() if k!='text'} for e in extracts]}
write_json(ROOT/'来源清单.json',manifest)

# The following concrete task content and all numeric scene settings are our adaptations.
# Each row: title, deliverable, minutes, priority, source activity reference.
families = [
 ('S1','课程学习日','围绕一门自己熟悉的课程安排当天学习；各项材料独立提供，没有前后依赖。',[
  ('阅读课程章节','阅读指定章节，记录 5 个关键概念及简短解释。',45,'中','study_reading'),
  ('完成课程练习','完成一组已学内容的练习题，并标记尚不确定的题目。',60,'高','self-study'),
  ('观看课程录像','观看一段可暂停的课程录像，记录 3 个不理解的问题。',45,'中','lecture'),
  ('撰写短作业','依据单独提供的材料撰写约 500 字课程分析。',60,'高','self-study'),
  ('整理复习卡片','将之前已学的概念整理成 10 张问答卡片。',30,'低','self-study')]),
 ('S2','考前复习日','为一门已学课程复习；题组、错题和笔记均提前提供，各项独立。',[
  ('阅读复习笔记','阅读指定笔记并列出 5 个仍不熟悉的知识点。',45,'中','study_reading'),
  ('完成模拟题组','完成一组模拟练习题，记录不确定的答案；不是固定考试。',60,'高','quiz'),
  ('复习历史错题','重做 3 道之前的错题，并分别写下错误原因。',45,'中','self-study'),
  ('进行专题练习','完成另一个专题的练习，并核对独立提供的参考答案。',60,'高','self-study'),
  ('进行概念自测','根据既有知识清单自测，并标记后续需要复习的概念。',30,'低','quiz')]),
 ('S3','课程报告准备日','为课程报告做准备；文献、数据、提纲均已提供，各项可独立开展。',[
  ('阅读参考文献','阅读一篇参考材料，摘记 3 个与报告主题有关的论点。',45,'中','study_reading'),
  ('分析已给数据','用熟悉的工具整理已给的小型数据表，并制作一张描述图。',60,'高','self-study'),
  ('观看方法讲解','观看一段可暂停的方法讲解，记录关键步骤和疑问。',45,'中','lecture'),
  ('撰写讨论段落','依据已给结果和提纲写出约 500 字讨论，不依赖当天其他任务。',60,'高','self-study'),
  ('整理引用条目','整理已提供的参考文献条目并检查引用格式。',30,'低','self-study')]),
]

def minute(s):
    h,m=map(int,s.split(':')); return h*60+m

def clock(m):
    return f'{m//60:02}:{m%60:02}'

def intervals(scene):
    blocked=[(minute(x['start']),minute(x['end'])) for x in scene['reserved_periods']]
    result=[]
    for w in scene['available_windows']:
        parts=[(minute(w['start']),minute(w['end']))]
        for lo,hi in blocked:
            updated=[]
            for a,b in parts:
                if hi<=a or lo>=b: updated.append((a,b)); continue
                if a<lo: updated.append((a,lo))
                if hi<b: updated.append((hi,b))
            parts=updated
        result.extend(parts)
    return result

def check(scene):
    windows=intervals(scene)
    examples=[]; feasible_orders=0
    for perm in itertools.permutations(scene['tasks']):
        cursor=minute('09:00'); schedule=[]
        for t in perm:
            placed=False
            for a,b in windows:
                start=max(a,cursor,minute(t['earliest_start']))
                end=start+t['estimated_minutes']
                if end<=b and end<=minute(t['deadline']):
                    schedule.append({'task_id':t['task_id'],'start':clock(start),'end':clock(end)})
                    cursor=end; placed=True; break
            if not placed: break
        if len(schedule)==len(scene['tasks']):
            feasible_orders+=1
            if len(examples)<3: examples.append(schedule)
    assert feasible_orders>1,scene['scenario_id']
    # Independently validate the saved witnesses, not just the search's return value.
    by_id={x['task_id']:x for x in scene['tasks']}
    for schedule in examples:
        assert set(x['task_id'] for x in schedule)==set(by_id)
        for i,item in enumerate(schedule):
            t=by_id[item['task_id']]; a=minute(item['start']);b=minute(item['end'])
            assert b-a==t['estimated_minutes']
            assert a>=minute(t['earliest_start']) and b<=minute(t['deadline'])
            assert any(a>=lo and b<=hi for lo,hi in windows)
            if i: assert a>=minute(schedule[i-1]['end'])
    work=sum(x['estimated_minutes'] for x in scene['tasks'])
    net=sum(b-a for a,b in windows)
    return {'scenario_id':scene['scenario_id'],'task_count':len(scene['tasks']),
            'work_minutes':work,'net_available_minutes':net,'spare_minutes':net-work,
            'workload_ratio':round(work/net,4),'feasible_non_split_orders':feasible_orders,
            'orders_tested':120,'example_feasible_schedules':examples,
            'interpretation':'仅验证不拆分、各排列尽早放置时存在可行解；不是所有可行日程计数，不是最佳或个性化结果。'}

scenes=[]; checks=[]
for fid,title,context,rows in families:
    for code,label,end in [('L','宽松','17:00'),('T','紧张','15:00')]:
        sid=f'{fid}-{code}'
        tasks=[]
        for i,(name,deliverable,duration,priority,activity) in enumerate(rows,1):
            tasks.append({'task_id':f'{fid}-{i:02}','title':name,'deliverable':deliverable,
                'estimated_minutes':duration,'priority':priority,'earliest_start':'09:00',
                'deadline':('12:00' if code=='T' and i<=2 else end),
                'splittable':True,'minimum_chunk_minutes':15,'depends_on':[],
                'perceived_difficulty':None,'source_activity':activity,
                'source_excerpt_ids':['E03'] if activity=='study_reading' else ['E02'],
                'provenance':'活动类别受 CalendarBench 启发；具体任务、交付物及所有数值和规则为研究者改编。'})
        scene={'scenario_id':sid,'family_id':fid,'title':title,'constraint_condition':label,
               'material_type':'researcher_adapted_stimulus','pilot_status':'未预试',
               'context':context,'timezone':'Asia/Shanghai','day':'假设同一个工作日，不绑定实际日期',
               'available_windows':[{'start':'09:00','end':'12:00'},{'start':'13:00','end':end}],
               'reserved_periods':[{'start':'10:30','end':'10:45','label':'固定休息'},
                                   {'start':'12:00','end':'13:00','label':'午休，不可用'},
                                   {'start':'14:00','end':'14:15','label':'固定休息'}],
               'tasks':tasks,'rules':[
                 '仅在可用时间内排程；固定休息和午休不可安排任务；截止表示必须完成的最晚时间。',
                 '五项均需完成；优先级用于冲突取舍，不代表必须按高到低排序。',
                 '预计用时包括所列交付物；本轮先作为排程评价材料，并未要求实际完成所有学习内容。',
                 '每项可拆分，最小工作块 15 分钟；一次只安排一项任务；无跨任务先后依赖。',
                 '参与者报告感知难度及 Profile；不预填个人状态、不预设最优顺序。',
                 '录像可暂停；模拟题组是自练任务，非不可移动的正式考试。'],
               'source_commit':COMMIT,
               'provenance':'参考 CalendarBench 活动类别后编写；不是原数据集导出的独立日程，不含真实参与者记录。'}
        result=check(scene); scenes.append(scene);checks.append(result)
        write_json(ROOT/'改编场景'/f'{sid}.json',scene)
        lines=[f'# {sid}｜{title}｜{label}', '',
               '**研究者改编的实验刺激材料，尚未预试。不是 CalendarBench 原始日程或参与者数据。**','',context,'',
               f'可用时间：09:00–12:00、13:00–{end}。固定休息：10:30–10:45、14:00–14:15；午休：12:00–13:00。',
               f"净可用时间 {result['net_available_minutes']} 分钟；任务共 {result['work_minutes']} 分钟；余量 {result['spare_minutes']} 分钟。",'',
               '|任务|具体内容与交付物|预计时长|优先级|最早开始|截止时间|',
               '|---|---|---:|---|---|---|']
        for t in tasks:
            lines.append(f"|{t['title']}|{t['deliverable']}|{t['estimated_minutes']} 分钟|{t['priority']}|{t['earliest_start']}|{t['deadline']}|")
        lines+=['','## 共同规则','']+['- '+r for r in scene['rules']]
        lines+=['','## 来源与待确认项','',scene['provenance'],
                '学习任务名称和数值不是原仓库给定内容。文献支持活动分类，并不验证本素材的时长或难度。',
                '预试前需要选定课程与具体题目／阅读材料，并由目标学生核对预计用时。固定休息用于统一最低休息条件，会限制对休息时间偏好的检验。',
                '同一组两版只改变可用时间及前两项任务截止时间，不能分别归因于两种约束；两者共同代表约束强度。']
        (ROOT/'改编场景'/f'{sid}.md').write_text('\n'.join(lines)+'\n')

# Assert matched-pair invariants before exporting the combined materials.
for a,b in zip(scenes[::2],scenes[1::2]):
    for ta,tb in zip(a['tasks'],b['tasks']):
        assert {k:v for k,v in ta.items() if k!='deadline'}=={k:v for k,v in tb.items() if k!='deadline'}
    assert a['reserved_periods']==b['reserved_periods']
write_json(ROOT/'六份候选场景.json',{'format':'HumanOS_learning_stimuli_v1',
    'not_participant_data':True,'not_production_import_format':True,'scenarios':scenes})
write_json(ROOT/'校验'/'可行性检查.json',checks)
with (ROOT/'任务总表.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.writer(f);writer.writerow(['场景编号','组别','约束','任务编号','任务','内容','分钟','优先级','开始下限','完成截止','可拆分','最小块分钟','来源类别','性质'])
    for s in scenes:
        for t in s['tasks']:
            writer.writerow([s['scenario_id'],s['title'],s['constraint_condition'],t['task_id'],t['title'],t['deliverable'],t['estimated_minutes'],t['priority'],t['earliest_start'],t['deadline'],'是',15,t['source_activity'],'研究者改编'])

overview=['# CalendarBench 学习素材包 v1','',
 '本包有 **8 份原文配置摘录**，以及 **3 组 × 宽松／紧张 = 6 份研究者改编的单日学习场景**。',
 '8 份摘录不是 8 个独立任务样本；6 份场景不是从原数据集抽到的已生成日程。具体任务内容和所有数值均在来源说明中区分。','',
 '## 从哪里看','',
 '- `素材总览.html`：直接打开浏览原文卡片与六份任务表。',
 '- `原文摘录/`：原样截取 YAML，行号与链接见 `来源清单.json`。',
 '- `原始来源/`：固定提交的完整配置快照与原 MIT 许可证。完整学生模板仅用于核对上下文，其人格、情绪等合成设定没有导入场景。',
 '- `改编场景/`：每份各有 Markdown 与 JSON。JSON 是研究材料格式，不是现有服务器的一键导入格式。',
 '- `任务总表.csv`、`六份候选场景.json`：合并材料；CSV 共 30 行，配对重复属于设计，不是 30 个独立任务。',
 '- `校验/可行性检查.json`：约束核查及研究者参考可行安排。不要将这些安排作为推荐答案展示给参与者。',
 '- `整理与校验.py`：无需第三方依赖，可从本包的来源快照重建并核查。','',
 '## 六份候选素材','',
 '|编号|场景|约束|任务数|任务分钟|净可用分钟|余量|',
 '|---|---|---|---:|---:|---:|---:|']
for s,c in zip(scenes,checks):
    overview.append(f"|[{s['scenario_id']}](改编场景/{s['scenario_id']}.md)|{s['title']}|{s['constraint_condition']}|5|240|{c['net_available_minutes']}|{c['spare_minutes']}|")
overview+=['','## 原文摘录索引','']
for e in extracts:
    overview+= [f"- **{e['id']} {e['title']}**：[原文]({e['url']})。{e['interpretation']}"]
overview+=['','## 如何选用','',
 '建议先看 S1 课程学习日的一对；S2、S3 是语义不同的备选，不要求每位参与者全部评价。三组时间结构有意保持相同，不能当作三种独立约束强度。',
 '宽松／紧张同时改变可用时间和部分截止时间。本设计只比较总体约束强度，不能单独判断是哪一种约束造成差异。紧张程度的主观操纵检查仍未完成。',
 '同一学习任务清单重复出现可能有熟悉效应，正式实验需处理呈现顺序；是否使用同任务配对或匹配的不同内容，需要和整体实验设计一起确定。',
 '当前只写清交付物，不提供可直接考试的学科题目或教材。选定课程后，必须补齐具体学习材料并验证估时。Profile 和感知难度由参与者提供。',
 '固定午休和两次短休息用于统一最低休息条件；如研究重点包含自由休息偏好，应另行调整这条共同规则并重新检查可行性。',
 '优先级、15 分钟拆分粒度、所有具体任务时长和窗口是本项目设计值，不是原论文验证过的标准；未按 HumanOS 得分或优势筛选。',
 '', '## 校验范围','',
 '逐组检查配对任务内容、时长、优先级和共同规则一致；检查全部 120 种任务排列在不拆分且尽早放置规则下的可行性；独立复核每份保存的三个可行安排。存在多个可行顺序不等于证明个人偏好能被满足。',
 '未运行 CalendarBench 生成器、未调用 LLM、未测量 HumanOS 效果、未采集参与者数据。',
 '', '## 来源', '', f'CalendarBench 仓库：https://github.com/MaaniBeigy/calendar-bench；提交 `{COMMIT}`。',
 '本包的原文配置来自开放仓库，保留原 MIT 许可证。该许可声明不自动覆盖外部本体或其他数据源。']
(ROOT/'README.md').write_text('\n'.join(overview)+'\n')

esc=html.escape
parts=['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CalendarBench 学习素材包</title>',
'''<style>body{margin:0;background:#f5f7fa;color:#172337;font:16px/1.7 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:36px 22px}h1{font-size:30px}h2{margin-top:36px}a{color:#2354aa}nav{display:flex;gap:14px;flex-wrap:wrap}section,.card{background:white;padding:24px;border:1px solid #d9e0ea;border-radius:12px;margin:20px 0}.note{border-left:4px solid #c58a28;padding:14px 20px;background:#fff5e3}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:690px}td,th{text-align:left;padding:10px;border-bottom:1px solid #dce3ed}th{background:#edf3fc}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:16px;font-size:13px}.meta{color:#53637a}.tag{display:inline-block;background:#e9f1ff;color:#234883;border-radius:6px;padding:3px 9px;font-size:14px}summary{cursor:pointer;font-weight:600}li{margin:7px 0}@media print{body{background:white}section{break-inside:auto}nav{display:none}main{padding:0}table{min-width:0}td,th{padding:6px}a{color:inherit}}</style></head><body><main>''',
 '<h1>CalendarBench 学习素材包</h1><p>8 份原文配置摘录 · 3 组学习内容 · 6 份单日候选场景</p>',
 '<p class="note">原文摘录是活动类别、时长范围和学生模板；下方六份具体任务表为研究者改编，尚未预试，不是原数据集的六条真实记录。</p>',
 '<nav><a href="#extracts">原始素材</a><a href="#scenes">六份任务表</a><a href="#checks">可行性检查</a><a href="任务总表.csv">下载 CSV</a><a href="六份候选场景.json">查看 JSON</a><a href="README.md">完整说明</a></nav>',
 '<h2 id="extracts">抽取的原始素材</h2><p>这是同一框架中的不同配置片段，不能当作八个独立学习样本。人物覆盖参数与活动目录的通用参数需一起阅读。</p>']
for e in extracts:
    parts.append(f'<details class="card"><summary>{esc(e["id"]+" · "+e["title"])}</summary><p>{esc(e["interpretation"])}</p><a href="{esc(e["url"],quote=True)}">查看固定版本原文与行号</a><pre>{esc(e["text"])}</pre></details>')
parts+=['<h2 id="scenes">六份候选场景</h2><p>建议先选 S1 的一对。S2、S3 是备选内容；每组任务工作量相同，仅配对的可用时间和部分截止时间改变。</p>']
for s,c in zip(scenes,checks):
    parts.append(f'<section id="{s["scenario_id"]}"><span class="tag">研究者改编 · 未预试</span><h2>{s["scenario_id"]} · {s["title"]} · {s["constraint_condition"]}</h2><p>{esc(s["context"])}</p>')
    parts.append(f'<p><b>可用时间：</b>09:00–12:00、13:00–{s["available_windows"][1]["end"]}。<br><b>固定休息：</b>10:30–10:45、14:00–14:15；午休 12:00–13:00。</p><p class="meta">任务 240 分钟 / 净可用 {c["net_available_minutes"]} 分钟 / 余量 {c["spare_minutes"]} 分钟</p>')
    parts.append('<div class="scroll"><table><thead><tr><th>任务</th><th>内容与交付物</th><th>分钟</th><th>优先级</th><th>最早开始</th><th>截止</th></tr></thead><tbody>')
    for t in s['tasks']:
        parts.append('<tr>'+''.join(f'<td>{esc(str(v))}</td>' for v in [t['title'],t['deliverable'],t['estimated_minutes'],t['priority'],t['earliest_start'],t['deadline']])+'</tr>')
    parts.append('</tbody></table></div><ul>'+''.join('<li>'+esc(r)+'</li>' for r in s['rules'])+'</ul>')
    parts.append(f'<p><a href="改编场景/{s["scenario_id"]}.md">独立素材说明</a> · <a href="改编场景/{s["scenario_id"]}.json">独立 JSON</a></p></section>')
parts+=['<h2 id="checks">可行性与使用边界</h2><div class="scroll"><table><tr><th>场景</th><th>检查排列数</th><th>找到的可行顺序数</th><th>结果</th></tr>']
for c in checks:
    parts.append(f'<tr><td>{c["scenario_id"]}</td><td>120</td><td>{c["feasible_non_split_orders"]}</td><td>存在多个可行顺序</td></tr>')
parts+=['</table></div><p>计数只针对不拆分、按排列尽早放置的检查；不是全部日程数，也不是个性化质量得分。具体可行安排保留在校验文件中，不作为参与者答案展示。</p>',
 '<p>具体课程材料、实际用时及感知难度尚待预试。固定休息会限制休息偏好的表现空间；同时改变截止和可用时间只能解释整体约束强度。所有具体参数均为本项目设定，不由原文验证。</p>',
 '<p><a href="校验/可行性检查.json">查看研究者校验文件</a> · <a href="来源清单.json">来源清单</a> · <a href="原始来源/LICENSE_CalendarBench.txt">原始代码许可证</a></p>',
 f'<p class="meta">来源：CalendarBench · 提交 {COMMIT} · 整理日期 2026-11-25。未运行生成器或调用模型，未产生实验效果数据。</p></main></body></html>']
(ROOT/'素材总览.html').write_text('\n'.join(parts))
print(json.dumps({'excerpts':len(extracts),'scenarios':len(scenes),
                  'checks':[{k:v for k,v in c.items() if k not in ['example_feasible_schedules','interpretation']} for c in checks]},ensure_ascii=False,indent=2))
