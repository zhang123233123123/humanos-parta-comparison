"""Local QA snapshot files and explicitly closed SQLite backup connections."""
from contextlib import closing
import json
import sqlite3


def read_manifest(directory, database_path):
    manifest_path = directory / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError("QA scenario snapshots have not been generated")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["qa_database"] = str(database_path)
    return manifest


def restore_database(snapshot_path, database_path):
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(snapshot_path)) as source:
        with closing(sqlite3.connect(database_path)) as target:
            with source, target:
                source.backup(target)
