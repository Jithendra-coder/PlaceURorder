from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from schemas import ReauthenticateRequest, ResetPasswordRequest
from services import auth_service


class ActiveSessionClient:
    def __init__(self, expires_at=None, revoked_at=None):
        self.expires_at = expires_at or datetime.now(timezone.utc) + timedelta(minutes=5)
        self.revoked_at = revoked_at
        self.commands = []

    def execute_one(self, _sql, _params):
        return {"expires_at": self.expires_at, "revoked_at": self.revoked_at}

    def execute_command(self, sql, params):
        self.commands.append((sql, params))
        return 1


def test_valid_supabase_session_decodes_and_updates_activity(issue_supabase_access_token):
    user_id, session_id = uuid4(), uuid4()
    token = issue_supabase_access_token(user_id, session_id=session_id)
    client = ActiveSessionClient()

    assert auth_service.decode_access_token(token) == user_id
    assert auth_service.assert_session_active(client, token) == user_id
    assert "last_active_at" in client.commands[0][0]


@pytest.mark.parametrize("token", ["", "malformed", "header.payload.signature"])
def test_invalid_access_tokens_are_controlled_401(issue_supabase_access_token, token):
    with pytest.raises(HTTPException) as error:
        auth_service.decode_access_token(token)
    assert error.value.status_code == 401


def test_expired_supabase_access_token_is_rejected(issue_supabase_access_token):
    token = issue_supabase_access_token(
        uuid4(), expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)
    )
    with pytest.raises(HTTPException) as error:
        auth_service.decode_access_token(token)
    assert error.value.status_code == 401


def test_revoked_and_expired_sessions_are_controlled_401(issue_supabase_access_token):
    token = issue_supabase_access_token(uuid4())
    clients = (
        ActiveSessionClient(revoked_at=datetime.now(timezone.utc)),
        ActiveSessionClient(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)),
    )
    for client in clients:
        with pytest.raises(HTTPException) as error:
            auth_service.assert_session_active(client, token)
        assert error.value.status_code == 401


def test_logout_revokes_the_supabase_server_session(issue_supabase_access_token):
    session_id = uuid4()
    token = issue_supabase_access_token(uuid4(), session_id=session_id)
    client = ActiveSessionClient()

    auth_service.revoke_session(client, token)

    sql, params = client.commands[0]
    assert "set revoked_at" in sql
    assert params["id"] == str(session_id)


def test_password_reset_uses_supabase_and_revokes_existing_sessions(
    issue_supabase_access_token, monkeypatch
):
    user_id = uuid4()
    token = issue_supabase_access_token(user_id)
    auth_requests = []

    class Client:
        revoked_user_id = None

        def execute_command(self, sql, params):
            assert "update auth_sessions set revoked_at" in sql
            self.revoked_user_id = params["user_id"]

    monkeypatch.setattr(
        auth_service,
        "auth_request",
        lambda *args, **kwargs: auth_requests.append((args, kwargs)) or {},
    )
    client = Client()
    auth_service.reset_password(
        client, ResetPasswordRequest(token=token, password="MenuTapTest1")
    )

    assert auth_requests[0][0] == ("user",)
    assert auth_requests[0][1]["method"] == "PUT"
    assert auth_requests[0][1]["token"] == token
    assert auth_requests[0][1]["body"] == {"password": "MenuTapTest1"}
    assert client.revoked_user_id == str(user_id)


def test_recent_auth_rejects_stale_session_and_accepts_current_session():
    business_id, user_id, session_id = uuid4(), uuid4(), uuid4()

    class Client:
        def __init__(self, reauthenticated_at):
            self.reauthenticated_at = reauthenticated_at

        def execute_one(self, _sql, _params):
            return {"reauthenticated_at": self.reauthenticated_at, "reauthentication_minutes": 15}

    auth_service.require_recent_auth(
        Client(datetime.now(timezone.utc)), business_id, user_id, session_id
    )
    with pytest.raises(HTTPException) as error:
        auth_service.require_recent_auth(
            Client(datetime.now(timezone.utc) - timedelta(minutes=16)),
            business_id,
            user_id,
            session_id,
        )
    assert error.value.status_code == 403


def test_reauthenticate_verifies_password_with_supabase_and_refreshes_session(
    issue_supabase_access_token, monkeypatch
):
    user_id, session_id = uuid4(), uuid4()
    token = issue_supabase_access_token(user_id, session_id=session_id)
    verified_token = issue_supabase_access_token(user_id, session_id=uuid4())
    auth_requests = []

    class Client(ActiveSessionClient):
        def execute_one(self, sql, params):
            if "from auth_sessions" in sql:
                return super().execute_one(sql, params)
            return {"email": "user@example.test"}

    def auth_request(*args, **kwargs):
        auth_requests.append((args, kwargs))
        return {"access_token": verified_token} if args[0].startswith("token?") else {}

    monkeypatch.setattr(auth_service, "auth_request", auth_request)
    client = Client()
    auth_service.reauthenticate(
        client, user_id, token, ReauthenticateRequest(password="MenuTapTest1")
    )

    assert auth_requests[0][0] == ("token?grant_type=password",)
    assert auth_requests[0][1]["body"] == {
        "email": "user@example.test",
        "password": "MenuTapTest1",
    }
    assert auth_requests[1][0] == ("logout",)
    assert any("reauthenticated_at" in sql for sql, _params in client.commands)
