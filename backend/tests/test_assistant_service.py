import json
from urllib.error import URLError
from uuid import UUID

from services import assistant_service
from services.assistant_service import _retrieve_policy, _tokens, _uses_unsupported_period


def test_policy_retrieval_and_supported_order_period():
    sections = _retrieve_policy(_tokens("How do I test and publish my kiosk?"))

    assert sections
    assert any("test" in section["title"].lower() for section in sections)
    assert _tokens("चाय") == {"चाय"}
    assert not _uses_unsupported_period(_tokens("How many orders in the last 24 hours?"))
    assert _uses_unsupported_period(_tokens("Show my orders today"))


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

    assert result["mode"] == "extractive"
    assert result["generated_model"] is None
    assert "temporarily unavailable" in result["answer"]
    assert result["sources"]


def test_missing_key_never_calls_google(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(assistant_service, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected provider call")))

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["mode"] == "extractive"
    assert result["generated_model"] is None
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

    assert result["mode"] == "extractive"
    assert result["sources"] == []


def test_successful_grounded_answer_reports_model(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "models/test-model")
    monkeypatch.setattr(assistant_service, "_generate_answer", lambda *_args: "Publish only after testing.")

    result = assistant_service.answer(
        None,
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
        "How do I test and publish my kiosk?",
    )

    assert result["mode"] == "gemini"
    assert result["generated_model"] == "models/test-model"
    assert result["answer"] == "Publish only after testing."
    assert result["sources"]
