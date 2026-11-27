"""Memory storage and retrieval orchestration with explicit embedding capabilities."""
from collections.abc import Callable

from ..repositories.memories import MemoryRepository


def add_memory(
    user_id: str, source_type: str, source_id: str, task_id: str | None,
    text: str, metadata: dict, *, connect: Callable, embed: Callable,
    make_id: Callable, now: Callable, encode: Callable,
) -> dict:
    memory_id = make_id("mem")
    embedding, embedding_model = embed(text)
    memory = {
        "id": memory_id, "user_id": user_id, "source_type": source_type,
        "source_id": source_id, "task_id": task_id, "text": text,
        "metadata": metadata, "embedding_model": embedding_model, "created_at": now(),
    }
    with connect() as conn:
        MemoryRepository(conn).insert(
            memory_id=memory_id, user_id=user_id, source_type=source_type,
            source_id=source_id, task_id=task_id, text=text,
            metadata_json=encode(metadata | {"embedding_model": embedding_model}),
            embedding_json=encode(embedding), created_at=memory["created_at"],
        )
    return memory


def search_memories(
    user_id: str, query: str, top_k: int = 5, *, connect: Callable,
    embed: Callable, decode: Callable, encode: Callable, similarity: Callable,
) -> list[dict]:
    with connect() as conn:
        rows = MemoryRepository(conn).recent_for_user(user_id=user_id)
    # Do not request an embedding when no evidence exists for this user.
    if not rows:
        return []
    query_vec, query_model = embed(query)
    scored = []
    refreshed = []
    for row in rows:
        vec = decode(row["embedding_json"], [])
        metadata = decode(row["metadata_json"], {})
        stored_model = metadata.get("embedding_model") if isinstance(metadata, dict) else None
        if stored_model != query_model or not isinstance(vec, list) or len(vec) != len(query_vec):
            vec, stored_model = embed(row["text"])
            if stored_model == query_model:
                metadata = dict(metadata) if isinstance(metadata, dict) else {}
                metadata["embedding_model"] = stored_model
                refreshed.append((encode(metadata), encode(vec), row["id"]))
        if stored_model != query_model or not isinstance(vec, list) or len(vec) != len(query_vec):
            continue  # Never compare different embedding spaces, even if lengths coincide.
        score = similarity(query_vec, vec)
        scored.append({
            "memory_id": row["id"], "source_type": row["source_type"],
            "source_id": row["source_id"], "task_id": row["task_id"],
            "text": row["text"], "metadata": metadata, "score": round(score, 4),
            "created_at": row["created_at"], "evidence_role": "profile_learning_evidence",
            "plan_write_allowed": False,
        })
    if refreshed:
        with connect() as conn:
            MemoryRepository(conn).refresh_embeddings(user_id=user_id, records=refreshed)
    scored.sort(key=(lambda item: item["score"] if query.strip() else item["created_at"]), reverse=True)
    return scored[:top_k]
