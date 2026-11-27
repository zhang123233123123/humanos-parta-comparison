"""Owner-scoped self-report records; transactions belong to the caller."""


class RuntimeStateRepository:
    def __init__(self, connection):
        self.connection = connection

    def by_request(self, user_id, request_id):
        return self.connection.execute(
            "SELECT * FROM runtime_states WHERE user_id=? AND request_id=?",
            (user_id, request_id)).fetchone()

    def get(self, user_id, state_id):
        return self.connection.execute('SELECT * FROM runtime_states WHERE user_id=? AND id=?', (user_id, state_id)).fetchone()

    def latest(self, user_id):
        return self.connection.execute(
            "SELECT * FROM runtime_states WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (user_id,)).fetchone()

    def legacy_evidence(self, user_id, source_id):
        return self.connection.execute(
            "SELECT payload_json FROM personalization_outbox WHERE user_id=? AND kind='state_checkin' AND source_id=?",
            (user_id, source_id)).fetchone()

    def insert(self, values):
        self.connection.execute(
            """INSERT INTO runtime_states (
                id, user_id, request_id, focus, energy, stress, mood,
                attention_residue, emotion, readiness, daily_note, created_at, reported_state_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", values)

    def mark_daily_checkin(self, user_id, local_date, timestamp):
        self.connection.execute(
            "UPDATE profiles SET last_daily_checkin_date=?,updated_at=? WHERE user_id=?",
            (local_date, timestamp, user_id))
