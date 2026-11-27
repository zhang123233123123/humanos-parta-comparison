"""Plan edit evidence persistence on caller-owned transactions."""


class PlanEditEvidenceRepository:
    def __init__(self, connection):
        self.connection = connection

    def episode(self, user_id, episode_id):
        return self.connection.execute("SELECT * FROM plan_edit_episodes WHERE id=? AND user_id=?",
                                       (episode_id, user_id)).fetchone()

    def replay(self, user_id, request_id):
        return self.connection.execute("SELECT * FROM plan_edit_events WHERE user_id=? AND request_id=?",
                                       (user_id, request_id)).fetchone()

    def next_sequence(self, episode_id):
        return int(self.connection.execute(
            "SELECT COALESCE(MAX(sequence_number),0)+1 AS n FROM plan_edit_events WHERE edit_episode_id=?",
            (episode_id,)).fetchone()["n"])

    def insert(self, values):
        self.connection.execute(
            "INSERT INTO plan_edit_events (id,edit_episode_id,user_id,task_id,block_id,actor,event_type,before_json,after_json,interaction_source,validation_result_json,reverts_event_id,request_id,client_time,server_time,sequence_number,effective) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            values)

    def undo(self, event_id, episode_id):
        self.connection.execute("UPDATE plan_edit_events SET effective=0 WHERE id=? AND edit_episode_id=?",
                                (event_id, episode_id))

    def reopen(self, user_id, episode_id, timestamp):
        self.connection.execute("UPDATE plan_edit_episodes SET status='open',updated_at=? WHERE id=? AND user_id=?",
                                (timestamp, episode_id, user_id))

    def evidence(self, user_id):
        return self.connection.execute(
            "SELECT evidence_json,eligible_for_pattern FROM evidence_items WHERE user_id=? ORDER BY created_at,id",
            (user_id,)).fetchall()

    def behavior(self, user_id):
        return self.connection.execute(
            "SELECT event_json,effective FROM behavior_events WHERE user_id=? ORDER BY created_at,id",
            (user_id,)).fetchall()

    def failures(self, user_id):
        return self.connection.execute(
            "SELECT id,kind,source_id,attempts,last_error,created_at,updated_at FROM personalization_outbox WHERE user_id=? AND status='failed' ORDER BY sequence_number",
            (user_id,)).fetchall()

    def recent_behavior(self, user_id, since, until, limit):
        return self.connection.execute(
            "SELECT event_json,created_at FROM behavior_events WHERE user_id=? AND effective=1 "
            "AND created_at BETWEEN ? AND ? AND source_type IN ('system_observation','plan_edit') "
            "ORDER BY created_at DESC,id DESC LIMIT ?", (user_id, since, until, limit)).fetchall()
