"""Record client-reported transitions without mutating execution state."""
from collections.abc import Callable
from ..repositories.execution_sessions import ExecutionSessionRepository


def record_state_transition(user_id: str, payload: dict, *, connect: Callable, get_task: Callable, _insert_state_transition: Callable, log_event: Callable) -> dict:
    task_id = payload.get("task_id")
    if task_id and not get_task(task_id, user_id):
        raise KeyError(task_id)
    action = dict(payload.get("action") or {})
    action_type = str(action.get("type") or "").strip()
    if not action_type:
        raise ValueError("action.type is required")
    execution_session_id = str(action.get("execution_session_id") or payload.get("execution_session_id") or "").strip() or None
    with connect() as conn:
        if execution_session_id:
            session = ExecutionSessionRepository(conn).get(user_id=user_id, session_id=execution_session_id)
            if not session:
                raise KeyError(execution_session_id)
            if task_id and str(session["task_id"]) != str(task_id):
                raise ValueError("execution session does not belong to task")
            task_id = session["task_id"]
        transition = _insert_state_transition(
            conn,
            user_id=user_id,
            task_id=task_id,
            before_status=str((payload.get("before_state") or {}).get("execution_status") or "unknown"),
            action_type=action_type,
            after_status=str((payload.get("actual_state") or {}).get("execution_status") or "unknown"),
            execution_session_id=execution_session_id,
            action_detail={key: value for key, value in action.items() if key not in {"type", "execution_session_id"}},
            outcome=payload.get("outcome") or {},
            trusted_execution_transition=False,
        )
    log_event(user_id, "state_transition_recorded", transition)
    return transition
