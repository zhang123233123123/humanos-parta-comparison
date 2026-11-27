"""Embedding configuration and providers, independent of HTTP and persistence."""
import hashlib
import json
import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from urllib.request import Request, urlopen

LOCAL_MODEL = "humanos-local-hash-embedding-v1"
VECTOR_DIMS = 64


@dataclass(frozen=True)
class EmbeddingConfig:
    api_key: str = field(repr=False)
    base_url: str
    url: str
    model: str
    local_model: str = LOCAL_MODEL
    timeout_seconds: float = 15

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]):
        key = (environment.get("AI_EMBEDDING_API_KEY", "").strip()
               or environment.get("DASHSCOPE_API_KEY", "").strip())
        base = environment.get("AI_EMBEDDING_BASE_URL",
                               "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
        timeout = float(environment.get('AI_EMBEDDING_TIMEOUT_SECONDS', '15'))
        if not math.isfinite(timeout) or not 0 < timeout <= 300:
            raise ValueError('AI_EMBEDDING_TIMEOUT_SECONDS must be between 0 and 300')
        return cls(key, base, f"{base}/embeddings" if key else "",
                   environment.get("AI_EMBEDDING_MODEL", "text-embedding-v2").strip(), timeout_seconds=timeout)


def tokenize(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]", text.lower()) or ["empty"]


def local_embed_text(text: str, dimensions: int = VECTOR_DIMS) -> list[float]:
    vec = [0.0] * dimensions
    for token in tokenize(text):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:2], "big") % dimensions
        sign = 1.0 if digest[2] % 2 == 0 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def embedding_for_text(
    text: str, *, config: EmbeddingConfig, encode: Callable,
    open_url: Callable = urlopen, local_embed: Callable = local_embed_text,
    report: Callable = print,
) -> tuple[list[float], str]:
    if config.url:
        try:
            request = Request(config.url,
                data=encode({"model": config.model, "input": text}).encode("utf-8"),
                headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
                method="POST")
            with open_url(request, timeout=config.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
            vector = [float(value) for value in payload["data"][0]["embedding"]]
            if not vector or not all(math.isfinite(value) for value in vector):
                raise ValueError('Invalid embedding vector')
            norm = math.sqrt(sum(value * value for value in vector))
            if not math.isfinite(norm) or not norm:
                raise ValueError('Invalid embedding norm')
            return [value / norm for value in vector], config.model
        except Exception as exc:
            report(f"Embedding unavailable; using local fallback ({type(exc).__name__})")
    return local_embed(text), config.local_model
