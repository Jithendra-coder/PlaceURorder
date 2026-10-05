from datetime import datetime, timedelta, timezone
from uuid import uuid4
from types import SimpleNamespace

from fastapi.testclient import TestClient

from database import get_db_client
import deps
from main import app
from services import auth_service, business_service, device_service, payment_service
from services.rate_limit_service import reset_rate_limits


client = TestClient(app)


def test_public_health_and_openapi_contract():
    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["status"] == "online"

    openapi = client.get("/openapi.json")
    assert openapi.status_code == 200
    paths = openapi.json()["paths"]
    for path in [
        "/api/auth/signup",
        "/api/auth/signup/start",
        "/api/auth/signup/verify",
        "/api/auth/signup/complete",
        "/api/auth/login",
        "/api/auth/oauth/google/start",
        "/api/auth/oauth/google/exchange",
        "/api/businesses/{business_id}/products",
        "/api/businesses/{business_id}/availability",
        "/api/businesses/{business_id}/availability/rules",
        "/api/businesses/{business_id}/availability/rules/{rule_id}",
        "/api/businesses/{business_id}/dashboard",
        "/api/businesses/{business_id}/home-activation",
        "/api/businesses/{business_id}/analytics",
        "/api/businesses/{business_id}/combos",
        "/api/combos/{combo_id}",
        "/api/kiosk/{business_slug}/orders",
        "/api/kiosk/{business_slug}/device-heartbeat",
        "/api/kiosk/{business_slug}/owner-pin/verify",
        "/api/kiosk/live/{device_token}/menu",
        "/api/kiosk/live/{device_token}/orders",
        "/api/kiosk/live/{device_token}/heartbeat",
        "/api/kiosk/live/{device_token}/owner-pin/verify",
        "/api/kiosk/live/session/menu",
        "/api/kiosk/live/session/orders",
        "/api/kiosk/live/session/heartbeat",
        "/api/kiosk/live/session/owner-pin/verify",
        "/api/orders/{order_id}/status",
        "/api/businesses/{business_id}/payments",
        "/api/businesses/{business_id}/payment-accounts",
        "/api/businesses/{business_id}/payment-accounts/{provider}/connect",
        "/api/businesses/{business_id}/payment-accounts/{provider}",
        "/api/businesses/{business_id}/payment-accounts/{provider}/refresh",
        "/api/businesses/{business_id}/payment-accounts/{provider}/disconnect",
        "/api/payments/{payment_id}/counter-paid",
        "/api/orders/{order_id}/counter-complete",
        "/api/payments/paytm/dynamic-qr/create",
        "/api/payments/{payment_id}/status",
        "/api/businesses/{business_id}/administration/overview",
        "/api/businesses/{business_id}/administration/locations",
        "/api/businesses/{business_id}/administration/locations/{location_id}",
        "/api/businesses/{business_id}/administration/locations/{location_id}/deactivate",
        "/api/businesses/{business_id}/administration/activity-log",
        "/api/businesses/{business_id}/administration/payment-location-assignments",
        "/api/businesses/{business_id}/administration/locations/{location_id}/payment-assignment",
        "/api/businesses/{business_id}/administration/invitations",
        "/api/businesses/{business_id}/administration/custom-roles",
        "/api/businesses/{business_id}/administration/security-policy",
        "/api/businesses/{business_id}/administration/integrations",
        "/api/businesses/{business_id}/administration/api-keys",
        "/api/businesses/{business_id}/administration/webhooks",
        "/api/businesses/{business_id}/devices",
        "/api/businesses/{business_id}/device-pairing-requests",
        "/api/businesses/{business_id}/device-activation-codes",
        "/api/businesses/{business_id}/device-pairing-requests/{request_id}/approve",
        "/api/businesses/{business_id}/device-pairing-requests/{request_id}/reject",
        "/api/businesses/{business_id}/devices/{device_id}",
        "/api/businesses/{business_id}/devices/{device_id}/regenerate-link",
        "/api/businesses/{business_id}/devices/{device_id}/disable",
        "/api/devices/pairing/request",
        "/api/devices/pairing/{pairing_code}",
        "/api/devices/pairing/{pairing_code}/claim",
        "/api/devices/activate",
        "/api/devices/live/{device_token}",
        "/api/devices/live/{device_token}/heartbeat",
        "/api/devices/live/{device_token}/session",
        "/api/devices/live/session",
        "/api/devices/live/session/heartbeat",
        "/api/counter/live/{device_token}/payments",
        "/api/counter/live/{device_token}/payments/{payment_id}/counter-paid",
        "/api/counter/live/{device_token}/orders/{order_id}/complete",
        "/api/counter/live/session/payments",
        "/api/counter/live/session/menu",
        "/api/counter/live/session/pending-payments",
        "/api/counter/live/session/payments/{payment_id}/claim",
        "/api/counter/live/session/payments/{payment_id}/release",
        "/api/counter/live/session/overrides",
        "/api/counter/live/session/payments/{payment_id}/cancel",
        "/api/counter/live/session/orders",
        "/api/counter/live/session/kitchen-orders",
        "/api/counter/live/session/handover-history",
        "/api/counter/live/session/held-orders",
        "/api/counter/live/session/payments/{payment_id}/counter-paid",
        "/api/counter/live/session/orders/{order_id}/complete",
        "/api/kitchen/live/{device_token}/orders",
        "/api/kitchen/live/{device_token}/orders/{order_id}/status",
        "/api/kitchen/live/session/orders",
        "/api/kitchen/live/session/orders/{order_id}/status",
        "/api/kitchen/live/session/board",
        "/api/kitchen/live/session/completed",
        "/api/kitchen/live/session/orders/{order_id}/start",
        "/api/kitchen/live/session/orders/{order_id}/hold",
        "/api/kitchen/live/session/orders/{order_id}/resume",
        "/api/kitchen/live/session/orders/{order_id}/ready",
        "/api/kitchen/live/session/orders/{order_id}/recall",
        "/api/kitchen/live/session/orders/{order_id}/items/{item_id}",
        "/api/kitchen/live/session/all-day",
        "/api/kitchen/live/session/availability",
        "/api/kitchen/live/session/availability/{product_id}",
        "/api/kitchen/live/session/overrides",
        "/api/kitchen/live/session/preferences",
        "/api/businesses/{business_id}/alerts",
        "/api/payments/webhooks/stripe",
        "/api/payments/webhooks/razorpay",
        "/api/payments/webhooks/paytm",
        "/api/webhooks/paytm",
    ]:
        assert path in paths


def test_protected_routes_reject_missing_bearer_token():
    business_id = uuid4()
    product_id = uuid4()

    protected_requests = [
        ("GET", "/api/onboarding/status"),
        ("GET", "/api/businesses/me"),
        ("GET", f"/api/businesses/{business_id}/products"),
        ("GET", f"/api/businesses/{business_id}/availability"),
        ("GET", f"/api/businesses/{business_id}/administration/overview"),
        ("PATCH", f"/api/products/{product_id}/availability"),
    ]

    for method, path in protected_requests:
        response = client.request(method, path, json={"is_available": True})
        assert response.status_code == 401
        assert response.json()["detail"] == "Authentication required."
        assert response.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"

    bypass_attempt = client.get("/api/businesses/me", headers={"x-user-id": str(uuid4())})
    assert bypass_attempt.status_code == 401


def test_login_sets_httponly_cookie_without_json_access_token(monkeypatch, issue_supabase_access_token):
    reset_rate_limits()
    local_client = TestClient(app)
    user_id = uuid4()
    token = issue_supabase_access_token(user_id, session_id=uuid4())
    app.dependency_overrides[get_db_client] = lambda: object()
    monkeypatch.setattr(
        auth_service,
        "login",
        lambda _client, _payload: {
            "access_token": None,
            "token_type": "bearer",
            "user": {"id": str(user_id), "email": "owner@example.test", "is_active": True},
            auth_service.INTERNAL_SESSION_TOKEN_FIELD: token,
        },
    )
    try:
        response = local_client.post("/api/auth/login", json={"email": "owner@example.test", "password": "Password123"})
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()

    assert response.status_code == 200
    assert response.json()["access_token"] is None
    set_cookie = response.headers["set-cookie"]
    assert f"{auth_service.SESSION_COOKIE_NAME}=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()


def test_staged_signup_uses_short_lived_httponly_completion_cookie(monkeypatch, issue_supabase_access_token):
    reset_rate_limits()
    local_client = TestClient(app)
    user_id = uuid4()
    signup_token = issue_supabase_access_token(user_id)
    session_token = issue_supabase_access_token(user_id)
    app.dependency_overrides[get_db_client] = lambda: object()
    monkeypatch.setattr(auth_service, "verify_staged_signup", lambda _client, payload: {
        "email": payload.email,
        "message": "Email verified. Create your password to finish.",
        auth_service.INTERNAL_SIGNUP_TOKEN_FIELD: signup_token,
        auth_service.INTERNAL_REFRESH_TOKEN_FIELD: "signup-refresh-token",
    })
    monkeypatch.setattr(auth_service, "decode_signup_completion_token", lambda _token: user_id)
    monkeypatch.setattr(
        auth_service,
        "complete_staged_signup",
        lambda _client, _token, _refresh_token, _payload: {
            "access_token": None,
            "token_type": "bearer",
            "user": {"id": str(user_id), "email": "owner@example.test", "is_active": True},
            auth_service.INTERNAL_SESSION_TOKEN_FIELD: session_token,
        },
    )
    try:
        verified = local_client.post(
            "/api/auth/signup/verify",
            json={"email": "owner@example.test", "code": "123456"},
        )
        assert verified.status_code == 200
        assert auth_service.SIGNUP_SESSION_COOKIE_NAME in local_client.cookies
        set_cookie = verified.headers["set-cookie"]
        assert "HttpOnly" in set_cookie
        assert "Max-Age=900" in set_cookie

        completed = local_client.post(
            "/api/auth/signup/complete",
            json={"password": "Password123"},
        )
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()

    assert completed.status_code == 200
    assert completed.json()["access_token"] is None
    assert auth_service.SESSION_COOKIE_NAME in local_client.cookies
    assert auth_service.SIGNUP_SESSION_COOKIE_NAME not in local_client.cookies


def test_email_verification_persists_supabase_session(monkeypatch, issue_supabase_access_token):
    user_id = uuid4()
    access_token = issue_supabase_access_token(user_id)
    database_commands = []

    monkeypatch.setattr(
        auth_service,
        "auth_request",
        lambda *_args, **_kwargs: {
            "access_token": access_token,
            "refresh_token": "refresh-token",
            "user": {"id": str(user_id), "email": "owner@example.test"},
        },
    )

    class SupabaseSessionClient:
        def execute_command(self, query, params):
            database_commands.append((query, params))
            return 1

    db = SupabaseSessionClient()
    session = auth_service.verify_email(
        db,
        SimpleNamespace(email="owner@example.test", code="123456"),
    )

    assert session["user"]["is_active"] is True
    assert session["user"]["id"] == str(user_id)
    assert "insert into auth_sessions" in database_commands[0][0]


def test_auth_me_accepts_session_cookie_and_rejects_missing_or_invalid_cookie(monkeypatch, issue_supabase_access_token):
    local_client = TestClient(app)
    user_id = uuid4()
    token = issue_supabase_access_token(user_id, session_id=uuid4())
    public_user = {"id": str(user_id), "email": "owner@example.test", "is_active": True}

    app.dependency_overrides[get_db_client] = lambda: object()
    monkeypatch.setattr(deps, "assert_session_active", lambda _client, _token: user_id)
    monkeypatch.setattr(deps, "get_user", lambda _client, _user_id: public_user)
    monkeypatch.setattr(auth_service, "get_user", lambda _client, _user_id: public_user)
    try:
        missing = local_client.get("/api/auth/me")
        assert missing.status_code == 401

        local_client.cookies.set(auth_service.SESSION_COOKIE_NAME, "not-a-valid-token")
        invalid = local_client.get("/api/auth/me")
        assert invalid.status_code == 401

        local_client.cookies.set(auth_service.SESSION_COOKIE_NAME, token)
        valid = local_client.get("/api/auth/me")
        assert valid.status_code == 200
        assert valid.json()["email"] == "owner@example.test"
    finally:
        app.dependency_overrides.clear()


def test_logout_clears_session_cookie():
    local_client = TestClient(app)
    app.dependency_overrides[get_db_client] = lambda: object()
    try:
        response = local_client.post("/api/auth/logout")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    set_cookie = response.headers["set-cookie"]
    assert f"{auth_service.SESSION_COOKIE_NAME}=" in set_cookie
    assert "Max-Age=0" in set_cookie


def test_device_token_exchange_sets_httponly_cookie_and_clean_launch_path(monkeypatch):
    reset_rate_limits()
    local_client = TestClient(app)
    business_id = uuid4()
    device_id = uuid4()
    device = {
        "id": str(device_id),
        "business_id": str(business_id),
        "device_id": "kiosk-1",
        "name": "Front kiosk",
        "device_type": "kiosk",
        "status": "online",
        "is_active": True,
    }
    context = {
        "business": {"id": str(business_id), "name": "Demo Store", "slug": "demo-store"},
        "device": device,
        "launch_path": "/kiosk/live",
    }

    app.dependency_overrides[get_db_client] = lambda: object()
    monkeypatch.setattr(
        device_service,
        "exchange_device_token_for_session",
        lambda _client, _device_token, expected_type=None: (context["business"], device, context),
    )
    try:
        response = local_client.post(
            "/api/devices/live/device_kiosk_unit_token/session",
            json={"expected_type": "kiosk"},
        )
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()

    assert response.status_code == 200
    assert response.json()["data"]["launch_path"] == "/kiosk/live"
    set_cookie = response.headers["set-cookie"]
    assert f"{device_service.DEVICE_SESSION_COOKIE_NAME}=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()


def test_device_and_admin_session_cookies_are_not_interchangeable(issue_supabase_access_token):
    local_client = TestClient(app)
    business_id = uuid4()
    device = {
        "id": str(uuid4()),
        "business_id": str(business_id),
        "device_id": "kiosk-1",
        "device_type": "kiosk",
    }
    device_cookie = device_service.create_device_session_token(device)
    admin_cookie = issue_supabase_access_token(uuid4())

    app.dependency_overrides[get_db_client] = lambda: object()

    local_client.cookies.set(device_service.DEVICE_SESSION_COOKIE_NAME, device_cookie)
    admin_response = local_client.get("/api/businesses/me")
    assert admin_response.status_code == 401

    local_client.cookies.clear()
    local_client.cookies.set(auth_service.SESSION_COOKIE_NAME, admin_cookie)
    try:
        device_response = local_client.get("/api/devices/live/session")
    finally:
        app.dependency_overrides.clear()
    assert device_response.status_code == 401


def test_bearer_fallback_still_works_without_cookie(monkeypatch, issue_supabase_access_token):
    local_client = TestClient(app)
    user_id = uuid4()
    token = issue_supabase_access_token(user_id, session_id=uuid4())
    public_user = {"id": str(user_id), "email": "owner@example.test", "is_active": True}

    monkeypatch.setattr(deps, "assert_session_active", lambda _client, _token: user_id)
    monkeypatch.setattr(deps, "get_user", lambda _client, _user_id: public_user)
    monkeypatch.setattr(auth_service, "get_user", lambda _client, _user_id: public_user)
    app.dependency_overrides[get_db_client] = lambda: object()

    try:
        resolved = local_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.clear()

    assert resolved.status_code == 200


def test_auth_payload_validation_rejects_malformed_signup():
    app.dependency_overrides[get_db_client] = lambda: object()
    try:
        response = client.post(
            "/api/auth/signup",
            json={"email": "qa@example.test", "password": "short"},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_production_kiosk_rejects_preview_mode_before_db_lookup():
    response = client.post(
        "/api/kiosk/preview-store/orders",
        headers={"x-menutap-mode": "preview"},
        json={
            "order_type": "dine_in",
            "payment_method": "preview_counter",
            "items": [{"product_id": str(uuid4()), "quantity": 1}],
        },
    )

    assert response.status_code == 409
    assert "Preview/test" in response.json()["detail"]


def test_payment_status_rejects_query_token_and_accepts_body(monkeypatch):
    reset_rate_limits()
    payment_id = uuid4()
    captured_tokens: list[str | None] = []

    app.dependency_overrides[get_db_client] = lambda: object()
    monkeypatch.setattr(
        payment_service,
        "payment_status",
        lambda _client, _payment_id, token: captured_tokens.append(token)
        or {
            "id": str(_payment_id),
            "status": "pending",
            "amount": 100,
            "currency": "INR",
        },
    )
    try:
        query_response = client.get(f"/api/payments/{payment_id}/status?payment_token=secret-token")
        assert query_response.status_code == 400
        assert captured_tokens == []

        body_response = client.post(f"/api/payments/{payment_id}/status", json={"payment_token": "secret-token"})
        assert body_response.status_code == 200
        assert body_response.json()["status"] == "pending"
        assert captured_tokens == ["secret-token"]
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()


def test_valid_session_reaches_onboarding_and_business_routes(monkeypatch, issue_supabase_access_token):
    local_client = TestClient(app)
    user_id, session_id = uuid4(), uuid4()
    token = issue_supabase_access_token(user_id, session_id=session_id)

    class SessionDb:
        def execute_one(self, query, _params):
            if "auth_sessions" in query:
                return {"expires_at": datetime.now(timezone.utc) + timedelta(minutes=5), "revoked_at": None}
            if "app_users" in query:
                return {"id": str(user_id), "email": "owner@example.test", "is_active": True}
            return None

        def execute_command(self, _query, _params):
            return 1

    app.dependency_overrides[get_db_client] = lambda: SessionDb()
    monkeypatch.setattr(business_service, "get_onboarding_business_type", lambda _client, actual_user_id: {"business_type": None, "business_description": None} if actual_user_id == user_id else None)
    monkeypatch.setattr(business_service, "set_onboarding_business_type", lambda _client, actual_user_id, business_type, description: {"business_type": business_type, "business_description": description} if actual_user_id == user_id else None)
    monkeypatch.setattr(business_service, "get_primary_business_for_user", lambda _client, actual_user_id: None if actual_user_id == user_id else None)
    local_client.cookies.set(auth_service.SESSION_COOKIE_NAME, token)

    try:
        onboarding = local_client.get("/api/onboarding/business-type")
        saved = local_client.put("/api/onboarding/business-type", json={"business_type": "cafe"})
        business = local_client.get("/api/businesses/me")
    finally:
        local_client.cookies.clear()
        app.dependency_overrides.clear()

    assert onboarding.status_code == 200
    assert saved.status_code == 200
    assert saved.json()["business_type"] == "cafe"
    assert business.status_code == 200
    assert business.json()["business"] is None


def test_unexpected_api_exception_has_structured_500(monkeypatch):
    reset_rate_limits()
    local_client = TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides[get_db_client] = lambda: object()
    monkeypatch.setattr(auth_service, "start_staged_signup", lambda *_args: (_ for _ in ()).throw(RuntimeError("database password leaked")))
    try:
        response = local_client.post("/api/auth/signup/start", json={"email": "failure@example.test"})
    finally:
        app.dependency_overrides.clear()
        reset_rate_limits()

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "password" not in response.text
