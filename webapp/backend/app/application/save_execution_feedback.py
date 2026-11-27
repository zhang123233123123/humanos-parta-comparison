"""Execution feedback orchestration; repositories share the caller connection."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.execution_feedback import ExecutionFeedbackRepository
from ..repositories.execution_sessions import ExecutionSessionRepository
from ..repositories.interruption_episodes import InterruptionEpisodeRepository
from ..repositories.tasks import TaskRepository
from ..repositories.plans import PlanRepository
from ..repositories.profiles import ProfileRepository
from ..domain.execution_continuation import continuation_baseline
from ..domain.feedback_request import require_same_feedback_target


@dataclass(frozen=True)
class ExecutionFeedbackPorts:
    get_task: Callable
    ensure_profile: Callable
    connect: Callable
    atomic: Callable
    decode: Callable
    execution_parallel_context: Callable
    interruption_episode_row: Callable
    make_id: Callable
    now: Callable
    encode: Callable
    user_clock_now: Callable
    _insert_state_transition: Callable
    _enqueue_personalization: Callable
    add_memory: Callable
    log_event: Callable


def save_execution_feedback(user_id: str, payload: dict, *, ports: ExecutionFeedbackPorts) -> dict:
    # Profile initialization may index memory. Keep it outside the write lock;
    # the authoritative task/profile reads are repeated inside settlement.
    if not ports.get_task(payload["task_id"], user_id):
        raise KeyError(payload["task_id"])
    ports.ensure_profile(user_id)
    # Serialize reads and settlement together; external indexing stays outside.
    with ports.atomic():
        feedback, task = _persist_execution_feedback(user_id, payload, ports=ports)
    if task is None:
        return feedback
    return _publish_execution_feedback(user_id, payload, feedback, task, ports=ports)


def _persist_execution_feedback(user_id: str, payload: dict, *, ports: ExecutionFeedbackPorts):
    """Store three feedback targets separately and preserve the same task identity."""
    task_id = payload["task_id"]
    task = ports.get_task(task_id, user_id)
    if not task:
        raise KeyError(task_id)
    feedback_profile = ports.ensure_profile(user_id)
    session_trait_refs: list[str] = []
    settled_actual_minutes = 0
    inherited_active_minutes = 0
    execution_context = {"attribution": "unknown", "derived_by": "no_execution_session"}
    if payload.get("execution_session_id"):
        with ports.connect() as conn:
            source_session = ExecutionSessionRepository(conn).get(user_id=user_id, session_id=payload.get("execution_session_id"))
        if not source_session:
            raise KeyError(payload.get("execution_session_id"))
        if str(source_session["task_id"]) != str(task_id):
            raise ValueError("execution session does not belong to the feedback task")
        snapshot = ports.decode(source_session['interruption_snapshot_json'], {})
        settled_actual_minutes = int(snapshot.get('actual_minutes') or 0)
        inherited_active_minutes = continuation_baseline(snapshot)
        session_trait_refs = [str(item) for item in ports.decode(source_session["profile_trait_refs_json"], []) if str(item)]
        execution_context = ports.execution_parallel_context(user_id, source_session)
    request_id = str(payload.get("request_id") or "").strip() or None
    if request_id:
        with ports.connect() as conn:
            existing = ExecutionFeedbackRepository(conn).find_request(user_id=user_id, request_id=request_id)
        if existing:
            require_same_feedback_target(existing, payload)
            replay_result = {
                "id": existing["id"],
                "user_id": existing["user_id"],
                "task_id": existing["task_id"],
                "trigger": existing["trigger"],
                "task_evaluation": ports.decode(existing["task_evaluation_json"], {}),
                "state_evaluation": ports.decode(existing["state_evaluation_json"], {}),
                "recommendation_evaluation": ports.decode(existing["recommendation_evaluation_json"], {}),
                "execution_session_id": existing["execution_session_id"],
                "request_id": existing["request_id"],
                "research_context_revision": existing["research_context_revision"],
                "profile_trait_refs": ports.decode(existing["profile_trait_refs_json"], []),
                "execution_context": ports.decode(existing["execution_context_json"], {}),
                "created_at": existing["created_at"],
            }
            with ports.connect() as episode_conn:
                episode = InterruptionEpisodeRepository(episode_conn).latest_settled(user_id=user_id, session_id=existing["execution_session_id"])
            replay_result["recovery_episode"] = ports.interruption_episode_row(episode)
            return replay_result, None
    feedback = {
        "id": ports.make_id("feedback"),
        "user_id": user_id,
        "task_id": task_id,
        "trigger": payload.get("trigger", "task_completed"),
        "task_evaluation": payload.get("task_evaluation") or {},
        "state_evaluation": payload.get("state_evaluation") or {},
        "recommendation_evaluation": {
            **(payload.get("recommendation_evaluation") or {}),
            **({"parallel_evaluation": payload.get("parallel_evaluation")} if payload.get("parallel_evaluation") else {}),
        },
        "parallel_evaluation": payload.get("parallel_evaluation"),
        "execution_session_id": payload.get("execution_session_id"),
        "request_id": request_id,
        "research_context_revision": int(feedback_profile.get("research_context_revision") or 0),
        "profile_trait_refs": session_trait_refs,
        "execution_context": execution_context,
        "created_at": ports.now(),
    }
    task_eval = feedback["task_evaluation"]
    from ..domain.task import apply_execution_feedback

    feedback_decision = apply_execution_feedback(
        task,
        {**task_eval, "_execution_session_id": feedback.get("execution_session_id")},
        feedback_id=feedback["id"],
        feedback_created_at=feedback["created_at"],
        settled_actual_minutes=settled_actual_minutes,
        inherited_active_minutes=inherited_active_minutes,
    )
    recovery_episode_result = None
    with ports.connect() as conn:
        ExecutionFeedbackRepository(conn).insert({
            **{key: feedback[key] for key in ("id", "user_id", "task_id", "trigger",
                "execution_session_id", "request_id", "research_context_revision", "created_at")},
            **{key + "_json": ports.encode(feedback[key]) for key in (
                "task_evaluation", "state_evaluation", "recommendation_evaluation",
                "profile_trait_refs", "execution_context")},
        })
        if feedback["execution_session_id"]:
            outcome = str((feedback["task_evaluation"] or {}).get("completion") or "partial")
            from ..domain.task import feedback_session_status, require_execution_transition

            session_status = feedback_session_status(outcome)
            session_row = ExecutionSessionRepository(conn).get(user_id=user_id, session_id=feedback["execution_session_id"])
            if not session_row:
                raise KeyError(feedback["execution_session_id"])
            require_execution_transition(str(session_row["status"]), session_status)
            confirmed_actual = feedback_decision.actual_minutes
            ExecutionSessionRepository(conn).save_feedback(
                user_id=user_id, session_id=feedback["execution_session_id"],
                status=session_status, outcome=outcome,
                ended_at=ports.user_clock_now(user_id, feedback_profile.get("timezone") or "Asia/Shanghai").isoformat(),
                actual_minutes=confirmed_actual, timestamp=feedback["created_at"],
                snapshot_json=ports.encode({
                    **ports.decode(session_row['interruption_snapshot_json'], {}),
                    'actual_minutes': confirmed_actual,
                }),
            )
            ports._insert_state_transition(
                conn,
                user_id=user_id,
                task_id=task_id,
                before_status=str(session_row["status"]),
                action_type="submit_feedback",
                after_status=session_status,
                execution_session_id=feedback["execution_session_id"],
                outcome={"persisted": True, "completion": outcome, "actual_minutes": confirmed_actual},
                created_at=feedback["created_at"],
            )
            recovery_episode = InterruptionEpisodeRepository(conn).active_recovery(user_id=user_id, session_id=feedback["execution_session_id"])
            if recovery_episode:
                recovery_outcome = {
                    "completion": outcome,
                    "actual_minutes_after_resume": max(confirmed_actual - int(recovery_episode["active_minutes_before_resume"] or 0), 0),
                    "reinterrupted": False,
                    "state_evaluation": feedback["state_evaluation"],
                }
                settled_at = ports.user_clock_now(user_id, feedback_profile.get("timezone") or "Asia/Shanghai").isoformat()
                InterruptionEpisodeRepository(conn).settle_feedback(user_id=user_id, episode_id=recovery_episode["id"], outcome_json=ports.encode(recovery_outcome), settled_at=settled_at, timestamp=feedback["created_at"])
                recovery_episode_result = ports.interruption_episode_row(InterruptionEpisodeRepository(conn).get(user_id=user_id, episode_id=recovery_episode["id"]))
                ports._enqueue_personalization(conn, user_id=user_id, kind="interruption_recovery_outcome", source_id=f"{recovery_episode['id']}:feedback", payload={"episode": recovery_episode_result}, timestamp=feedback["created_at"])
        from ..domain.task import update_field_provenance

        feedback_fields = {"status"}
        if (feedback_decision.task_demand or {}).get("expected_difficulty") is not None:
            feedback_fields.add("expected_difficulty")
        feedback_provenance = update_field_provenance(
            task.get("field_provenance"), fields=feedback_fields,
            source="execution_feedback", source_id=feedback["id"], updated_at=feedback["created_at"],
        )
        TaskRepository(conn).save_feedback(
            user_id=user_id, task_id=task_id, execution_json=ports.encode(feedback_decision.execution),
            demand_json=ports.encode(feedback_decision.task_demand), status=feedback_decision.task_status,
            difficulty=(feedback_decision.task_demand or {}).get("expected_difficulty"),
            provenance_json=ports.encode(feedback_provenance), timestamp=feedback["created_at"],
        )
        schedule_action = str(payload.get("schedule_action") or "keep_time_free")
        requires_plan_adjustment = feedback_decision.execution.get("remaining_duration_minutes", 0) > 0 or schedule_action == "review_today"
        if requires_plan_adjustment:
            PlanRepository(conn).mark_needs_update(user_id=user_id, week_id=task.get("week_id"), timestamp=feedback["created_at"])
            ProfileRepository(conn).invalidate_active_revision(user_id=user_id, timestamp=feedback["created_at"])
        ports._enqueue_personalization(
            conn, user_id=user_id, kind="execution_feedback", source_id=feedback["id"], timestamp=feedback["created_at"],
            payload={"feedback": feedback, "task": task},
        )
    feedback["task"] = ports.get_task(task_id, user_id)
    feedback["recovery_episode"] = recovery_episode_result
    feedback["requires_plan_adjustment"] = requires_plan_adjustment
    feedback["schedule_action"] = schedule_action
    return feedback, task


def _publish_execution_feedback(user_id, payload, feedback, task, *, ports: ExecutionFeedbackPorts):
    task_id = feedback["task_id"]
    task_eval = feedback["task_evaluation"]
    ports.add_memory(
        user_id=user_id,
        source_type="episodic_memory",
        source_id=feedback["id"],
        task_id=task_id,
        text=(
            f"Task episode {task['title']}. Trigger: {feedback['trigger']}. "
            f"Task evaluation: {ports.encode(task_eval)}. State after: "
            f"{ports.encode(feedback['state_evaluation'])}. Parallel experience: "
            f"{ports.encode(feedback['parallel_evaluation']) if feedback['parallel_evaluation'] else 'not_applicable'}."
        ),
        metadata={
            "kind": "parallel_execution_episode" if feedback["parallel_evaluation"] else "execution_episode",
            "eligible_for_pattern": True,
            "pattern_label": payload.get("pattern_label") or ("parallel_pair_experience" if feedback["parallel_evaluation"] else feedback["trigger"]),
            "parallel_group_id": (feedback["parallel_evaluation"] or {}).get("parallel_group_id"),
            "partner_task_ids": (feedback["parallel_evaluation"] or {}).get("partner_task_ids", []),
        },
    )
    ports.log_event(user_id, "execution_feedback_saved", feedback)
    return feedback
