"""A recommendation acceptance is not consent to a different schedule conflict."""
import hashlib
import json


def impact_token(impact: dict) -> str:
    snapshot = {key: impact.get(key) for key in (
        'execution_session_id', 'remaining_minutes', 'deadline_at', 'week_end_at', 'reason_codes')}
    snapshot['conflicts'] = sorted([
        {key: item.get(key) for key in ('execution_session_id', 'planned_start_at', 'planned_end_at', 'fixed_event', 'overlap_minutes')}
        for item in impact.get('affected_sessions', [])
    ], key=lambda item: str(item['execution_session_id']))
    snapshot['plan_revision'] = (impact.get('capacity_projection') or {}).get('plan_revision')
    # Review granularity matches minute-based execution accounting, not seconds.
    snapshot['estimated_end_minute'] = str(impact.get('estimated_end_at') or '')[:16]
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()


def require_impact_confirmation(impact: dict, confirmed: object, token: object = None) -> None:
    if impact.get('requires_plan_adjustment') and (confirmed is not True or token != impact_token(impact)):
        raise ValueError('执行将影响后续安排，请先查看冲突并明确确认。 Review schedule conflicts before starting or resuming.')
