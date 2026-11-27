"""Build re-entry guidance and record generation, without starting execution."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.context_dumps import ContextDumpRepository
from ..repositories.interruption_episodes import InterruptionEpisodeRepository
from .recovery_context import recovery_context


@dataclass(frozen=True)
class ReentryPorts:
    get_task: Callable
    latest_runtime_state: Callable
    search_memories: Callable
    connect: Callable
    user_clock_now: Callable
    ensure_profile: Callable
    now: Callable
    interruption_episode_row: Callable
    decode: Callable
    log_event: Callable


def reentry_prompt(user_id: str, payload: dict, *, ports: ReentryPorts) -> dict:
    task_id = payload["task_id"]
    task = ports.get_task(task_id, user_id)
    if not task:
        raise KeyError(task_id)
    state = ports.latest_runtime_state(user_id)
    query = f"Resume task {task['title']} with energy {state.get('energy')} stress {state.get('stress')}"
    memories = ports.search_memories(user_id, query, top_k=4)
    latest_dump = None
    episode = None
    with ports.connect() as conn:
        row = ContextDumpRepository(conn).latest_for_task(user_id=user_id, task_id=task_id)
        episode_row = InterruptionEpisodeRepository(conn).latest_open_for_task(user_id=user_id, task_id=task_id)
        if episode_row:
            generated_at = ports.user_clock_now(user_id, ports.ensure_profile(user_id).get("timezone") or "Asia/Shanghai").isoformat()
            InterruptionEpisodeRepository(conn).mark_guidance(user_id=user_id, episode_id=episode_row["id"], generated_at=generated_at, timestamp=ports.now())
            episode = ports.interruption_episode_row(InterruptionEpisodeRepository(conn).get(user_id=user_id, episode_id=episode_row["id"]))
    if row:
        latest_dump = {
            "progress": row["progress"],
            "open_questions": ports.decode(row["open_questions"], []),
            "next_action": row["next_action"],
            "stop_reason": row["stop_reason"],
        }
    checkpoint = recovery_context(task, latest_dump)
    first_step = (
        checkpoint.get('next_action')
        or "Review the saved note or task context and choose your next action."
    )
    prompt = (
        f"Resume task: {task['title']}. "
        f"{'Previous progress: ' + checkpoint['progress'] + '. ' if checkpoint.get('progress') else ''}"
        f"{'Open questions: ' + '; '.join(checkpoint['open_questions']) + '. ' if checkpoint.get('open_questions') else ''}"
        f"First action: {first_step}"
    )
    from .deterministic_scheduler import session_limit_minutes
    limit = session_limit_minutes(ports.ensure_profile(user_id).get('task_preferences') or {})
    remaining = (task.get('execution') or {}).get('remaining_duration_minutes')
    if remaining is None:
        remaining = task.get('duration')
    response = {
        "task_id": task_id,
        "prompt": prompt,
        "first_step": first_step,
        "suggested_block_minutes": min(limit, max(int(remaining), 0)) if remaining is not None else None,
        "previous_progress": checkpoint.get('progress', ''),
        "previous_stop_reason": checkpoint.get('stop_reason', ''),
        "open_questions": checkpoint.get('open_questions', []),
        "task_remaining_minutes": int(
            task.get("duration", 0)
            if (task.get("execution") or {}).get("remaining_duration_minutes") is None
            else (task.get("execution") or {}).get("remaining_duration_minutes")
        ),
        "memory_evidence": memories,
        "interruption_episode_id": episode.get("id") if episode else None,
    }
    # Temporary response alias for older clients. New clients must use the
    # task-scoped name so it cannot be confused with Session remaining.
    response["remaining_duration_minutes"] = response["task_remaining_minutes"]
    ports.log_event(user_id, "reentry_prompt", response)
    return response
