import base64
import hashlib
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from config import Settings, get_settings
from database import get_db_client
from main import app
from routers.auth import GOOGLE_OAUTH_VERIFIER_COOKIE
from services import auth_service
from services.rate_limit_service import reset_rate_limits


class AuthSessionClient:
    def __init__(self):
        self.commands = []

    def execute_command(self, sql, params):
        self.commands.append((sql, params))
        return 1


def test_google_pkce_flow_sets_server_session_cookie(monkeypatch, issue_supabase_access_token):
    user_id = uuid4()
    token = issue_supabase_access_token(user_id, provider="email", providers=["email", "google"])
    auth_requests = []
    database = AuthSessionClient()
    settings = Settings(
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        frontend_base_url="https://app.example.test",
    )

    def auth_request(path, **kwargs):
        auth_requests.append((path, kwargs))
        if path == "settings":
            return {"external": {"google": True}}
        return {
            "access_token": token,
            "refresh_token": "supabase-refresh-token",
            "user": {
                "id": str(user_id),
                "email": "owner@example.test",
                "app_metadata": {"provider": "google"},
            },
            "expires_in": 900,
        }

    monkeypatch.setattr(auth_service, "auth_request", auth_request)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_db_client] = lambda: database
    reset_rate_limits()
    local_client = TestClient(app)
    try:
        start = local_client.get("/api/auth/oauth/google/start")
        assert start.status_code == 200
        authorization = urlsplit(start.json()["authorization_url"])
        query = parse_qs(authorization.query)
        verifier = local_client.cookies.get(GOOGLE_OAUTH_VERIFIER_COOKIE)
        expected_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).decode("ascii").rstrip("=")

        assert authorization.path == "/auth/v1/authorize"
        assert query["provider"] == ["google"]
        assert query["redirect_to"] == ["https://app.example.test/auth/callback"]
        assert query["code_challenge"] == [expected_challenge]
        assert query["code_challenge_method"] == ["s256"]
        assert query["apikey"] == ["sb_publishable_test"]
        assert f"{GOOGLE_OAUTH_VERIFIER_COOKIE}=" in start.headers["set-cookie"]
        assert "httponly" in start.headers["set-cookie"].lower()

        exchanged = local_client.post(
            "/api/auth/oauth/google/exchange", json={"code": "one-time-supabase-auth-code"}
        )
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()

    assert exchanged.status_code == 200
    assert exchanged.json()["access_token"] is None
    assert exchanged.json()["user"]["id"] == str(user_id)
    assert f"{auth_service.SESSION_COOKIE_NAME}=" in exchanged.headers["set-cookie"]
    assert GOOGLE_OAUTH_VERIFIER_COOKIE in exchanged.headers["set-cookie"]
    assert any("insert into auth_sessions" in sql for sql, _params in database.commands)
    assert auth_requests[1][0] == "token?grant_type=pkce"
    assert auth_requests[1][1]["body"] == {
        "auth_code": "one-time-supabase-auth-code",
        "code_verifier": verifier,
    }


def test_google_exchange_rejects_non_google_supabase_sessions(
    monkeypatch, issue_supabase_access_token
):
    user_id = uuid4()
    token = issue_supabase_access_token(user_id, provider="email")
    monkeypatch.setattr(
        auth_service,
        "auth_request",
        lambda *_args, **_kwargs: {
            "access_token": token,
            "refresh_token": "refresh-token",
            "user": {"id": str(user_id), "email": "owner@example.test"},
        },
    )

    with pytest.raises(HTTPException) as error:
        auth_service.exchange_google_oauth_code(object(), "code", "verifier")
    assert error.value.status_code == 401


def test_google_start_explains_when_provider_is_disabled(monkeypatch):
    settings = Settings(
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )
    monkeypatch.setattr(auth_service, "auth_request", lambda *_args, **_kwargs: {"external": {"google": False}})
    app.dependency_overrides[get_settings] = lambda: settings
    reset_rate_limits()
    try:
        response = TestClient(app).get("/api/auth/oauth/google/start")
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()
    assert response.status_code == 503
    assert response.json()["detail"] == "Google sign-in is not enabled in Supabase Auth yet."
