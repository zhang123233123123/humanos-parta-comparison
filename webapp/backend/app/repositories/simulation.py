"""Simulation-only durable snapshots, events and idempotent operations."""
import json
import sqlite3
from contextlib import contextmanager


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


class SimulationRepository:
    def __init__(self, path):
        self.path = path
        with self.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sim_profile_forms(id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sim_profiles(participant_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sim_profile_history(seq INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sim_documents(id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sim_versions(id TEXT PRIMARY KEY, document_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sim_runs(id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sim_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS sim_events_run ON sim_events(run_id,seq);
                CREATE TABLE IF NOT EXISTS sim_requests(actor TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor,request_id));
                CREATE TABLE IF NOT EXISTS sim_jobs(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, body TEXT NOT NULL);
            ''')

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def events(self, db, run_id):
        return [json.loads(x[0]) for x in db.execute('SELECT body FROM sim_events WHERE run_id=? ORDER BY seq', (run_id,))]

    def run(self, db, run_id):
        row = db.execute('SELECT body FROM sim_runs WHERE id=?', (run_id,)).fetchone()
        if not row:
            raise KeyError(run_id)
        return json.loads(row[0])

    def save_run(self, db, run):
        db.execute('INSERT INTO sim_runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body',
                   (run['id'], run['participant_id'], run['revision'], encode(run)))
