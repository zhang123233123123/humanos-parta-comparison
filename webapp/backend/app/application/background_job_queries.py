"""Owner-scoped background job response projection."""
from ..repositories.background_jobs import BackgroundJobRepository


def get_job(user_id, job_id, *, connect, decode):
    with connect() as conn:
        row = BackgroundJobRepository(conn).get(job_id, user_id)
    if not row:
        return None
    return {
        "job_id": row["id"], "kind": row["kind"], "status": row["status"],
        "result": decode(row["result_json"], None), "error": row["error"],
        "created_at": row["created_at"], "started_at": row["started_at"],
        "completed_at": row["completed_at"], "updated_at": row["updated_at"],
    }
