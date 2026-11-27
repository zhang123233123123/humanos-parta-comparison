"""Atomic interruption checkpoint workflow; indexing happens after commit."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.interruption_episodes import InterruptionEpisodeRepository


@dataclass(frozen=True)
class InterruptExecutionPorts:
    atomic: Callable
    pause_execution_session: Callable
    save_context_dump: Callable
    connect: Callable
    now: Callable
    index_context_dump_memory: Callable


def interrupt_execution(user_id: str, payload: dict, *, ports: InterruptExecutionPorts, index_memory: bool = True) -> dict:
    """Atomically pause one Session and persist its re-entry checkpoint."""
    from .execution_interruption import build_interruption_command
    from ..domain.execution import interruption_policy

    command = build_interruption_command(payload)
    policy = interruption_policy(command.get("interruption_action"))
    if not str(command.get("request_id") or "").strip():
        raise ValueError("request_id is required for an atomic interruption")
    reason = str(command.get("pause_reason") or command.get("reason") or "").strip()
    progress = str(command.get("progress") or "").strip()
    next_step = str(command.get("next_step") or command.get("next_action") or "").strip()

    context_dump = None
    with ports.atomic():
        execution_session = ports.pause_execution_session(user_id, command)
        if policy.requires_context_dump:
            context_dump = ports.save_context_dump(user_id, {
                "task_id": execution_session["task_id"],
                "execution_session_id": execution_session["execution_session_id"],
                "plan_revision": execution_session.get("plan_revision"),
                "request_id": command.get("request_id"),
                "checkpoint_type": "execution_interruption",
                "progress": progress,
                "progress_percent": command.get("progress_percent"),
                "next_action": next_step,
                "open_questions": command.get("open_questions") or [],
                "stop_reason": reason,
                "materials": command.get("materials") or [],
                "session_remaining_minutes": execution_session.get("session_remaining_minutes"),
                "task_remaining_minutes": command.get("task_remaining_minutes"),
                "metadata": {
                    "interruption_action": policy.action,
                    "resume_preference": command.get("resume_preference"),
                    "preferred_resume_at": command.get("preferred_resume_at"),
                },
                "skip_memory_index": True,
            })
            episode = execution_session.get("interruption_episode") or {}
            if episode.get("id"):
                with ports.connect() as conn:
                    InterruptionEpisodeRepository(conn).link_context(user_id=user_id, episode_id=episode["id"], context_id=context_dump["id"], timestamp=ports.now())
                execution_session["interruption_episode"] = {**episode, "context_dump_id": context_dump["id"]}

    if context_dump and index_memory:
        ports.index_context_dump_memory(user_id, context_dump)
    return {
        "execution_session": execution_session,
        "context_dump": context_dump,
        "command": command,
    }
