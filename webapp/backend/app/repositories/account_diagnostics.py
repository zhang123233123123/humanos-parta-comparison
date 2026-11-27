"""Test-account diagnostics and clock persistence; callers enforce capability."""


class AccountDiagnosticsRepository:
    def __init__(self, connection):
        self.connection = connection

    def plans(self, user_id):
        return self.connection.execute("SELECT * FROM plans WHERE user_id=? ORDER BY created_at DESC LIMIT 20", (user_id,)).fetchall()

    def events(self, user_id):
        return self.connection.execute("SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (user_id,)).fetchall()

    def edits(self, user_id):
        return self.connection.execute("SELECT * FROM plan_edit_events WHERE user_id=? ORDER BY server_time DESC LIMIT 50", (user_id,)).fetchall()

    def transitions(self, user_id):
        return self.connection.execute("SELECT * FROM state_transitions WHERE user_id=? ORDER BY created_at DESC LIMIT 100", (user_id,)).fetchall()

    def failures(self, user_id):
        return self.connection.execute("SELECT id,kind,source_id,attempts,last_error,created_at,updated_at FROM personalization_outbox WHERE user_id=? AND status='failed' ORDER BY sequence_number", (user_id,)).fetchall()

    def reset_clock(self, account_id):
        self.connection.execute("UPDATE users SET test_clock_base=NULL,test_clock_anchor_ms=NULL,test_time_scale=0 WHERE id=?", (account_id,))

    def update_clock(self, account_id, base, anchor_ms, scale):
        self.connection.execute(
            "UPDATE users SET test_clock_base=?,test_clock_anchor_ms=?,test_time_scale=? WHERE id=?",
            (base, anchor_ms, scale, account_id))
