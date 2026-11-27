"""Publication eligibility for persisted scheduling requests, not job execution."""
from ..repositories.background_jobs import BackgroundJobRepository


def require_current_scheduling_job(conn, *, user_id, week_id, job_id, decode):
    jobs = BackgroundJobRepository(conn)
    job = jobs.get(job_id, user_id)
    if job is None or job['kind'] != 'schedule_plan':
        raise ValueError('重排请求不存在或不属于当前用户，请重新发起。')
    payload = decode(job['payload_json'], {})
    # Historical jobs did not persist a target week; do not rewrite them here.
    if payload.get('week_id') and str(payload['week_id']) != week_id:
        raise ValueError('重排请求所属周已变化，请重新发起。')
    if jobs.has_newer_schedule(user_id=user_id, week_id=week_id, job_id=job_id):
        raise ValueError('已有更新的重排请求，本次旧结果未保存。请查看最新请求。')
