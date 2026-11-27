"""Legacy identity data migration; caller owns authorization and transaction."""
import sqlite3


def migrate_legacy_identity(conn: sqlite3.Connection, email: str, user_id: str) -> bool:
    """Move pre-canonical resources keyed by email onto the stable users.id.

    Older frontend sessions sent the login email as ``user_id`` even though
    registration had already created a stable backend ID.  The migration is
    transactional and idempotent; it runs after successful authentication so
    an arbitrary caller cannot claim another account's legacy resources.
    """
    legacy_identity = email.strip().lower()
    if not legacy_identity or legacy_identity == user_id:
        return False

    resource_tables = (
        "tasks",
        "runtime_states",
        "context_dumps",
        "memories",
        "events",
        "behavior_events",
        "evidence_items",
        "evidence_deletions",
        "personalization_outbox",
        "pattern_decisions",
        "profile_traits",
        "trait_reviews",
        "chat_turns",
        "execution_feedback",
        "state_transitions",
        "plans",
        "weekly_context_history",
        "plan_edit_episodes",
        "plan_edit_events",
        "plan_change_rationales",
        "execution_sessions",
        "interruption_episodes",
        "execution_requests",
    )

    migrated = False
    legacy_profile = conn.execute(
        "SELECT * FROM profiles WHERE user_id=?", (legacy_identity,)
    ).fetchone()
    canonical_profile = conn.execute(
        "SELECT * FROM profiles WHERE user_id=?", (user_id,)
    ).fetchone()

    if legacy_profile:
        if canonical_profile:
            legacy_updated = int(legacy_profile["updated_at"] or 0)
            canonical_updated = int(canonical_profile["updated_at"] or 0)
            if legacy_updated > canonical_updated:
                columns = [
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(profiles)").fetchall()
                    if row["name"] != "user_id"
                ]
                assignments = ",".join(f"{column}=?" for column in columns)
                conn.execute(
                    f"UPDATE profiles SET {assignments} WHERE user_id=?",
                    [*[legacy_profile[column] for column in columns], user_id],
                )
            conn.execute("DELETE FROM profiles WHERE user_id=?", (legacy_identity,))
        else:
            conn.execute(
                "UPDATE profiles SET user_id=? WHERE user_id=?",
                (user_id, legacy_identity),
            )
        migrated = True

    for table in resource_tables:
        columns = {
            column["name"]
            for column in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if "user_id" not in columns:
            continue
        cursor = conn.execute(
            f"UPDATE {table} SET user_id=? WHERE user_id=?",
            (user_id, legacy_identity),
        )
        migrated = migrated or cursor.rowcount > 0

    return migrated
