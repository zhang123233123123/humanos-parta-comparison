"""Legacy JSON completion transport, independent of application orchestration."""
import json
import math
from collections.abc import Callable, Mapping
from urllib.request import Request, urlopen


def complete_json(messages: list[dict], temperature: float = 0.2, *,
                  environment: Mapping[str, str], api_url: str, encode: Callable,
                  open_url: Callable = urlopen, report: Callable = print) -> object | None:
    api_key = environment.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return None
    payload = {
        "model": environment.get("DEEPSEEK_MODEL", "deepseek-chat"),
        "messages": messages, "temperature": temperature,
        "response_format": {"type": "json_object"},
        "thinking": {"type": "disabled"},
    }
    request = Request(api_url, data=encode(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST")
    try:
        timeout = float(environment.get("DEEPSEEK_TIMEOUT_SECONDS", "20"))
        if not math.isfinite(timeout) or not 0 < timeout <= 300:
            raise ValueError("DEEPSEEK_TIMEOUT_SECONDS must be between 0 and 300 seconds")
        with open_url(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
        data = json.loads(raw)
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as exc:
        report(f"DeepSeek unavailable: {type(exc).__name__}: {exc}")
        return None
