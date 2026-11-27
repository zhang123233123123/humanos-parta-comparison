"""Research-only same-origin signed proxy API."""
import json
import os
from ...application.part_a.planning import PartAError
from ...application.simulation.service import SimulationError
from ...infrastructure.simulation_runtime import verify_actor
from ...infrastructure.part_a_runtime import get_service


def part_a(request, store, runtime, method, path, query):
    if path != '/api/part-a' and not path.startswith('/api/part-a/'):
        return False
    try:
        if os.environ.get('HUMANOS_PARTA_MODE') != '1':
            raise PartAError('Part A 内部工具未启用', 404)
        secret = os.environ.get('HUMANOS_PARTA_PROXY_SECRET', '')
        if len(secret) < 32:
            raise PartAError('Part A 身份代理未配置', 503)
        size = int(request.headers.get('Content-Length', '0'))
        if not 0 <= size <= 512000:
            raise PartAError('请求过大', 413)
        raw = request.rfile.read(size) if size else b''
        actor = verify_actor(request.headers, method, request.path, raw, secret)
        link_actor = os.environ.get('HUMANOS_PARTA_LINK_ACTOR', '')
        if not (link_actor.startswith('parta_link_') and actor == link_actor):
            user = store.user_row(actor)
            if not user or user['id'] != actor:
                raise PartAError('账号不存在', 401)
            researchers = {s.strip() for s in os.environ.get('HUMANOS_PARTA_RESEARCHERS', '').split(',') if s.strip()}
            if actor not in researchers:
                raise PartAError('此账号没有 Part A 研究者权限', 403)
        if method not in ('GET', 'POST'):
            raise PartAError('不支持此方法', 405)
        payload = json.loads(raw or b'{}')
        if not isinstance(payload, dict):
            raise PartAError('请求必须是 JSON 对象')
        service = get_service()
        status = 200
        if method == 'GET' and path == '/api/part-a/catalog':
            result = service.catalog()
        elif method == 'POST' and path == '/api/part-a/preview':
            result = service.preview(payload)
        elif method == 'POST' and path == '/api/part-a/runs':
            if not os.environ.get('DEEPSEEK_API_KEY', '').strip():
                raise PartAError('后端尚未配置模型密钥', 503)
            result = service.start(actor, payload)
            status = 202
        elif method == 'GET' and path == '/api/part-a/runs':
            result = service.list(actor)
        elif method == 'GET' and path.startswith('/api/part-a/runs/'):
            result = service.get(actor, path.rsplit('/', 1)[-1])
        else:
            raise PartAError('接口不存在', 404)
        request.send_json({'data': result}, status=status)
    except (PartAError, SimulationError) as exc:
        request.send_json({'error': 'part_a_error', 'message': str(exc)}, status=exc.status)
    except (ValueError, TypeError):
        request.send_json({'error': 'invalid_input', 'message': '请求格式无效'}, status=400)
    return True
