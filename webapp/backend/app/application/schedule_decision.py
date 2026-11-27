"""Candidate scheduling orchestration, independent of HTTP and the Store implementation."""
from collections.abc import Callable
from dataclasses import dataclass
import json

from .ai_ordered_scheduler import generate_ordered_plan
from .scheduling_prompt_context import scheduling_prompt_context, CONTEXT_GUIDANCE
from ..domain.ai_output_models import ScheduleSoftReviewOutput
from ..domain.plan_publication import publication_state


@dataclass(frozen=True)
class SchedulingPorts:
    ensure_profile: Callable
    list_tasks: Callable
    latest_runtime_state: Callable
    user_clock_now: Callable
    build_schedule_query: Callable
    search_memories: Callable
    analyze_schedule_inputs: Callable
    active_plan: Callable
    latest_proposed_plan: Callable
    validate_confirmed_schedule: Callable
    save_proposed_plan: Callable
    log_event: Callable
    typed_completion: Callable
    encode: Callable
    read_requested_plan: Callable
    capture_scope: Callable
    list_execution_sessions: Callable | None = None
    recent_behavior: Callable | None = None
    learned_behavior: Callable | None = None


def decide_schedule(user_id: str, payload: dict, *, ports: SchedulingPorts,
                    request_lock, request_cache, scheduling_job_id=None) -> dict:

    if payload.get('adjustment_trigger') == 'daily-checkin':
        payload = {**payload, 'replan_scope': 'today', 'affected_task_ids': []}
    request_id = str(payload.get("request_id") or "").strip()
    cache_key = f"{user_id}:{request_id}" if request_id else ""
    with request_lock:
        if request_id:
            # SQLite owns both lifecycle and edited content, including after a
            # restart. A cached snapshot is never authority for replay.
            saved = ports.read_requested_plan(user_id, request_id, payload.get('week_id'))
            if saved is not None:
                return json.loads(json.dumps(saved))
            if cache_key in request_cache:
                raise ValueError('原排程记录已不存在，请刷新后重新发起。')
        profile = ports.ensure_profile(user_id)
        all_tasks = payload.get("tasks") or ports.list_tasks(user_id)
        week_id = str(payload.get("week_id") or profile.get("active_week_id") or (profile.get("weekly_context") or {}).get("week_id") or "")
        # Capture before slow model work; publication rechecks under its write
        # transaction. Never accept a client-supplied concurrency token here.
        active = ports.active_plan(user_id, week_id)
        proposed = ports.latest_proposed_plan(user_id, week_id)
        expected_plan_state = publication_state(active, proposed)
        tasks = [
            task for task in all_tasks
            if not task.get("removed_from_week")
            and (not week_id or not task.get("week_id") or str(task.get("week_id")) == week_id)
        ]
        scope_policy = ports.capture_scope(user_id, payload=payload, baseline=active,
            tasks=tasks, now=ports.user_clock_now(user_id, profile.get('timezone') or 'Asia/Shanghai'), week_id=week_id)
        runtime_state = ports.latest_runtime_state(user_id)
        if runtime_state.get('reported_at') or runtime_state.get('created_at'):
            from ..domain.runtime_observation import current_day_observation, submitted_values
            runtime_state = current_day_observation({**runtime_state, 'reported_fields': runtime_state.get('reported_fields', list(submitted_values(runtime_state)))}, ports.user_clock_now(user_id, profile.get('timezone') or 'Asia/Shanghai'))
        payload = {**payload, "runtime_state": runtime_state}
        query = payload.get("query") or ports.build_schedule_query(tasks, runtime_state)
        memories = []  # Behavior context is supplied through the two dedicated sources below.
        analysis_state = {
            "user_id": user_id,
            "payload": payload,
            "profile": profile,
            "tasks": tasks,
            "runtime_state": runtime_state,
            "query": query,
            "memories": memories,
        }
        analysis = ports.analyze_schedule_inputs(analysis_state)
        if analysis.get('provider') in {'local_fallback', 'local_deterministic'} and tasks:
            raise ValueError('AI 任务分析暂不可用，当前计划未改变。请重试。 AI task analysis unavailable; retry.')
        # Confirmed calendar commitments are the scheduling baseline. A
        # stale proposed revision must never move Profile/onboarding tasks
        # that the user has already confirmed.
        existing_plan = active or proposed
        decision_context = scheduling_prompt_context(
            profile=profile, tasks=tasks, runtime_state=runtime_state,
            memories=memories,
            plan=existing_plan, scope_policy=scope_policy,
        )
        if ports.list_execution_sessions is not None:
            from .scheduling_prompt_context import select_fields
            sessions = ports.list_execution_sessions(user_id, ['running', 'paused', 'ready'])
            decision_context['execution_sessions'] = [select_fields(session, (
                'execution_session_id', 'task_id', 'status', 'week_id', 'plan_revision',
                'planned_start_at', 'planned_end_at', 'planned_work_minutes',
                'session_remaining_minutes', 'live_active_minutes',
            )) for session in sessions if not week_id or session.get('week_id') == week_id] if isinstance(sessions, list) else []
        from .behavior_prompt_context import add_behavior_context
        add_behavior_context(decision_context, user_id, recent_behavior=ports.recent_behavior,
                             learned_behavior=ports.learned_behavior)
        decision = generate_ordered_plan(
            profile=profile, tasks=tasks, analysis=analysis, existing_plan=existing_plan,
            payload={**payload, "_replan_policy": scope_policy},
            decision_context=decision_context, typed_completion=ports.typed_completion,
            encode=ports.encode,
            validate=lambda candidate: ports.validate_confirmed_schedule(
                user_id, {**candidate, 'user_id': user_id}, scope_policy=scope_policy or False),
        )
        review_payload = {
            "decision_context": decision_context,
            "ai_task_order": decision.get("ai_task_order"),
            "profile_rules": decision.get("scheduler"),
            "sessions": [
                {
                    key: block.get(key)
                    for key in ("task_id", "day_index", "start", "end", "planned_work_minutes")
                }
                for block in decision.get("plan_patch", [])
            ],
            "unscheduled_tasks": decision.get("unscheduled_tasks", []),
            "task_demands": analysis.get("task_demands", []),
            "dependencies": analysis.get("dependencies", []),
            "personalization": decision.get("personalization", {}),
        }
        ai_soft_review = ports.typed_completion([
            {"role": "system", "content": CONTEXT_GUIDANCE + "Review this AI-ordered, Python-allocated weekly schedule for soft risks only. Do not change exact times. Return JSON with status, risks, strengths, and user_message. Consider cognitive load, context switching, buffer, deadline pressure, and profile rhythm."},
            {"role": "user", "content": ports.encode(review_payload)},
        ], ScheduleSoftReviewOutput, "schedule_soft_review", temperature=0.1)
        decision["ai_soft_review"] = ai_soft_review if isinstance(ai_soft_review, dict) else {
            "status": "unavailable",
            "risks": [],
            "strengths": ["The draft passed deterministic timeline allocation and hard-constraint validation."],
            "user_message": "The AI-ordered draft passed timeline validation; AI soft-risk review was unavailable.",
        }
        if scope_policy:
            decision['replan_policy'] = scope_policy
            decision['week_id'] = week_id
        validation = ports.validate_confirmed_schedule(user_id, {**decision, "user_id": user_id}, scope_policy=scope_policy or False)
        decision["validation"] = validation
        from .planning_outcome import is_capacity_draft
        if not validation.get('valid') and not is_capacity_draft(decision, validation):
            raise ValueError('日历约束已变化，当前计划未改变。请重新生成。 Calendar constraints changed; generate again.')
        decision["ai_soft_review"]["hard_constraints_authority"] = "python"
        if request_id:
            decision["request_id"] = request_id
        # A generated schedule is a draft Plan.  It does not write formal
        # task Slots until the user confirms the whole plan.
        decision = ports.save_proposed_plan(user_id, decision, {**payload, 'week_id': week_id},
                                            expected_plan_state=expected_plan_state,
                                            scheduling_job_id=scheduling_job_id)
        ports.log_event(user_id, "schedule_decision", decision)
        if cache_key:
            # Retain only a bounded existence marker, never a stale Plan body.
            request_cache.remember(cache_key)
        return decision
