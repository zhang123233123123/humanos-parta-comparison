"""State-transition records; commit and rollback belong to the caller."""
import sqlite3


class StateTransitionRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def insert(self, *, transition_id: str, user_id: str, task_id: str | None,
               before_json: str, action_json: str, predicted_json: str,
               actual_json: str, outcome_json: str, created_at: int) -> None:
        self.connection.execute(
            "INSERT INTO state_transitions (id,user_id,task_id,before_state_json,action_json,predicted_state_json,actual_state_json,outcome_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (transition_id, user_id, task_id, before_json, action_json,
             predicted_json, actual_json, outcome_json, created_at),
        )
