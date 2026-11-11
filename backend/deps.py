from typing import Annotated
from uuid import UUID

from fastapi import Cookie, Depends, Header, HTTPException, status

from config import Settings, get_settings
from database import DbClient, get_db_client
from services.auth_service import SESSION_COOKIE_NAME, assert_session_active, decode_access_token, get_user


def legacy_device_token_guard(settings: Settings = Depends(get_settings)) -> None:
    """Token-in-path device routes are disabled unless explicitly enabled. Tokens in URLs leak into logs and proxies."""
    if not settings.legacy_device_token_routes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    raw = authorization.strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return None


def _authenticated_token(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    settings: Settings = Depends(get_settings),
) -> tuple[UUID, str | None]:
    if isinstance(session_cookie, str) and session_cookie:
        return decode_access_token(session_cookie), session_cookie

    token = _bearer_token(authorization)
    if token:
        return decode_access_token(token), token

    if settings.allow_dev_auth_bypass and x_user_id:
        if settings.environment.lower() not in {"local", "dev", "development", "test", "testing"}:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
        try:
            return UUID(x_user_id), None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid x-user-id header.") from exc

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")


async def require_user_id(
    auth: Annotated[tuple[UUID, str | None], Depends(_authenticated_token)],
    client: DbClient = Depends(get_db_client),
) -> UUID:
    user_id, token = auth
    if token:
        assert_session_active(client, token)
        get_user(client, user_id)
    return user_id
