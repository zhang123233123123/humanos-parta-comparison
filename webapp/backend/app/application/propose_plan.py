"""Persist a candidate and its edit episode without activating the calendar."""
from collections.abc import Callable
from contextlib import AbstractContextManager
import sqlite3
from ..repositories.plans import PlanRepository
from ..repositories.plan_edit_episodes import PlanEditEpisodeRepository


def save_proposed_plan(user_id: str, decision: dict, payload: dict, *,
                       ensure_profile: Callable, current_week: Callable, now: Callable,
                       connect: Callable[[], AbstractContextManager[sqlite3.Connection]],
                       decode: Callable, encode: Callable, make_id: Callable,
                       decorate_blocks: Callable, canonical_snapshot: Callable,
                       snapshot_hash: Callable, expected_plan_state=None, scheduling_job_id=None) -> dict:
    profile = ensure_profile(user_id)
    timezone_name = profile.get("timezone") or "Asia/Shanghai"
    week_id = str(payload.get("week_id") or (profile.get("weekly_context") or {}).get("week_id") or profile.get("active_week_id") or current_week(timezone_name=timezone_name))
    request_id = str(payload.get("request_id") or decision.get("request_id") or "").strip() or None
    timestamp = now()
    with connect() as conn:
        plans = PlanRepository(conn)
        episodes = PlanEditEpisodeRepository(conn)
        if request_id:
            existing = plans.find_request(user_id=user_id, request_id=request_id)
            if existing:
                saved = decode(existing["plan_json"], {})
                saved.update({"plan_id": existing["id"],"plan_revision": existing["plan_revision"],"plan_status": existing["plan_status"],"week_id": existing["week_id"]})
                return saved
        if scheduling_job_id is not None:
            from .scheduling_job_guard import require_current_scheduling_job
            require_current_scheduling_job(conn, user_id=user_id, week_id=week_id,
                                           job_id=scheduling_job_id, decode=decode)
        from ..domain.plan_publication import publication_state, require_unchanged_publication
        if expected_plan_state is not None:
            current = publication_state(
                plans.latest_active(user_id=user_id, week_id=week_id),
                plans.latest_proposed(user_id=user_id, week_id=week_id))
            require_unchanged_publication(expected_plan_state, current)
        base_plan_id = decision.get('base_plan_id')
        if base_plan_id:
            active = plans.latest_active(user_id=user_id, week_id=week_id)
            if active is None or active['id'] != base_plan_id:
                raise ValueError('原计划已被替换，请刷新后重新调整。')
        revision = plans.next_revision(user_id=user_id, week_id=week_id)
        plan_id = make_id("plan")
        stored = dict(decision)
        stored["plan_patch"] = decorate_blocks(list(decision.get("plan_patch") or []), week_id, revision, timezone_name)
        from .build_timeline import build_weekly_timeline_snapshot

        stored["weekly_timeline"] = build_weekly_timeline_snapshot(
            week_id=week_id,
            timezone_name=timezone_name,
            blocks=stored["plan_patch"],
        )
        for candidate in stored.get("candidate_plans") or []:
            candidate["plan_patch"] = decorate_blocks(list(candidate.get("plan_patch") or []), week_id, revision, timezone_name)
        from .project_plan import project_plan_for_persistence

        stored = project_plan_for_persistence(stored, profile=profile)
        stored.update({"plan_id": plan_id,"plan_revision": revision,"plan_status": "proposed","week_id": week_id})
        plans.supersede_proposals(user_id=user_id, week_id=week_id, timestamp=timestamp)
        plans.insert_proposed(plan_id=plan_id, user_id=user_id, week_id=week_id,
            revision=revision, request_id=request_id, plan_json=encode(stored), timestamp=timestamp)
        episodes.suspend_open(user_id=user_id, week_id=week_id, timestamp=timestamp)
        episode_id = make_id("episode")
        initial_snapshot = canonical_snapshot(stored["plan_patch"])
        research_revision = int(profile.get("research_context_revision") or (profile.get("research_context") or {}).get("revision") or 0)
        episodes.insert_open(episode_id=episode_id, user_id=user_id, week_id=week_id,
            plan_id=plan_id, revision=revision, snapshot_json=encode(initial_snapshot),
            snapshot_hash=snapshot_hash(initial_snapshot), research_revision=research_revision,
            timestamp=timestamp)
        stored["edit_episode_id"] = episode_id
        plans.update_snapshot(plan_id=plan_id, plan_json=encode(stored))
    return stored
