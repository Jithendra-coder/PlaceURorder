from index_assistant_knowledge import sync_policy_index
from services import assistant_service


def test_indexing_reuses_unchanged_embeddings_and_removes_stale_chunks(monkeypatch):
    chunk = {
        "section_key": "publishing-001",
        "title": "Publishing",
        "content": "Publish after a successful test.",
        "content_hash": "a" * 64,
        "source_version": "1.3.0",
    }
    sql_calls = []
    events = []

    class Connection:
        def execute(self, sql, params):
            events.append("write")
            sql_calls.append((sql, params))

    class Client:
        connection = Connection()

        def commit(self):
            events.append("commit")

        def fetch_all(self, *_args, **_kwargs):
            events.append("read")
            return [{
                "section_key": chunk["section_key"],
                "content_hash": chunk["content_hash"],
                "embedding_model": assistant_service.EMBEDDING_MODEL,
                "embedding": assistant_service._vector_literal([1.0] + [0.0] * 767),
            }]

    monkeypatch.setattr(assistant_service, "_policy_chunks", lambda: [chunk])
    monkeypatch.setattr(
        assistant_service,
        "_request_embeddings",
        lambda *_args: (_ for _ in ()).throw(AssertionError("unchanged guide chunk should not be re-embedded")),
    )

    assert sync_policy_index(Client(), "test-key") == (1, 0)
    assert len(sql_calls) == 2
    assert "on conflict (source_key, section_key)" in sql_calls[0][0]
    assert "delete from public.assistant_knowledge_chunks" in sql_calls[1][0]
    assert events[:2] == ["read", "commit"]


def test_indexing_embeds_and_upserts_new_chunks(monkeypatch):
    chunk = {
        "section_key": "menu-001",
        "title": "Menu",
        "content": "Review product prices in the menu editor.",
        "content_hash": "b" * 64,
        "source_version": "1.3.0",
    }
    sql_calls = []
    embedding_calls = []
    events = []

    class Connection:
        def execute(self, sql, params):
            events.append("write")
            sql_calls.append((sql, params))

    class Client:
        connection = Connection()

        def commit(self):
            events.append("commit")

        def fetch_all(self, *_args, **_kwargs):
            events.append("read")
            return []

    vector = [1.0] + [0.0] * 767
    monkeypatch.setattr(assistant_service, "_policy_chunks", lambda: [chunk])
    monkeypatch.setattr(
        assistant_service,
        "_request_embeddings",
        lambda texts, _key, task: events.append("embed") or embedding_calls.append((texts, task)) or [vector],
    )

    assert sync_policy_index(Client(), "test-key") == (1, 1)
    assert embedding_calls == [([chunk["content"]], "RETRIEVAL_DOCUMENT")]
    assert sql_calls[0][1]["embedding"].startswith("[1,0,0")
    assert "::extensions.vector" in sql_calls[0][0]
    assert events[:3] == ["read", "commit", "embed"]
