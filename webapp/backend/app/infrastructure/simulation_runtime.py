"""Opt-in isolation and authenticated same-origin proxy boundary."""
import hashlib
import hmac
import os
import sqlite3
import threading
import time
import re
from pathlib import Path
from contextlib import closing
from ..application.simulation.service import SimulationService, SimulationError


def validate_simulation_settings(root, database, environment):
    if environment.get('HUMANOS_SIMULATION_MODE')!='1':return
    explicit=environment.get('HUMANOS_DB_PATH','')
    p=Path(explicit).expanduser().resolve() if explicit else None
    if not p or p!=database.resolve() or 'simulation' not in p.name.lower() or p==(root/'data/humanos.db').resolve() or any(x in str(p).lower() for x in ['backup','备份','simplified']):
        raise ValueError('模拟模式需要显式独立HUMANOS_DB_PATH（文件名含simulation），不能使用正式库或备份库')
    if len(environment.get('HUMANOS_SIMULATION_PROXY_SECRET',''))<32:
        raise ValueError('模拟模式需要至少32字符的HUMANOS_SIMULATION_PROXY_SECRET')
    if p.exists():
        with closing(sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)) as db:
            names={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if names and 'sim_instance' not in names:raise ValueError('数据库不是已登记的模拟实例，拒绝打开')
    p.parent.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(p)) as db:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS sim_instance(version INTEGER NOT NULL)')
            if not db.execute('SELECT 1 FROM sim_instance').fetchone():db.execute('INSERT INTO sim_instance VALUES(1)')


def verify_actor(headers, method, path, raw, secret):
    actor=headers.get('X-Simulation-Actor','')
    timestamp=headers.get('X-Simulation-Time','')
    signature=headers.get('X-Simulation-Signature','')
    try:
        valid=abs(time.time()-int(timestamp))<=60 and bool(actor) and len(actor)<=128
    except ValueError:valid=False
    text='\n'.join([timestamp,actor,method,path,hashlib.sha256(raw).hexdigest()])
    expected=hmac.new(secret.encode(),text.encode(),hashlib.sha256).hexdigest()
    if not valid or not hmac.compare_digest(signature,expected):raise SimulationError('代理身份校验失败',401)
    return actor


_service=None
_lock=threading.Lock()


def get_service(store):
    global _service
    with _lock:
        if _service is None:
            from .json_chat import complete_json
            import json
            env=dict(os.environ)
            def complete(messages):
                if not env.get('DEEPSEEK_API_KEY','').strip():raise ValueError('模拟模型API尚未配置')
                failures=[]
                result=complete_json(messages,environment=env,
                    api_url=env.get('DEEPSEEK_BASE_URL','https://api.deepseek.com').rstrip('/')+'/chat/completions',
                    encode=lambda x:json.dumps(x,ensure_ascii=False),report=failures.append)
                if result is None:
                    # Preserve actionable diagnostics without persisting provider bodies or credentials.
                    match=re.search(r'HTTP Error (\d{3})',failures[-1] if failures else '')
                    status='HTTP '+match.group(1) if match else '连接、超时或响应格式错误'
                    raise ValueError('模型调用失败（'+status+'），请检查模型服务配置后重试')
                return result
            _service=SimulationService(store.path,
                researchers=[s.strip() for s in env.get('HUMANOS_SIMULATION_RESEARCHERS','').split(',') if s.strip()],
                complete=complete,
                model=env.get('DEEPSEEK_MODEL','deepseek-chat'),user_exists=lambda user: bool((row:=store.user_row(user)) and row['id']==user))
        return _service
