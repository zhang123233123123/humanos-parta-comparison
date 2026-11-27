"""Independent, persistent internal comparisons. No writes to participant calendars."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import sqlite3
import threading
import uuid

from .planning import PartAError, build_preview, encoded, digest, validate_output


def now():
    return datetime.now(timezone.utc).isoformat()


class PartAService:
    def __init__(self, materials, database, model, complete):
        self.materials = Path(materials)
        self.database = Path(database)
        self.model = model
        self.complete = complete
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='part-a')
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS parta_runs (id TEXT PRIMARY KEY, actor TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(actor, request_id))')
            for rid, body in db.execute('SELECT id,body FROM parta_runs').fetchall():
                run = json.loads(body)
                if run['status'] in ('queued', 'running'):
                    run['status'] = 'interrupted'
                    for c in run['results']:
                        if c['status'] in ('queued', 'running'):
                            c['status'] = 'interrupted'
                            c['error'] = '服务重启中断；已有尝试保留，未自动重跑。'
                    db.execute('UPDATE parta_runs SET body=? WHERE id=?', (encoded(run), rid))

    def db(self):
        return closing(sqlite3.connect(self.database, timeout=15))

    def catalog(self):
        try:
            scenarios = [json.loads(p.read_text()) for p in sorted((self.materials/'任务素材/改编场景').glob('*.json'))]
            profiles = json.loads((self.materials/'Profile素材/正式实验18人_首次Profile.json').read_text())
            if not scenarios or not profiles:
                raise ValueError('empty')
        except (OSError, ValueError):
            raise PartAError('Part A 素材不可用，请检查素材目录和首日导出。', 503)
        # Only scheduling-relevant profile fields are sent to the internal UI.
        public_profiles = [{k: p[k] for k in ('participant', 'submitted_at', 'original_profile_fields', 'first_day_context', 'part_a_dimension_mapping')} for p in profiles]
        for p in public_profiles:
            p['original_profile_fields'] = deepcopy(p['original_profile_fields'])
            pp = p['original_profile_fields']['personal_profile']
            for key in list(pp):
                if key not in ('day_energy', 'task_switching_preference'):
                    del pp[key]
        return {'scenarios': scenarios, 'profiles': public_profiles, 'model': self.model,
                'policy': '同一模型，temperature=0.2，每条件最多3次；时间质检不替模型排程。'}

    def preview(self, payload):
        catalog = self.catalog()
        scenario = next((s for s in catalog['scenarios'] if s['scenario_id'] == payload.get('scenario_id')), None)
        profile = next((p for p in catalog['profiles'] if p['participant'] == payload.get('profile_id')), None)
        if not scenario or not profile:
            raise PartAError('请选择存在的任务素材与 Profile')
        return build_preview(scenario, profile, payload, self.model)

    def get(self, actor, rid):
        with self.db() as db:
            row = db.execute('SELECT body FROM parta_runs WHERE id=? AND actor=?', (rid, actor)).fetchone()
        if not row:
            raise PartAError('运行记录不存在或无权查看', 404)
        return json.loads(row[0])

    def list(self, actor):
        with self.db() as db:
            rows = db.execute('SELECT body FROM parta_runs WHERE actor=? ORDER BY created_at DESC LIMIT 100', (actor,)).fetchall()
        return [{k: r[k] for k in ('id', 'created_at', 'status', 'scenario_id', 'profile_id')} for r in map(lambda x: json.loads(x[0]), rows)]

    def start(self, actor, payload):
        request_id = payload.get('request_id', '')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', request_id):
            raise PartAError('request_id 必须为8–80位字母数字或短横线')
        input_hash = digest(payload)
        with self.lock:
            with self.db() as db:
                existing = db.execute('SELECT id,input_hash FROM parta_runs WHERE actor=? AND request_id=?', (actor, request_id)).fetchone()
            if existing:
                if existing[1] != input_hash:
                    raise PartAError('同一 request_id 不可用于不同输入', 409)
                return self.get(actor, existing[0])
            preview = self.preview(payload)
            if payload.get('preview_hash') != preview['preview_hash']:
                raise PartAError('输入或素材已变化，请重新预览提示词', 409)
            if not preview['precheck']['can_attempt']:
                raise PartAError('共同时间预检不通过：'+'；'.join(preview['precheck']['issues']), 422)
            with self.db() as db:
                active = sum(json.loads(x[0])['status'] in ('queued', 'running') for x in db.execute('SELECT body FROM parta_runs'))
            if active >= 2:
                raise PartAError('已有两组比较运行中，请等待完成后再试', 429)
            rid = str(uuid.uuid4())
            run = {'id': rid, 'created_at': now(), 'status': 'running', 'scenario_id': preview['scenario_id'],
                   'profile_id': preview['profile_id'], 'input': deepcopy(payload), 'preview': preview,
                   'results': [{'id': c['id'], 'label': c['label'], 'status': 'queued', 'attempts': []} for c in preview['conditions']]}
            with self.db() as db, db:
                db.execute('INSERT INTO parta_runs VALUES (?,?,?,?,?,?)', (rid, actor, request_id, input_hash, run['created_at'], encoded(run)))
            for c in preview['conditions']:
                self.pool.submit(self.generate, actor, rid, deepcopy(preview), c)
            return run

    def update(self, actor, rid, cid, **changes):
        with self.lock:
            run = self.get(actor, rid)
            c = next(x for x in run['results'] if x['id'] == cid)
            c.update(changes)
            statuses = [x['status'] for x in run['results']]
            if all(s not in ('queued', 'running') for s in statuses):
                run['status'] = 'completed' if all(s == 'valid' for s in statuses) else 'completed_with_errors'
                run['finished_at'] = now()
            with self.db() as db, db:
                db.execute('UPDATE parta_runs SET body=? WHERE id=?', (encoded(run), rid))

    def generate(self, actor, rid, preview, condition):
        messages = deepcopy(condition['messages'])
        attempts = []
        try:
            self.update(actor, rid, condition['id'], status='running')
            for n in range(1, 4):
                attempt = {'number': n, 'started_at': now(), 'messages': deepcopy(messages), 'status': 'calling'}
                attempts.append(attempt)
                self.update(actor, rid, condition['id'], attempts=attempts)
                response = self.complete(messages)
                attempt.update(response)
                attempt['finished_at'] = now()
                if response.get('error'):
                    attempt['status'] = 'error'
                    self.update(actor, rid, condition['id'], status='error', attempts=attempts, error=response['error'])
                    return
                check = validate_output(preview['common'], response.get('output'))
                attempt.update(validation=check, status='valid' if check['valid'] else 'invalid')
                self.update(actor, rid, condition['id'], attempts=attempts)
                if check['valid']:
                    self.update(actor, rid, condition['id'], status='valid', final=check,
                                explanation=response.get('output', {}).get('explanation', ''))
                    return
                raw_content = response.get('raw_content')
                if isinstance(raw_content, str) and raw_content.strip():
                    messages.append({'role': 'assistant', 'content': raw_content})
                messages += [{'role': 'user', 'content': '共同时间质检未通过。保持原任务、全部约束和本条件信息不变，修正后重新输出完整JSON计划。问题：'+encoded(check['violations'])}]
            self.update(actor, rid, condition['id'], status='invalid', attempts=attempts, error='已用完3次生成，时间校验仍未通过。')
        except Exception:
            # Never expose transport credentials or arbitrary exception text to the UI.
            if attempts and attempts[-1]['status'] == 'calling':
                attempts[-1].update(status='error', finished_at=now())
            self.update(actor, rid, condition['id'], status='error', attempts=attempts, error='生成过程发生内部错误，已保留此前尝试，请检查后端。')
