from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from services import auth_service


@pytest.fixture
def issue_supabase_access_token(monkeypatch):
    issued: dict[str, dict] = {}

    def issue(user_id, email="owner@example.test", session_id=None, expires_at=None, provider=None):
        now = datetime.now(timezone.utc)
        token = f"supabase-test.{uuid4().hex}"
        issued[token] = {
            "sub": str(user_id),
            "email": email,
            "session_id": str(session_id or uuid4()),
            "exp": int((expires_at or now + timedelta(minutes=15)).timestamp()),
        }
        if provider:
            issued[token]["app_metadata"] = {"provider": provider}
        return token

    def verify(token):
        claims = issued.get(token)
        if not claims or claims["exp"] <= int(datetime.now(timezone.utc).timestamp()):
            raise HTTPException(status_code=401, detail="Invalid auth token.")
        return claims.copy()

    monkeypatch.setattr(auth_service, "verify_access_token", verify)
    return issue
