"""Complete interruption review without HTTP or implicit plan activation."""
from collections.abc import Callable
from dataclasses import dataclass

from .execution_interruption import build_interruption_command, interruption_response
from .ready_queue import build_ready_queue


@dataclass(frozen=True)
class InterruptionReviewPorts:
    interrupt: Callable
    pause: Callable
    assess_impact: Callable
    list_sessions: Callable
    get_task: Callable
    ensure_profile: Callable
    runtime_state: Callable
    user_clock: Callable
    propose_diff: Callable
    make_id: Callable


def review_interruption(user_id: str, payload: dict, *, capture_context: bool,
                        ports: InterruptionReviewPorts) -> dict:
    if capture_context:
        result = ports.interrupt(user_id, payload)
        command = result["command"]
        session = result["execution_session"]
    else:
        command = build_interruption_command(payload)
        session = ports.pause(user_id, command)
    action = command["interruption_action"]
    impact = None if action == "short_break" else ports.assess_impact(
        user_id, {**command, "action": action})
    response = interruption_response(execution_session=session, command=command,
        impact=impact, reschedule_check=(impact or {}).get("reschedule_check"))
    if capture_context:
        response["context_dump"] = result.get("context_dump")
    response["interruption_episode"] = session.get("interruption_episode")
    if action == "switch_task":
        ready = ports.list_sessions(user_id, ["ready"])
        tasks = {str(item.get("task_id")): ports.get_task(str(item.get("task_id")), user_id) or {}
                 for item in ready}
        profile = ports.ensure_profile(user_id)
        response["ready_queue"] = build_ready_queue(
            ready, tasks, exclude_task_id=str(session.get("task_id") or ""),
            plan_revision=session.get("plan_revision"), runtime_state=ports.runtime_state(user_id),
            reference_now=ports.user_clock(user_id, profile.get("timezone") or "Asia/Shanghai").isoformat())
    if action == "continue_later" and session.get("preferred_resume_at"):
        # Preserve endpoint-specific behavior: atomic interruption already saved
        # its checkpoint, while the legacy pause endpoint propagates planning errors.
        if capture_context:
            try:
                response.update(ports.propose_diff(user_id, session, impact or {},
                    request_id=f"{command.get('request_id')}:local-diff"))
            except ValueError as error:
                response["planning_warning"] = str(error)
        else:
            response.update(ports.propose_diff(user_id, session, impact or {},
                request_id=f"{command.get('request_id') or ports.make_id('pause')}:local-diff"))
    return response
