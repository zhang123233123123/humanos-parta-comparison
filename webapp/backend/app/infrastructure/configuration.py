"""Explicit configuration parsing; no environment or file reads on import."""
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


def apply_env_text(text: str, environment: MutableMapping[str, str]) -> None:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in environment:
            environment[key] = value


def load_local_env(root: Path, environment: MutableMapping[str, str]) -> None:
    path = root / ".env"
    if path.exists():
        apply_env_text(path.read_text(encoding="utf-8"), environment)


def database_path(root: Path, environment: Mapping[str, str]) -> Path:
    configured = environment.get("HUMANOS_DB_PATH", "").strip()
    return Path(configured) if configured else root / "data" / "humanos.db"


@dataclass(frozen=True)
class RuntimeConfig:
    test_mode: bool
    qa_mode: bool
    qa_scenario_dir: Path
    test_clock_base: datetime
    test_clock_scale: float

    @classmethod
    def from_environment(cls, root: Path, environment: Mapping[str, str]):
        test_mode = environment.get("HUMANOS_TEST_MODE", "").strip() == "1"
        return cls(
            test_mode=test_mode,
            qa_mode=test_mode and environment.get("HUMANOS_QA_DB", "").strip() == "1",
            qa_scenario_dir=Path(environment.get("HUMANOS_QA_SCENARIO_DIR", "").strip()
                                 or root.parent / "qa-local" / "scenarios"),
            test_clock_base=datetime.fromisoformat(
                environment.get("HUMANOS_TEST_NOW", "2026-08-03T08:45:00+08:00")),
            test_clock_scale=float(environment.get("HUMANOS_TEST_TIME_SCALE", "0") or 0),
        )
