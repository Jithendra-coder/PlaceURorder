import json
from urllib.error import HTTPError, URLError
from uuid import UUID

from fastapi import HTTPException
import pytest

from config import Settings
from routers.assistant import AssistantResponse
from services import assistant_service
from services.assistant_service import _classify_intent, _retrieve_policy, _tokens, _uses_unsupported_period


def test_policy_retrieval_and_supported_order_period():
    sections = _retrieve_policy(_tokens("How do I test and publish my kiosk?"))

    assert sections
    assert any("test" in section["title"].lower() for section in sections)
    assert assistant_service._policy_version() == "1.3.0"
    assert _tokens("चाय") == {"चाय"}
    assert not _uses_unsupported_period(_tokens("How many orders in the last 24 hours?"))
    assert _uses_unsupported_period(_tokens("Show my orders today"))


def test_policy_chunking_is_bounded_and_content_addressed(monkeypatch):
    monkeypatch.setattr(assistant_service, "_policy_sections", lambda: ({
        "title": "Publishing Guide",
        "content": "publish safely " * 150,
        "tokens": {"publishing", "guide"},
    },))

    chunks = assistant_service._policy_chunks(max_chars=120, overlap_chars=20)

    assert len(chunks) > 1
    assert all(len(chunk["content"]) <= 120 for chunk in chunks)
    assert all(len(chunk["content_hash"]) == 64 for chunk in chunks)
    assert chunks[0]["section_key"].startswith("guide-publishing-")


def test_known_how_to_questions_stay_on_the_help_path():
    assert _classify_intent(_tokens("How many orders were placed?"), True, "How many orders were placed?") == "orders_summary"
    assert _classify_intent(_tokens("How do I add a menu item?"), True, "How do I add a menu item?") == "product_help"


def test_gemini_request_is_stateless_and_contains_only_question_and_sources(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({"status": "completed", "steps": [{"type": "model_output", "content": [{"type": "text", "text": "Publish from setup."}]}]}).encode()

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(assistant_service, "urlopen", fake_urlopen)
    generated = assistant_service._generate_answer(
        "How do I publish?",
        [{"title": "Setup", "excerpt": "Publish from setup.", "customer_email": "not sent@example.com"}],
        "test-key",
        assistant_service.DEFAULT_GEMINI_MODEL,
    )

    request = captured["request"]
    body = json.loads(request.data)
    headers = {key.lower(): value for key, value in request.header_items()}
    assert generated == "Publish from setup."
    assert body["model"] == "gemini-3.1-flash-lite"
    assert request.full_url == "https://generativelanguage.googleapis.com/v1/interactions"
    assert headers["x-goog-api-key"] == "test-key"
    assert captured["timeout"] == 15
    assert body["store"] is False
    assert "tools" not in body
    assert "not sent@example.com" not in body["input"]


def test_embedding_request_uses_retrieval_task_and_normalizes_vectors(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({"embeddings": [{"values": [3.0, 4.0] + [0.0] * 766}]}).encode()

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(assistant_service, "urlopen", fake_urlopen)
    vectors = assistant_service._request_embeddings(["How do I publish?"], "test-key", "RETRIEVAL_QUERY")
    request = captured["request"]
    body = json.loads(request.data)

    assert request.full_url.endswith("/models/gemini-embedding-001:batchEmbedContents")
    assert body["requests"][0]["embedContentConfig"] == {
        "taskType": "RETRIEVAL_QUERY",
        "outputDimensionality": 768,
    }
    assert len(vectors[0]) == 768
    assert vectors[0][:2] == [0.6, 0.8]
    assert captured["timeout"] == 15


@pytest.mark.parametrize("values", [[], [0.0] * 768, [float("nan")] + [0.0] * 767])
def test_invalid_embedding_vectors_are_rejected(values):
    with pytest.raises(ValueError):
        assistant_service._normalize_embedding(values)


def test_pgvector_retrieval_filters_current_source_and_rejects_weak_matches(monkeypatch):
    captured = {}

    class Client:
        def commit(self):
            pass

        def rollback(self):
            pass

        def fetch_all(self, sql, params):
            captured["sql"] = sql
            captured["params"] = params
            return [
                {"title": "Publishing", "content": "Publish after a successful test.", "source_version": assistant_service._policy_version(), "similarity": 0.81},
                {"title": "Unrelated", "content": "Not relevant.", "source_version": assistant_service._policy_version(), "similarity": 0.2},
            ]

    monkeypatch.setattr(assistant_service, "_request_embeddings", lambda *_args: [[1.0] + [0.0] * 767])
    sources = assistant_service._retrieve_policy_pgvector(Client(), "How can I publish?", "test-key")

    assert [source["title"] for source in sources] == ["Publishing"]
    assert "OPERATOR(extensions.<=>)" in captured["sql"]
    assert "source_version = %(source_version)s" in captured["sql"]
    assert captured["params"]["source_key"] == assistant_service.KNOWLEDGE_SOURCE_KEY
    assert captured["params"]["embedding_model"] == assistant_service.EMBEDDING_MODEL
    assert captured["params"]["query_vector"].startswith("[1,0,0")


def test_pgvector_query_failure_rolls_back_before_keyword_fallback(monkeypatch):
    events = []

    class Client:
        def commit(self):
            events.append("commit")

        def fetch_all(self, *_args, **_kwargs):
            events.append("query")
            raise RuntimeError("vector extension unavailable")

        def rollback(self):
            events.append("rollback")

    monkeypatch.setattr(assistant_service, "_request_embeddings", lambda *_args: [[1.0] + [0.0] * 767])

    assert assistant_service._retrieve_policy_pgvector(Client(), "How can I publish?", "test-key") == []
    assert events == ["commit", "query", "rollback"]


def test_semantic_help_lookup_uses_pgvector_sources(monkeypatch):
    events = []

    class Client:
        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

        def fetch_all(self, *_args, **_kwargs):
            events.append("query")
            return [{
                "title": "Test, preview, and publish",
                "content": "Run a successful test before publishing the reviewed kiosk draft.",
                "source_version": assistant_service._policy_version(),
                "similarity": 0.88,
            }]

    seen = {}
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(assistant_service, "_retrieve_policy", lambda *_args: [])
    monkeypatch.setattr(assistant_service, "_request_embeddings", lambda *_args: events.append("embed") or [[1.0] + [0.0] * 767])
    def generate(_question, sources, *_args):
        assert events[-1] == "commit"
        events.append("generate")
        seen["sources"] = sources
        return "Publish after testing."

    monkeypatch.setattr(assistant_service, "_generate_answer", generate)

    result = assistant_service.answer(
        Client(),
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How can I take my kiosk live?",
    )

    assert result["intent"] == "product_help"
    assert result["sources"][0]["title"] == "Test, preview, and publish"
    assert seen["sources"][0]["title"] == "Test, preview, and publish"
    assert "Publish after testing." in result["text"]
    assert events == ["commit", "embed", "query", "commit", "generate"]


def test_provider_failure_falls_back_to_retrieved_sources(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.setattr(assistant_service, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("offline")))

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["intent"] == "product_help"
    assert result["answer_kind"] == "narrative"
    assert result["text"] == "Here are the closest passages from the PlaceURorder help guide."
    assert result["sources"]
    assert "Gemini" not in result["text"]


def test_http_provider_failure_logs_status_without_provider_details(monkeypatch, caplog):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    def fail_with_http_error(*_args, **_kwargs):
        raise HTTPError("https://generativelanguage.googleapis.com", 400, "Bad Request", {}, None)

    monkeypatch.setattr(assistant_service, "urlopen", fail_with_http_error)
    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["sources"]
    assert "Gemini answer generation failed (HTTP 400)" in caplog.text
    assert "test-key" not in caplog.text


def test_missing_key_never_calls_google(monkeypatch):
    class Settings:
        gemini_api_key = None
        gemini_model = assistant_service.DEFAULT_GEMINI_MODEL

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(assistant_service, "get_settings", lambda: Settings())
    monkeypatch.setattr(assistant_service, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected provider call")))

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["intent"] == "product_help"
    assert result["answer_kind"] == "narrative"
    assert result["text"]
    assert result["sources"]


def test_gemini_settings_file_values_are_used_by_help_answers(monkeypatch, tmp_path):
    captured = {}
    env_file = tmp_path / "assistant.env"
    env_file.write_text("GEMINI_API_KEY=settings-key\nGEMINI_MODEL=models/settings-model\n", encoding="utf-8")
    settings = Settings(_env_file=env_file)

    def generate(_question, _sources, api_key, model):
        captured.update(api_key=api_key, model=model)
        return "Use the setup checklist."

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.setattr(assistant_service, "get_settings", lambda: settings)
    monkeypatch.setattr(assistant_service, "_generate_answer", generate)

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["text"] == "Use the setup checklist."
    assert captured == {"api_key": "settings-key", "model": "settings-model"}


def test_no_matching_source_never_calls_google(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(assistant_service, "_generate_answer", lambda *_args: (_ for _ in ()).throw(AssertionError("unsupported question was sent")))

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "qzxvplmokn",
    )

    assert result["intent"] == "unsupported"
    assert result["sources"] == []
    assert result["results"] == []


def test_successful_grounded_answer_keeps_structured_contract(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "models/test-model")
    seen = {}

    def generate(_question, _sources, _api_key, model):
        seen["model"] = model
        return "Publish only after testing."

    monkeypatch.setattr(assistant_service, "_generate_answer", generate)

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["intent"] == "product_help"
    assert result["text"] == "Publish only after testing."
    assert seen["model"] == "test-model"
    assert result["answer_kind"] == "narrative"
    assert result["sources"]
    assert set(result) == {
        "intent", "text", "total", "results", "sources", "as_of", "has_more",
        "answer_kind", "requires_confirmation", "action", "args",
    }
    assert result["requires_confirmation"] is False
    assert result["action"] is result["args"] is None


def test_live_order_question_returns_structured_read_only_data_without_gemini(monkeypatch):
    class Client:
        def fetch_all(self, *_args, **_kwargs):
            return [{"status": "completed", "count": 2}, {"status": "pending", "count": 1}]

    monkeypatch.setattr(assistant_service.business_service, "assert_business_access", lambda *_args, **_kwargs: None)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(assistant_service, "_generate_answer", lambda *_args: (_ for _ in ()).throw(AssertionError("known data query must not call Gemini")))

    result = assistant_service.answer(
        Client(),
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How many orders were placed in the last 24 hours?",
    )

    assert result["intent"] == "orders_summary"
    assert result["answer_kind"] == "data"
    assert result["total"] == 3
    assert result["results"] == [
        {"title": "Completed", "value": "2"},
        {"title": "Pending", "value": "1"},
    ]
    assert result["sources"][0]["href"] == "/dashboard/operations/order-history"
    assert result["has_more"] is False
    AssistantResponse.model_validate(result)


def test_current_menu_query_is_not_misread_as_a_product_search(monkeypatch):
    queries = []

    class Client:
        def fetch_one(self, sql, _params):
            queries.append(sql)
            if "currency_code" in sql:
                return {"currency_code": "INR"}
            return {"count": 31}

        def fetch_all(self, sql, _params):
            queries.append(sql)
            return [{"category": "Drinks", "name": "Tea", "price": 20, "is_available": True, "menu_status": "active"}]

    monkeypatch.setattr(assistant_service.business_service, "assert_business_access", lambda *_args, **_kwargs: None)
    result = assistant_service.answer(
        Client(),
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "Show my current menu",
    )

    assert result["intent"] == "menu_catalog"
    assert result["total"] == 31
    assert result["results"][0]["title"] == "Tea"
    assert result["results"][0]["value"] == "INR 20.00"
    assert result["has_more"] is True
    assert not any("ilike any" in sql for sql in queries)
    assert result["sources"][0]["href"] == "/dashboard/kiosk-experience/menu"


def test_denied_business_data_stays_a_notice_without_results(monkeypatch):
    def deny(*_args, **_kwargs):
        raise HTTPException(status_code=403)

    monkeypatch.setattr(assistant_service.business_service, "assert_business_access", deny)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(assistant_service, "_generate_answer", lambda *_args: (_ for _ in ()).throw(AssertionError("denied data must not be sent to Gemini")))

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How many orders were placed in the last 24 hours?",
    )

    assert result["answer_kind"] == "narrative"
    assert result["sources"][0]["kind"] == "notice"
    assert result["results"] == []
    assert "does not permit access" in result["text"]
