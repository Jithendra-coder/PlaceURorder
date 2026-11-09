import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException

from database import DbClient
from services import business_service


TEST_SESSION_COOKIE_NAME = "menutap_kiosk_test_session"
TEST_SESSION_MINUTES = 24 * 60
TEST_APPLICATIONS = frozenset({"kiosk", "counter", "kitchen"})


def create(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    business = business_service.assert_business_access(client, business_id, user_id, business_service.FULL_ACCESS_ROLES)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TEST_SESSION_MINUTES)
    client.execute_command(
        "update kiosk_test_sessions set revoked_at = now() where business_id = %(business_id)s and revoked_at is null",
        {"business_id": str(business_id)},
    )
    session = client.fetch_one(
        """insert into kiosk_test_sessions (business_id, token_hash, created_by, expires_at)
        values (%(business_id)s, %(token_hash)s, %(user_id)s, %(expires_at)s)
        returning id, business_id, expires_at""",
        {
            "business_id": str(business_id),
            "token_hash": _hash(token),
            "user_id": str(user_id),
            "expires_at": expires_at,
        },
    )
    return {**session, "token": token, "business_slug": business["slug"]}


def exchange(client: DbClient, token: str) -> dict:
    session = _valid_session(client, token)
    client.execute_command(
        "update kiosk_test_sessions set last_used_at = now() where id = %(id)s",
        {"id": session["id"]},
    )
    return session


def from_cookie(client: DbClient, token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Test kiosk session is required.")
    session = _valid_session(client, token)
    # shortcut: activity can lag by one minute; use a separate activity log if audit-grade freshness is needed.
    client.execute_command(
        """update kiosk_test_sessions set last_used_at = now()
        where id = %(id)s and (last_used_at is null or last_used_at < now() - interval '1 minute')""",
        {"id": session["id"]},
    )
    return session


def runtime_context(client: DbClient, token: str | None, app_type: str) -> dict:
    if app_type not in TEST_APPLICATIONS:
        raise HTTPException(status_code=422, detail="Unsupported test application.")
    return {**from_cookie(client, token), "app_type": app_type}


def revoke(client: DbClient, token: str | None) -> None:
    if token:
        client.execute_command(
            "update kiosk_test_sessions set revoked_at = now() where token_hash = %(token_hash)s",
            {"token_hash": _hash(token)},
        )


def current(client: DbClient, business_id: UUID, user_id: UUID) -> dict | None:
    business_service.assert_business_access(client, business_id, user_id, business_service.FULL_ACCESS_ROLES)
    return client.fetch_one(
        """select id, business_id, created_by, expires_at, created_at, last_used_at
        from kiosk_test_sessions
        where business_id = %(business_id)s and revoked_at is null and expires_at > now()
        order by created_at desc limit 1""",
        {"business_id": str(business_id)},
    )


def reset(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    business_service.assert_business_access(client, business_id, user_id, business_service.FULL_ACCESS_ROLES)
    client.execute_command(
        "update kiosk_test_sessions set revoked_at = now() where business_id = %(business_id)s and revoked_at is null",
        {"business_id": str(business_id)},
    )
    return create(client, business_id, user_id)


def end_current(client: DbClient, business_id: UUID, user_id: UUID) -> None:
    business_service.assert_business_access(client, business_id, user_id, business_service.FULL_ACCESS_ROLES)
    client.execute_command(
        "update kiosk_test_sessions set revoked_at = now() where business_id = %(business_id)s and revoked_at is null",
        {"business_id": str(business_id)},
    )


def _valid_session(client: DbClient, token: str) -> dict:
    session = client.fetch_one(
        """select id, business_id, created_by, expires_at
        from kiosk_test_sessions
        where token_hash = %(token_hash)s and revoked_at is null and expires_at > now()
        limit 1""",
        {"token_hash": _hash(token)},
    )
    if not session:
        raise HTTPException(status_code=401, detail="This test kiosk session is invalid or expired.")
    return session


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
