"""Base profile lifecycle with explicit persistence and evidence capabilities."""
from collections.abc import Callable
from dataclasses import dataclass
from zoneinfo import ZoneInfo
from ..repositories.profiles import ProfileRepository


@dataclass(frozen=True)
class ProfilePorts:
    get_profile: Callable
    default_timezone: Callable
    today: Callable
    upsert_profile: Callable
    add_memory: Callable
    connect: Callable
    decode: Callable
    now: Callable
    clock_now: Callable
    encode: Callable
    log_event: Callable
    ensure_profile: Callable


def ensure_profile(user_id: str, *, ports: ProfilePorts) -> dict:
    existing = ports.get_profile(user_id)
    if existing:
        return existing
    from ..domain.profile import build_default_profile

    timezone_name = ports.default_timezone()
    profile = build_default_profile(
        user_id,
        timezone_name=timezone_name,
        week_of=ports.today(timezone_name),
    ).model_dump()
    ports.upsert_profile(profile)
    ports.add_memory(
        user_id=user_id,
        source_type="profile",
        source_id=user_id,
        task_id=None,
        text=(
            f"User is a {profile['role']}. Deep work window: "
            f"{profile['deep_work_window']}. Low energy window: "
            f"{profile['low_energy_window']}. Control preference: "
            f"{profile['control_preference']}."
        ),
        metadata={"kind": "initial_profile"},
    )
    return ports.get_profile(user_id) or profile


def get_profile(user_id: str, *, ports: ProfilePorts) -> dict | None:
    with ports.connect() as conn:
        row = ProfileRepository(conn).get(user_id=user_id)
    if not row:
        return None
    from ..domain.profile import sanitize_weekly_context

    return {
        "user_id": row["user_id"],
        "role": row["role"],
        "deep_work_window": row["deep_work_window"],
        "low_energy_window": row["low_energy_window"],
        "control_preference": row["control_preference"],
        "blocker_patterns": ports.decode(row["blocker_patterns"], []),
        "task_preferences": ports.decode(row["task_preferences"], {}),
        "weekly_context": sanitize_weekly_context(ports.decode(row["weekly_context_json"], {})),
        "learned_patterns": ports.decode(row["learned_patterns_json"], []),
        "timezone": row["timezone"] or "Asia/Shanghai",
        "active_week_id": row["active_week_id"],
        "active_plan_revision": row["active_plan_revision"],
        "last_daily_checkin_date": row["last_daily_checkin_date"],
        "research_context": ports.decode(row["research_context_json"], {}),
        "research_context_revision": int(row["research_context_revision"] or 0),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def upsert_profile(profile: dict, *, ports: ProfilePorts) -> dict:
    user_id = profile.get("user_id", "demo")
    current = ports.get_profile(user_id)
    timestamp = ports.now()
    from ..domain.profile import merge_profile_patch

    timezone_name = profile.get("timezone") or (current or {}).get("timezone") or "Asia/Shanghai"
    aggregate = merge_profile_patch(
        current,
        profile,
        captured_at=ports.clock_now(ZoneInfo(timezone_name)).isoformat(),
    )
    # The direct Profile API and weekly reconcile enforce the same activity
    # contract. Validate explicit activity writes, not unrelated profile edits.
    incoming_weekly = profile.get("weekly_context")
    if isinstance(incoming_weekly, dict) and "context_items" in incoming_weekly:
        from ..domain.profile import validate_context_items
        validate_context_items(aggregate.weekly_context)
    aggregate_data = aggregate.model_dump()
    data = {key: value for key, value in aggregate_data.items() if key != "user_id"}
    with ports.connect() as conn:
        ProfileRepository(conn).upsert({
            "user_id": user_id,
            **{key: data[key] for key in ("role", "deep_work_window", "low_energy_window",
                "control_preference", "timezone", "active_week_id", "active_plan_revision",
                "last_daily_checkin_date", "research_context_revision")},
            "blocker_patterns": ports.encode(data["blocker_patterns"]),
            "task_preferences": ports.encode(data["task_preferences"]),
            "weekly_context_json": ports.encode(data["weekly_context"]),
            "learned_patterns_json": ports.encode(data["learned_patterns"]),
            "research_context_json": ports.encode(data["research_context"]),
            "created_at": current["created_at"] if current else timestamp, "updated_at": timestamp,
        })
    ports.log_event(user_id, "profile_upserted", data)
    profile_summary = (
        f"Profile update. Role: {data['role']}. Deep work: {data['deep_work_window']}. "
        f"Low energy: {data['low_energy_window']}. Control: {data['control_preference']}. "
        f"Blockers: {', '.join(data['blocker_patterns'])}. "
        f"Preferences: {ports.encode(data['task_preferences'])}."
    )
    ports.add_memory(
        user_id=user_id,
        source_type="profile",
        source_id=user_id,
        task_id=None,
        text=profile_summary,
        metadata={"kind": "profile_update"},
    )
    return ports.ensure_profile(user_id)
