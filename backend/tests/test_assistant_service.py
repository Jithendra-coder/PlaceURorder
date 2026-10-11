import json
from urllib.error import HTTPError, URLError
from uuid import UUID

from fastapi import HTTPException

from routers.assistant import AssistantResponse
from services import assistant_service
from services.assistant_service import _classify_intent, _retrieve_policy, _tokens, _uses_unsupported_period


def test_policy_retrieval_and_supported_order_period():
    sections = _retrieve_policy(_tokens("How do I test and publish my kiosk?"))

    assert sections
    assert any("test" in section["title"].lower() for section in sections)
    assert _tokens("चाय") == {"चाय"}
    assert not _uses_unsupported_period(_tokens("How many orders in the last 24 hours?"))
    assert _uses_unsupported_period(_tokens("Show my orders today"))


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
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
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
