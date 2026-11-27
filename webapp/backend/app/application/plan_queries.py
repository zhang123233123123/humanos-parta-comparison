"""Plan reads keep confirmed and candidate state separate."""
from collections.abc import Callable
from ..repositories.plans import PlanRepository
from .pending_plan_projection import visible_pending_plan


def read_requested_plan(user_id, request_id, week_id=None, *, connect, decode):
    with connect() as conn:
        row = PlanRepository(conn).find_request(user_id=user_id, request_id=request_id)
    if row is None:
        return None
    if week_id and str(week_id) != row['week_id']:
        raise ValueError('该排程请求编号已用于另一周，请重新发起。')
    if row['plan_status'] not in {'proposed', 'confirmed'}:
        raise ValueError('原草案已取消、被替换或失效，请查看最新计划或重新发起排程。')
    plan = decode(row['plan_json'], {})
    plan.update(plan_id=row['id'], plan_revision=row['plan_revision'],
                plan_status=row['plan_status'], week_id=row['week_id'])
    return visible_pending_plan(plan, user_id, connect=connect)


def read_plan(user_id: str, week_id: str | None, *, proposed: bool,
              ensure_profile: Callable, current_week: Callable, connect: Callable,
              decode: Callable) -> dict | None:
    profile = ensure_profile(user_id)
    target_week = str(week_id or profile.get('active_week_id') or current_week(timezone_name=profile.get('timezone')))
    with connect() as conn:
        repository = PlanRepository(conn)
        query = repository.latest_proposed if proposed else repository.latest_active
        row = query(user_id=user_id, week_id=target_week)
    if not row:
        return None
    plan = decode(row['plan_json'], {})
    # Database lifecycle columns override stale metadata inside the snapshot.
    plan.update(plan_id=row['id'], plan_revision=row['plan_revision'],
                plan_status=row['plan_status'], week_id=row['week_id'])
    return visible_pending_plan(plan, user_id, connect=connect)
