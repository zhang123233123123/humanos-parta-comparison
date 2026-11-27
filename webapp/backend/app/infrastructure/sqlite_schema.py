"""SQLite schema and additive upgrades; no server or application imports.

Conversation migrations are supplied by the composition layer during extraction.
SQL and upgrade ordering intentionally match the existing production initializer.
"""
from collections.abc import Callable
import sqlite3


def initialize_schema(
    conn: sqlite3.Connection,
    *,
    migrate_chat_threads: Callable[[sqlite3.Connection], None],
    migrate_task_drafts: Callable[[sqlite3.Connection], None],
) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS behavior_experiences (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
          source_type TEXT NOT NULL, source_id TEXT NOT NULL, task_id TEXT, session_id TEXT,
          facts_json TEXT NOT NULL, summary TEXT, embedding_json TEXT, embedding_model TEXT,
          status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
          lease_token TEXT, next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
          UNIQUE(user_id,kind,source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_behavior_experience_queue ON behavior_experiences(status,next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_behavior_experience_user ON behavior_experiences(user_id,status,created_at);
        CREATE TABLE IF NOT EXISTS behavior_patterns (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, anchor_json TEXT NOT NULL,
          embedding_model TEXT NOT NULL, status TEXT NOT NULL,
          learning_status TEXT NOT NULL, source_hash TEXT, support_count INTEGER NOT NULL DEFAULT 0,
          description TEXT, scope TEXT, confidence TEXT,
          summary_embedding_json TEXT, summary_embedding_model TEXT,
          lease_token TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_behavior_pattern_user ON behavior_patterns(user_id,status);
        CREATE TABLE IF NOT EXISTS behavior_pattern_members (
          pattern_id TEXT NOT NULL, user_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
          experience_id TEXT NOT NULL UNIQUE, PRIMARY KEY(user_id,experience_id)
        );
        CREATE TABLE IF NOT EXISTS profiles (
          user_id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          deep_work_window TEXT NOT NULL,
          low_energy_window TEXT NOT NULL,
          control_preference TEXT NOT NULL,
          blocker_patterns TEXT NOT NULL,
          task_preferences TEXT NOT NULL,
          weekly_context_json TEXT NOT NULL DEFAULT '{}',
          learned_patterns_json TEXT NOT NULL DEFAULT '[]',
          timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
          active_week_id TEXT,
          active_plan_revision INTEGER,
          last_daily_checkin_date TEXT,
          research_context_json TEXT NOT NULL DEFAULT '{}',
          research_context_revision INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_login_at INTEGER,
          account_type TEXT NOT NULL DEFAULT 'normal',
          test_clock_base TEXT,
          test_clock_anchor_ms INTEGER,
          test_time_scale REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          deadline_at TEXT,
          duration INTEGER NOT NULL,
          priority TEXT NOT NULL,
          status TEXT NOT NULL,
          context TEXT NOT NULL,
          context_window_json TEXT NOT NULL DEFAULT '{}',
          cognitive_load TEXT NOT NULL,
          ambiguity TEXT NOT NULL,
          switch_cost TEXT NOT NULL,
          reentry_cost TEXT NOT NULL,
          slot_json TEXT,
          checkpoints_json TEXT NOT NULL,
          demand_json TEXT NOT NULL DEFAULT '{}',
          execution_json TEXT NOT NULL DEFAULT '{}',
          resource_modality_json TEXT NOT NULL DEFAULT '[]',
          attention_mode TEXT NOT NULL DEFAULT 'continuous',
          parallelizable INTEGER NOT NULL DEFAULT 0,
          expected_difficulty INTEGER,
          week_id TEXT,
          removed_from_week INTEGER NOT NULL DEFAULT 0,
          archived_at INTEGER,
          create_request_id TEXT,
          field_provenance_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS runtime_states (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          request_id TEXT,
          focus INTEGER NOT NULL,
          energy INTEGER NOT NULL,
          stress INTEGER NOT NULL,
          mood INTEGER,
          attention_residue TEXT,
          emotion TEXT,
          readiness TEXT,
          daily_note TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS context_dumps (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          execution_session_id TEXT,
          plan_revision INTEGER,
          request_id TEXT,
          checkpoint_type TEXT NOT NULL DEFAULT 'human_context',
          supersedes_dump_id TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          progress TEXT NOT NULL,
          open_questions TEXT NOT NULL,
          next_action TEXT NOT NULL,
          stop_reason TEXT NOT NULL,
          materials TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          task_id TEXT,
          text TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          embedding_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS behavior_events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          event_json TEXT NOT NULL,
          effective INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          UNIQUE(user_id, source_type, source_id)
        );

        CREATE TABLE IF NOT EXISTS evidence_items (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          claim_key TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          eligible_for_pattern INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          UNIQUE(user_id, source_type, source_id, claim_key)
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_items_user_eligible
        ON evidence_items(user_id, eligible_for_pattern, created_at);

        CREATE TABLE IF NOT EXISTS evidence_deletions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          evidence_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          deleted_at INTEGER NOT NULL,
          UNIQUE(user_id, evidence_id),
          UNIQUE(user_id, request_id)
        );

        CREATE TABLE IF NOT EXISTS personalization_outbox (
          sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          source_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(user_id, kind, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_personalization_outbox_status_sequence
        ON personalization_outbox(status, sequence_number);

        CREATE TABLE IF NOT EXISTS pattern_decisions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          candidate_id TEXT NOT NULL,
          pattern_label TEXT NOT NULL,
          action TEXT NOT NULL,
          request_id TEXT,
          candidate_json TEXT NOT NULL,
          defer_until INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pattern_decision_request
        ON pattern_decisions(user_id, request_id) WHERE request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_pattern_decision_candidate
        ON pattern_decisions(user_id, candidate_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS profile_traits (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          candidate_id TEXT NOT NULL,
          trait_key TEXT NOT NULL,
          trait_json TEXT NOT NULL,
          status TEXT NOT NULL,
          confirmed_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(user_id, candidate_id)
        );

        CREATE TABLE IF NOT EXISTS trait_reviews (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          trait_id TEXT NOT NULL,
          action TEXT NOT NULL,
          request_id TEXT,
          effect_snapshot_json TEXT NOT NULL,
          defer_until INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_trait_review_request
        ON trait_reviews(user_id, request_id) WHERE request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_trait_review_trait
        ON trait_reviews(user_id, trait_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS chat_turns (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          request_id TEXT,
          user_text TEXT NOT NULL,
          assistant_reply TEXT NOT NULL,
          intent TEXT NOT NULL,
          features_json TEXT NOT NULL,
          task_ids_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pending_task_batches (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_text TEXT NOT NULL,
          tasks_json TEXT NOT NULL,
          missing_fields_json TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pending_task_batches_user_status
        ON pending_task_batches(user_id,status,updated_at);

        CREATE TABLE IF NOT EXISTS execution_feedback (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          trigger TEXT NOT NULL,
          task_evaluation_json TEXT NOT NULL,
          state_evaluation_json TEXT NOT NULL,
          recommendation_evaluation_json TEXT NOT NULL,
          execution_session_id TEXT,
          request_id TEXT,
          research_context_revision INTEGER NOT NULL DEFAULT 0,
          profile_trait_refs_json TEXT NOT NULL DEFAULT '[]',
          execution_context_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS state_transitions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task_id TEXT,
          before_state_json TEXT NOT NULL,
          action_json TEXT NOT NULL,
          predicted_state_json TEXT NOT NULL,
          actual_state_json TEXT NOT NULL,
          outcome_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          week_id TEXT NOT NULL,
          plan_revision INTEGER NOT NULL,
          plan_status TEXT NOT NULL,
          request_id TEXT,
          plan_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          confirmed_at INTEGER,
          updated_at INTEGER NOT NULL,
          UNIQUE(user_id, week_id, plan_revision)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_request
        ON plans(user_id, request_id) WHERE request_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS weekly_context_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          week_id TEXT NOT NULL,
          weekly_context_json TEXT NOT NULL,
          archived_at INTEGER NOT NULL,
          UNIQUE(user_id, week_id)
        );

        CREATE TABLE IF NOT EXISTS plan_edit_episodes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          week_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          plan_revision INTEGER NOT NULL,
          initial_plan_json TEXT NOT NULL,
          initial_plan_hash TEXT NOT NULL,
          final_plan_json TEXT,
          final_plan_hash TEXT,
          canonical_diff_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          research_context_revision INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          confirmed_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_plan_edit_episode_plan
        ON plan_edit_episodes(user_id, plan_id, plan_revision);

        CREATE TABLE IF NOT EXISTS plan_edit_events (
          id TEXT PRIMARY KEY,
          edit_episode_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          task_id TEXT,
          block_id TEXT,
          actor TEXT NOT NULL,
          event_type TEXT NOT NULL,
          before_json TEXT NOT NULL,
          after_json TEXT NOT NULL,
          interaction_source TEXT NOT NULL,
          validation_result_json TEXT NOT NULL,
          reverts_event_id TEXT,
          request_id TEXT,
          client_time TEXT,
          server_time INTEGER NOT NULL,
          sequence_number INTEGER NOT NULL,
          effective INTEGER NOT NULL DEFAULT 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_edit_event_request
        ON plan_edit_events(user_id, request_id) WHERE request_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS plan_change_rationales (
          id TEXT PRIMARY KEY,
          edit_episode_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          plan_revision INTEGER NOT NULL,
          final_plan_hash TEXT NOT NULL,
          reason_codes_json TEXT NOT NULL,
          raw_user_response TEXT NOT NULL,
          parsed_reason_json TEXT NOT NULL,
          generalizability TEXT NOT NULL,
          affected_task_ids_json TEXT NOT NULL,
          response_status TEXT NOT NULL,
          source_json TEXT NOT NULL,
          request_id TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_rationale_hash
        ON plan_change_rationales(edit_episode_id, final_plan_hash);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_rationale_request
        ON plan_change_rationales(user_id, request_id) WHERE request_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS execution_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          block_id TEXT NOT NULL,
          week_id TEXT NOT NULL,
          plan_revision INTEGER,
          planned_start_at TEXT NOT NULL,
          planned_end_at TEXT NOT NULL,
          planned_work_minutes INTEGER NOT NULL,
          actual_start_at TEXT,
          actual_end_at TEXT,
          accumulated_active_minutes INTEGER NOT NULL DEFAULT 0,
          paused_at TEXT,
          resumed_at TEXT,
          pause_reason TEXT,
          interruption_action TEXT,
          interruption_snapshot_json TEXT NOT NULL DEFAULT '{}',
          profile_trait_refs_json TEXT NOT NULL DEFAULT '[]',
          parallel_context_json TEXT NOT NULL DEFAULT '{}',
          resume_preference TEXT,
          preferred_resume_at TEXT,
          remaining_at_pause INTEGER,
          resumed_from_session_id TEXT,
          status TEXT NOT NULL,
          completion_outcome TEXT,
          request_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(user_id, block_id, plan_revision)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_session_request
        ON execution_sessions(user_id, request_id) WHERE request_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS interruption_episodes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          source_execution_session_id TEXT NOT NULL,
          context_dump_id TEXT,
          interruption_action TEXT NOT NULL,
          pause_reason TEXT NOT NULL,
          paused_at TEXT NOT NULL,
          remaining_minutes INTEGER NOT NULL,
          task_demand_snapshot_json TEXT NOT NULL DEFAULT '{}',
          runtime_state_snapshot_json TEXT NOT NULL DEFAULT '{}',
          profile_trait_refs_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          reentry_guidance_generated_at TEXT,
          resumed_execution_session_id TEXT,
          resumed_at TEXT,
          resume_latency_minutes INTEGER,
          active_minutes_before_resume INTEGER,
          outcome_json TEXT NOT NULL DEFAULT '{}',
          settled_at TEXT,
          request_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_interruption_episode_request
        ON interruption_episodes(user_id, request_id) WHERE request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_interruption_episode_task
        ON interruption_episodes(user_id, task_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS execution_requests (
          request_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          execution_session_id TEXT NOT NULL,
          action TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, request_id)
        );

        CREATE TABLE IF NOT EXISTS session_reports (
          user_id TEXT NOT NULL,
          execution_session_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          command_hash TEXT NOT NULL,
          state_id TEXT NOT NULL,
          pending_work_id TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, request_id),
          UNIQUE(user_id, execution_session_id)
        );
        CREATE TABLE IF NOT EXISTS pending_work (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source_session_id TEXT NOT NULL,
          remaining_minutes INTEGER NOT NULL CHECK(remaining_minutes BETWEEN 1 AND 10080),
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          scheduled_plan_id TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(user_id, source_session_id)
        );

        CREATE TABLE IF NOT EXISTS background_jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          request_id TEXT,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          result_json TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_background_jobs_user
        ON background_jobs(user_id, created_at DESC);
        """
    )
    behavior_columns = {row['name'] for row in conn.execute('PRAGMA table_info(behavior_experiences)')}
    for name, definition in {'summary_model':'TEXT', 'summary_prompt_version':'TEXT', 'summary_generated_at':'INTEGER'}.items():
        if name not in behavior_columns:
            conn.execute(f'ALTER TABLE behavior_experiences ADD COLUMN {name} {definition}')
    columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
    }
    if "context_window_json" not in columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN context_window_json TEXT NOT NULL DEFAULT '{}'")
    task_migrations = {
        "demand_json": "TEXT NOT NULL DEFAULT '{}'",
        "execution_json": "TEXT NOT NULL DEFAULT '{}'",
        "resource_modality_json": "TEXT NOT NULL DEFAULT '[]'",
        "attention_mode": "TEXT NOT NULL DEFAULT 'continuous'",
        "parallelizable": "INTEGER NOT NULL DEFAULT 0",
        "expected_difficulty": "INTEGER",
        "week_id": "TEXT",
        "removed_from_week": "INTEGER NOT NULL DEFAULT 0",
        "archived_at": "INTEGER",
        "create_request_id": "TEXT",
        "field_provenance_json": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in task_migrations.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE tasks ADD COLUMN {name} {definition}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_create_request "
        "ON tasks(user_id, create_request_id) WHERE create_request_id IS NOT NULL"
    )
    profile_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(profiles)").fetchall()
    }
    profile_migrations = {
        "weekly_context_json": "TEXT NOT NULL DEFAULT '{}'",
        "learned_patterns_json": "TEXT NOT NULL DEFAULT '[]'",
        "timezone": "TEXT NOT NULL DEFAULT 'Asia/Shanghai'",
        "active_week_id": "TEXT",
        "active_plan_revision": "INTEGER",
        "last_daily_checkin_date": "TEXT",
        "research_context_json": "TEXT NOT NULL DEFAULT '{}'",
        "research_context_revision": "INTEGER NOT NULL DEFAULT 0",
        "profile_trait_refs_json": "TEXT NOT NULL DEFAULT '[]'",
    }
    for name, definition in profile_migrations.items():
        if name not in profile_columns:
            conn.execute(f"ALTER TABLE profiles ADD COLUMN {name} {definition}")
    runtime_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(runtime_states)").fetchall()
    }
    runtime_migrations = {"emotion": "TEXT", "readiness": "TEXT", "daily_note": "TEXT", "request_id": "TEXT", "reported_state_json": "TEXT"}
    for name, definition in runtime_migrations.items():
        if name not in runtime_columns:
            conn.execute(f"ALTER TABLE runtime_states ADD COLUMN {name} {definition}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_states_request "
        "ON runtime_states(user_id, request_id) WHERE request_id IS NOT NULL"
    )
    feedback_columns = {row["name"] for row in conn.execute("PRAGMA table_info(execution_feedback)").fetchall()}
    feedback_migrations = {
        "execution_session_id": "TEXT",
        "request_id": "TEXT",
        "research_context_revision": "INTEGER NOT NULL DEFAULT 0",
        "profile_trait_refs_json": "TEXT NOT NULL DEFAULT '[]'",
        "execution_context_json": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in feedback_migrations.items():
        if name not in feedback_columns:
            conn.execute(f"ALTER TABLE execution_feedback ADD COLUMN {name} {definition}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_feedback_request "
        "ON execution_feedback(user_id, request_id) WHERE request_id IS NOT NULL"
    )
    execution_columns = {row["name"] for row in conn.execute("PRAGMA table_info(execution_sessions)").fetchall()}
    execution_migrations = {
        "confirmed_work_minutes": "INTEGER",
        "confirmed_work_baseline_seconds": "REAL",
        "resumed_at": "TEXT",
        "pause_reason": "TEXT",
        "interruption_action": "TEXT",
        "interruption_snapshot_json": "TEXT NOT NULL DEFAULT '{}'",
        "resume_preference": "TEXT",
        "preferred_resume_at": "TEXT",
        "remaining_at_pause": "INTEGER",
        "resumed_from_session_id": "TEXT",
        "profile_trait_refs_json": "TEXT NOT NULL DEFAULT '[]'",
        "parallel_context_json": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in execution_migrations.items():
        if name not in execution_columns:
            conn.execute(f"ALTER TABLE execution_sessions ADD COLUMN {name} {definition}")
    interruption_columns = {row["name"] for row in conn.execute("PRAGMA table_info(interruption_episodes)").fetchall()}
    if "active_minutes_before_resume" not in interruption_columns:
        conn.execute("ALTER TABLE interruption_episodes ADD COLUMN active_minutes_before_resume INTEGER")
    context_dump_columns = {row["name"] for row in conn.execute("PRAGMA table_info(context_dumps)").fetchall()}
    context_dump_migrations = {
        "execution_session_id": "TEXT",
        "plan_revision": "INTEGER",
        "request_id": "TEXT",
        "checkpoint_type": "TEXT NOT NULL DEFAULT 'human_context'",
        "supersedes_dump_id": "TEXT",
        "metadata_json": "TEXT NOT NULL DEFAULT '{}'",
    }
    for name, definition in context_dump_migrations.items():
        if name not in context_dump_columns:
            conn.execute(f"ALTER TABLE context_dumps ADD COLUMN {name} {definition}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_context_dump_request "
        "ON context_dumps(user_id, request_id) WHERE request_id IS NOT NULL"
    )
    chat_turn_columns = {row["name"] for row in conn.execute("PRAGMA table_info(chat_turns)").fetchall()}
    migrate_chat_threads(conn)
    migrate_task_drafts(conn)
    if "request_id" not in chat_turn_columns:
        conn.execute("ALTER TABLE chat_turns ADD COLUMN request_id TEXT")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_turn_request "
        "ON chat_turns(user_id, request_id) WHERE request_id IS NOT NULL"
    )
    background_job_columns = {row["name"] for row in conn.execute("PRAGMA table_info(background_jobs)").fetchall()}
    if "request_id" not in background_job_columns:
        conn.execute("ALTER TABLE background_jobs ADD COLUMN request_id TEXT")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_background_job_request "
        "ON background_jobs(user_id, kind, request_id) WHERE request_id IS NOT NULL"
    )
    user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    user_migrations = {
        "account_type": "TEXT NOT NULL DEFAULT 'normal'",
        "test_clock_base": "TEXT",
        "test_clock_anchor_ms": "INTEGER",
        "test_time_scale": "REAL NOT NULL DEFAULT 0",
    }
    for name, definition in user_migrations.items():
        if name not in user_columns:
            conn.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
