"""Explicit application and server lifecycle; import has no startup side effects."""
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from http.server import ThreadingHTTPServer
from pathlib import Path
import threading

from .infrastructure import configuration
from .infrastructure.embeddings import EmbeddingConfig


@dataclass(frozen=True)
class StartupSettings:
    database_path: Path
    embedding: EmbeddingConfig
    runtime: configuration.RuntimeConfig


def load_startup_settings(root, environment):
    # Preserve the legacy ordering: DB selection precedes local .env loading.
    # Changing that precedence is a separate configuration contract decision.
    database = configuration.database_path(root, environment)
    configuration.load_local_env(root, environment)
    from .infrastructure.simulation_runtime import validate_simulation_settings
    validate_simulation_settings(root, database, environment)
    embedding = EmbeddingConfig.from_environment(environment)
    runtime = configuration.RuntimeConfig.from_environment(root, environment)
    return StartupSettings(database, embedding, runtime)


def build_health_snapshot(*, environment, database_path, embedding_url, embedding_model,
                          local_embedding_model, test_mode, qa_mode,
                          test_clock_state):
    ai_enabled = bool(environment.get("DEEPSEEK_API_KEY", "").strip())
    return {
        "ok": True, "db": str(database_path),
        "embedding_model": embedding_model if embedding_url else local_embedding_model,
        "ai_enabled": ai_enabled, "ai_provider": "deepseek" if ai_enabled else None,
        "ai_model": environment.get("DEEPSEEK_MODEL", "deepseek-chat") if ai_enabled else None,
        "task_parser": "disabled",
        "scheduling_mode": "constraint_engine_plus_llm" if ai_enabled else "constraint_engine_only",
        "test_mode": test_mode, "qa_mode": qa_mode,
        "simulation_mode": environment.get('HUMANOS_SIMULATION_MODE') == '1',
        "clock": test_clock_state() if test_mode else None,
    }


@dataclass(frozen=True)
class ServerConfig:
    host: str
    port: int

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]):
        return cls(environment.get("HUMANOS_BACKEND_HOST", "127.0.0.1"),
                   int(environment.get("PORT", "8787")))


class ApplicationLifecycle:
    """Create and recover one application explicitly or on first access."""
    def __init__(self, *, create: Callable, recover: Callable):
        self.create = create
        self.recover = recover
        self._application = None
        self._lock = threading.Lock()

    def get(self):
        with self._lock:
            if self._application is None:
                application = self.create()
                self.recover(application)
                self._application = application
            return self._application


def initialize_application(*, initialize_schema: Callable, recover: Callable, resume_jobs: bool):
    """Legacy explicit construction initializes storage before optional recovery."""
    initialize_schema()
    if resume_jobs:
        recover()


def start_job_thread(job_id: str, *, run: Callable, thread_factory: Callable = threading.Thread) -> None:
    thread_factory(target=run, args=(job_id,), daemon=True, name=f"humanos-{job_id}").start()


def serve_http(config: ServerConfig, handler, *, database_path, start_application: Callable,
               server_factory: Callable = ThreadingHTTPServer, report: Callable = print) -> None:
    start_application()
    report(f"HumanOS backend listening on http://{config.host}:{config.port}")
    report(f"SQLite database: {database_path}")
    server = server_factory((config.host, config.port), handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()
