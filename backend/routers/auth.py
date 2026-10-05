from fastapi import APIRouter, Depends, HTTPException, Request, Response

from config import Settings, get_settings
from database import DbClient, get_db_client
from deps import _bearer_token, require_user_id
from schemas import (
    ApiResponse,
    AuthLogin,
    ReauthenticateRequest,
    AuthSession,
    AuthSignup,
    AuthUser,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResendVerificationRequest,
    ResetPasswordRequest,
    SignupEmailComplete,
    SignupEmailStart,
    SignupEmailVerified,
    SignupLinkAccept,
    SignupStartResponse,
    VerifyEmailRequest,
)
from services import auth_service
from services.rate_limit_service import RateLimitRule, assert_rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])
SIGNUP_LIMIT = RateLimitRule("auth:signup", 5, 60)
SIGNUP_VERIFY_LIMIT = RateLimitRule("auth:signup-verify", 8, 60)
SIGNUP_COMPLETE_LIMIT = RateLimitRule("auth:signup-complete", 5, 60)
VERIFY_EMAIL_LIMIT = RateLimitRule("auth:verify-email", 8, 60)
RESEND_VERIFICATION_LIMIT = RateLimitRule("auth:resend-verification", 5, 60)
LOGIN_LIMIT = RateLimitRule("auth:login", 8, 60)
FORGOT_PASSWORD_LIMIT = RateLimitRule("auth:forgot-password", 5, 60)
RESET_PASSWORD_LIMIT = RateLimitRule("auth:reset-password", 5, 60)
REAUTHENTICATE_LIMIT = RateLimitRule("auth:reauthenticate", 10, 60)


@router.post("/signup", response_model=SignupStartResponse)
def signup(payload: AuthSignup, request: Request, client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, SIGNUP_LIMIT, identity_parts=[payload.email])
    return auth_service.signup(client, payload)


@router.post("/signup/start", response_model=SignupStartResponse)
def start_staged_signup(payload: SignupEmailStart, request: Request, client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, SIGNUP_LIMIT, identity_parts=[payload.email])
    return auth_service.start_staged_signup(client, payload.email)


@router.post("/signup/accept", response_model=SignupEmailVerified)
def accept_signup_link(
    payload: SignupLinkAccept,
    request: Request,
    response: Response,
    client: DbClient = Depends(get_db_client),
    settings: Settings = Depends(get_settings),
):
    assert_rate_limit(request, SIGNUP_VERIFY_LIMIT, identity_parts=["signup-link"])
    session = auth_service.accept_signup_link(client, payload.access_token, payload.refresh_token)
    access_token = session.pop(auth_service.INTERNAL_SESSION_TOKEN_FIELD)
    refresh_token = session.pop(auth_service.INTERNAL_REFRESH_TOKEN_FIELD)
    _set_cookie(response, auth_service.SIGNUP_SESSION_COOKIE_NAME, access_token, settings, max_age=15 * 60, path="/api/auth/signup")
    _set_cookie(response, auth_service.SIGNUP_REFRESH_COOKIE_NAME, refresh_token, settings, max_age=15 * 60, path="/api/auth/signup")
    return {"email": session["user"]["email"], "message": "Email verified. Create your password to finish."}


@router.post("/signup/verify", response_model=SignupEmailVerified)
def verify_staged_signup(
    payload: VerifyEmailRequest,
    request: Request,
    response: Response,
    client: DbClient = Depends(get_db_client),
    settings: Settings = Depends(get_settings),
):
    assert_rate_limit(request, SIGNUP_VERIFY_LIMIT, identity_parts=[payload.email])
    result = auth_service.verify_staged_signup(client, payload)
    token = result.pop(auth_service.INTERNAL_SIGNUP_TOKEN_FIELD)
    refresh_token = result.pop(auth_service.INTERNAL_REFRESH_TOKEN_FIELD)
    _set_cookie(response, auth_service.SIGNUP_SESSION_COOKIE_NAME, token, settings, max_age=15 * 60, path="/api/auth/signup")
    _set_cookie(response, auth_service.SIGNUP_REFRESH_COOKIE_NAME, refresh_token, settings, max_age=15 * 60, path="/api/auth/signup")
    return result


@router.post("/signup/complete", response_model=AuthSession)
def complete_staged_signup(
    payload: SignupEmailComplete,
    request: Request,
    response: Response,
    client: DbClient = Depends(get_db_client),
    settings: Settings = Depends(get_settings),
):
    token = request.cookies.get(auth_service.SIGNUP_SESSION_COOKIE_NAME)
    refresh_token = request.cookies.get(auth_service.SIGNUP_REFRESH_COOKIE_NAME)
    if not token or not refresh_token:
        raise HTTPException(status_code=401, detail="Signup session expired. Verify your email again.")
    user_id = auth_service.decode_signup_completion_token(token)
    assert_rate_limit(request, SIGNUP_COMPLETE_LIMIT, identity_parts=[str(user_id)])
    session = auth_service.complete_staged_signup(client, token, refresh_token, payload)
    _set_session_cookie(response, session, settings)
    response.delete_cookie(
        key=auth_service.SIGNUP_SESSION_COOKIE_NAME,
        path="/api/auth/signup",
        secure=_secure_cookie(settings),
        samesite="lax",
    )
    response.delete_cookie(
        key=auth_service.SIGNUP_REFRESH_COOKIE_NAME,
        path="/api/auth/signup",
        secure=_secure_cookie(settings),
        samesite="lax",
    )
    return session


@router.post("/verify-email", response_model=AuthSession)
def verify_email(
    payload: VerifyEmailRequest,
    request: Request,
    response: Response,
    client: DbClient = Depends(get_db_client),
    settings: Settings = Depends(get_settings),
):
    assert_rate_limit(request, VERIFY_EMAIL_LIMIT, identity_parts=[payload.email])
    session = auth_service.verify_email(client, payload)
    _set_session_cookie(response, session, settings)
    return session


@router.post("/resend-verification", response_model=SignupStartResponse)
def resend_verification(payload: ResendVerificationRequest, request: Request, client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, RESEND_VERIFICATION_LIMIT, identity_parts=[payload.email])
    return auth_service.resend_verification(client, payload)


@router.post("/login", response_model=AuthSession)
def login(
    payload: AuthLogin,
    request: Request,
    response: Response,
    client: DbClient = Depends(get_db_client),
    settings: Settings = Depends(get_settings),
):
    assert_rate_limit(request, LOGIN_LIMIT, identity_parts=[payload.email])
    session = auth_service.login(client, payload)
    _set_session_cookie(response, session, settings)
    return session


@router.post("/refresh", response_model=AuthSession)
def refresh(
    request: Request,
    response: Response,
    client: DbClient = Depends(get_db_client),
    settings: Settings = Depends(get_settings),
):
    session = auth_service.refresh_session(
        client,
        request.cookies.get(auth_service.SESSION_COOKIE_NAME),
        request.cookies.get(auth_service.SESSION_REFRESH_COOKIE_NAME),
    )
    _set_session_cookie(response, session, settings)
    return session


@router.post("/reauthenticate", response_model=ApiResponse)
def reauthenticate(payload: ReauthenticateRequest, request: Request, user_id=Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, REAUTHENTICATE_LIMIT, identity_parts=[str(user_id)])
    token = request.cookies.get(auth_service.SESSION_COOKIE_NAME) or _bearer_token(request.headers.get("authorization"))
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    auth_service.reauthenticate(client, user_id, token, payload)
    return ApiResponse(message="Password verified.")


@router.get("/me", response_model=AuthUser)
def me(user_id=Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    return auth_service.get_user(client, user_id)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, FORGOT_PASSWORD_LIMIT, identity_parts=[payload.email])
    return auth_service.create_password_reset(client, payload.email)


@router.post("/reset-password", response_model=ApiResponse)
def reset_password(payload: ResetPasswordRequest, request: Request, client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, RESET_PASSWORD_LIMIT, identity_parts=[payload.token])
    auth_service.reset_password(client, payload)
    return ApiResponse(message="Password updated.")


@router.post("/logout", response_model=ApiResponse)
def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    client: DbClient = Depends(get_db_client),
):
    token = request.cookies.get(auth_service.SESSION_COOKIE_NAME) or _bearer_token(request.headers.get("authorization"))
    auth_service.logout(client, token)
    _clear_session_cookie(response, settings)
    return ApiResponse(message="Signed out.")


def _set_session_cookie(response: Response, session: dict, settings: Settings) -> None:
    token = session.pop(auth_service.INTERNAL_SESSION_TOKEN_FIELD, None)
    refresh_token = session.pop(auth_service.INTERNAL_REFRESH_TOKEN_FIELD, None)
    max_age = max(60, int(session.pop("_expires_in", 3600)))
    if not token:
        return
    _set_cookie(response, auth_service.SESSION_COOKIE_NAME, token, settings, max_age=max_age, path="/")
    if refresh_token:
        _set_cookie(response, auth_service.SESSION_REFRESH_COOKIE_NAME, refresh_token, settings, max_age=60 * 60 * 24 * 30, path="/api/auth")


def _clear_session_cookie(response: Response, settings: Settings) -> None:
    for cookie, path in ((auth_service.SESSION_COOKIE_NAME, "/"), (auth_service.SESSION_REFRESH_COOKIE_NAME, "/api/auth"), (auth_service.SIGNUP_SESSION_COOKIE_NAME, "/api/auth/signup"), (auth_service.SIGNUP_REFRESH_COOKIE_NAME, "/api/auth/signup")):
        response.delete_cookie(key=cookie, path=path, secure=_secure_cookie(settings), samesite="lax")


def _set_cookie(response: Response, key: str, value: str, settings: Settings, *, max_age: int, path: str) -> None:
    response.set_cookie(key=key, value=value, max_age=max_age, httponly=True, secure=_secure_cookie(settings), samesite="lax", path=path)


def _secure_cookie(settings: Settings) -> bool:
    return settings.environment.lower() in {"prod", "production"}
