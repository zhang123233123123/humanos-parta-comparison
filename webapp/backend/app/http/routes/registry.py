"""Ordered route dispatch; ordering matches the legacy API adapter."""
from . import runtime, planning, auth, profile, tasks, chat, execution, insights, jobs, memory
from .simulation import simulation
from .part_a import part_a


ROUTES = (
    part_a,
    simulation,
    runtime.health_get,
    runtime.account_capabilities_get,
    runtime.developer_snapshot_get,
    runtime.test_clock,
    runtime.qa_scenarios,
    runtime.qa_scenarios_load_actions,
    planning.plans_revise_post,
    planning.plans_adjust_task_post,
    planning.plans_parallel_decision_post,
    auth.auth_register_post,
    auth.auth_login_post,
    profile.profile,
    planning.weekly_setup_reconcile_post,
    planning.weeks_status_get,
    planning.weeks_rollover_post,
    planning.cross_week_actions,
    tasks.tasks,
    tasks.tasks_parse_post,
    chat.chat_turn_post,
    chat.chat_turns_get,
    tasks.task_drafts_get,
    tasks.task_drafts_item_patch_post,
    chat.chat_threads_get_post,
    chat.chat_threads_item_patch,
    tasks.tasks_item_get,
    tasks.tasks_item_patch,
    tasks.tasks_item_delete,
    execution.state_checkins_post,
    execution.state_checkins_get,
    execution.execution_recommendations_post,
    execution.execution_recommendations_feedback_post,
    execution.execution_recommendations_resume_time_check_post,
    execution.execution_recommendations_apply_post,
    execution.context_dumps_post,
    execution.execution_feedback_post,
    execution.workspace_sessions,
    planning.plan_edits_events_post,
    execution.execution_sessions_get,
    execution.execution_sessions_current_get,
    execution.execution_sessions_start_post,
    execution.execution_sessions_ensure_post,
    execution.execution_sessions_interrupt_post,
    execution.execution_sessions_pause_post,
    execution.execution_sessions_impact_post,
    execution.execution_adjustment_post,
    execution.interruption_episodes_get,
    planning.plans_replan_post,
    execution.execution_sessions_end_post,
    execution.state_transitions_post,
    insights.behavior_patterns,
    insights.profile_data_export_get,
    planning.schedules_decide_post,
    jobs.background_jobs_post,
    jobs.background_jobs_get,
    planning.schedules_validate_post,
    planning.plans_active_get,
    planning.plans_proposed_get,
    planning.schedules_confirm_post,
    execution.reentry_post,
    memory.memories_search_get,
)


def dispatch(request, store, runtime, method: str, path: str, query: dict) -> bool:
    for route in ROUTES:
        if route(request, store, runtime, method, path, query):
            return True
    return False
