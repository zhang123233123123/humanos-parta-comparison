"""Generate, review and apply execution advice with explicit dependencies.

Application preserves the checkpoint transaction; indexing occurs after commit.
"""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from ..domain.ai_output_models import HelpDecideOutput
from ..repositories.recommendation_events import RecommendationEventRepository
from .recovery_context import recovery_context


@dataclass(frozen=True)
class RecommendationWorkflowPorts:
    list_execution_sessions: Callable
    get_task: Callable
    save_runtime_state: Callable
    ensure_profile: Callable
    user_clock_now: Callable
    analyze_execution_impact: Callable
    typed_completion: Callable
    make_id: Callable
    log_event: Callable
    connect: Callable
    decode: Callable
    _recommendation_event: Callable
    atomic: Callable
    _original_help_decide: Callable
    _persist_help_decide_feedback: Callable
    now: Callable
    _enqueue_personalization: Callable
    safe_timezone: Callable
    build_scheduling_context: Callable
    iso_week_id: Callable
    _apply_help_decide_choice: Callable
    index_context_dump_memory: Callable
    latest_runtime_state: Callable
    active_plan: Callable
    start_execution_session: Callable
    interrupt_execution_session: Callable
    propose_continue_later_diff: Callable
    request_replan: Callable | None = None
    recent_behavior: Callable | None = None
    learned_behavior: Callable | None = None


def help_decide(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    try:
        return _generate_help_decide(user_id,payload,ports=ports)
    except Exception as exc:
        ports.log_event(user_id,'help_decide_generation_failed',{'task_id':payload.get('task_id'),
            'failure_stage':'generation','failure_code':type(exc).__name__})
        raise


def _generate_help_decide(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    from .help_decide import build_decision_evidence, recommendation_prompt, validate_recommendation
    from .decision_options import build_decision_options, check_decision_options
    from .ready_queue import build_ready_queue

    task_id = str(payload.get("task_id") or "")
    sessions = ports.list_execution_sessions(user_id, ["running", "paused", "ready"])
    session = next((item for item in sessions if str(item.get("task_id") or "") == task_id and item.get("status") in {"running", "paused"}), None)
    if not session:
        raise ValueError("No active execution session is available for this task")
    task = ports.get_task(task_id, user_id) or {}
    checkpoint = recovery_context(task, {**payload, 'stop_reason': payload.get('reason')})
    runtime_state = ports.latest_runtime_state(user_id)
    ready_sessions = [item for item in sessions if item.get("status") == "ready"]
    ready_tasks = {str(item.get("task_id") or ""): ports.get_task(str(item.get("task_id") or ""), user_id) or {} for item in ready_sessions}
    profile = ports.ensure_profile(user_id)
    ready_queue = build_ready_queue(
        ready_sessions, ready_tasks, exclude_task_id=task_id,
        plan_revision=session.get("plan_revision"), runtime_state=runtime_state,
        reference_now=ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai").isoformat(),
    )
    impact = ports.analyze_execution_impact(user_id, {
        "execution_session_id": session.get("execution_session_id"),
        "action": "help_decide",
        "remaining_duration_minutes": session.get("session_remaining_minutes"),
    })
    context = {
        "reason": str(payload.get("reason") or "").strip(),
        "locale": str(payload.get("locale") or "en"),
        "runtime_state": runtime_state,
        "recovery_context": checkpoint,
        "task": {key: task.get(key) for key in ("id", "title", "priority", "deadline_at", "expected_difficulty", "cognitive_load")},
        "execution_session": {key: session.get(key) for key in ("execution_session_id", "status", "planned_start_at", "planned_end_at", "planned_work_minutes", "live_active_minutes", "block_id", "week_id", "plan_revision")},
        "elapsed_minutes": int(session.get("live_active_minutes") or 0),
        "remaining_minutes": int(session.get("session_remaining_minutes") or 0),
        "ready_queue": ready_queue,
        "downstream_impact": impact,
    }
    from .scheduling_prompt_context import scheduling_prompt_context
    from .behavior_prompt_context import add_behavior_context
    import json
    shared = scheduling_prompt_context(profile=profile, tasks=[task], runtime_state=runtime_state)
    add_behavior_context(shared, user_id, recent_behavior=ports.recent_behavior,
                         learned_behavior=ports.learned_behavior)
    context['decision_context'] = shared
    context['task_preferences'] = profile.get('task_preferences') or {}
    context['option_checks'] = check_decision_options(user_id,context,session=session,task=task,
        profile=profile,ready_sessions=ready_sessions,ready_tasks=ready_tasks,ports=ports)
    options = build_decision_options(context)
    context['candidate_options'] = options
    if not options:
        raise ValueError('当前没有可直接执行的建议选项，请手动调整计划。 No feasible immediate options; review the plan.')
    ai_result = ports.typed_completion(recommendation_prompt(context), HelpDecideOutput, 'help_decide', temperature=0.1)
    selected = HelpDecideOutput.model_validate(ai_result).model_dump() if isinstance(ai_result,dict) else None
    candidate = next((option for option in options if selected and option['option_id'] == selected['recommended_option_id']),None)
    if candidate is None:
        raise ValueError('建议暂不可用，请重试或手动选择。 AI did not select an available option.')
    recommendation = {**candidate,'reason':selected['reason']}
    recommendation_id = ports.make_id("rec")
    import os
    baseline_plan = ports.active_plan(user_id, str(session.get('week_id') or '')) or {}
    result = {
        'prompt_version':'help_decide_options_v2', 'model':os.environ.get('DEEPSEEK_MODEL','deepseek-chat'),
        'generated_at':ports.now(), 'account_now':ports.user_clock_now(user_id,profile.get('timezone') or 'Asia/Shanghai').isoformat(),
        'plan_id':baseline_plan.get('plan_id'), 'plan_revision':baseline_plan.get('plan_revision'),
        "id": recommendation_id,
        "recommendation": recommendation,
        "options": options,
        "evidence": build_decision_evidence(context),
        "context": context,
        "provider": "deepseek",
    }
    ports.log_event(user_id, "help_decide_recommendation_created", result)
    return result

def _recommendation_event(user_id: str, recommendation_id: str, event_type: str, *, ports: RecommendationWorkflowPorts) -> dict | None:
    with ports.connect() as conn:
        row = RecommendationEventRepository(conn).latest(user_id, recommendation_id, event_type)
    return ports.decode(row["payload_json"], {}) if row else None

def _original_help_decide(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    recommendation_id = str(payload.get("recommendation_id") or "").strip()
    if not recommendation_id:
        raise ValueError("recommendation_id is required")
    original = ports._recommendation_event(user_id, recommendation_id, "help_decide_recommendation_created")
    if not original:
        raise KeyError(recommendation_id)
    task_id = (original.get("context") or {}).get("task", {}).get("id")
    if not task_id or str(payload.get("task_id") or "") != str(task_id):
        raise ValueError("Recommendation does not match the requested task")
    return original

def save_help_decide_feedback(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    # Positive confirmation must go through apply, so a standalone feedback
    # request cannot claim an action was executed.
    if payload.get("accepted") is not False:
        raise ValueError("Use the apply endpoint to confirm an execution choice")
    with ports.atomic():
        original = ports._original_help_decide(user_id, payload)
        existing = ports._recommendation_event(user_id, original["id"], "help_decide_recommendation_feedback")
        if existing:
            if existing.get("choice_status") == "declined":
                return existing
            raise ValueError("Recommendation already has a confirmed choice")
        return ports._persist_help_decide_feedback(user_id, original, None)

def _persist_help_decide_feedback(user_id: str, original: dict, selection: dict | None, *, ports: RecommendationWorkflowPorts) -> dict:
    from .recommendation_choice import classify_recommendation_choice
    from .recommendation_learning import recommendation_pattern_label

    recommendation_id = original["id"]
    classification = classify_recommendation_choice(original.get("recommendation"), selection, confirmed=selection is not None)
    accepted = classification.status == "original_accepted"
    context = original["context"]
    task_id = context["task"]["id"]
    feedback = {
        "user_id": user_id,
        "recommendation_id": recommendation_id,
        "accepted": accepted,
        "task_id": task_id,
        "original_recommendation": original.get("recommendation"),
        "selected_choice": selection,
        "choice_status": classification.status,
        "choice_reason_code": classification.reason_code,
        "choice_schema_version": 1,
        "execution_applied": selection is not None,
        'choice_id':f"{recommendation_id}:choice",
        'selected_option_id':selection.get('option_id') if selection else None,
        'confirmed_at':ports.now() if selection else None,
        'application_status':'applied' if selection else 'declined',
        'recommendation_context': {
            **{key:context.get(key) for key in ('reason','recovery_context','execution_session','task')},
            'momentary_state':(context.get('decision_context') or {}).get('momentary_state'),
            'recent_behavior_source_ids': [item['experience_id'] for item in
                ((context.get('decision_context') or {}).get('recent_behavior') or {}).get('items', [])],
        },
        'generation': {key:original.get(key) for key in ('prompt_version','model','generated_at','account_now','plan_id','plan_revision')},
        "recommended_action": (original.get("recommendation") or {}).get("action"),
        "selected_action": selection["action"] if selection else "user_choice",
        "execution_session_id": context.get("execution_session", {}).get("execution_session_id"),
        "created_at": ports.now(),
    }
    pattern_label = recommendation_pattern_label(
        reason=context.get("reason"),
        selected_action=feedback["selected_action"],
        accepted=accepted,
        choice_status=classification.status,
    )
    feedback["pattern_label"] = pattern_label
    feedback["reason"] = context.get("reason")
    task = ports.get_task(task_id, user_id) if task_id else None
    with ports.connect() as conn:
        if pattern_label:
            ports._enqueue_personalization(
                conn, user_id=user_id, kind="recommendation_feedback", source_id=recommendation_id,
                payload={"feedback": feedback, "task": task}, timestamp=feedback["created_at"],
            )
    ports.log_event(user_id, "help_decide_recommendation_feedback", feedback)
    return feedback

def check_resume_time(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    from .resume_time_options import evaluate_resume_time

    task_id = str(payload.get("task_id") or "")
    session = next((item for item in ports.list_execution_sessions(user_id, ["running", "paused"]) if str(item.get("task_id") or "") == task_id), None)
    if not session:
        raise ValueError("No active execution session is available for this task")
    try:
        preferred = datetime.fromisoformat(str(payload.get("preferred_resume_at") or "").replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ValueError("preferred_resume_at must be a valid ISO datetime")
    profile = ports.ensure_profile(user_id)
    timezone = ports.safe_timezone(profile.get("timezone") or "Asia/Shanghai")
    context = ports.build_scheduling_context(profile)
    occupied = [item for item in ports.list_execution_sessions(user_id, ["ready", "running", "paused"]) if item.get("execution_session_id") != session.get("execution_session_id")]
    return evaluate_resume_time(
        preferred=preferred,
        duration_minutes=int(payload.get("remaining_duration_minutes") or session.get("session_remaining_minutes") or 1),
        week_id=str(session.get("week_id") or profile.get("active_week_id") or ports.iso_week_id(preferred)),
        available_windows=context.get("full_available_windows") or context.get("windows") or [],
        occupied_sessions=occupied,
        timezone=timezone,
    )

def apply_help_decide_recommendation(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    try:
        return _apply_recommendation_transaction(user_id,payload,ports=ports)
    except Exception as exc:
        ports.log_event(user_id,'help_decide_apply_failed',{'recommendation_id':payload.get('recommendation_id'),
            'task_id':payload.get('task_id'),'application_status':'failed',
            'failure_stage':'confirmation_or_application','failure_code':type(exc).__name__})
        raise


def _apply_recommendation_transaction(user_id: str, payload: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    # Transaction and replay guard cover pause, optional switch/draft,
    # feedback and the response receipt together.
    with ports.atomic():
        original = ports._original_help_decide(user_id, payload)
        request = {key: payload.get(key) for key in (
            "task_id", "recommendation", "preferred_resume_at", "progress",
            "progress_percent", "task_remaining_minutes", "next_action", "open_questions",
        )}
        receipt = ports._recommendation_event(user_id, original["id"], "help_decide_choice_applied")
        if receipt:
            if receipt.get("request") != request:
                raise ValueError("Recommendation was already applied with a different choice")
            result = receipt["result"]
        else:
            if ports._recommendation_event(user_id, original["id"], "help_decide_recommendation_feedback"):
                raise ValueError("Recommendation already has feedback; request a new recommendation")
            result = ports._apply_help_decide_choice(user_id, payload, original)
            ports.log_event(user_id, "help_decide_choice_applied", {
                "recommendation_id": original["id"], "request": request, "result": result,
            })
    # Optional retrieval indexing must not hold the execution transaction
    # open or turn an already committed action into an apparent failure.
    dump = result["execution"].get("context_dump")
    if dump:
        try:
            ports.index_context_dump_memory(user_id, dump)
        except Exception as error:
            print(f"Recommendation context indexing failed after checkpoint commit: {type(error).__name__}", flush=True)
    execution = result['execution']
    if execution.get('requires_replan'):
        # Start model work only after the interruption receipt commits. Replays
        # use the same job key, including retries after a submission failure.
        result = {**result, 'execution': dict(execution)}
        try:
            result['execution']['replan'] = ports.request_replan(user_id, scope='today',
                trigger='help_decide_break', week_id=execution['execution_session']['week_id'],
                affected_task_ids=[payload['task_id']],
                request_id=f"{original['id']}:break-replan")
        except Exception as error:
            raise ValueError('休息已记录，但调整草案提交失败；日历未改变。请重试本次选择，不会重复暂停。 Break recorded; draft submission failed. Retry this choice.') from error
    return result

def _apply_help_decide_choice(user_id: str, payload: dict, original: dict, *, ports: RecommendationWorkflowPorts) -> dict:
    from .execution_interruption import interruption_response
    from .help_decide import validate_recommendation
    from .ready_queue import build_ready_queue

    task_id = str(payload.get("task_id") or "")
    sessions = ports.list_execution_sessions(user_id, ["running", "paused", "ready"])
    source_id = original["context"].get("execution_session", {}).get("execution_session_id")
    session = next((item for item in sessions if item.get("execution_session_id") == source_id and str(item.get("task_id") or "") == task_id and item.get("status") in {"running", "paused"}), None)
    if not session:
        raise ValueError("No active execution session is available for this task")
    ready_sessions = [item for item in sessions if item.get("status") == "ready"]
    ready_tasks = {str(item.get("task_id") or ""): ports.get_task(str(item.get("task_id") or ""), user_id) or {} for item in ready_sessions}
    runtime_state = ports.latest_runtime_state(user_id)
    ready_queue = build_ready_queue(
        ready_sessions,
        ready_tasks,
        exclude_task_id=task_id,
        plan_revision=session.get("plan_revision"),
        runtime_state=runtime_state,
        reference_now=ports.user_clock_now(
            user_id,
            ports.ensure_profile(user_id).get("timezone") or "Asia/Shanghai",
        ).isoformat(),
    )
    from .recommendation_choice import classify_recommendation_choice
    raw_choice = payload.get("recommendation")
    if classify_recommendation_choice(raw_choice, raw_choice, confirmed=True).status != "original_accepted":
        raise ValueError("A complete execution choice is required")
    recommendation = validate_recommendation(
        payload.get("recommendation"),
        {
            "runtime_state": runtime_state,
            "remaining_minutes": session.get("session_remaining_minutes"),
            "ready_queue": ready_queue,
            "reason": payload.get("reason"),
            "task_preferences": ports.ensure_profile(user_id).get("task_preferences") or {},
        },
    )
    if recommendation.get("validation", {}).get("violations"):
        raise ValueError("Selected choice is no longer available")
    if classify_recommendation_choice(raw_choice, recommendation, confirmed=True).status != "original_accepted":
        raise ValueError("Selected choice parameters changed; request a new recommendation")
    if 'candidate_options' in original.get('context', {}):
        from .decision_options import check_decision_options
        saved = next((option for option in original['context']['candidate_options']
            if classify_recommendation_choice(option,raw_choice,confirmed=True).status == 'original_accepted'),None)
        if saved is None:
            raise ValueError('Choice is not one of the saved code-generated options')
        checks = check_decision_options(user_id, {'remaining_minutes':session.get('session_remaining_minutes')},
            session=session, task=ports.get_task(task_id,user_id), profile=ports.ensure_profile(user_id),
            ready_sessions=ready_sessions, ready_tasks=ready_tasks, ports=ports)
        from .decision_options import build_decision_options
        latest_options = build_decision_options({'remaining_minutes':session.get('session_remaining_minutes'),
            'ready_queue':ready_queue, 'task_preferences':ports.ensure_profile(user_id).get('task_preferences') or {},
            'option_checks':checks})
        if not any(option['option_id'] == saved['option_id'] and
                   classify_recommendation_choice(option,raw_choice,confirmed=True).status == 'original_accepted'
                   for option in latest_options):
            raise ValueError('Selected option is no longer feasible; request new advice')
    action = recommendation["action"]
    if action == "continue_later" and not str(payload.get("preferred_resume_at") or "").strip():
        raise ValueError("preferred_resume_at is required for continue_later")
    if action == "continue_later":
        try:
            preferred = datetime.fromisoformat(str(payload["preferred_resume_at"]).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            raise ValueError("preferred_resume_at must be a valid ISO datetime")
        profile = ports.ensure_profile(user_id)
        current = ports.user_clock_now(user_id, profile.get("timezone") or "Asia/Shanghai")
        if preferred.tzinfo is None:
            preferred = preferred.replace(tzinfo=current.tzinfo)
        if preferred <= current:
            raise ValueError("preferred_resume_at must be in the future")
        recommendation["preferred_resume_at"] = preferred.isoformat()
        active = ports.active_plan(user_id, str(session.get("week_id") or "")) or {}
        if not active.get("plan_id") or active.get("plan_status") not in {"confirmed", "needs_update"}:
            raise ValueError("An active confirmed plan is required before leaving this task for later")
    context_payload = None
    if action in {"short_break", "continue_later", "switch_task"}:
        progress = str(payload.get("progress") or "").strip()
        next_action = str(payload.get("next_action") or "").strip()
        context_payload = {
            "task_id": task_id,
            "request_id": f"{payload.get('recommendation_id')}:context" if payload.get("recommendation_id") else None,
            "progress": progress,
            "progress_percent": min(max(int(payload["progress_percent"]), 0), 100) if payload.get("progress_percent") is not None else None,
            "task_remaining_minutes": max(int(payload["task_remaining_minutes"]), 0) if payload.get("task_remaining_minutes") is not None else None,
            "session_remaining_minutes": max(int(session.get("session_remaining_minutes") or 0), 0),
            "next_action": next_action,
            "open_questions": payload.get("open_questions") or [],
            "stop_reason": payload.get("reason") or "help_decide_recommendation",
            "materials": [],
        }
    reported_remaining = payload.get('task_remaining_minutes')
    if reported_remaining is not None and (type(reported_remaining) is not int or reported_remaining < 0):
        raise ValueError('task_remaining_minutes must be a non-negative integer')
    if action == 'continue_current' and reported_remaining is not None and reported_remaining < recommendation['duration_minutes']:
        raise ValueError('Reported remaining work no longer fits this option; request new advice')
    execution_result: dict = {"action": action, "execution_session": session,
        'recommendation_id':original['id'],'choice_id':f"{original['id']}:choice",
        'application_status':'applied','applied_at':ports.now(),
        'impact_confirmation':{'confirmed':payload.get('confirm_schedule_impact') is True,
            'token':payload.get('impact_confirmation_token')},
        'final_validation':checks.get(saved['option_id']) if 'candidate_options' in original.get('context',{}) else recommendation.get('validation'),
        'plan_revision_before':session.get('plan_revision')}
    if action == "continue_current":
        # A subsequent recommendation must not bypass the adjustment workflow.
        if session.get('confirmed_work_minutes') is not None:
            from ..domain.execution.adjustment import adjustment_review
            checked = adjustment_review(session=session, task=ports.get_task(task_id, user_id),
                plan=ports.active_plan(user_id, session.get('week_id')) or {},
                profile=ports.ensure_profile(user_id),
                now=ports.user_clock_now(user_id, ports.ensure_profile(user_id).get('timezone') or 'Asia/Shanghai'),
                requested_minutes=recommendation['duration_minutes'])
            if not checked['feasibility']['can_continue']:
                raise ValueError('下一段执行需要调整计划，请返回 Focus 复核下一段执行。')
        from ..domain.task.eligibility import require_executable_task
        require_executable_task(ports.get_task(task_id, user_id))
        if session.get("status") == "paused":
            resumed = ports.start_execution_session(user_id, {
                "execution_session_id": session.get("execution_session_id"),
                "request_id": f"{payload.get('recommendation_id')}:resume",
                "confirm_schedule_impact": payload.get('confirm_schedule_impact') is True,
                "impact_confirmation_token": payload.get('impact_confirmation_token'),
            })
            execution_result["execution_session"] = resumed
        # A confirmed work interval is independent of the task and calendar budgets.
        active_session = execution_result["execution_session"]
        baseline = float(active_session.get("accumulated_active_minutes") or 0) * 60
        started = active_session.get("resumed_at") or active_session.get("actual_start_at")
        if started:
            clock = ports.user_clock_now(user_id, ports.ensure_profile(user_id).get("timezone") or "Asia/Shanghai")
            baseline += max((clock - datetime.fromisoformat(str(started).replace("Z", "+00:00"))).total_seconds(), 0)
        from ..repositories.execution_sessions import ExecutionSessionRepository
        with ports.connect() as conn:
            ExecutionSessionRepository(conn).set_confirmed_work(
                user_id=user_id, session_id=session["execution_session_id"],
                minutes=recommendation["duration_minutes"], baseline_seconds=baseline, timestamp=ports.now())
        execution_result["execution_session"] = {
            **active_session, "confirmed_work_minutes": recommendation["duration_minutes"],
            "confirmed_work_baseline_seconds": baseline,
        }
    else:
        command_payload = {
            **(context_payload or {}),
            "execution_session_id": session.get("execution_session_id"),
            "interruption_action": action,
            "pause_reason": payload.get("reason") or "help_decide_recommendation",
            "request_id": f"{payload.get('recommendation_id')}:pause",
            "break_minutes": recommendation.get("break_minutes"),
            "preferred_resume_at": payload.get("preferred_resume_at"),
            "remaining_minutes": session.get("session_remaining_minutes"),
            "next_step": (context_payload or {}).get("next_action"),
        }
        atomic_result = ports.interrupt_execution_session(user_id, command_payload, index_memory=False)
        command = atomic_result["command"]
        paused = atomic_result["execution_session"]
        impact = None if action == "short_break" else ports.analyze_execution_impact(user_id, {**command, "action": action})
        execution_result.update(interruption_response(
            execution_session=paused,
            command=command,
            impact=impact,
            reschedule_check=(impact or {}).get("reschedule_check"),
        ))
        execution_result["context_dump"] = atomic_result.get("context_dump")
        execution_result["interruption_episode"] = paused.get("interruption_episode")
        if action == 'short_break' and 'candidate_options' in original.get('context', {}) and checks.get('short_break', {}).get('requires_plan_review'):
            from datetime import timedelta
            clock = ports.user_clock_now(user_id, ports.ensure_profile(user_id).get('timezone') or 'Asia/Shanghai')
            execution_result.update(requires_replan=True, requires_user_confirmation=True,
                break_end_at=(clock + timedelta(minutes=recommendation['break_minutes'])).isoformat())
        if action == "switch_task":
            target_id = recommendation.get("target_execution_session_id")
            started = ports.start_execution_session(user_id, {
                "execution_session_id": target_id,
                "request_id": f"{payload.get('recommendation_id')}:switch",
                "confirm_schedule_impact": payload.get('confirm_schedule_impact') is True,
                "impact_confirmation_token": payload.get('impact_confirmation_token'),
            })
            execution_result["switched_to"] = started
        elif action == "continue_later":
            execution_result.update(ports.propose_continue_later_diff(
                user_id,
                paused,
                impact or {},
                request_id=f"{payload.get('recommendation_id')}:local-diff",
            ))
            execution_result["requires_user_confirmation"] = True

    from .recommendation_report import save_confirmed_report
    execution_result.update(save_confirmed_report(user_id,task_id,payload,
        execution_result['execution_session'],ports=ports))
    execution_result['plan_revision_after'] = execution_result['execution_session'].get('plan_revision')
    recommendation = {**recommendation, 'application': {
        key:execution_result.get(key) for key in ('choice_id','application_status','applied_at','confirmed_report',
            'report_application_status','final_validation','impact_confirmation','plan_revision_before','plan_revision_after')},
        'interruption_episode_id':(execution_result.get('interruption_episode') or {}).get('id'),
        'context_dump_id':(execution_result.get('context_dump') or {}).get('id'),
        'target_execution_session_id':recommendation.get('target_execution_session_id')}
    with ports.connect() as conn:
        for linked_session in {session['execution_session_id'], recommendation.get('target_execution_session_id')} - {None}:
            RecommendationEventRepository(conn).link_session(user_id,linked_session,{
                'recommendation_id':original['id'],'choice_id':f"{original['id']}:choice",
                'source_execution_session_id':session['execution_session_id'],
                'target_execution_session_id':recommendation.get('target_execution_session_id'),
                'interruption_episode_id':recommendation.get('interruption_episode_id'),
                'context_dump_id':recommendation.get('context_dump_id'), 'applied_at':execution_result['applied_at']})
    feedback = ports._persist_help_decide_feedback(user_id, original, recommendation)
    ports.log_event(user_id, "help_decide_recommendation_applied", {"recommendation_id": payload.get("recommendation_id"), **execution_result})
    return {"execution": execution_result, "feedback": feedback}
