#!/usr/bin/env python3
"""HumanOS compatibility facade and production dependency wiring.

HTTP, application use cases, domain rules and SQLite adapters live under app/.
This module preserves legacy callable names and supplies explicit dependencies.
Importing it does not instantiate a database or start background workers.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
import uuid
from functools import wraps
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

if __package__:
    from .app.infrastructure import configuration
    from .app.infrastructure.json_chat import complete_json
    from .app.bootstrap import ApplicationLifecycle, ServerConfig, serve_http, start_job_thread, load_startup_settings, build_health_snapshot, initialize_application
    # Match the canonical app.* services used by Store so typed application
    # exceptions retain identity when this facade is imported as a package.
    from app.http.handler import HTTPRuntime, HumanOSHTTPHandler
    from .app.infrastructure import embeddings as embedding_provider
    from .app.infrastructure.sqlite_database import SQLiteDatabase
    from .app.infrastructure.application_storage import ApplicationStorage
else:
    from app.infrastructure import configuration
    from app.infrastructure.json_chat import complete_json
    from app.bootstrap import ApplicationLifecycle, ServerConfig, serve_http, start_job_thread, load_startup_settings, build_health_snapshot, initialize_application
    from app.http.handler import HTTPRuntime, HumanOSHTTPHandler
    from app.infrastructure import embeddings as embedding_provider
    from app.infrastructure.sqlite_database import SQLiteDatabase
    from app.infrastructure.application_storage import ApplicationStorage

try:
    from .app.application.chat_replies import interruption_reply, progress_reply, task_preview_reply
    from .app.application.behavior_features import local_behavior_features
    from .app.application.chat_response import apply_existing_task_updates, apply_weekly_context_update, initial_planner_response
    from .app.application.calendar_advisor import advisor_requires_planner_handoff, fallback_calendar_summary, sessions_for_local_date
    from .app.application.classify_chat_intent import classify_chat_intent
    from .app.agents import PydanticAIIntentClassifier
    from .app.domain.intent import classify_intent
    from .app.domain.task.change_policy import exact_task_reference_indexes, has_unique_task_identity, is_explicit_change_request, matching_context_item
    from .app.domain.execution import analyze_remaining_work_impact, settle_interruption
    from .app.domain.planning.ai_outputs import ScheduleComparisonOutput, SchedulePlannerOutput
    from .app.domain.ai_output_models import BehaviorFeatureOutput, CalendarAdvisorOutput, HelpDecideOutput, ParallelCompatibilityOutput, ScheduleSoftReviewOutput, TaskAnalysisOutput
    from .app.infrastructure.typed_chat import generate_typed_json
except ImportError:
    try:
        from app.application.chat_replies import interruption_reply, progress_reply, task_preview_reply
        from app.application.behavior_features import local_behavior_features
        from app.application.chat_response import apply_existing_task_updates, apply_weekly_context_update, initial_planner_response
        from app.application.calendar_advisor import advisor_requires_planner_handoff, fallback_calendar_summary, sessions_for_local_date
        from app.application.classify_chat_intent import classify_chat_intent
        from app.agents import PydanticAIIntentClassifier
        from app.domain.intent import classify_intent
        from app.domain.task.change_policy import exact_task_reference_indexes, has_unique_task_identity, is_explicit_change_request, matching_context_item
        from app.domain.execution import analyze_remaining_work_impact, settle_interruption
        from app.domain.planning.ai_outputs import ScheduleComparisonOutput, SchedulePlannerOutput
        from app.domain.ai_output_models import BehaviorFeatureOutput, CalendarAdvisorOutput, HelpDecideOutput, ParallelCompatibilityOutput, ScheduleSoftReviewOutput, TaskAnalysisOutput
        from app.infrastructure.typed_chat import generate_typed_json
    except ImportError as ai_import_error:
        raise ImportError("AI service dependencies unavailable") from ai_import_error


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
VECTOR_DIMS = 64


def load_local_env() -> None:
    configuration.load_local_env(ROOT, os.environ)


_startup_settings = load_startup_settings(ROOT, os.environ)
DEEPSEEK_API_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/") + "/chat/completions"
DB_PATH = _startup_settings.database_path


_embedding_config = _startup_settings.embedding
DASHSCOPE_API_KEY = _embedding_config.api_key
AI_EMBEDDING_BASE_URL = _embedding_config.base_url
AI_EMBEDDING_URL = _embedding_config.url
AI_EMBEDDING_MODEL = _embedding_config.model
LOCAL_EMBEDDING_MODEL = _embedding_config.local_model


_runtime_config = _startup_settings.runtime
TEST_MODE = _runtime_config.test_mode
QA_MODE = _runtime_config.qa_mode
QA_SCENARIO_DIR = _runtime_config.qa_scenario_dir
from app.infrastructure.shared_clock import SharedClock

_shared_clock = SharedClock(
    base=_runtime_config.test_clock_base, scale=_runtime_config.test_clock_scale,
    enabled=lambda: TEST_MODE, monotonic=lambda: time.monotonic(),
    safe_timezone=lambda value: safe_timezone(value),
    current_week=lambda value: planning_period_id(value),
)


def clock_now(timezone_name: str | ZoneInfo | None = None) -> datetime:
    return _shared_clock.now(timezone_name)


def test_clock_state() -> dict:
    return _shared_clock.state()


def update_test_clock(payload: dict, *, allow_backward: bool = False) -> dict:
    return _shared_clock.update(payload, allow_backward=allow_backward)


def qa_scenario_manifest() -> dict:
    from app.application.qa_scenarios import scenario_manifest
    from app.infrastructure.qa_snapshots import read_manifest
    return scenario_manifest(enabled=QA_MODE, read_manifest=read_manifest,
        directory=QA_SCENARIO_DIR, database_path=DB_PATH)


def restore_qa_scenario(scenario_id: str) -> dict:
    from app.application.qa_scenarios import restore_scenario
    from app.infrastructure.qa_snapshots import restore_database
    return restore_scenario(scenario_id, manifest=qa_scenario_manifest,
        directory=QA_SCENARIO_DIR, database_path=DB_PATH,
        restore_database=restore_database, update_clock=update_test_clock)


def now_ms() -> int:
    return int(clock_now().timestamp() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def tokenize(text: str) -> list[str]:
    return embedding_provider.tokenize(text)


def local_embed_text(text: str) -> list[float]:
    return embedding_provider.local_embed_text(text, dimensions=VECTOR_DIMS)


def embedding_for_text(text: str) -> tuple[list[float], str]:
    config = embedding_provider.EmbeddingConfig(
        DASHSCOPE_API_KEY, AI_EMBEDDING_BASE_URL, AI_EMBEDDING_URL,
        AI_EMBEDDING_MODEL, LOCAL_EMBEDDING_MODEL)
    return embedding_provider.embedding_for_text(
        text, config=config, encode=as_json, open_url=urlopen, local_embed=local_embed_text)


def embed_text(text: str) -> list[float]:
    return embedding_for_text(text)[0]


def cosine(a: list[float], b: list[float]) -> float:
    return embedding_provider.cosine(a, b)


def as_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


from app.application.extraction_prompts import BEHAVIOR_FEATURE_PROMPT_VERSION




def behavior_feature_messages(text: str, chat_context: dict | None = None) -> list[dict]:
    from app.application.extraction_prompts import behavior_feature_messages as build_messages
    return build_messages(text, chat_context, encode=as_json,
        prompt_version=BEHAVIOR_FEATURE_PROMPT_VERSION)


def from_json(value: str | None, fallback: object) -> object:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def infer_duration_minutes(text: str) -> int | None:
    from app.domain.legacy_time_rules import infer_duration_minutes as rule
    return rule(text)


def chat_completion(messages: list[dict], temperature: float = 0.2) -> object | None:
    return complete_json(messages, temperature, environment=os.environ,
        api_url=DEEPSEEK_API_URL, encode=as_json, open_url=urlopen)


def typed_chat_completion(
    messages: list[dict],
    output_model: object,
    label: str,
    temperature: float = 0.2,
) -> dict | None:
    """Compatibility wrapper around the shared typed-output adapter."""
    def report_rejection(rejection_label: str, error: Exception) -> None:
        print(f"Typed AI output rejected ({rejection_label}): {type(error).__name__}: {error}", flush=True)

    return generate_typed_json(
        messages,
        output_model,
        label,
        completion=chat_completion,
        temperature=temperature,
        report_rejection=report_rejection,
    )


def safe_duration_minutes(value: object, fallback: int = 60) -> int:
    from app.domain.legacy_time_rules import safe_duration_minutes as rule
    return rule(value, fallback, infer=infer_duration_minutes)


from app.domain.task.legacy_resources import PARALLEL_RESOURCE_MODALITIES


def normalize_task_identity(value: object) -> str:
    from app.domain.task.legacy_resources import normalize_task_identity as rule
    return rule(value)

def schedule_task_kind(task: dict) -> str:
    from app.domain.task.legacy_resources import schedule_task_kind as rule
    return rule(task)

def normalize_resource_modalities(value: object) -> list[str]:
    from app.domain.task.legacy_resources import normalize_resource_modalities as rule
    return rule(value)

def local_resource_profile(task: dict) -> dict:
    from app.domain.task.legacy_resources import local_resource_profile as rule
    return rule(task, normalize=normalize_resource_modalities)

def parallel_pair_rule(primary: dict, secondary: dict, demand_map: dict[str, dict]) -> tuple[bool, str]:
    from app.domain.task.legacy_resources import parallel_pair_rule as rule
    return rule(primary, secondary, demand_map)

def confirmed_parallel_overlap_allowed(first: dict, second: dict) -> bool:
    from app.domain.task.legacy_resources import confirmed_parallel_overlap_allowed as rule
    return rule(first, second)


def normalize_chinese_clock(value: object) -> str:
    from app.domain.legacy_time_rules import normalize_chinese_clock as rule
    return rule(value)

def parse_clock_hour(value: str, inherited_period: str = "") -> float | None:
    from app.domain.legacy_time_rules import parse_clock_hour as rule
    return rule(value, inherited_period, normalize=normalize_chinese_clock)

def format_clock_hour(hour: float) -> str:
    from app.domain.legacy_time_rules import format_clock_hour as rule
    return rule(hour)

def parse_clock_range(value: str, inherited_period: str = "") -> tuple[float, float] | None:
    from app.domain.legacy_time_rules import parse_clock_range as rule
    return rule(value, inherited_period, normalize=normalize_chinese_clock, parse_hour=parse_clock_hour)

def safe_timezone(name: str | None) -> ZoneInfo:
    from app.domain.legacy_time_rules import safe_timezone as rule
    return rule(name)

def today_label(timezone_name: str | None = None) -> str:
    from app.domain.legacy_time_rules import today_label as rule
    return rule(timezone_name, clock_now=clock_now, timezone=safe_timezone)

def iso_week_id(value: object | None = None, timezone_name: str | None = None) -> str:
    from app.domain.legacy_time_rules import iso_week_id as rule
    return rule(value, timezone_name, clock_now=clock_now, timezone=safe_timezone)

def planning_period_id(value=None, timezone_name=None):
    """Compatibility week_id field now identifies a seven-day period start."""
    if value:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return moment.astimezone(safe_timezone(timezone_name)).date().isoformat() if moment.tzinfo else moment.date().isoformat()
    return today_label(timezone_name)


def session_absolute_times(week_id: str, day_index: int, start: float, end: float, timezone_name: str) -> tuple[str, str]:
    from app.domain.legacy_time_rules import session_absolute_times as rule
    return rule(week_id, day_index, start, end, timezone_name, timezone=safe_timezone)


def transactional(method):
    """Run a Store application operation inside one re-entrant transaction."""
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self.atomic():
            return method(self, *args, **kwargs)
    return wrapped


class Store(ApplicationStorage):
    def __init__(self, path: Path, *, resume_jobs: bool = True) -> None:
        super().__init__(path)
        initialize_application(initialize_schema=self.init_db,
            recover=self.resume_background_jobs, resume_jobs=resume_jobs)

    def task_drafts(self):
        from app.application.task_drafts import TaskDrafts, TaskDraftPorts
        return TaskDrafts(TaskDraftPorts(
            connect=self.connect, atomic=self.atomic, get_task=self.get_task,
            create_task=lambda user, payload: self.create_task(user, payload),
            get_profile=self.get_profile, upsert_profile=self.upsert_profile))

    def require_chat_thread(self, user_id: str, thread_id: str | None) -> str:
        from app.application.chat_threads import require_user_thread
        return require_user_thread(user_id, thread_id, connect=self.connect)

    def list_chat_threads(self, user_id: str) -> dict:
        from app.application.chat_threads import list_threads
        return list_threads(user_id, connect=self.connect)

    def create_chat_thread(self, user_id: str, payload: dict) -> dict:
        from app.application.chat_threads import create_user_thread
        return create_user_thread(user_id, payload, connect=self.connect, now=now_ms)

    def update_chat_thread(self, user_id: str, thread_id: str, payload: dict) -> dict:
        from app.application.chat_threads import update_thread
        return update_thread(user_id, thread_id, payload,
            require=self.require_chat_thread, connect=self.connect, now=now_ms)

    def chat_history_page(self, user_id: str, thread_id: str, limit: int = 30, before: str | None = None) -> dict:
        from app.application.chat_threads import history_page
        return history_page(user_id, thread_id, limit, before,
            require=self.require_chat_thread, connect=self.connect)

    def create_background_job(self, user_id: str, kind: str, payload: dict) -> dict:
        from app.application.manual_task_entry import require_supported_background_intake
        require_supported_background_intake(kind, payload)
        from app.application.background_job_submission import create_job
        return create_job(user_id, kind, payload, atomic=self.atomic,
            require_thread=self.require_chat_thread, get_draft=self.task_drafts().get,
            get_task=self.get_task, get_job=self.get_background_job,
            link_draft=self._link_draft_job, start=self.start_background_job,
            make_id=new_id, now=now_ms, encode=as_json, decode=from_json,
            ensure_profile=self.ensure_profile, current_week=planning_period_id)

    @staticmethod
    def _link_draft_job(conn, job_id, draft_id, user_id):
        from app.repositories.background_jobs import BackgroundJobRepository
        BackgroundJobRepository(conn).link_draft(job_id, draft_id, user_id)

    def request_replan(self, user_id: str, *, scope: str, trigger: str, affected_task_ids: list[str] | None = None, week_id: str | None = None, request_id: str | None = None) -> dict:
        from app.application.plan_revision import request_replan
        return request_replan(user_id, scope=scope, trigger=trigger,
            affected_task_ids=affected_task_ids, week_id=week_id, request_id=request_id,
            ensure_profile=self.ensure_profile, current_week=planning_period_id,
            make_id=new_id, create_job=self.create_background_job)

    def get_background_job(self, user_id: str, job_id: str) -> dict | None:
        from app.application.background_job_queries import get_job
        return get_job(user_id, job_id, connect=self.connect, decode=from_json)

    def start_background_job(self, job_id: str) -> None:
        start_job_thread(job_id, run=self.run_background_job)

    def _background_job_runner(self):
        from app.application.background_jobs import BackgroundJobRunner
        return BackgroundJobRunner(connect=self.connect, now=now_ms,
            execute=self._execute_background_job, finalize=self._finalize_background_job,
            encode=as_json)

    def _execute_background_job(self, job):
        from app.application.background_job_workflow import execute_job
        return execute_job(job, decode=from_json, chat_turn=self.chat_turn,
            list_drafts=self.task_drafts().list, create_task=self.create_task,
            decide_schedule=self.decide_schedule, preview_next_week=self.preview_next_week)

    def _finalize_background_job(self, conn, job, result, finalized_task_ids):
        from app.application.background_job_workflow import finalize_job
        return finalize_job(conn, job, result, finalized_task_ids, decode=from_json, encode=as_json)

    def run_background_job(self, job_id: str) -> None:
        self._background_job_runner().run(job_id)

    def resume_background_jobs(self) -> None:
        self._background_job_runner().resume(self.start_background_job)

    def password_hash(self, password: str, salt: str) -> str:
        return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()

    def public_user(self, row: sqlite3.Row) -> dict:
        from app.application.accounts import public_user
        return public_user(row)

    def user_row(self, identity: str) -> sqlite3.Row | None:
        from app.application.accounts import user_row
        return user_row(identity, connect=self.connect)

    def user_row_by_name(self, name: str) -> sqlite3.Row | None:
        from app.application.accounts import user_row_by_name
        return user_row_by_name(name, connect=self.connect)

    def account_capabilities(self, identity: str) -> dict:
        from app.application.accounts import account_capabilities
        return account_capabilities(identity, find_user=self.user_row)

    def _developer_snapshot_ports(self):
        from app.application.developer_snapshot import DeveloperSnapshotPorts
        return DeveloperSnapshotPorts(
            account_capabilities=self.account_capabilities,
            ensure_profile=self.ensure_profile,
            user_row=self.user_row,
            active_plan=self.active_plan,
            list_tasks=self.list_tasks,
            list_execution_sessions=self.list_execution_sessions,
            connect=self.connect,
            decode=from_json,
            user_clock_now=self.user_clock_now,
            latest_runtime_state=self.latest_runtime_state,
        )

    def developer_snapshot(self, identity: str) -> dict:
        from app.application.developer_snapshot import developer_snapshot
        return developer_snapshot(identity, ports=self._developer_snapshot_ports())

    def _account_clock_ports(self):
        from app.application.account_clock import AccountClockPorts
        return AccountClockPorts(
            user_row=self.user_row,
            safe_timezone=safe_timezone,
            clock_now=clock_now,
            wall_time=time.time,
            user_clock_now=self.user_clock_now,
            current_week=planning_period_id,
            connect=self.connect,
            user_clock_state=self.user_clock_state,
            log_event=self.log_event,
        )

    def user_clock_now(self, identity: str, timezone_name: str | None = None) -> datetime:
        from app.application.account_clock import user_clock_now
        return user_clock_now(identity, timezone_name, ports=self._account_clock_ports())

    def user_clock_state(self, identity: str) -> dict:
        from app.application.account_clock import user_clock_state
        return user_clock_state(identity, ports=self._account_clock_ports())

    def update_user_clock(self, identity: str, payload: dict) -> dict:
        from app.application.account_clock import update_user_clock
        return update_user_clock(identity, payload, ports=self._account_clock_ports())

    def create_user(self, email: str, password: str, name: str = "") -> dict:
        from app.application.accounts import create_user
        return create_user(email, password, name, connect=self.connect, make_id=new_id,
            make_salt=lambda: uuid.uuid4().hex, now=now_ms, hash_password=self.password_hash,
            timezone=lambda: os.environ.get("HUMANOS_DEFAULT_TIMEZONE", "Asia/Shanghai"),
            today=today_label, upsert_profile=self.upsert_profile, log_event=self.log_event,
            project=self.public_user)

    def authenticate_user(self, email: str, password: str) -> dict:
        from app.application.accounts import authenticate_user
        return authenticate_user(email, password, connect=self.connect,
            hash_password=self.password_hash, now=now_ms,
            migrate_identity=self.migrate_legacy_email_identity, ensure_profile=self.ensure_profile,
            log_event=self.log_event, project=self.public_user)

    def migrate_legacy_email_identity(self, email: str, user_id: str) -> bool:
        from app.application.migrate_identity import migrate_identity
        return migrate_identity(email, user_id, connect=self.connect)

    def _profile_ports(self):
        from app.application.base_profile import ProfilePorts
        return ProfilePorts(
            get_profile=self.get_profile,
            default_timezone=lambda: os.environ.get("HUMANOS_DEFAULT_TIMEZONE", "Asia/Shanghai"),
            today=today_label,
            upsert_profile=self.upsert_profile,
            add_memory=self.add_memory,
            connect=self.connect,
            decode=from_json,
            now=now_ms,
            clock_now=clock_now,
            encode=as_json,
            log_event=self.log_event,
            ensure_profile=self.ensure_profile,
        )

    def ensure_profile(self, user_id: str) -> dict:
        from app.application.base_profile import ensure_profile
        return ensure_profile(user_id, ports=self._profile_ports())

    def get_profile(self, user_id: str) -> dict | None:
        from app.application.base_profile import get_profile
        return get_profile(user_id, ports=self._profile_ports())

    def upsert_profile(self, profile: dict) -> dict:
        from app.application.base_profile import upsert_profile
        return upsert_profile(profile, ports=self._profile_ports())

    def infer_task_type(self, title: str, context: str = "") -> str:
        from app.domain.task.legacy_inference import infer_task_type
        return infer_task_type(title, context)

    def infer_schedule_task_type(self, payload: dict) -> str:
        from app.domain.task.legacy_inference import infer_schedule_task_type
        return infer_schedule_task_type(payload)

    def clean_task_title(self, value: object) -> str:
        from app.domain.task.legacy_inference import clean_task_title
        return clean_task_title(value)

    def infer_task_demand(self, payload: dict, task_type: str) -> dict:
        from app.domain.task.legacy_inference import infer_task_demand
        return infer_task_demand(payload, task_type)

    def create_task(self, user_id: str, payload: dict) -> dict:
        from app.application.create_task import create_task
        profile = self.ensure_profile(user_id)
        payload = {**payload, 'week_id': payload.get('week_id') or profile.get('active_week_id') or (profile.get('weekly_context') or {}).get('week_id') or planning_period_id(timezone_name=profile.get('timezone'))}
        return create_task(user_id, payload, clean_title=self.clean_task_title,
            infer_type=self.infer_task_type, infer_schedule_type=self.infer_schedule_task_type,
            infer_demand=self.infer_task_demand, connect=self.connect, project=self.task_row,
            make_id=new_id, current_week=planning_period_id, now=now_ms, encode=as_json,
            add_memory=self.add_memory, log_event=self.log_event, get_task=self.get_task)


    def materialize_parsed_tasks(self, user_id: str, payloads: list[dict], parser: str, create_tasks: bool) -> list[dict]:
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()

    def parse_tasks_from_text(self, user_id: str, text: str, chat_context: dict | None = None, create_tasks: bool = True, *, include_reply: bool = False) -> list[dict] | dict:
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()






    def parse_explicit_schedule_lines(self, user_id: str, text: str, create_tasks: bool = True) -> list[dict]:
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()

    def local_parse_tasks_from_text(self, user_id: str, text: str, create_tasks: bool = True) -> list[dict]:
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()

    def parse_task_from_text(self, user_id: str, text: str) -> dict:
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()

    def extract_behavior_features(self, user_id: str, text: str, chat_context: dict | None = None, local_only: bool = False) -> dict:
        from app.application.behavior_feature_workflow import BehaviorFeaturePorts, extract_behavior_features

        ports = BehaviorFeaturePorts(
            typed_completion=typed_chat_completion,
            messages=behavior_feature_messages,
            prompt_version=BEHAVIOR_FEATURE_PROMPT_VERSION,
            log_event=self.log_event,
        )
        return extract_behavior_features(user_id, text, chat_context, local_only, ports=ports)

    def update_weekly_context_from_chat(self, user_id: str, text: str) -> dict | None:
        from app.application.weekly_chat_context import WeeklyChatContextPorts, update_weekly_context_from_chat

        ports = WeeklyChatContextPorts(
            normalize_chinese_clock=normalize_chinese_clock,
            parse_clock_hour=parse_clock_hour,
            get_profile=self.get_profile,
            ensure_profile=self.ensure_profile,
            parse_clock_range=parse_clock_range,
            clock_now=clock_now,
            format_clock_hour=format_clock_hour,
            upsert_profile=self.upsert_profile,
        )
        return update_weekly_context_from_chat(user_id, text, ports=ports)

    def calendar_advisor_turn(self, user_id: str, text: str, payload: dict) -> dict:
        from app.application.calendar_advisor_workflow import CalendarAdvisorPorts, calendar_advisor_turn

        ports = CalendarAdvisorPorts(
            save_chat_turn=self.save_chat_turn,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            list_tasks=self.list_tasks,
            list_execution_sessions=self.list_execution_sessions,
            active_plan=self.active_plan,
            typed_completion=typed_chat_completion,
            encode=as_json,
            model_name=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        )
        return calendar_advisor_turn(user_id, text, payload, ports=ports)

    def chat_turn(self, user_id: str, payload: dict) -> dict:
        from app.application.chat_turn_workflow import ChatTurnPorts, chat_turn

        ports = ChatTurnPorts(
            require_chat_thread=self.require_chat_thread,
            calendar_advisor_turn=self.calendar_advisor_turn,
        )
        return chat_turn(user_id, payload, ports=ports)


    def resolve_draft_message(self, user_id, draft, text, context, payload):
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()

    def resolve_task_clarification(self, user_id: str, batch: dict, text: str, context: dict, payload: dict) -> dict | None:
        from app.application.manual_task_entry import ManualTaskEntryRequired
        raise ManualTaskEntryRequired()

    def _pending_task_batch_ports(self):
        from app.application.pending_task_batches import PendingTaskBatchPorts
        from app.application.task_drafts import register

        return PendingTaskBatchPorts(
            require_chat_thread=self.require_chat_thread,
            make_id=new_id,
            now=now_ms,
            connect=self.connect,
            encode=as_json,
            register_drafts=register,
            decode=from_json,
        )

    def save_pending_task_batch(self, user_id: str, source_text: str, tasks: list[dict], thread_id: str | None = None) -> dict:
        from app.application.pending_task_batches import save_pending_task_batch
        return save_pending_task_batch(user_id, source_text, tasks, thread_id, ports=self._pending_task_batch_ports())

    def latest_pending_task_batch(self, user_id: str, thread_id: str | None = None) -> dict | None:
        from app.application.pending_task_batches import latest_pending_task_batch
        return latest_pending_task_batch(user_id, thread_id, ports=self._pending_task_batch_ports())

    @staticmethod
    def is_pending_task_batch_followup(text: str) -> bool:
        from app.application.pending_task_batches import is_pending_task_batch_followup
        return is_pending_task_batch_followup(text)

    def complete_pending_task_batch(self, user_id: str, batch: dict, text: str) -> list[dict]:
        from app.application.pending_task_batches import complete_pending_task_batch
        return complete_pending_task_batch(user_id, batch, text, ports=self._pending_task_batch_ports())

    def _chat_record_ports(self):
        from app.application.chat_records import ChatRecordPorts

        return ChatRecordPorts(
            atomic=self.atomic,
            require_chat_thread=self.require_chat_thread,
            connect=self.connect,
            decode=from_json,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            make_id=new_id,
            now=now_ms,
            encode=as_json,
            _enqueue_personalization=self._enqueue_personalization,
            log_event=self.log_event,
            get_task=self.get_task,
        )

    def save_chat_turn(
        self, user_id: str, user_text: str, assistant_reply: str, intent: str,
        features: dict, task_ids: list[str], request_id: str | None = None,
        thread_id: str | None = None,
    ) -> dict:
        from app.application.chat_records import save_chat_turn

        return save_chat_turn(user_id, user_text, assistant_reply, intent, features, task_ids,
            request_id, thread_id, ports=self._chat_record_ports())

    def list_chat_turns(self, user_id: str, limit: int = 20, thread_id: str | None = None) -> list[dict]:
        from app.application.chat_records import list_chat_turns
        return list_chat_turns(user_id, limit, thread_id, ports=self._chat_record_ports())

    def latest_task_turn_tasks(self, user_id: str, thread_id: str | None = None) -> list[dict]:
        from app.application.chat_records import latest_task_turn_tasks
        return latest_task_turn_tasks(user_id, thread_id, ports=self._chat_record_ports())


    def get_task(self, task_id: str, user_id: str) -> dict | None:
        from app.application.task_queries import TaskQueries
        return TaskQueries(connect=self.connect, project=self.task_row).get(task_id, user_id)

    def list_tasks(self, user_id: str) -> list[dict]:
        from app.application.task_queries import TaskQueries
        return TaskQueries(connect=self.connect, project=self.task_row).list(user_id)

    def build_chat_context(self, user_id: str, text: str, thread_id: str | None = None) -> dict:
        from app.application.chat_context import ChatContextPorts, build_chat_context

        ports = ChatContextPorts(
            list_chat_turns=self.list_chat_turns,
            list_tasks=self.list_tasks,
            latest_task_turn_tasks=self.latest_task_turn_tasks,
            search_memories=self.search_memories,
            latest_pending_task_batch=self.latest_pending_task_batch,
            log_event=self.log_event,
        )
        return build_chat_context(user_id, text, thread_id, ports=ports)

    def task_row(self, row: sqlite3.Row) -> dict:
        from app.application.task_record import project_task_record
        return project_task_record(row, decode=from_json)

    def patch_task(self, task_id: str, patch: dict, user_id: str) -> dict:
        from app.application.modify_task import modify_task
        return modify_task(task_id, patch, user_id, get_task=self.get_task,
            ensure_profile=self.ensure_profile,
            separate_history=self._separate_session_history, current_week=planning_period_id,
            now=now_ms, connect=self.connect, encode=as_json, decode=from_json,
            log_event=self.log_event)

    def _separate_session_history(self, task: dict, week_id: str, timezone_name: str, reference: datetime | None = None) -> tuple[list[dict], list[dict]]:
        from app.domain.planning.reconciliation_rules import _separate_session_history
        return _separate_session_history(task, week_id, timezone_name,
            reference or clock_now(safe_timezone(timezone_name)), absolute_times=session_absolute_times)

    @staticmethod
    def _task_change_scope(before: dict, after: dict) -> set[str]:
        from app.domain.planning.reconciliation_rules import _task_change_scope
        return _task_change_scope(before, after)

    @staticmethod
    def _weekly_change_scope(before: dict, after: dict) -> set[str]:
        from app.domain.planning.reconciliation_rules import _weekly_change_scope
        return _weekly_change_scope(before, after)

    def reconcile_weekly_setup(self, user_id: str, payload: dict) -> dict:
        from app.application.weekly_reconciliation import WeeklyReconciliationPorts, reconcile_weekly_setup

        ports = WeeklyReconciliationPorts(
            ensure_profile=self.ensure_profile,
            current_week=planning_period_id,
            clock_now=clock_now,
            safe_timezone=safe_timezone,
            now=now_ms,
            connect=self.connect,
            task_row=self.task_row,
            _weekly_change_scope=self._weekly_change_scope,
            _task_change_scope=self._task_change_scope,
            _separate_session_history=self._separate_session_history,
            clean_task_title=self.clean_task_title,
            encode=as_json,
            make_id=new_id,
            infer_task_type=self.infer_task_type,
            infer_schedule_task_type=self.infer_schedule_task_type,
            infer_task_demand=self.infer_task_demand,
        )
        return reconcile_weekly_setup(user_id, payload, ports=ports)

    def _decorate_plan_blocks(self, blocks: list[dict], week_id: str, revision: int, timezone_name: str) -> list[dict]:
        from app.domain.planning.plan_snapshots import decorate_plan_blocks
        return decorate_plan_blocks(blocks, week_id, revision, timezone_name,
            absolute_times=session_absolute_times)

    @staticmethod
    def canonical_plan_snapshot(plan_patch: list[dict]) -> list[dict]:
        from app.domain.planning.plan_snapshots import canonical_plan_snapshot
        return canonical_plan_snapshot(plan_patch)

    @classmethod
    def plan_hash(cls, plan_patch: list[dict]) -> str:
        from app.domain.planning.plan_snapshots import plan_hash
        return plan_hash(plan_patch, snapshot=cls.canonical_plan_snapshot)

    @classmethod
    def canonical_plan_diff(cls, initial_patch: list[dict], final_patch: list[dict]) -> dict:
        from app.domain.planning.plan_snapshots import canonical_plan_diff
        return canonical_plan_diff(initial_patch, final_patch, snapshot=cls.canonical_plan_snapshot)

    def _plan_edit_evidence_ports(self):
        from app.application.plan_edit_evidence_workflow import PlanEditEvidencePorts
        return PlanEditEvidencePorts(
            connect=self.connect,
            decode=from_json,
            get_edit_episode=self.get_edit_episode,
            now=now_ms,
            make_id=new_id,
            encode=as_json,
            _enqueue_personalization=self._enqueue_personalization,
            task_row=self.task_row,
        )

    def get_edit_episode(self, user_id: str, episode_id: str) -> dict | None:
        from app.application.plan_edit_evidence_workflow import get_edit_episode
        return get_edit_episode(user_id, episode_id, ports=self._plan_edit_evidence_ports())

    @staticmethod
    def _enqueue_personalization(conn: sqlite3.Connection, *, user_id: str, kind: str, source_id: str, payload: dict, timestamp: int) -> None:
        from app.repositories import PersonalizationEvidenceRepository

        PersonalizationEvidenceRepository(conn).enqueue(
            outbox_id=new_id("outbox"), user_id=user_id, kind=kind, source_id=source_id,
            payload_json=as_json(payload), timestamp=timestamp,
        )

    def record_plan_edit_event(self, user_id: str, payload: dict) -> dict:
        from app.application.plan_edit_evidence_workflow import record_plan_edit_event
        return record_plan_edit_event(user_id, payload, ports=self._plan_edit_evidence_ports())

    def list_personalization_evidence(self, user_id: str) -> list[dict]:
        from app.application.plan_edit_evidence_workflow import list_personalization_evidence
        return list_personalization_evidence(user_id, ports=self._plan_edit_evidence_ports())

    def list_behavior_events(self, user_id: str) -> list[dict]:
        from app.application.plan_edit_evidence_workflow import list_behavior_events
        return list_behavior_events(user_id, ports=self._plan_edit_evidence_ports())

    def list_personalization_projection_failures(self, user_id: str) -> list[dict]:
        from app.application.plan_edit_evidence_workflow import list_personalization_projection_failures
        return list_personalization_projection_failures(user_id, ports=self._plan_edit_evidence_ports())

    def save_proposed_plan(self, user_id: str, decision: dict, payload: dict, *, expected_plan_state=None, scheduling_job_id=None) -> dict:
        from app.application.propose_plan import save_proposed_plan
        return save_proposed_plan(user_id, decision, payload,
            ensure_profile=self.ensure_profile, current_week=planning_period_id, now=now_ms,
            connect=self.atomic, decode=from_json, encode=as_json, make_id=new_id,
            decorate_blocks=self._decorate_plan_blocks,
            canonical_snapshot=self.canonical_plan_snapshot, snapshot_hash=self.plan_hash,
            expected_plan_state=expected_plan_state, scheduling_job_id=scheduling_job_id)

    def _plan_editing_ports(self):
        from app.application.plan_editing import PlanEditingPorts
        return PlanEditingPorts(
            connect=self.connect, decode=from_json, encode=as_json,
            make_id=new_id, now=now_ms, list_tasks=self.list_tasks,
            get_task=self.get_task, patch_task=self.patch_task, active_plan=self.active_plan,
            save_proposed_plan=self.save_proposed_plan,
            validate_confirmed_schedule=self.validate_confirmed_schedule,
            revise_plan=self.revise_plan, confirm_plan=self.confirm_plan,
            schedule_task_kind=schedule_task_kind,
        )

    def revise_plan(self, user_id: str, payload: dict) -> dict:
        from app.application.plan_editing import revise_plan
        return revise_plan(user_id, payload, ports=self._plan_editing_ports())

    def propose_continue_later_diff(self, user_id: str, execution_session: dict, impact: dict, request_id: str | None = None) -> dict:
        from app.application.plan_editing import propose_continue_later_diff
        return propose_continue_later_diff(user_id, execution_session, impact, request_id,
            ports=self._plan_editing_ports())

    def decide_parallel_suggestion(self, user_id: str, payload: dict) -> dict:
        from app.application.plan_editing import decide_parallel_suggestion
        return decide_parallel_suggestion(user_id, payload, ports=self._plan_editing_ports())

    def adjust_scheduled_task(self, user_id: str, payload: dict) -> dict:
        from app.application.plan_editing import adjust_scheduled_task
        return adjust_scheduled_task(user_id, payload, ports=self._plan_editing_ports())

    def confirm_plan(self, user_id: str, payload: dict) -> dict:
        from app.application.confirm_plan import ConfirmationPorts, confirm_plan
        ports = ConfirmationPorts(
            validate_confirmed_schedule=self.validate_confirmed_schedule,
            log_event=self.log_event,
            ensure_profile=self.ensure_profile,
            get_edit_episode=self.get_edit_episode,
            canonical_plan_snapshot=self.canonical_plan_snapshot,
            plan_hash=self.plan_hash,
            canonical_plan_diff=self.canonical_plan_diff,
            connect=self.atomic,
            encode=as_json,
            now=now_ms,
            current_week=planning_period_id,
            decode=from_json,
            make_id=new_id,
            _decorate_plan_blocks=self._decorate_plan_blocks,
            task_row=self.task_row,
            _enqueue_personalization=self._enqueue_personalization,
        )
        return confirm_plan(user_id, payload, ports=ports)

    def active_plan(self, user_id: str, week_id: str | None = None) -> dict | None:
        from app.application.plan_queries import read_plan
        return read_plan(user_id, week_id, proposed=False, ensure_profile=self.ensure_profile,
            current_week=planning_period_id, connect=self.connect, decode=from_json)

    def latest_proposed_plan(self, user_id: str, week_id: str | None = None) -> dict | None:
        from app.application.plan_queries import read_plan
        return read_plan(user_id, week_id, proposed=True, ensure_profile=self.ensure_profile,
            current_week=planning_period_id, connect=self.connect, decode=from_json)

    def _week_lifecycle_ports(self):
        from app.application.week_lifecycle import WeekLifecyclePorts

        return WeekLifecyclePorts(
            ensure_profile=self.ensure_profile,
            current_week=planning_period_id,
            list_tasks=self.list_tasks,
            now=now_ms,
            connect=self.connect,
            make_id=new_id,
            encode=as_json,
            task_row=self.task_row,
        )

    def week_status(self, user_id: str, requested_week_id: str | None = None) -> dict:
        from app.application.week_lifecycle import week_status
        return week_status(user_id, requested_week_id, ports=self._week_lifecycle_ports())

    def rollover_week(self, user_id: str, payload: dict) -> dict:
        from app.application.week_lifecycle import rollover_week
        return rollover_week(user_id, payload, ports=self._week_lifecycle_ports())

    def delete_task(self, task_id: str, user_id: str) -> dict:
        from app.application.archive_task import archive_task
        return archive_task(task_id, user_id, get_task=self.get_task,
            connect=self.connect, now=now_ms, current_week=planning_period_id,
            user_timestamp=lambda identity: self.user_clock_now(identity,
                self.ensure_profile(identity).get("timezone") or "Asia/Shanghai").isoformat(),
            log_event=self.log_event)

    def _runtime_state_ports(self):
        from app.application.runtime_states import RuntimeStatePorts
        return RuntimeStatePorts(
            atomic=self.atomic, connect=self.connect, ensure_profile=self.ensure_profile,
            get_profile=self.get_profile, user_clock_now=self.user_clock_now,
            clock_now=clock_now, now=now_ms, make_id=new_id, encode=as_json, decode=from_json,
            daily_checkin_status=self.daily_checkin_status, latest_runtime_state=self.latest_runtime_state,
            project_runtime_observation=self.project_runtime_observation,
            list_execution_sessions=self.list_execution_sessions, get_task=self.get_task,
            _enqueue_personalization=self._enqueue_personalization, log_event=self.log_event,
        )

    def save_runtime_state(self, user_id: str, payload: dict) -> dict:
        from app.application.runtime_states import save_runtime_state
        return save_runtime_state(user_id, payload, ports=self._runtime_state_ports())

    def daily_checkin_status(self, user_id: str) -> dict:
        from app.application.runtime_states import daily_checkin_status
        return daily_checkin_status(user_id, ports=self._runtime_state_ports())

    def evaluate_daily_checkin(self, user_id: str, state: dict) -> dict:
        from app.application.daily_plan_review import DailyReviewPorts, evaluate_daily_plan
        return evaluate_daily_plan(user_id, locale=state.get('_locale', 'zh'), ports=DailyReviewPorts(
            ensure_profile=self.ensure_profile, user_clock_now=self.user_clock_now,
            latest_runtime_state=self.latest_runtime_state, list_tasks=self.list_tasks,
            list_execution_sessions=self.list_execution_sessions, active_plan=self.active_plan,
            recent_behavior=self.recent_scheduling_behavior, learned_behavior=self.learned_behaviors,
            typed_completion=typed_chat_completion,
            encode=as_json, log_event=self.log_event))

    def adjust_execution(self, user_id: str, payload: dict) -> dict:
        from app.application.execution_adjustment import AdjustmentPorts, adjust_execution
        ports = AdjustmentPorts(
            connect=self.connect, atomic=self.atomic, execution_session_row=self.execution_session_row,
            get_task=self.get_task, ensure_profile=self.ensure_profile, user_clock_now=self.user_clock_now,
            active_plan=self.active_plan, list_tasks=self.list_tasks, save_proposed_plan=self.save_proposed_plan,
            start_execution_session=self.start_execution_session,
            interrupt_execution_session=self.interrupt_execution_session, log_event=self.log_event,
            decode=from_json, now=now_ms)
        return adjust_execution(user_id, payload, ports=ports)

    def _recommendation_workflow_ports(self):
        from app.application.recommendation_workflow import RecommendationWorkflowPorts
        try:
            from humanos_graph import build_scheduling_context
        except ImportError:
            from backend.humanos_graph import build_scheduling_context
        return RecommendationWorkflowPorts(
            list_execution_sessions=self.list_execution_sessions,
            get_task=self.get_task,
            save_runtime_state=self.save_runtime_state,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            analyze_execution_impact=self.analyze_execution_impact,
            typed_completion=typed_chat_completion,
            make_id=new_id,
            log_event=self.log_event,
            connect=self.connect,
            decode=from_json,
            _recommendation_event=self._recommendation_event,
            atomic=self.atomic,
            _original_help_decide=self._original_help_decide,
            _persist_help_decide_feedback=self._persist_help_decide_feedback,
            now=now_ms,
            _enqueue_personalization=self._enqueue_personalization,
            safe_timezone=safe_timezone,
            build_scheduling_context=build_scheduling_context,
            iso_week_id=iso_week_id,
            _apply_help_decide_choice=self._apply_help_decide_choice,
            index_context_dump_memory=self.index_context_dump_memory,
            latest_runtime_state=self.latest_runtime_state,
            active_plan=self.active_plan,
            start_execution_session=self.start_execution_session,
            interrupt_execution_session=self.interrupt_execution_session,
            propose_continue_later_diff=self.propose_continue_later_diff,
            request_replan=self.request_replan,
            recent_behavior=self.recent_scheduling_behavior,
            learned_behavior=self.learned_behaviors,
        )

    def help_decide(self, user_id: str, payload: dict) -> dict:
        from app.application.recommendation_workflow import help_decide
        return help_decide(user_id, payload, ports=self._recommendation_workflow_ports())

    def _recommendation_event(self, user_id: str, recommendation_id: str, event_type: str) -> dict | None:
        from app.application.recommendation_workflow import _recommendation_event
        return _recommendation_event(user_id, recommendation_id, event_type, ports=self._recommendation_workflow_ports())

    def _original_help_decide(self, user_id: str, payload: dict) -> dict:
        from app.application.recommendation_workflow import _original_help_decide
        return _original_help_decide(user_id, payload, ports=self._recommendation_workflow_ports())

    def save_help_decide_feedback(self, user_id: str, payload: dict) -> dict:
        from app.application.recommendation_workflow import save_help_decide_feedback
        return save_help_decide_feedback(user_id, payload, ports=self._recommendation_workflow_ports())

    def _persist_help_decide_feedback(self, user_id: str, original: dict, selection: dict | None) -> dict:
        from app.application.recommendation_workflow import _persist_help_decide_feedback
        return _persist_help_decide_feedback(user_id, original, selection, ports=self._recommendation_workflow_ports())

    def check_resume_time(self, user_id: str, payload: dict) -> dict:
        from app.application.recommendation_workflow import check_resume_time
        return check_resume_time(user_id, payload, ports=self._recommendation_workflow_ports())

    def apply_help_decide_recommendation(self, user_id: str, payload: dict) -> dict:
        from app.application.recommendation_workflow import apply_help_decide_recommendation
        return apply_help_decide_recommendation(user_id, payload, ports=self._recommendation_workflow_ports())

    def _apply_help_decide_choice(self, user_id: str, payload: dict, original: dict) -> dict:
        from app.application.recommendation_workflow import _apply_help_decide_choice
        return _apply_help_decide_choice(user_id, payload, original, ports=self._recommendation_workflow_ports())

    def latest_runtime_state(self, user_id: str) -> dict:
        from app.application.runtime_states import latest_runtime_state
        return latest_runtime_state(user_id, ports=self._runtime_state_ports())

    def project_runtime_observation(self, row) -> dict:
        from app.application.runtime_states import project_runtime_observation
        return project_runtime_observation(row, ports=self._runtime_state_ports())

    def save_context_dump(self, user_id: str, payload: dict) -> dict:
        from app.application.save_context_dump import ContextDumpPorts, save_context_dump

        return save_context_dump(user_id, payload, ports=ContextDumpPorts(
            connect=self.connect,
            get_task=self.get_task,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            _insert_state_transition=self._insert_state_transition,
            _enqueue_personalization=self._enqueue_personalization,
            index_context_dump_memory=self.index_context_dump_memory,
            log_event=self.log_event,
            decode=from_json,
            encode=as_json,
            make_id=new_id,
            now=now_ms,
        ))

    def index_context_dump_memory(self, user_id: str, dump: dict) -> dict:
        from app.application.index_context_dump_memory import index_context_dump_memory

        return index_context_dump_memory(user_id, dump,
            connect=self.connect,
            decode=from_json,
            add_memory=self.add_memory,
        )

    @staticmethod
    def _iso_elapsed_minutes(start_value: str | None, end_value: str | None = None) -> int:
        from app.application.execution_queries import iso_elapsed_minutes
        return iso_elapsed_minutes(start_value, end_value, clock_now=clock_now)

    def execution_session_row(self, row: sqlite3.Row) -> dict:
        from app.application.execution_queries import iso_elapsed_minutes, project_session
        return project_session(row, decode=from_json, elapsed_minutes=lambda start: iso_elapsed_minutes(
            start, clock_now=lambda _timezone: self.user_clock_now(row['user_id'])))

    @staticmethod
    def interruption_episode_row(row: sqlite3.Row | None) -> dict | None:
        from app.application.recovery_queries import project_episode
        return project_episode(row, decode=from_json)

    def list_interruption_episodes(self, user_id: str) -> list[dict]:
        from app.application.recovery_queries import list_episodes
        return list_episodes(user_id, connect=self.connect, project=self.interruption_episode_row)

    def interruption_recovery_summary(self, user_id: str) -> dict:
        from app.application.recovery_queries import recovery_summary
        return recovery_summary(user_id, list_episodes=self.list_interruption_episodes,
            connect=self.connect, decode=from_json)

    def _episode_for_resume(self, conn: sqlite3.Connection, user_id: str, session: sqlite3.Row) -> sqlite3.Row | None:
        from app.repositories.interruption_episodes import InterruptionEpisodeRepository
        return InterruptionEpisodeRepository(conn).pending_for_resume(user_id=user_id, session=session)

    @staticmethod
    def _execution_request_seen(conn: sqlite3.Connection, user_id: str, request_id: str | None) -> sqlite3.Row | None:
        from app.repositories.execution_requests import ExecutionRequestRepository
        return ExecutionRequestRepository(conn).replay(user_id=user_id, request_id=request_id)

    @staticmethod
    def _record_execution_request(conn: sqlite3.Connection, user_id: str, request_id: str | None, session_id: str, action: str, timestamp: int) -> None:
        from app.repositories.execution_requests import ExecutionRequestRepository
        ExecutionRequestRepository(conn).record(user_id=user_id, request_id=request_id,
            session_id=session_id, action=action, timestamp=timestamp)

    def list_execution_sessions(self, user_id: str, statuses: list[str] | None = None) -> list[dict]:
        from app.application.execution_queries import list_sessions
        return list_sessions(user_id, statuses, connect=self.connect, project=self.execution_session_row)

    def current_execution(self, user_id: str) -> dict:
        from app.application.current_execution import CurrentExecutionPorts, current_execution
        ports = CurrentExecutionPorts(
            list_execution_sessions=self.list_execution_sessions,
            active_plan=self.active_plan,
            now=now_ms,
            connect=self.connect,
            make_id=new_id,
            encode=as_json,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            get_task=self.get_task,
        )
        return current_execution(user_id, ports=ports)

    def _parallel_start_allowed(self, user_id: str, first_block_id: str, second_block_id: str) -> bool:
        from app.domain.task.legacy_resources import plan_allows_parallel_start
        return plan_allows_parallel_start(self.active_plan(user_id) or {}, first_block_id, second_block_id)

    def _insert_state_transition(self, conn: sqlite3.Connection, *, user_id: str, task_id: str | None, before_status: str, action_type: str, after_status: str, execution_session_id: str | None = None, action_detail: dict | None = None, outcome: dict | None = None, created_at: int | None = None, trusted_execution_transition: bool = True) -> dict:
        from app.application.execution_transition import insert_execution_transition

        return insert_execution_transition(
            conn, user_id=user_id, task_id=task_id, before_status=before_status,
            action_type=action_type, after_status=after_status,
            execution_session_id=execution_session_id, action_detail=action_detail,
            outcome=outcome, created_at=created_at,
            trusted_execution_transition=trusted_execution_transition,
            make_id=new_id, now=now_ms, encode=as_json,
            project_task=self.task_row, enqueue_personalization=self._enqueue_personalization,
        )

    def start_execution_session(self, user_id: str, payload: dict) -> dict:
        from app.application.start_execution import StartExecutionPorts, start_execution
        ports = StartExecutionPorts(
            now=now_ms,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            connect=self.atomic,
            _execution_request_seen=self._execution_request_seen,
            execution_session_row=self.execution_session_row,
            interruption_episode_row=self.interruption_episode_row,
            _record_execution_request=self._record_execution_request,
            _episode_for_resume=self._episode_for_resume,
            _parallel_start_allowed=self._parallel_start_allowed,
            _insert_state_transition=self._insert_state_transition,
            _enqueue_personalization=self._enqueue_personalization,
            analyze_execution_impact=self.analyze_execution_impact,
        )
        return start_execution(user_id, payload, ports=ports)

    def _workspace_execution_ports(self):
        from app.application.workspace_execution_ports import WorkspaceExecutionPorts
        return WorkspaceExecutionPorts(atomic=self.atomic, connect=self.connect, ensure_profile=self.ensure_profile,
            active_plan=self.active_plan, get_task=self.get_task, save_runtime_state=self.save_runtime_state,
            user_clock_now=self.user_clock_now, now=now_ms, make_id=new_id, encode=as_json, decode=from_json,
            execution_session_row=self.execution_session_row, _iso_elapsed_minutes=self._iso_elapsed_minutes,
            _insert_state_transition=self._insert_state_transition, _enqueue_personalization=self._enqueue_personalization)

    def report_session(self, user_id: str, payload: dict) -> dict:
        from app.application.session_reports import report_session
        return report_session(user_id, payload, ports=self._workspace_execution_ports())

    def pending_work(self, user_id: str) -> list[dict]:
        from app.application.session_reports import pending_work
        return pending_work(user_id, connect=self.connect)

    def workspace_execution(self, user_id: str, payload: dict, *, defer=False) -> dict:
        from app.application.workspace_execution import workspace_execution
        return workspace_execution(user_id, payload, defer=defer, ports=self._workspace_execution_ports())

    def propose_sessions(self, user_id: str, payload: dict) -> dict:
        from app.application.session_proposals import propose_sessions
        from app.application.workspace_execution_ports import SessionProposalPorts
        ports = SessionProposalPorts(atomic=self.atomic, connect=self.connect, ensure_profile=self.ensure_profile,
            active_plan=self.active_plan, user_clock_now=self.user_clock_now, latest_runtime_state=self.latest_runtime_state,
            list_tasks=self.list_tasks, make_id=new_id, encode=as_json, decode=from_json,
            typed_completion=typed_chat_completion, save_proposed_plan=self.save_proposed_plan,
            validate_confirmed_schedule=self.validate_confirmed_schedule, learned_behavior=self.learned_behaviors,
            recent_behavior=self.recent_scheduling_behavior)
        return propose_sessions(user_id, payload, ports=ports)

    def _execution_context_ports(self):
        from app.application.execution_context import ExecutionContextPorts
        return ExecutionContextPorts(
            get_task=self.get_task,
            connect=self.connect,
            execution_session_row=self.execution_session_row,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            make_id=new_id,
            now=now_ms,
            current_week=planning_period_id,
            decode=from_json,
        )

    def ensure_execution_session(self, user_id: str, payload: dict) -> dict:
        from app.application.execution_context import ensure_execution_session
        return ensure_execution_session(user_id, payload, ports=self._execution_context_ports())

    def pause_execution_session(self, user_id: str, payload: dict) -> dict:
        from app.application.pause_execution import PauseExecutionPorts, pause_execution

        return pause_execution(user_id, payload, ports=PauseExecutionPorts(
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            connect=self.connect,
            _execution_request_seen=self._execution_request_seen,
            execution_session_row=self.execution_session_row,
            get_task=self.get_task,
            interruption_episode_row=self.interruption_episode_row,
            _iso_elapsed_minutes=self._iso_elapsed_minutes,
            _enqueue_personalization=self._enqueue_personalization,
            latest_runtime_state=self.latest_runtime_state,
            _insert_state_transition=self._insert_state_transition,
            _record_execution_request=self._record_execution_request,
            now=now_ms,
            encode=as_json,
            new_id=new_id,
        ))

    def interrupt_execution_session(self, user_id: str, payload: dict, *, index_memory: bool = True) -> dict:
        from app.application.interrupt_execution import InterruptExecutionPorts, interrupt_execution

        return interrupt_execution(user_id, payload, index_memory=index_memory, ports=InterruptExecutionPorts(
            atomic=self.atomic,
            pause_execution_session=self.pause_execution_session,
            save_context_dump=self.save_context_dump,
            connect=self.connect,
            now=now_ms,
            index_context_dump_memory=self.index_context_dump_memory,
        ))

    def review_interruption(self, user_id: str, payload: dict, *, capture_context: bool) -> dict:
        from app.application.interruption_review import InterruptionReviewPorts, review_interruption

        return review_interruption(user_id, payload, capture_context=capture_context,
            ports=InterruptionReviewPorts(
                interrupt=self.interrupt_execution_session, pause=self.pause_execution_session,
                assess_impact=self.analyze_execution_impact, list_sessions=self.list_execution_sessions,
                get_task=self.get_task, ensure_profile=self.ensure_profile,
                runtime_state=self.latest_runtime_state, user_clock=self.user_clock_now,
                propose_diff=self.propose_continue_later_diff, make_id=new_id,
            ))

    def analyze_execution_impact(self, user_id: str, payload: dict) -> dict:
        from app.application.analyze_execution_impact import ExecutionImpactPorts, analyze_execution_impact

        return analyze_execution_impact(user_id, payload, ports=ExecutionImpactPorts(
            connect=self.connect,
            execution_session_row=self.execution_session_row,
            ensure_profile=self.ensure_profile,
            user_clock_now=self.user_clock_now,
            get_task=self.get_task,
            list_execution_sessions=self.list_execution_sessions,
            active_plan=self.active_plan,
        ))

    def end_execution_session(self, user_id: str, payload: dict) -> dict:
        from app.application.end_execution import end_execution
        return end_execution(user_id, payload, now=now_ms, ensure_profile=self.ensure_profile,
            user_clock=self.user_clock_now, connect=self.connect,
            request_seen=self._execution_request_seen, project_session=self.execution_session_row,
            elapsed_minutes=self._iso_elapsed_minutes, insert_transition=self._insert_state_transition,
            record_request=self._record_execution_request)

    def execution_parallel_context(self, user_id: str, session: sqlite3.Row) -> dict:
        from app.application.execution_context import execution_parallel_context
        return execution_parallel_context(user_id, session, ports=self._execution_context_ports())

    def save_execution_feedback(self, user_id: str, payload: dict) -> dict:
        from app.application.save_execution_feedback import ExecutionFeedbackPorts, save_execution_feedback

        return save_execution_feedback(user_id, payload, ports=ExecutionFeedbackPorts(
            get_task=self.get_task,
            ensure_profile=self.ensure_profile,
            connect=self.connect,
            atomic=self.atomic,
            decode=from_json,
            execution_parallel_context=self.execution_parallel_context,
            interruption_episode_row=self.interruption_episode_row,
            make_id=new_id,
            now=now_ms,
            encode=as_json,
            user_clock_now=self.user_clock_now,
            _insert_state_transition=self._insert_state_transition,
            _enqueue_personalization=self._enqueue_personalization,
            add_memory=self.add_memory,
            log_event=self.log_event,
        ))

    def record_state_transition(self, user_id: str, payload: dict) -> dict:
        from app.application.record_state_transition import record_state_transition

        return record_state_transition(user_id, payload,
            connect=self.connect,
            get_task=self.get_task,
            _insert_state_transition=self._insert_state_transition,
            log_event=self.log_event,
        )

    def behavior_patterns(self, user_id: str) -> dict:
        from app.application.behavior_learning import list_patterns
        return list_patterns(user_id, connect=self.connect)

    def manage_behavior_pattern(self, user_id: str, pattern_id: str, payload: dict) -> dict:
        from app.application.behavior_learning import manage_pattern
        return manage_pattern(user_id, pattern_id, payload, connect=self.connect, now=now_ms)

    def export_profile_data(self, user_id: str) -> dict:
        from app.application.behavior_learning import export_data
        return export_data(user_id, connect=self.connect)

    def add_memory(
        self, user_id: str, source_type: str, source_id: str,
        task_id: str | None, text: str, metadata: dict,
    ) -> dict:
        from app.application.memory_service import add_memory

        return add_memory(user_id, source_type, source_id, task_id, text, metadata,
            connect=self.connect, embed=embedding_for_text, make_id=new_id,
            now=now_ms, encode=as_json)

    def search_memories(self, user_id: str, query: str, top_k: int = 5) -> list[dict]:
        from app.application.memory_service import search_memories

        return search_memories(user_id, query, top_k,
            connect=self.connect, embed=embedding_for_text,
            decode=from_json, encode=as_json, similarity=cosine)

    def analyze_schedule_inputs(self, state: dict) -> dict:
        from app.application.schedule_input_analysis import analyze_schedule_inputs
        return analyze_schedule_inputs(state, typed_completion=typed_chat_completion,
            encode=as_json, local_resource_profile=local_resource_profile,
            parallel_pair_rule=parallel_pair_rule,
            model_name=lambda: os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"))

    def build_parallel_suggestions(self, state: dict, plan_patch: list[dict]) -> list[dict]:
        from app.application.parallel_suggestions import build_parallel_suggestions
        return build_parallel_suggestions(state, plan_patch,
            clock=lambda timezone: clock_now(safe_timezone(timezone)),
            make_suffix=lambda: uuid.uuid4().hex[:6])

    def _cross_week_ports(self):
        from types import SimpleNamespace
        from app.application.validate_schedule import validate_schedule
        return SimpleNamespace(ensure_profile=self.ensure_profile, list_tasks=self.list_tasks,
            active_plan=self.active_plan, latest_proposed_plan=self.latest_proposed_plan,
            user_clock_now=self.user_clock_now, analyze_schedule_inputs=self.analyze_schedule_inputs,
            recent_behavior=self.recent_scheduling_behavior, learned_behavior=self.learned_behaviors,
            typed_completion=typed_chat_completion, encode=as_json, make_id=new_id, now=now_ms,
            atomic=self.atomic, log_event=self.log_event, save_proposed_plan=self.save_proposed_plan,
            confirm_plan=self.confirm_plan, validate_snapshot=lambda plan, profile, tasks, now:
                validate_schedule(plan, profile=profile, tasks=tasks, now=now,
                    schedule_task_kind=schedule_task_kind, confirmed_parallel_overlap_allowed=confirmed_parallel_overlap_allowed,
                    local_resource_profile=local_resource_profile, parallel_pair_rule=parallel_pair_rule))

    def preview_next_week(self, user_id, payload):
        from app.application.cross_week import preview_next_week
        return preview_next_week(user_id, payload, ports=self._cross_week_ports())

    def confirm_next_week(self, user_id, payload):
        from app.application.cross_week import confirm_next_week
        return confirm_next_week(user_id, payload, ports=self._cross_week_ports())

    def validate_confirmed_schedule(self, user_id: str, payload: dict, *, scope_policy=None) -> dict:
        from app.application.validate_schedule import validate_user_schedule
        return validate_user_schedule(user_id, payload, ensure_profile=self.ensure_profile,
            connect=self.connect, decode=from_json, scope_policy=scope_policy,
            list_tasks=self.list_tasks, user_clock_now=self.user_clock_now,
            schedule_task_kind=schedule_task_kind,
            confirmed_parallel_overlap_allowed=confirmed_parallel_overlap_allowed,
            local_resource_profile=local_resource_profile, parallel_pair_rule=parallel_pair_rule)

    def decide_schedule(self, user_id: str, payload: dict, *, scheduling_job_id=None) -> dict:
        from app.application.schedule_decision import SchedulingPorts, decide_schedule
        from app.application.plan_queries import read_requested_plan
        from app.application.replan_scope import capture_scope
        ports = SchedulingPorts(
            capture_scope=lambda user, **kwargs: capture_scope(user, connect=self.connect, **kwargs),
            ensure_profile=self.ensure_profile, list_tasks=self.list_tasks,
            latest_runtime_state=self.latest_runtime_state, user_clock_now=self.user_clock_now,
            list_execution_sessions=self.list_execution_sessions,
            recent_behavior=self.recent_scheduling_behavior,
            learned_behavior=self.learned_behaviors,
            build_schedule_query=self.build_schedule_query, search_memories=self.search_memories,
            analyze_schedule_inputs=self.analyze_schedule_inputs, active_plan=self.active_plan,
            latest_proposed_plan=self.latest_proposed_plan,
            validate_confirmed_schedule=self.validate_confirmed_schedule,
            save_proposed_plan=self.save_proposed_plan, log_event=self.log_event,
            typed_completion=typed_chat_completion, encode=as_json,
            read_requested_plan=lambda user, request_id, week_id: read_requested_plan(
                user, request_id, week_id, connect=self.connect, decode=from_json))
        return decide_schedule(user_id, payload, ports=ports, scheduling_job_id=scheduling_job_id,
            request_lock=self.schedule_gate.for_user(user_id), request_cache=self.schedule_request_cache)

    def learned_behaviors(self, user_id):
        from app.application.behavior_learning import background
        return background(user_id, connect=self.connect)

    def recent_scheduling_behavior(self, user_id: str, query: str) -> dict:
        from app.application.recent_behavior_retrieval import retrieve_recent
        return retrieve_recent(user_id, query, connect=self.connect,
                               embed=embedding_for_text, now_ms=now_ms())

    def build_schedule_query(self, tasks: list[dict], state: dict) -> str:
        from app.application.schedule_narrative import build_schedule_query
        return build_schedule_query(tasks, state)

    def schedule_explanation(self, state: dict, memories: list[dict]) -> str:
        from app.application.schedule_narrative import schedule_explanation
        return schedule_explanation(state, memories)

    def validate_llm_schedule_candidates(self, state: dict, decision: dict, llm_result: dict) -> list[dict]:
        from app.application.ai_candidate_validation import CandidateValidationPorts, validate_llm_schedule_candidates
        from humanos_graph import build_scheduling_context, day_index_from_due, parse_due_start_hour, profile_now
        return validate_llm_schedule_candidates(state, decision, llm_result,
            ports=CandidateValidationPorts(
                build_scheduling_context=build_scheduling_context,
                day_index_from_due=day_index_from_due,
                parse_due_start_hour=parse_due_start_hour,
                profile_now=profile_now,
                schedule_task_kind=schedule_task_kind,
                confirmed_parallel_overlap_allowed=confirmed_parallel_overlap_allowed,
                local_resource_profile=local_resource_profile,
                parallel_pair_rule=parallel_pair_rule,
            ))

    def refine_schedule_decision(self, state: dict, decision: dict) -> dict:
        from app.application.schedule_refinement import ScheduleRefinementPorts, refine_schedule_decision
        from humanos_graph import build_scheduling_context, day_index_from_due, parse_due_start_hour, profile_now
        return refine_schedule_decision(state, decision, ports=ScheduleRefinementPorts(
            ensure_profile=self.ensure_profile,
            validate_llm_schedule_candidates=self.validate_llm_schedule_candidates,
            build_parallel_suggestions=self.build_parallel_suggestions,
            build_scheduling_context=build_scheduling_context,
            day_index_from_due=day_index_from_due, parse_due_start_hour=parse_due_start_hour,
            profile_now=profile_now, iso_week_id=iso_week_id,
            schedule_task_kind=schedule_task_kind,
            typed_completion=typed_chat_completion, encode=as_json,
            model_name=lambda: os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        ))

    def reentry_prompt(self, user_id: str, payload: dict) -> dict:
        from app.application.reentry_prompt import ReentryPorts, reentry_prompt

        return reentry_prompt(user_id, payload, ports=ReentryPorts(
            get_task=self.get_task,
            latest_runtime_state=self.latest_runtime_state,
            search_memories=self.search_memories,
            connect=self.connect,
            user_clock_now=self.user_clock_now,
            ensure_profile=self.ensure_profile,
            now=now_ms,
            interruption_episode_row=self.interruption_episode_row,
            decode=from_json,
            log_event=self.log_event,
        ))

    def log_event(self, user_id: str, event_type: str, payload: dict) -> None:
        from app.application.record_event import record_event
        record_event(user_id, event_type, payload, connect=self.connect,
            make_id=new_id, encode=as_json, now=now_ms)


store: Store | None = None
_application_lifecycle = ApplicationLifecycle(
    create=lambda: Store(DB_PATH, resume_jobs=False),
    recover=lambda application: application.resume_background_jobs(),
)


def get_application() -> Store:
    # Preserve explicit Store replacement by existing internal callers/tests.
    if store is not None:
        return store
    return _application_lifecycle.get()


class Handler(HumanOSHTTPHandler):
    def runtime(self) -> HTTPRuntime:
        return HTTPRuntime(
            application=get_application, encode=as_json, health=health_snapshot,
            test_mode=TEST_MODE, qa_mode=QA_MODE, test_clock_state=test_clock_state,
            update_test_clock=update_test_clock, qa_scenario_manifest=qa_scenario_manifest,
            restore_qa_scenario=restore_qa_scenario, make_id=new_id,
        )


def health_snapshot() -> dict:
    return build_health_snapshot(environment=os.environ, database_path=DB_PATH,
        embedding_url=AI_EMBEDDING_URL, embedding_model=AI_EMBEDDING_MODEL,
        local_embedding_model=LOCAL_EMBEDDING_MODEL,
        test_mode=TEST_MODE,
        qa_mode=QA_MODE, test_clock_state=test_clock_state)


def main() -> None:
    from app.application.behavior_experience import start_worker
    application = get_application()
    if os.environ.get('HUMANOS_SIMULATION_MODE') == '1':
        from app.infrastructure.simulation_runtime import get_service
        service = get_service(application)
        try:
            serve_http(ServerConfig.from_environment(os.environ), Handler,
                database_path=DB_PATH, start_application=get_application)
        finally:
            service.close()
        return
    stop = start_worker(connect=application.connect, complete=typed_chat_completion,
        embed=embedding_for_text, enabled=lambda: bool(os.environ.get('DEEPSEEK_API_KEY', '').strip()))
    try:
        serve_http(ServerConfig.from_environment(os.environ), Handler,
            database_path=DB_PATH, start_application=get_application)
    finally:
        stop.set()


if __name__ == "__main__":
    main()
