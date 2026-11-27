"""Owner-scoped recommendation receipts in the event stream."""


class RecommendationEventRepository:
    def __init__(self, connection):
        self.connection = connection

    def latest(self, user_id, recommendation_id, event_type):
        return self.connection.execute(
            "SELECT payload_json FROM events WHERE user_id=? AND type=? "
            "AND COALESCE(json_extract(payload_json, '$.recommendation_id'), json_extract(payload_json, '$.id'))=? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (user_id, event_type, recommendation_id)).fetchone()

    def link_session(self, user_id, session_id, link):
        import json
        row = self.connection.execute('SELECT interruption_snapshot_json FROM execution_sessions WHERE user_id=? AND id=?', (user_id,session_id)).fetchone()
        if row is None:
            return
        snapshot = json.loads(row['interruption_snapshot_json'] or '{}')
        snapshot['recommendation_link'] = link
        self.connection.execute('UPDATE execution_sessions SET interruption_snapshot_json=? WHERE user_id=? AND id=?', (json.dumps(snapshot),user_id,session_id))
