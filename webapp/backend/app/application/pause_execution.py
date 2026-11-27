"""Pause settlement and recovery evidence on one database transaction."""
from collections.abc import Callable
from dataclasses import dataclass
import json
from ..domain.execution import settle_interruption
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.interruption_episodes import InterruptionEpisodeRepository


@dataclass(frozen=True)
class PauseExecutionPorts:
    ensure_profile: Callable
    user_clock_now: Callable
    connect: Callable
    _execution_request_seen: Callable
    execution_session_row: Callable
    get_task: Callable
    interruption_episode_row: Callable
    _iso_elapsed_minutes: Callable
    _enqueue_personalization: Callable
    latest_runtime_state: Callable
    _insert_state_transition: Callable
    _record_execution_request: Callable
    now: Callable
    encode: Callable
    new_id: Callable


def pause_execution(user_id: str, payload: dict, *, ports: PauseExecutionPorts) -> dict:
    session_id = str(payload.get("execution_session_id") or "")
    timestamp = ports.now()
    profile = ports.ensure_profile(user_id)
    paused_at = str(payload.get("paused_at") or ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai").isoformat())
    confirmed_minutes = max(int(payload.get("actual_minutes") or 0), 0)
    reported_remaining = payload.get('task_remaining_minutes')
    if reported_remaining is not None and (type(reported_remaining) is not int or reported_remaining < 0):
        raise ValueError('task_remaining_minutes must be a non-negative integer')
    pause_reason = str(payload.get("pause_reason") or "").strip()
    interruption_action = str(payload.get("interruption_action") or payload.get("action") or "continue_later").strip()
    resume_preference = str(payload.get("resume_preference") or "unknown").strip()
    preferred_resume_at = str(payload.get("preferred_resume_at") or "").strip() or None
    request_id = str(payload.get("request_id") or "").strip() or None
    with ports.connect() as conn:
        from ..repositories import TaskRepository

        tasks = TaskRepository(conn)
        sessions = ExecutionSessionRepository(conn)
        episodes = InterruptionEpisodeRepository(conn)
        replay = ports._execution_request_seen(conn, user_id, request_id)
        if replay:
            result = ports.execution_session_row(replay)
            replay_task = ports.get_task(str(replay["task_id"]), user_id) or {}
            result["task_remaining_minutes"] = int(
                (replay_task.get("execution") or {}).get(
                    "remaining_duration_minutes",
                    replay_task.get("duration") or replay["planned_work_minutes"] or 0,
                )
            )
            episode = episodes.find_request(user_id=user_id, request_id=request_id) if request_id else None
            result["interruption_episode"] = ports.interruption_episode_row(episode)
            return result
        row = sessions.get(user_id=user_id, session_id=session_id)
        if not row:
            raise KeyError(session_id)
        if payload.get('expected_status') and row['status'] != payload['expected_status']:
            raise ValueError('Execution session status changed; refresh before interrupting')
        from ..domain.task import require_execution_transition

        require_execution_transition(str(row["status"]), "paused")
        calculated = int(row["accumulated_active_minutes"] or 0)
        elapsed_segment = 0
        if row["status"] == "running":
            elapsed_segment = ports._iso_elapsed_minutes(row["resumed_at"] or row["actual_start_at"], paused_at)
        task = ports.get_task(str(row["task_id"]), user_id) or {}
        task_remaining = int((task.get("execution") or {}).get("remaining_duration_minutes", task.get("duration") or row["planned_work_minutes"] or 0))
        from ..domain.execution_continuation import continuation_baseline, continuation_snapshot
        baseline = continuation_baseline(json.loads(row['interruption_snapshot_json'] or '{}'))
        report = (task.get('execution') or {}).get('remaining_work_report') or {}
        reported_baseline = int(report.get('session_active_minutes') or 0) if report.get('execution_session_id') == session_id else 0
        settlement = settle_interruption(
            planned_session_minutes=int(row["planned_work_minutes"] or 0) + baseline,
            previous_active_minutes=calculated,
            elapsed_segment_minutes=elapsed_segment,
            reported_active_minutes=confirmed_minutes,
            previous_task_remaining_minutes=task_remaining + max(reported_baseline - calculated, 0),
        )
        task_remaining_after = settlement.task_remaining_minutes if reported_remaining is None else reported_remaining
        active = settlement.effective_active_minutes
        remaining_minutes = settlement.session_remaining_minutes
        from ..domain.execution import build_interruption_snapshot

        interruption_snapshot = build_interruption_snapshot(
            task_id=str(row["task_id"]),
            execution_session_id=session_id,
            plan_revision=row["plan_revision"],
            actual_minutes=active,
            remaining_minutes=remaining_minutes,
            action=interruption_action,
            reason=pause_reason,
            progress=str(payload.get("progress") or ""),
            next_step=str(payload.get("next_step") or ""),
        )
        prior_link = json.loads(row['interruption_snapshot_json'] or '{}').get('recommendation_link')
        if prior_link:
            interruption_snapshot['recommendation_link'] = prior_link
        interruption_snapshot['task_remaining_minutes'] = task_remaining_after
        interruption_snapshot['task_remaining_source'] = 'user_report' if reported_remaining is not None else 'elapsed_work_calculation'
        interruption_snapshot['open_questions'] = payload.get('open_questions') or []
        if baseline:
            interruption_snapshot = continuation_snapshot(interruption_snapshot, baseline)
        sessions.save_pause((paused_at, active, pause_reason, interruption_snapshot["action"], ports.encode(interruption_snapshot), resume_preference, preferred_resume_at, remaining_minutes, timestamp, session_id, user_id))
        prior_recovery = episodes.active_recovery(user_id=user_id, session_id=session_id)
        if prior_recovery:
            prior_outcome = {"reinterrupted": True, "completion": None, "actual_minutes_after_resume": max(active - int(prior_recovery["active_minutes_before_resume"] or 0), 0)}
            episodes.settle_reinterrupted((ports.encode(prior_outcome), paused_at, timestamp, prior_recovery["id"]))
            settled_prior = ports.interruption_episode_row(episodes.get(user_id=user_id, episode_id=prior_recovery["id"]))
            ports._enqueue_personalization(conn, user_id=user_id, kind="interruption_recovery_outcome", source_id=f"{prior_recovery['id']}:reinterrupted", payload={"episode": settled_prior}, timestamp=timestamp)
        episode_id = ports.new_id("interruption")
        demand_snapshot = {
            "expected_difficulty": task.get("expected_difficulty"), "cognitive_load": task.get("cognitive_load"),
            "ambiguity": task.get("ambiguity"), "switch_cost": task.get("switch_cost"),
            "reentry_cost": task.get("reentry_cost"), "resource_modality": task.get("resource_modality") or [],
            "attention_mode": task.get("attention_mode"),
        }
        runtime_snapshot = ports.latest_runtime_state(user_id)
        episodes.insert_pending(
            (episode_id, user_id, str(row["task_id"]), session_id, interruption_snapshot["action"], pause_reason, paused_at, remaining_minutes, ports.encode(demand_snapshot), ports.encode(runtime_snapshot), row["profile_trait_refs_json"], "pending", request_id, timestamp, timestamp),
        )
        execution = dict(task.get("execution") or {})
        execution["accumulated_actual_minutes"] = int(execution.get("accumulated_actual_minutes") or 0) + max(settlement.effective_active_minutes - settlement.previous_active_minutes, 0)
        execution["remaining_duration_minutes"] = task_remaining_after
        if reported_remaining is not None:
            execution['remaining_work_report'] = {'minutes': reported_remaining, 'source': 'user_report',
                'execution_session_id': session_id, 'reported_at': paused_at}
        tasks.save_execution_state(
            task_id=str(row["task_id"]),
            user_id=user_id,
            execution_json=ports.encode(execution),
            status="paused",
            timestamp=timestamp,
        )
        ports._insert_state_transition(conn, user_id=user_id, task_id=row["task_id"], before_status=str(row["status"]), action_type="pause", after_status="paused", execution_session_id=session_id, action_detail={"interruption": interruption_snapshot, "resume_preference": resume_preference, **settlement.to_dict(), 'task_remaining_minutes': task_remaining_after, 'reported_task_remaining_minutes': reported_remaining}, created_at=timestamp)
        ports._record_execution_request(conn, user_id, request_id, session_id, "pause", timestamp)
        updated = sessions.get(user_id=user_id, session_id=session_id)
    result = ports.execution_session_row(updated)
    result["task_remaining_minutes"] = task_remaining_after
    with ports.connect() as conn:
        episode = InterruptionEpisodeRepository(conn).latest_source(user_id=user_id, session_id=session_id)
    result["interruption_episode"] = ports.interruption_episode_row(episode)
    return result
