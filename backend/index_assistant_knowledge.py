from __future__ import annotations

import os
import sys

from config import get_settings
from database import DbClient, db_context
from services import assistant_service


def sync_policy_index(client: DbClient, api_key: str) -> tuple[int, int]:
    chunks = assistant_service._policy_chunks()
    if not chunks:
        raise RuntimeError("The product-help guide contains no indexable sections.")

    existing_rows = client.fetch_all(
        """select section_key, content_hash, embedding_model, embedding::text as embedding
        from public.assistant_knowledge_chunks
        where source_key = %(source_key)s""",
        {"source_key": assistant_service.KNOWLEDGE_SOURCE_KEY},
    )
    client.commit()
    existing = {row["section_key"]: row for row in existing_rows}
    pending = [
        chunk for chunk in chunks
        if (
            chunk["section_key"] not in existing
            or existing[chunk["section_key"]]["content_hash"] != chunk["content_hash"]
            or existing[chunk["section_key"]]["embedding_model"] != assistant_service.EMBEDDING_MODEL
        )
    ]
    new_vectors = (
        assistant_service._request_embeddings(
            [chunk["content"] for chunk in pending], api_key, "RETRIEVAL_DOCUMENT"
        )
        if pending else []
    )
    indexed_vectors = {
        chunk["section_key"]: assistant_service._vector_literal(vector)
        for chunk, vector in zip(pending, new_vectors, strict=True)
    }

    upsert_sql = """insert into public.assistant_knowledge_chunks
        (source_key, section_key, title, content, content_hash, source_version,
         embedding_model, embedding, is_active, indexed_at)
        values (%(source_key)s, %(section_key)s, %(title)s, %(content)s, %(content_hash)s,
                %(source_version)s, %(embedding_model)s, %(embedding)s::extensions.vector,
                true, now())
        on conflict (source_key, section_key) do update set
          title = excluded.title,
          content = excluded.content,
          content_hash = excluded.content_hash,
          source_version = excluded.source_version,
          embedding_model = excluded.embedding_model,
          embedding = excluded.embedding,
          is_active = true,
          indexed_at = now()"""

    for chunk in chunks:
        old = existing.get(chunk["section_key"], {})
        client.connection.execute(upsert_sql, {
            **chunk,
            "source_key": assistant_service.KNOWLEDGE_SOURCE_KEY,
            "embedding_model": assistant_service.EMBEDDING_MODEL,
            "embedding": indexed_vectors.get(chunk["section_key"], old.get("embedding")),
        })

    client.connection.execute(
        """delete from public.assistant_knowledge_chunks
        where source_key = %(source_key)s
          and not (section_key = any(%(section_keys)s))""",
        {
            "source_key": assistant_service.KNOWLEDGE_SOURCE_KEY,
            "section_keys": [chunk["section_key"] for chunk in chunks],
        },
    )
    return len(chunks), len(pending)


def main() -> int:
    api_key = (os.getenv("GEMINI_API_KEY") or get_settings().gemini_api_key or "").strip()
    if not api_key:
        print("Set GEMINI_API_KEY in the backend environment before indexing.", file=sys.stderr)
        return 2

    try:
        with db_context() as client:
            chunk_count, embedded_count = sync_policy_index(client, api_key)
    except Exception as exc:
        print(
            f"Knowledge indexing failed ({type(exc).__name__}). Confirm the pgvector migration, database connection, and Gemini quota.",
            file=sys.stderr,
        )
        return 1

    print(f"Indexed {chunk_count} help chunks; generated {embedded_count} new embeddings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
