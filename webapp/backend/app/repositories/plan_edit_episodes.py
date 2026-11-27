"""Edit-episode persistence on the same transaction as the candidate plan."""
import sqlite3


class PlanEditEpisodeRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def request_rationale(self, *, episode_id, user_id, snapshot_json, snapshot_hash, diff_json, timestamp):
        self.connection.execute(
            "UPDATE plan_edit_episodes SET final_plan_json=?,final_plan_hash=?,canonical_diff_json=?,status='rationale_pending',updated_at=? WHERE id=? AND user_id=?",
            (snapshot_json, snapshot_hash, diff_json, timestamp, episode_id, user_id))

    def confirm(self, *, episode_id, user_id, snapshot_json, snapshot_hash, diff_json, timestamp):
        self.connection.execute(
            "UPDATE plan_edit_episodes SET final_plan_json=?,final_plan_hash=?,canonical_diff_json=?,status='confirmed',confirmed_at=?,updated_at=? WHERE id=? AND user_id=?",
            (snapshot_json, snapshot_hash, diff_json, timestamp, timestamp, episode_id, user_id))

    def find_rationale(self, *, episode_id, snapshot_hash):
        return self.connection.execute(
            'SELECT id FROM plan_change_rationales WHERE edit_episode_id=? AND final_plan_hash=?',
            (episode_id, snapshot_hash)).fetchone()

    def insert_rationale(self, *, rationale_id, episode_id, user_id, plan_id, revision,
                         snapshot_hash, reason_codes_json, raw_response, parsed_reason_json,
                         generalizability, affected_ids_json, response_status, source_json,
                         request_id, timestamp):
        self.connection.execute(
            'INSERT INTO plan_change_rationales (id,edit_episode_id,user_id,plan_id,plan_revision,final_plan_hash,reason_codes_json,raw_user_response,parsed_reason_json,generalizability,affected_task_ids_json,response_status,source_json,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (rationale_id, episode_id, user_id, plan_id, revision, snapshot_hash, reason_codes_json,
             raw_response, parsed_reason_json, generalizability, affected_ids_json, response_status,
             source_json, request_id, timestamp))

    def suspend_open(self, *, user_id: str, week_id: str, timestamp: int) -> None:
        self.connection.execute(
            "UPDATE plan_edit_episodes SET status='suspended',updated_at=? WHERE user_id=? AND week_id=? AND status IN ('open','rationale_pending','confirming')",
            (timestamp, user_id, week_id))

    def insert_open(self, *, episode_id: str, user_id: str, week_id: str, plan_id: str,
                    revision: int, snapshot_json: str, snapshot_hash: str,
                    research_revision: int, timestamp: int) -> None:
        self.connection.execute(
            'INSERT INTO plan_edit_episodes (id,user_id,week_id,plan_id,plan_revision,initial_plan_json,initial_plan_hash,status,research_context_revision,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (episode_id, user_id, week_id, plan_id, revision, snapshot_json, snapshot_hash,
             'open', research_revision, timestamp, timestamp))
