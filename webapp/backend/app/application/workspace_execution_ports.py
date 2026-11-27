"""Explicit capabilities for workspace execution and candidate generation."""
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkspaceExecutionPorts:
    atomic: Callable
    connect: Callable
    ensure_profile: Callable
    active_plan: Callable
    get_task: Callable
    save_runtime_state: Callable
    user_clock_now: Callable
    now: Callable
    make_id: Callable
    encode: Callable
    decode: Callable
    execution_session_row: Callable
    _iso_elapsed_minutes: Callable
    _insert_state_transition: Callable
    _enqueue_personalization: Callable


@dataclass(frozen=True)
class SessionProposalPorts:
    atomic: Callable
    connect: Callable
    ensure_profile: Callable
    active_plan: Callable
    user_clock_now: Callable
    latest_runtime_state: Callable
    list_tasks: Callable
    make_id: Callable
    encode: Callable
    decode: Callable
    typed_completion: Callable
    save_proposed_plan: Callable
    validate_confirmed_schedule: Callable
    learned_behavior: Callable | None = None
    recent_behavior: Callable | None = None
