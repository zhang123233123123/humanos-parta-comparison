"""Simulation routes require a signed proxy identity, not a browser user_id."""
import json
import os
from pydantic import ValidationError
from ...application.simulation.service import SimulationError
from ...infrastructure.simulation_runtime import get_service, verify_actor


def simulation(request, store, runtime, method, path, query):
    enabled=os.environ.get('HUMANOS_SIMULATION_MODE')=='1'
    if not path.startswith('/api/simulation'):
        if enabled and path not in ('/api/health','/api/auth/login','/api/auth/register'):
            request.send_json({'error':'simulation_only','message':'模拟实例仅提供模拟工作流'},status=404)
            return True
        return False
    if not enabled:
        request.send_json({'error':'not_found'},status=404);return True
    try:
        size=int(request.headers.get('Content-Length','0'))
        if size<0 or size>512000:raise SimulationError('请求过大',413)
        raw=request.rfile.read(size) if size else b''
        actor=verify_actor(request.headers,method,request.path,raw,os.environ.get('HUMANOS_SIMULATION_PROXY_SECRET',''))
        user=store.user_row(actor)
        if not user or user['id']!=actor:raise SimulationError('模拟账号不存在',401)
        parts=path.split('/')[3:]
        if not parts:raise KeyError(path)
        service=get_service(store)
        if method=='GET':result=service.get(actor,parts,query)
        elif method in ('POST','PATCH'):
            result=service.mutate(actor,method,parts,json.loads(raw or b'{}'))
        else:raise SimulationError('不支持此方法',405)
        status=202 if method=='POST' and result.get('pending_job_id') else 200
        request.send_json({'data':result,'meta':{'revision':result.get('revision')}},status=status)
    except SimulationError as exc:
        request.send_json({'error':'simulation_error','message':str(exc)},status=exc.status)
    except ValidationError as exc:
        message='；'.join(e['msg'].removeprefix('Value error, ') for e in exc.errors(include_url=False,include_input=False))
        request.send_json({'error':'invalid_simulation_input','message':message},status=400)
    except (ValueError, TypeError) as exc:
        request.send_json({'error':'invalid_simulation_input','message':str(exc)},status=400)
    except KeyError:
        request.send_json({'error':'not_found','message':'资源或必需字段不存在'},status=404)
    return True
