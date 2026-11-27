"""Recovery evidence projections; never alter execution state."""
from ..repositories.interruption_episodes import InterruptionEpisodeRepository
from ..repositories.events import EventRepository
from .interruption_recovery import summarize_recovery_episodes
from .recommendation_outcomes import summarize_recommendation_outcomes


def project_episode(row, *, decode):
    if not row:
        return None
    data = dict(row)
    data["task_demand_snapshot"] = decode(data.pop("task_demand_snapshot_json", "{}"), {})
    data["runtime_state_snapshot"] = decode(data.pop("runtime_state_snapshot_json", "{}"), {})
    data["profile_trait_refs"] = decode(data.pop("profile_trait_refs_json", "[]"), [])
    data["outcome"] = decode(data.pop("outcome_json", "{}"), {})
    return data


def list_episodes(user_id, *, connect, project):
    with connect() as conn:
        rows = InterruptionEpisodeRepository(conn).list_for_user(user_id)
    return [project(row) for row in rows]


def recovery_summary(user_id, *, list_episodes, connect, decode):
    episodes = list_episodes(user_id)
    with connect() as conn:
        rows = EventRepository(conn).recovery_feedback(user_id)
    feedback = [{"payload": decode(row["payload_json"], {}), "created_at": row["created_at"]}
                for row in rows if row["type"] == "help_decide_recommendation_feedback"]
    execution_feedback = [{"payload": decode(row["payload_json"], {}), "created_at": row["created_at"]}
                          for row in rows if row["type"] == "execution_feedback_saved"]
    return {
        "episodes": episodes,
        "summary": summarize_recovery_episodes(episodes),
        "recommendation_effects": summarize_recommendation_outcomes(feedback, episodes, execution_feedback),
    }
