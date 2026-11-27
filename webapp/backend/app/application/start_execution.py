"""Start or resume execution with explicit transaction and policy capabilities."""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import json
from ..domain.task.eligibility import require_executable_task
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.interruption_episodes import InterruptionEpisodeRepository
from ..repositories.tasks import TaskRepository


@dataclass(frozen=True)
class StartExecutionPorts:
    now: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    connect: Callable
    _execution_request_seen: Callable
    execution_session_row: Callable
    interruption_episode_row: Callable
    _record_execution_request: Callable
    _episode_for_resume: Callable
    _parallel_start_allowed: Callable
    _insert_state_transition: Callable
    _enqueue_personalization: Callable
    analyze_execution_impact: Callable


def start_execution(user_id: str, payload: dict, *, ports: StartExecutionPorts) -> dict:
    session_id = str(payload.get("execution_session_id") or "")
    block_id = str(payload.get("block_id") or "")
    request_id = str(payload.get("request_id") or "").strip() or None
    timestamp = ports.now()
    profile = ports.ensure_profile(user_id)
    actual_start = str(payload.get("actual_start_at") or ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai").isoformat())
    with ports.connect() as conn:
        sessions = ExecutionSessionRepository(conn)
        episodes = InterruptionEpisodeRepository(conn)
        replay = ports._execution_request_seen(conn, user_id, request_id)
        if replay:
            result = ports.execution_session_row(replay)
            episode = episodes.latest_resumed(user_id=user_id, session_id=replay["id"])
            result["recovery_episode"] = ports.interruption_episode_row(episode)
            return result
        row = sessions.find_start_target(user_id=user_id, session_id=session_id, block_id=block_id)
        if not row:
            raise KeyError(session_id or block_id)
        if row["status"] == "running":
            ports._record_execution_request(conn, user_id, request_id, row["id"], "start", timestamp)
            return ports.execution_session_row(row)
        from ..domain.task import require_execution_transition

        require_execution_transition(str(row["status"]), "running")
        task_row = TaskRepository(conn).get_for_user(task_id=row['task_id'], user_id=user_id)
        task = dict(task_row) if task_row else None
        if task is not None:
            task['contextWindow'] = json.loads(task.get('context_window_json') or '{}')
        require_executable_task(task)
        recovery_episode = ports._episode_for_resume(conn, user_id, row)
        other = sessions.other_running(user_id=user_id, session_id=row["id"])
        if len(other) >= 2:
            raise ValueError("At most two confirmed parallel sessions may run together")
        for active in other:
            if not ports._parallel_start_allowed(user_id, str(row["block_id"]), str(active["block_id"])):
                raise ValueError("Another non-parallel session is already running")
        from ..domain.execution.impact_confirmation import require_impact_confirmation
        impact = ports.analyze_execution_impact(user_id, {
            'execution_session_id': row['id'], 'action': 'resume' if row['status'] == 'paused' else 'start',
        })
        require_impact_confirmation(impact, payload.get('confirm_schedule_impact'), payload.get('impact_confirmation_token'))
        sessions.mark_running(session_id=row["id"], user_id=user_id, actual_start=actual_start,
            request_id=request_id, timestamp=timestamp)
        TaskRepository(conn).update_fields(task_id=row["task_id"], user_id=user_id, updates={"status": "running", "updated_at": timestamp})
        ports._insert_state_transition(conn, user_id=user_id, task_id=row["task_id"], before_status=str(row["status"]), action_type="resume" if row["status"] == "paused" else "start", after_status="running", execution_session_id=row["id"], created_at=timestamp)
        if recovery_episode:
            try:
                pause_time = datetime.fromisoformat(str(recovery_episode["paused_at"]).replace("Z", "+00:00"))
                resume_time = datetime.fromisoformat(actual_start.replace("Z", "+00:00"))
                latency = max(int((resume_time - pause_time).total_seconds() // 60), 0)
            except (TypeError, ValueError):
                latency = None
            episodes.mark_resumed(user_id=user_id, episode_id=recovery_episode["id"], session_id=row["id"],
                resumed_at=actual_start, latency=latency, active_minutes=int(row["accumulated_active_minutes"] or 0), timestamp=timestamp)
            updated_episode_row = episodes.get(user_id=user_id, episode_id=recovery_episode["id"])
            updated_episode = ports.interruption_episode_row(updated_episode_row)
            ports._enqueue_personalization(conn, user_id=user_id, kind="interruption_recovery_attempt", source_id=str(recovery_episode["id"]), payload={"episode": updated_episode}, timestamp=timestamp)
        ports._record_execution_request(conn, user_id, request_id, row["id"], "start", timestamp)
        updated = sessions.get(user_id=user_id, session_id=row["id"])
    result = ports.execution_session_row(updated)
    result["recovery_episode"] = updated_episode if recovery_episode else None
    return result
