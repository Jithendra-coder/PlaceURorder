from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, Path, Query, Request, Response
from uuid import UUID

from config import get_settings
from deps import legacy_device_token_guard
from database import db_context
from schemas import ApiResponse, DeviceHeartbeat, KioskExperienceTestOrderCreate, KioskMenu, KioskTestOrderCreate, KioskTestSessionExchange, OrderCreate, OwnerPinVerify, StoreOrderingStatus
from services import device_service, kiosk_config_service, kiosk_service, order_service, pin_service, qr_service, setup_service, test_session_service
from services.rate_limit_service import RateLimitRule, assert_rate_limit

router = APIRouter(prefix="/kiosk", tags=["kiosk"])
BusinessSlug = Annotated[str, Path(min_length=2, max_length=120)]
DeviceToken = Annotated[str, Path(min_length=20, max_length=160, pattern=r"^[A-Za-z0-9_-]+$")]
LIVE_SESSION_ORDER_LIMIT = RateLimitRule("kiosk:live-session-order", 30, 60)
LIVE_SESSION_PIN_LIMIT = RateLimitRule("kiosk:live-session-owner-pin", 8, 60)
LIVE_ORDER_LIMIT = RateLimitRule("kiosk:live-order", 30, 60)
LIVE_PIN_LIMIT = RateLimitRule("kiosk:live-owner-pin", 8, 60)
PUBLIC_ORDER_LIMIT = RateLimitRule("kiosk:public-order", 20, 60)
TEST_SESSION_EXCHANGE_LIMIT = RateLimitRule("kiosk:test-session-exchange", 120, 60)
PUBLIC_MENU_LIMIT = RateLimitRule("kiosk:public-menu", 120, 60)
OWNER_PIN_LIMIT = RateLimitRule("kiosk:owner-pin", 8, 60)
TEST_SESSION_LIMIT = RateLimitRule("kiosk:test-session", 30, 60)


@router.get("/config/{business_type}")
def get_kiosk_business_config(business_type: str):
    return {
        "config": kiosk_config_service.get_kiosk_business_config(business_type),
        "displaySettings": kiosk_config_service.resolve_kiosk_display_settings(business_type),
    }


@router.get("/{business_slug}", response_model=KioskMenu)
def get_kiosk(business_slug: BusinessSlug, request: Request, location_id: UUID | None = Query(default=None)):
    assert_rate_limit(request, PUBLIC_MENU_LIMIT, identity_parts=[business_slug])
    with db_context() as client:
        return kiosk_service.get_kiosk_payload(client, business_slug, location_id=str(location_id) if location_id else None)


@router.post("/test/session/exchange")
def exchange_test_session(payload: KioskTestSessionExchange, request: Request, response: Response):
    assert_rate_limit(request, TEST_SESSION_EXCHANGE_LIMIT, identity_parts=["test-session-exchange"])
    with db_context() as client:
        session = test_session_service.exchange(client, payload.token)
    settings = get_settings()
    response.set_cookie(
        key=test_session_service.TEST_SESSION_COOKIE_NAME,
        value=payload.token,
        max_age=test_session_service.TEST_SESSION_MINUTES * 60,
        httponly=True,
        secure=settings.environment.lower() in {"prod", "production"},
        samesite="lax",
        path="/",
    )
    return {"session": {"id": session["id"], "business_id": session["business_id"], "expires_at": session["expires_at"]}}


@router.get("/test/session/menu", response_model=KioskMenu)
def get_test_session_menu(
    test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME),
):
    with db_context() as client:
        session = test_session_service.from_cookie(client, test_session)
        business = setup_service.assert_workspace_access(client, UUID(session["business_id"]), UUID(session["created_by"]))
        return kiosk_service.get_kiosk_payload(client, business["slug"], use_draft=True)


@router.get("/test/session/context/{app_type}")
def get_test_session_context(
    app_type: str,
    test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME),
):
    with db_context() as client:
        return {"session": test_session_service.runtime_context(client, test_session, app_type)}


@router.post("/test/session/orders", response_model=ApiResponse)
def create_test_session_order(
    payload: KioskTestOrderCreate,
    request: Request,
    test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME),
):
    assert_rate_limit(request, TEST_SESSION_LIMIT, identity_parts=[test_session])
    with db_context() as client:
        session = test_session_service.from_cookie(client, test_session)
        result = setup_service.create_test_order(
            client,
            UUID(session["business_id"]),
            UUID(session["created_by"]),
            payload,
        )
    return ApiResponse(message="Test order completed.", data=result["test_order"])


@router.post("/test/session/experience-complete", response_model=ApiResponse)
def complete_test_session_experience(
    payload: KioskExperienceTestOrderCreate,
    request: Request,
    test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME),
):
    assert_rate_limit(request, TEST_SESSION_LIMIT, identity_parts=[test_session])
    with db_context() as client:
        session = test_session_service.from_cookie(client, test_session)
        result = setup_service.complete_test_experience(
            client,
            UUID(session["business_id"]),
            UUID(session["created_by"]),
            payload,
        )
    return ApiResponse(message="Test experience completed.", data=result["test_order"])


@router.delete("/test/session", response_model=ApiResponse)
def close_test_session(
    response: Response,
    test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME),
):
    with db_context() as client:
        test_session_service.revoke(client, test_session)
    settings = get_settings()
    response.delete_cookie(
        key=test_session_service.TEST_SESSION_COOKIE_NAME,
        path="/",
        secure=settings.environment.lower() in {"prod", "production"},
        samesite="lax",
    )
    return ApiResponse(message="Test session closed.")


@router.get("/live/session/menu", response_model=KioskMenu)
def get_live_device_session_menu(
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
):
    with db_context() as client:
        business, _device = device_service.business_for_device_session(client, device_session, expected_type="kiosk")
        return kiosk_service.get_kiosk_payload(client, business["slug"])


@router.post("/live/session/orders", response_model=ApiResponse)
def create_live_device_session_order(
    payload: OrderCreate,
    request: Request,
    x_menutap_mode: str | None = Header(default=None, max_length=32),
    x_idempotency_key: str | None = Header(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
):
    assert_rate_limit(request, LIVE_SESSION_ORDER_LIMIT, identity_parts=[device_session])
    if (x_menutap_mode or "").strip().lower() in {"preview", "test", "sandbox"}:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Preview/test checkout cannot create production orders.")
    with db_context() as client:
        business, _device = device_service.business_for_device_session(client, device_session, expected_type="kiosk")
        order = order_service.create_kiosk_order(client, business["slug"], payload, request_mode=x_menutap_mode, source="hardware_kiosk", idempotency_key=x_idempotency_key)
    return ApiResponse(message="Order placed.", data=order)


@router.post("/live/session/heartbeat", response_model=ApiResponse)
def live_device_session_heartbeat(
    payload: DeviceHeartbeat,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
):
    with db_context() as client:
        _business, device = device_service.business_for_device_session(client, device_session, expected_type="kiosk")
        device = device_service.heartbeat_for_device(client, device, payload)
    return ApiResponse(message="Device heartbeat recorded.", data=device)


@router.post("/live/session/owner-pin/verify")
def verify_live_device_session_owner_pin(
    payload: OwnerPinVerify,
    request: Request,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
):
    assert_rate_limit(request, LIVE_SESSION_PIN_LIMIT, identity_parts=[device_session])
    with db_context() as client:
        business, device = device_service.business_for_device_session(client, device_session, expected_type="kiosk")
        result = pin_service.verify_owner_pin(client, business["slug"], payload)
    return {**result, "device_id": device["id"], "unlock_expires_in_seconds": 30}


@router.get("/live/{device_token}/menu", response_model=KioskMenu, dependencies=[Depends(legacy_device_token_guard)])
def get_live_device_menu(device_token: DeviceToken):
    with db_context() as client:
        business, _device = device_service.business_for_device_token(client, device_token)
        return kiosk_service.get_kiosk_payload(client, business["slug"])


@router.post("/live/{device_token}/orders", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def create_live_device_order(
    device_token: DeviceToken,
    payload: OrderCreate,
    request: Request,
    x_menutap_mode: str | None = Header(default=None, max_length=32),
    x_idempotency_key: str | None = Header(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
):
    assert_rate_limit(request, LIVE_ORDER_LIMIT, identity_parts=[device_token])
    if (x_menutap_mode or "").strip().lower() in {"preview", "test", "sandbox"}:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Preview/test checkout cannot create production orders.")
    with db_context() as client:
        business, _device = device_service.business_for_device_token(client, device_token)
        order = order_service.create_kiosk_order(client, business["slug"], payload, request_mode=x_menutap_mode, source="hardware_kiosk", idempotency_key=x_idempotency_key)
    return ApiResponse(message="Order placed.", data=order)


@router.post("/live/{device_token}/heartbeat", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def live_device_heartbeat(device_token: DeviceToken, payload: DeviceHeartbeat):
    with db_context() as client:
        device = device_service.heartbeat_for_token(client, device_token, payload, expected_type="kiosk")
    return ApiResponse(message="Device heartbeat recorded.", data=device)


@router.post("/live/{device_token}/owner-pin/verify", dependencies=[Depends(legacy_device_token_guard)])
def verify_live_device_owner_pin(device_token: DeviceToken, payload: OwnerPinVerify, request: Request):
    assert_rate_limit(request, LIVE_PIN_LIMIT, identity_parts=[device_token])
    with db_context() as client:
        business, device = device_service.business_for_device_token(client, device_token)
        result = pin_service.verify_owner_pin(client, business["slug"], payload)
    return {**result, "device_id": device["id"], "unlock_expires_in_seconds": 30}


@router.get("/{business_slug}/menu", response_model=KioskMenu)
def get_menu(business_slug: BusinessSlug, request: Request, location_id: UUID | None = Query(default=None)):
    assert_rate_limit(request, PUBLIC_MENU_LIMIT, identity_parts=[business_slug])
    with db_context() as client:
        return kiosk_service.get_kiosk_payload(client, business_slug, location_id=str(location_id) if location_id else None)


@router.post("/{business_slug}/orders", response_model=ApiResponse)
def create_order(
    business_slug: BusinessSlug,
    payload: OrderCreate,
    request: Request,
    x_menutap_mode: str | None = Header(default=None, max_length=32),
    x_idempotency_key: str | None = Header(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
):
    assert_rate_limit(request, PUBLIC_ORDER_LIMIT, identity_parts=[business_slug])
    if (x_menutap_mode or "").strip().lower() in {"preview", "test", "sandbox"}:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Preview/test checkout cannot create production orders.")
    with db_context() as client:
        order = order_service.create_kiosk_order(client, business_slug, payload, request_mode=x_menutap_mode, source="public_slug", idempotency_key=x_idempotency_key)
    return ApiResponse(message="Order placed.", data=order)


@router.get("/{business_slug}/store", response_model=StoreOrderingStatus)
def get_store_ordering(business_slug: BusinessSlug, request: Request):
    assert_rate_limit(request, PUBLIC_MENU_LIMIT, identity_parts=[business_slug])
    with db_context() as client:
        return qr_service.store_ordering_status(client, business_slug)


@router.post("/{business_slug}/qr-orders", response_model=ApiResponse)
def create_qr_order(
    business_slug: BusinessSlug,
    payload: OrderCreate,
    request: Request,
    x_idempotency_key: str | None = Header(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
):
    assert_rate_limit(request, PUBLIC_ORDER_LIMIT, identity_parts=[business_slug])
    with db_context() as client:
        order = order_service.create_kiosk_order(client, business_slug, payload, request_mode=None, source="qr_order", idempotency_key=x_idempotency_key)
    return ApiResponse(message="Order placed.", data=order)


@router.post("/{business_slug}/device-heartbeat", response_model=ApiResponse)
def device_heartbeat(business_slug: BusinessSlug, payload: DeviceHeartbeat):
    with db_context() as client:
        device = device_service.heartbeat(client, business_slug, payload)
    return ApiResponse(message="Device heartbeat recorded.", data=device)


@router.post("/{business_slug}/owner-pin/verify")
def verify_owner_pin(business_slug: BusinessSlug, payload: OwnerPinVerify, request: Request):
    assert_rate_limit(request, OWNER_PIN_LIMIT, identity_parts=[business_slug])
    with db_context() as client:
        return pin_service.verify_owner_pin(client, business_slug, payload)
