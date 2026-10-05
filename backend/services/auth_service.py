from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import UUID

import jwt
from fastapi import HTTPException, status

from config import get_settings
from database import DbClient
from schemas import AuthLogin, AuthSignup, ReauthenticateRequest, ResetPasswordRequest, ResendVerificationRequest, SignupEmailComplete, VerifyEmailRequest
from services import mail_service
from services.supabase_auth import auth_request, verify_access_token

SESSION_COOKIE_NAME = "menutap_admin_session"
SESSION_REFRESH_COOKIE_NAME = "menutap_admin_refresh"
SIGNUP_SESSION_COOKIE_NAME = "menutap_signup_session"
SIGNUP_REFRESH_COOKIE_NAME = "menutap_signup_refresh"
INTERNAL_SESSION_TOKEN_FIELD = "_session_token"
INTERNAL_REFRESH_TOKEN_FIELD = "_refresh_token"
INTERNAL_SIGNUP_TOKEN_FIELD = "_signup_token"


def signup(client: DbClient, payload: AuthSignup) -> dict:
    auth_request("signup", body={"email": _normalize_email(payload.email), "password": payload.password, "data": {"full_name": payload.full_name}})
    return _signup_response(payload.email)


def start_staged_signup(client: DbClient, email_value: str) -> dict:
    email = _normalize_email(email_value)
    existing = client.execute_one("select is_active from app_users where email=%(email)s limit 1", {"email": email})
    if existing and existing.get("is_active"):
        raise HTTPException(status_code=409, detail="An account already exists for this email.")
    _send_signup_link(email, create_user=True)
    return _signup_response(email)


def verify_staged_signup(client: DbClient, payload: VerifyEmailRequest) -> dict:
    session = _verify_email(payload)
    return {
        "email": _normalize_email(payload.email),
        "message": "Email verified. Create your password to finish.",
        INTERNAL_SIGNUP_TOKEN_FIELD: session[INTERNAL_SESSION_TOKEN_FIELD],
        INTERNAL_REFRESH_TOKEN_FIELD: session[INTERNAL_REFRESH_TOKEN_FIELD],
    }


def accept_signup_link(client: DbClient, access_token: str, refresh_token: str) -> dict:
    auth_user = auth_request("user", method="GET", token=access_token)
    claims = verify_access_token(access_token)
    if str(auth_user.get("id")) != str(claims.get("sub")) or not auth_user.get("email_confirmed_at"):
        raise HTTPException(status_code=401, detail="The verification link is invalid or expired.")
    return _session(client, {"access_token": access_token, "refresh_token": refresh_token, "user": auth_user})


def complete_staged_signup(client: DbClient, token: str, refresh_token: str, payload: SignupEmailComplete) -> dict:
    user_id = decode_access_token(token)
    auth_request(
        "user",
        method="PUT",
        token=token,
        body={"password": payload.password, "data": {"full_name": payload.full_name}},
    )
    client.execute_one(
        "update app_users set full_name=%(full_name)s,is_active=true,last_login_at=now() where id=%(id)s returning id",
        {"full_name": payload.full_name, "id": str(user_id)},
    )
    client.table("profiles").upsert({"id": str(user_id), "email": _email_from_token(token), "full_name": payload.full_name}).execute()
    mail_service.send_welcome_email(_email_from_token(token))
    return _session(client, {"access_token": token, "refresh_token": refresh_token, "user": {"id": str(user_id), "email": _email_from_token(token), "user_metadata": {"full_name": payload.full_name}}})


def login(client: DbClient, payload: AuthLogin) -> dict:
    identifier = payload.email.strip()
    identity = {"phone": identifier, "password": payload.password} if "@" not in identifier else {"email": _normalize_email(identifier), "password": payload.password}
    auth_session = auth_request("token?grant_type=password", body=identity)
    session = _session(client, auth_session)
    user_id = session["user"]["id"]
    client.execute_one("update app_users set last_login_at=now() where id=%(id)s returning id", {"id": user_id})
    return session


def exchange_google_oauth_code(client: DbClient, code: str, code_verifier: str) -> dict:
    session = auth_request(
        "token?grant_type=pkce",
        body={"auth_code": code, "code_verifier": code_verifier},
    )
    token = session.get("access_token") or ""
    claims = verify_access_token(token)
    user = session.get("user") or {}
    app_metadata = claims.get("app_metadata") or {}
    if app_metadata.get("provider") != "google" or str(user.get("id")) != str(claims.get("sub")):
        raise HTTPException(status_code=401, detail="The Google sign-in session is invalid.")
    return _session(client, session)


def verify_email(client: DbClient, payload: VerifyEmailRequest) -> dict:
    return _verify_email(payload, client)


def _verify_email(payload: VerifyEmailRequest, client: DbClient | None = None) -> dict:
    session = auth_request("verify", body={"type": "email", "email": _normalize_email(payload.email), "token": payload.code})
    return _session(client, session)


def resend_verification(client: DbClient, payload: ResendVerificationRequest) -> dict:
    return send_signup_otp(payload.email)


def send_signup_otp(email: str) -> dict:
    normalized = _normalize_email(email)
    _send_signup_link(normalized, create_user=False)
    return _signup_response(normalized)


def _send_signup_link(email: str, *, create_user: bool) -> None:
    redirect = f"{get_settings().frontend_base_url.rstrip('/')}/auth/sign-up"
    auth_request(f"otp?{urlencode({'redirect_to': redirect})}", body={"email": email, "create_user": create_user})


def _signup_response(email: str) -> dict:
    return {
        "requires_verification": True,
        "email": _normalize_email(email),
        "message": "Check your email for a secure verification link.",
        "dev_otp": None,
    }


def _session(client: DbClient | None, auth_session: dict) -> dict:
    access_token = auth_session.get("access_token")
    refresh_token = auth_session.get("refresh_token")
    if not access_token or not refresh_token:
        raise HTTPException(status_code=401, detail="Supabase did not return a valid session.")
    claims = verify_access_token(access_token)
    try:
        user_id = UUID(str(claims["sub"]))
        session_id = UUID(str(claims["session_id"]))
        expires_at = datetime.fromtimestamp(int(claims["exp"]), tz=timezone.utc)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise HTTPException(status_code=401, detail="Invalid auth session.") from exc

    auth_user = auth_session.get("user") or {}
    user = {
        "id": str(user_id),
        "email": auth_user.get("email") or claims.get("email") or "",
        "full_name": (auth_user.get("user_metadata") or {}).get("full_name"),
        "is_active": True,
        "created_at": auth_user.get("created_at"),
    }
    if client:
        client.execute_command(
            """insert into auth_sessions (id,user_id,token_hash,expires_at,reauthenticated_at)
            values (%(id)s,%(user_id)s,%(token_hash)s,%(expires_at)s,now())
            on conflict (id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,
              revoked_at=null,last_active_at=now(),reauthenticated_at=coalesce(auth_sessions.reauthenticated_at,now())""",
            {
                "id": str(session_id),
                "user_id": str(user_id),
                "token_hash": _token_hash(access_token),
                "expires_at": expires_at,
            },
        )
    return {
        "access_token": None,
        "token_type": "bearer",
        "user": public_user(user),
        INTERNAL_SESSION_TOKEN_FIELD: access_token,
        INTERNAL_REFRESH_TOKEN_FIELD: refresh_token,
        "_expires_in": max(60, int(auth_session.get("expires_in") or (expires_at - datetime.now(timezone.utc)).total_seconds())),
    }


def refresh_session(client: DbClient, current_token: str | None, refresh_token: str | None) -> dict:
    if not current_token or not refresh_token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    claims = _unverified_claims(current_token)
    try:
        session_id = UUID(str(claims["session_id"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid auth session.") from exc
    row = client.execute_one(
        "select revoked_at from auth_sessions where id=%(id)s and token_hash=%(hash)s",
        {"id": str(session_id), "hash": _token_hash(current_token)},
    )
    if not row or row.get("revoked_at"):
        raise HTTPException(status_code=401, detail="Session has been revoked.")
    return _session(client, auth_request("token?grant_type=refresh_token", body={"refresh_token": refresh_token}))


def public_user(user: dict) -> dict:
    return {"id": user["id"], "email": user["email"], "full_name": user.get("full_name"), "is_active": user.get("is_active", True), "created_at": user.get("created_at")}


def get_user(client: DbClient, user_id: UUID) -> dict:
    user = client.execute_one("select id,email,full_name,is_active,created_at from app_users where id=%(id)s limit 1", {"id": str(user_id)})
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return public_user(user)


def create_password_reset(client: DbClient, email: str) -> dict:
    redirect = f"{get_settings().frontend_base_url.rstrip('/')}/auth/reset-password"
    auth_request(f"recover?{urlencode({'redirect_to': redirect})}", body={"email": _normalize_email(email)})
    return {"message": "If that email exists, a password reset email has been sent.", "reset_url": None}


def reset_password(client: DbClient, payload: ResetPasswordRequest) -> None:
    claims = verify_access_token(payload.token)
    user_id = UUID(str(claims["sub"]))
    auth_request("user", method="PUT", token=payload.token, body={"password": payload.password})
    client.execute_command("update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=%(user_id)s", {"user_id": str(user_id)})


def _unverified_claims(token: str) -> dict:
    try:
        return jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid auth session.") from exc


def _email_from_token(token: str) -> str:
    return str(verify_access_token(token).get("email") or "")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def decode_access_token(token: str) -> UUID:
    try:
        return UUID(str(verify_access_token(token)["sub"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token.") from exc


def decode_signup_completion_token(token: str) -> UUID:
    return decode_access_token(token)


def session_id_from_access_token(token: str) -> UUID | None:
    try:
        claims = verify_access_token(token)
        return UUID(str(claims["session_id"]))
    except (HTTPException, KeyError, TypeError, ValueError):
        return None


def revoke_session(client: DbClient, token: str | None) -> None:
    session_id = session_id_from_access_token(token) if token else None
    if session_id:
        client.execute_command("update auth_sessions set revoked_at=coalesce(revoked_at,now()) where id=%(id)s", {"id": str(session_id)})


def logout(client: DbClient, token: str | None) -> None:
    revoke_session(client, token)
    if token:
        try:
            auth_request("logout", token=token)
        except HTTPException:
            pass


def assert_session_active(client: DbClient, token: str) -> UUID:
    claims = verify_access_token(token)
    try:
        session_id = UUID(str(claims["session_id"]))
        user_id = UUID(str(claims["sub"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth session.") from exc
    row = client.execute_one(
        "select expires_at,revoked_at from auth_sessions where id=%(id)s and token_hash=%(hash)s",
        {"id": str(session_id), "hash": _token_hash(token)},
    )
    if not row or row.get("revoked_at"):
        raise HTTPException(status_code=401, detail="Session has been revoked.")
    expires_at = row["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session has expired.")
    client.execute_command("update auth_sessions set last_active_at=now() where id=%(id)s and last_active_at<now()-interval '1 minute'", {"id": str(session_id)})
    return user_id


def reauthenticate(client: DbClient, user_id: UUID, token: str, payload: ReauthenticateRequest) -> None:
    session_user_id = assert_session_active(client, token)
    if session_user_id != user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user = client.execute_one("select email from app_users where id=%(id)s and is_active=true", {"id": str(user_id)})
    if not user:
        raise HTTPException(status_code=401, detail="Password verification failed.")
    verification = auth_request("token?grant_type=password", body={"email": user["email"], "password": payload.password})
    try:
        auth_request("logout", token=verification["access_token"])
    finally:
        session_id = session_id_from_access_token(token)
        if session_id:
            client.execute_command("update auth_sessions set reauthenticated_at=now() where id=%(id)s and user_id=%(user_id)s", {"id": str(session_id), "user_id": str(user_id)})


def require_recent_auth(client: DbClient, business_id: UUID, user_id: UUID, session_id: UUID | None) -> None:
    if not session_id:
        raise HTTPException(status_code=401, detail="A current session is required for this action.")
    row = client.execute_one(
        """select s.reauthenticated_at,coalesce(p.reauthentication_minutes,15) as reauthentication_minutes
        from auth_sessions s left join business_security_policies p on p.business_id=%(business_id)s
        where s.id=%(session_id)s and s.user_id=%(user_id)s and s.revoked_at is null and s.expires_at>now()""",
        {"business_id": str(business_id), "session_id": str(session_id), "user_id": str(user_id)},
    )
    if not row or not row.get("reauthenticated_at"):
        raise HTTPException(status_code=401, detail="Please sign in again before this action.")
    reauthenticated_at = row["reauthenticated_at"]
    if isinstance(reauthenticated_at, str):
        reauthenticated_at = datetime.fromisoformat(reauthenticated_at.replace("Z", "+00:00"))
    if reauthenticated_at + timedelta(minutes=int(row["reauthentication_minutes"])) < datetime.now(timezone.utc):
        raise HTTPException(status_code=403, detail="Please re-enter your password before this action.")


def ensure_auth_user_for_invite(client: DbClient, email: str) -> dict:
    normalized = _normalize_email(email)
    user = client.execute_one("select id,email,full_name,is_active from app_users where email=%(email)s limit 1", {"email": normalized})
    if not user:
        _send_signup_link(normalized, create_user=True)
        user = client.execute_one("select id,email,full_name,is_active from app_users where email=%(email)s limit 1", {"email": normalized})
    if not user:
        raise HTTPException(status_code=503, detail="Supabase did not create the invited user.")
    return user


def _normalize_email(email: str) -> str:
    return email.strip().lower()
