"""Explicit index rebuild: preserve source facts and summaries, publish atomically."""
import json
import math
from ..repositories.embedding_indexes import EmbeddingIndexRepository


def reindex_embeddings(conn, *, embed, model, apply=False, workers=1):
    repository = EmbeddingIndexRepository(conn)
    memories, experiences = repository.snapshot()
    def needs_update(raw, old_model):
        try:
            vector = json.loads(raw or 'null')
            return old_model != model or not isinstance(vector, list) or not vector or (model == 'bge-m3' and len(vector) != 1024)
        except (ValueError, TypeError):
            return True
    memories = [r for r in memories if needs_update(r['embedding_json'], json.loads(r['metadata_json']).get('embedding_model'))]
    experiences = [r for r in experiences if needs_update(r['embedding_json'], r['embedding_model'])]
    report = {'model': model, 'memories': len(memories), 'behavior_experiences': len(experiences), 'applied': False}
    if not apply:
        return report
    def generate(item):
        table, row, text_key = item
        vector, actual_model = embed(row[text_key])
        if actual_model != model or model.startswith('humanos-local-') or not vector or not all(math.isfinite(v) for v in vector):
            raise ValueError('Target semantic embedding unavailable; index unchanged')
        if model == 'bge-m3' and len(vector) != 1024:
            raise ValueError('BGE-M3 vector must have 1024 dimensions')
        norm = math.sqrt(sum(v*v for v in vector))
        if not norm:
            raise ValueError('Empty embedding; index unchanged')
        return table, row, json.dumps([v/norm for v in vector])
    inputs = [(table, row, text_key) for table, rows, text_key in
              [('memories', memories, 'text'), ('behavior_experiences', experiences, 'summary')] for row in rows]
    if workers > 1:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(workers, 4)) as pool:
            updates = list(pool.map(generate, inputs))
    else:
        updates = [generate(item) for item in inputs]
    # No network inside the write transaction; concurrent text edits invalidate publication.
    publication = []
    for table, row, vector in updates:
        metadata = json.dumps({**json.loads(row['metadata_json']), 'embedding_model': model}, ensure_ascii=False) if table == 'memories' else None
        publication.append((table, row, vector, model, metadata))
    repository.publish(publication)
    return {**report, 'applied': True}
