"""Use the existing JSON transport, capturing only the safe request body."""
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import threading
from urllib.request import urlopen
from urllib.error import HTTPError

from ..application.part_a.service import PartAService
from .json_chat import complete_json


def completion(environment, open_url=urlopen):
    env = dict(environment)
    def call(messages):
        record = {}
        def capture(request, timeout):
            record['request'] = json.loads(request.data)
            try:
                with open_url(request, timeout=timeout) as response:
                    raw = response.read()
            except HTTPError as exc:
                record['error'] = f'模型接口返回 HTTP {exc.code}，请检查网关配置与额度。'
                raise
            except Exception:
                record['error'] = '模型连接失败或超时；没有切换模型或生成替代计划。'
                raise
            try:
                data = json.loads(raw)
                record['raw_content'] = data['choices'][0]['message']['content']
                record['response_model'] = data.get('model')
                record['finish_reason'] = data['choices'][0].get('finish_reason')
                record['usage'] = data.get('usage')
            except (ValueError, KeyError, IndexError, TypeError):
                record['error'] = '模型接口响应缺少有效的 choices/message/content。'
            return io.BytesIO(raw)
        if not env.get('DEEPSEEK_API_KEY', '').strip():
            return {'error': '后端尚未配置模型密钥。'}
        record['output'] = complete_json(deepcopy(messages), environment=env,
            api_url=env.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/')+'/chat/completions',
            encode=lambda x: json.dumps(x, ensure_ascii=False), open_url=capture, report=lambda _: None)
        # Invalid JSON content is a repairable model output, not fabricated success.
        if record['output'] is None and not record.get('error') and 'raw_content' not in record:
            record['error'] = '模型请求失败，请检查接口配置。'
        return record
    return call


_service = None
_lock = threading.Lock()


def get_service():
    global _service
    with _lock:
        if _service is None:
            backend = Path(__file__).resolve().parents[2]
            _service = PartAService(
                os.environ.get('HUMANOS_PARTA_MATERIALS', str(backend.parents[1]/'PartA预实验')),
                backend/'data/parta-pretest.sqlite3',
                os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat'), completion(os.environ))
        return _service
