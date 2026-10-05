from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest

from services import auth_service


@pytest.mark.parametrize("environment", ["prod", "production"])
def test_auth_emails_are_delegated_to_supabase_without_exposing_secrets(
    monkeypatch, environment
):
    settings = SimpleNamespace(
        environment=environment,
        frontend_base_url="https://app.menutap.example",
    )
    auth_requests = []
    monkeypatch.setattr(auth_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        auth_service,
        "auth_request",
        lambda path, **kwargs: auth_requests.append((path, kwargs)) or {},
    )

    verification = auth_service.send_signup_otp("owner@example.test")
    reset = auth_service.create_password_reset(object(), "owner@example.test")

    assert verification["dev_otp"] is None
    assert reset["reset_url"] is None
    assert reset["message"] == "If that email exists, a password reset email has been sent."
    assert [path.split("?", 1)[0] for path, _ in auth_requests] == ["otp", "recover"]
    assert all("password" not in kwargs.get("body", {}) for _, kwargs in auth_requests)


def test_password_reset_email_uses_configured_frontend_redirect(monkeypatch):
    settings = SimpleNamespace(
        frontend_base_url="https://dashboard.menutap.example/base/",
    )
    auth_requests = []
    monkeypatch.setattr(auth_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        auth_service,
        "auth_request",
        lambda path, **kwargs: auth_requests.append((path, kwargs)) or {},
    )

    result = auth_service.create_password_reset(object(), "owner@example.test")

    path, options = auth_requests[0]
    redirect = parse_qs(urlsplit("https://supabase.invalid/" + path).query)["redirect_to"][0]
    assert redirect == "https://dashboard.menutap.example/base/auth/reset-password"
    assert options["body"] == {"email": "owner@example.test"}
    assert result["reset_url"] is None
