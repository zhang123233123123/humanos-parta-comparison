"""Keep legacy identity migration's connection scope outside the facade."""
from ..repositories.legacy_identity import migrate_legacy_identity


def migrate_identity(email, user_id, *, connect):
    with connect() as conn:
        return migrate_legacy_identity(conn, email, user_id)
