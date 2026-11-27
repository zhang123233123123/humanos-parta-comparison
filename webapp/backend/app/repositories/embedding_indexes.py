"""Index snapshots and atomic publication on a caller-owned connection."""


class EmbeddingIndexRepository:
    def __init__(self, connection):
        self.connection = connection

    def snapshot(self):
        memories = [dict(row) for row in self.connection.execute('SELECT * FROM memories ORDER BY id')]
        has_behavior = self.connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='behavior_experiences'"
        ).fetchone() is not None
        experiences = [dict(row) for row in self.connection.execute(
            "SELECT * FROM behavior_experiences WHERE summary IS NOT NULL AND summary!='' ORDER BY id"
        )] if has_behavior else []
        return memories, experiences

    def publish(self, updates):
        """Compare source snapshots and publish all vectors, or roll back all."""
        try:
            self.connection.execute('BEGIN IMMEDIATE')
            for table, row, vector, model, metadata in updates:
                if table == 'memories':
                    cursor = self.connection.execute(
                        'UPDATE memories SET metadata_json=?,embedding_json=? WHERE id=? AND user_id=? AND text=? AND metadata_json=? AND embedding_json=?',
                        (metadata, vector, row['id'], row['user_id'], row['text'], row['metadata_json'], row['embedding_json']))
                else:
                    cursor = self.connection.execute(
                        'UPDATE behavior_experiences SET embedding_model=?,embedding_json=? WHERE id=? AND user_id=? AND summary=? AND status=? AND facts_json=? AND embedding_json IS ?',
                        (model, vector, row['id'], row['user_id'], row['summary'], row['status'], row['facts_json'], row['embedding_json']))
                if cursor.rowcount != 1:
                    raise ValueError('Index source changed; retry rebuild')
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
