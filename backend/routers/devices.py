from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, Header, Path, Query, Request, Response
from config import Settings, get_settings

from database import DbClient, get_db_client
from deps import require_user_id, legacy_device_token_guard
from schemas import (
    DeviceTokenExchange,
    ApiResponse,
    CounterOrderComplete,
    CounterOverrideRequest,
    CounterOverrideUse,
    CounterPaymentMarkPaid,
    KitchenActionRequest,
    KitchenAvailabilityUpdate,
    KitchenHoldRequest,
    KitchenItemCompletion,
    KitchenOverrideRequest,
    KitchenPreferenceUpdate,
    DeviceActivate,
    DeviceActivationCodeCreate,
    DeviceCreate,
    DeviceHeartbeat,
    DevicePairingApprove,
    DevicePairingClaim,
    DevicePairingRequestCreate,
    DeviceSessionExchange,
    DeviceUpdate,
    OrderCreate,
    OrderStatusUpdate,
)
from services import counter_service, device_service, kitchen_service
from services.rate_limit_service import RateLimitRule, assert_rate_limit

router = APIRouter(tags=["devices"])
PairingCode = Annotated[str, Path(min_length=6, max_length=12, pattern=r"^[A-Za-z0-9-]+$")]
DeviceToken = Annotated[str, Path(min_length=20, max_length=160, pattern=r"^[A-Za-z0-9_-]+$")]
PAIRING_REQUEST_LIMIT = RateLimitRule("device:pairing-request", 12, 60)
PAIRING_STATUS_LIMIT = RateLimitRule("device:pairing-status", 60, 60)
PAIRING_CLAIM_LIMIT = RateLimitRule("device:pairing-claim", 12, 60)
DEVICE_CODE_GLOBAL_LIMIT = RateLimitRule("device:code-global", 600, 60)
ACTIVATE_LIMIT = RateLimitRule("device:activate", 12, 60)
SESSION_EXCHANGE_LIMIT = RateLimitRule("device:live-session-exchange", 30, 60)
SESSION_CONTEXT_LIMIT = RateLimitRule("device:live-session-context", 120, 60)
LIVE_CONTEXT_LIMIT = RateLimitRule("device:live-context", 120, 60)
DEVICE_READ_LIMIT = 120
DEVICE_WRITE_LIMIT = 60


def _required_device_session(
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
) -> str:
    device_service.decode_device_session_token(device_session)
    return device_session or ""


@router.get("/businesses/{business_id}/devices")
def list_devices(
    business_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    return {"devices": device_service.list_devices(client, business_id, user_id)}


@router.get("/businesses/{business_id}/device-pairing-requests")
def list_device_pairing_requests(
    business_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    return {"requests": device_service.list_pairing_requests(client, business_id, user_id)}


@router.post("/businesses/{business_id}/device-activation-codes", response_model=ApiResponse)
def create_device_activation_code(
    business_id: UUID,
    payload: DeviceActivationCodeCreate,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    request = device_service.create_activation_code(client, business_id, user_id, payload)
    return ApiResponse(message="Device activation code created.", data=request)


@router.post("/businesses/{business_id}/device-pairing-requests/{request_id}/approve", response_model=ApiResponse)
def approve_device_pairing_request(
    business_id: UUID,
    request_id: UUID,
    payload: DevicePairingApprove,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    request = device_service.approve_pairing_request(client, business_id, user_id, request_id, payload)
    return ApiResponse(message="Device pairing request approved.", data=request)


@router.post("/businesses/{business_id}/device-pairing-requests/{request_id}/reject", response_model=ApiResponse)
def reject_device_pairing_request(
    business_id: UUID,
    request_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    request = device_service.reject_pairing_request(client, business_id, user_id, request_id)
    return ApiResponse(message="Device pairing request rejected.", data=request)


@router.post("/businesses/{business_id}/devices", response_model=ApiResponse)
def create_device(
    business_id: UUID,
    payload: DeviceCreate,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    device = device_service.create_device(client, business_id, user_id, payload)
    return ApiResponse(message="Device registered.", data=device)


@router.patch("/businesses/{business_id}/devices/{device_id}", response_model=ApiResponse)
def update_device(
    business_id: UUID,
    device_id: UUID,
    payload: DeviceUpdate,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    device = device_service.update_device(client, business_id, user_id, device_id, payload)
    return ApiResponse(message="Device updated.", data=device)


@router.post("/businesses/{business_id}/devices/{device_id}/regenerate-link", response_model=ApiResponse)
def regenerate_device_link(
    business_id: UUID,
    device_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    device = device_service.regenerate_device_link(client, business_id, user_id, device_id)
    return ApiResponse(message="Device launch link regenerated.", data=device)


@router.post("/businesses/{business_id}/devices/{device_id}/disable", response_model=ApiResponse)
def disable_device(
    business_id: UUID,
    device_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    device = device_service.update_device(client, business_id, user_id, device_id, DeviceUpdate(is_active=False))
    return ApiResponse(message="Device disabled.", data=device)


@router.delete("/businesses/{business_id}/devices/{device_id}", response_model=ApiResponse)
def delete_device(
    business_id: UUID,
    device_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    device_service.delete_device(client, business_id, user_id, device_id)
    return ApiResponse(message="Device removed.")


@router.post("/devices/pairing/request", response_model=ApiResponse)
def request_device_pairing(
    payload: DevicePairingRequestCreate,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, PAIRING_REQUEST_LIMIT, identity_parts=[payload.business_slug, payload.device_type])
    request = device_service.request_device_pairing(client, payload)
    return ApiResponse(message="Pairing request created.", data=request)


@router.get("/devices/pairing/{pairing_code}")
def get_device_pairing_status(
    pairing_code: PairingCode,
    request: Request,
    polling_secret: str | None = Query(default=None, min_length=16, max_length=160),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, PAIRING_STATUS_LIMIT, identity_parts=[pairing_code])
    assert_rate_limit(request, DEVICE_CODE_GLOBAL_LIMIT, identity_parts=["device-code"])
    return device_service.get_pairing_status(client, pairing_code, polling_secret=polling_secret)


@router.post("/devices/pairing/{pairing_code}/claim", response_model=ApiResponse)
def claim_device_pairing(
    pairing_code: PairingCode,
    payload: DevicePairingClaim,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, PAIRING_CLAIM_LIMIT, identity_parts=[pairing_code])
    assert_rate_limit(request, DEVICE_CODE_GLOBAL_LIMIT, identity_parts=["device-code"])
    session = device_service.claim_pairing_request(client, pairing_code, payload)
    _set_device_session_cookie(response, session["device"], settings)
    return ApiResponse(message="Device paired.", data=session)


@router.post("/devices/activate", response_model=ApiResponse)
def activate_device(
    payload: DeviceActivate,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, ACTIVATE_LIMIT, identity_parts=[payload.activation_code])
    assert_rate_limit(request, DEVICE_CODE_GLOBAL_LIMIT, identity_parts=["device-code"])
    session = device_service.activate_device(client, payload)
    _set_device_session_cookie(response, session["device"], settings)
    return ApiResponse(message="Device activated.", data=session)


@router.post("/devices/live/{device_token}/session", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def exchange_live_device_session(
    device_token: DeviceToken,
    payload: DeviceSessionExchange,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, SESSION_EXCHANGE_LIMIT, identity_parts=[device_token, payload.expected_type])
    _business, device, context = device_service.exchange_device_token_for_session(client, device_token, expected_type=payload.expected_type)
    _set_device_session_cookie(response, device, settings)
    return ApiResponse(message="Device session started.", data=context)


@router.post("/devices/live/session/exchange", response_model=ApiResponse)
def exchange_device_token_for_session(
    payload: DeviceTokenExchange,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    client: DbClient = Depends(get_db_client),
):
    # The token travels in the request body, never in the URL, so it stays out of access logs.
    assert_rate_limit(request, SESSION_EXCHANGE_LIMIT, identity_parts=[payload.device_token, payload.expected_type])
    _business, device, context = device_service.exchange_device_token_for_session(client, payload.device_token, expected_type=payload.expected_type)
    _set_device_session_cookie(response, device, settings)
    return ApiResponse(message="Device session started.", data=context)


@router.get("/devices/live/session")
def live_device_session_context(
    request: Request,
    expected_type: Literal["kiosk", "kitchen", "counter"] | None = None,
    device_session: Annotated[str, Depends(_required_device_session)] = "",
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, SESSION_CONTEXT_LIMIT, identity_parts=[device_session, expected_type])
    return device_service.live_device_session_context(client, device_session, expected_type=expected_type)


@router.delete("/devices/live/session", response_model=ApiResponse)
def clear_live_device_session(
    response: Response,
    settings: Settings = Depends(get_settings),
):
    _clear_device_session_cookie(response, settings)
    return ApiResponse(message="Device session cleared.")


@router.post("/devices/live/session/heartbeat", response_model=ApiResponse)
def live_device_session_heartbeat(
    payload: DeviceHeartbeat,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    _business, device = device_service.business_for_device_session(client, device_session)
    device = device_service.heartbeat_for_device(client, device, payload)
    return ApiResponse(message="Device heartbeat recorded.", data=device)


@router.get("/devices/live/{device_token}", dependencies=[Depends(legacy_device_token_guard)])
def live_device_context(
    device_token: DeviceToken,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, LIVE_CONTEXT_LIMIT, identity_parts=[device_token])
    return device_service.live_device_context(client, device_token)


@router.post("/devices/live/{device_token}/heartbeat", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def live_device_heartbeat(
    device_token: DeviceToken,
    payload: DeviceHeartbeat,
    client: DbClient = Depends(get_db_client),
):
    device = device_service.heartbeat_for_token(client, device_token, payload)
    return ApiResponse(message="Device heartbeat recorded.", data=device)


@router.get("/counter/live/session/payments")
def live_counter_session_payments(
    request: Request,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-session-payments", DEVICE_READ_LIMIT, 60), identity_parts=[device_session])
    return device_service.list_counter_payments_for_device_session(client, device_session)


@router.get("/counter/live/session/menu")
def live_counter_session_menu(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return counter_service.menu(client, device_session)


@router.get("/counter/live/session/pending-payments")
def live_counter_session_pending_payments(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return counter_service.pending_payments(client, device_session)


@router.post("/counter/live/session/payments/{payment_id}/claim", response_model=ApiResponse)
def live_counter_session_claim_payment(payment_id: UUID, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Counter payment claimed.", data=counter_service.claim_payment(client, device_session, payment_id))


@router.post("/counter/live/session/payments/{payment_id}/release", response_model=ApiResponse)
def live_counter_session_release_payment(payment_id: UUID, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Counter payment released.", data=counter_service.release_payment(client, device_session, payment_id))


@router.post("/counter/live/session/overrides", response_model=ApiResponse)
def live_counter_session_override(payload: CounterOverrideRequest, request: Request, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, RateLimitRule("device:counter-override", 5, 300), identity_parts=[device_session])
    return ApiResponse(message="Manager override authorized.", data=counter_service.create_override(client, device_session, payload))


@router.post("/counter/live/session/payments/{payment_id}/cancel", response_model=ApiResponse)
def live_counter_session_cancel_payment(payment_id: UUID, payload: CounterOverrideUse, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Counter payment cancelled.", data=counter_service.cancel_pending_payment(client, device_session, payment_id, payload))


@router.post("/counter/live/session/orders", response_model=ApiResponse)
def live_counter_session_create_order(
    payload: OrderCreate,
    request: Request,
    x_idempotency_key: str | None = Header(default=None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-session-order", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_session, x_idempotency_key])
    return ApiResponse(message="Counter order created.", data=counter_service.create_order(client, device_session, payload, x_idempotency_key))


@router.get("/counter/live/session/kitchen-orders")
def live_counter_session_kitchen_orders(status: str = "active", device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return counter_service.kitchen_orders(client, device_session, status)


@router.get("/counter/live/session/handover-history")
def live_counter_session_handover_history(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return counter_service.handover_history(client, device_session, start=datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))


@router.get("/counter/live/session/held-orders")
def live_counter_session_held_orders(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return {"held_orders": counter_service.held_orders(client, device_session)}


@router.post("/counter/live/session/held-orders", response_model=ApiResponse)
def live_counter_session_hold_order(payload: OrderCreate, reference: str | None = Query(default=None, max_length=80), device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Order held.", data=counter_service.hold_order(client, device_session, payload, reference))


@router.post("/counter/live/session/held-orders/{held_id}/resume", response_model=ApiResponse)
def live_counter_session_resume_order(held_id: UUID, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Held order resumed.", data=counter_service.resume_order(client, device_session, held_id))


@router.delete("/counter/live/session/held-orders/{held_id}", response_model=ApiResponse)
def live_counter_session_cancel_held_order(held_id: UUID, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    counter_service.cancel_held_order(client, device_session, held_id)
    return ApiResponse(message="Held order cancelled.")


@router.patch("/counter/live/session/payments/{payment_id}/counter-paid", response_model=ApiResponse)
def live_counter_session_mark_payment_paid(
    payment_id: UUID,
    payload: CounterPaymentMarkPaid,
    request: Request,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-session-paid", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_session, str(payment_id)])
    payment = device_service.mark_counter_payment_paid_for_device_session(client, device_session, payment_id, payload)
    return ApiResponse(message="Counter payment marked paid.", data=payment)


@router.patch("/counter/live/session/orders/{order_id}/complete", response_model=ApiResponse)
def live_counter_session_complete_order(
    order_id: UUID,
    payload: CounterOrderComplete,
    request: Request,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-session-complete", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_session, str(order_id)])
    order = device_service.complete_counter_order_for_device_session(client, device_session, order_id, payload)
    return ApiResponse(message="Order handed over.", data=order)


@router.get("/counter/live/{device_token}/payments", dependencies=[Depends(legacy_device_token_guard)])
def live_counter_payments(
    device_token: DeviceToken,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-payments", DEVICE_READ_LIMIT, 60), identity_parts=[device_token])
    return device_service.list_counter_payments_for_device(client, device_token)


@router.patch("/counter/live/{device_token}/payments/{payment_id}/counter-paid", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def live_counter_mark_payment_paid(
    device_token: DeviceToken,
    payment_id: UUID,
    payload: CounterPaymentMarkPaid,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-paid", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_token, str(payment_id)])
    payment = device_service.mark_counter_payment_paid_for_device(client, device_token, payment_id, payload)
    return ApiResponse(message="Counter payment marked paid.", data=payment)


@router.patch("/counter/live/{device_token}/orders/{order_id}/complete", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def live_counter_complete_order(
    device_token: DeviceToken,
    order_id: UUID,
    payload: CounterOrderComplete,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:counter-complete", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_token, str(order_id)])
    order = device_service.complete_counter_order_for_device(client, device_token, order_id, payload)
    return ApiResponse(message="Order handed over.", data=order)


@router.get("/kitchen/live/session/orders")
def live_kitchen_session_orders(
    request: Request,
    status: str | None = "active",
    start: datetime | None = None,
    end: datetime | None = None,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:kitchen-session-orders", DEVICE_READ_LIMIT, 60), identity_parts=[device_session, status])
    return device_service.list_kitchen_orders_for_device_session(client, device_session, status_filter=status, start=start, end=end)


@router.patch("/kitchen/live/session/orders/{order_id}/status", response_model=ApiResponse)
def live_kitchen_session_update_order_status(
    order_id: UUID,
    payload: OrderStatusUpdate,
    request: Request,
    device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:kitchen-session-status", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_session, str(order_id)])
    order = device_service.update_kitchen_order_status_for_device_session(client, device_session, order_id, payload)
    return ApiResponse(message="Order status updated.", data=order)


@router.get("/kitchen/live/session/board")
def live_kitchen_session_board(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return kitchen_service.board(client, device_session)


@router.get("/kitchen/live/session/completed")
def live_kitchen_session_completed(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return kitchen_service.board(client, device_session, completed=True)


@router.post("/kitchen/live/session/orders/{order_id}/start", response_model=ApiResponse)
def live_kitchen_session_start(order_id: UUID, payload: KitchenActionRequest, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Order started.", data=kitchen_service.start(client, device_session, order_id, payload))


@router.post("/kitchen/live/session/orders/{order_id}/hold", response_model=ApiResponse)
def live_kitchen_session_hold(order_id: UUID, payload: KitchenHoldRequest, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Order held.", data=kitchen_service.hold(client, device_session, order_id, payload))


@router.post("/kitchen/live/session/orders/{order_id}/resume", response_model=ApiResponse)
def live_kitchen_session_resume(order_id: UUID, payload: KitchenActionRequest, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Order resumed.", data=kitchen_service.resume(client, device_session, order_id, payload))


@router.post("/kitchen/live/session/orders/{order_id}/ready", response_model=ApiResponse)
def live_kitchen_session_ready(order_id: UUID, payload: KitchenActionRequest, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Order ready.", data=kitchen_service.ready(client, device_session, order_id, payload))


@router.post("/kitchen/live/session/orders/{order_id}/recall", response_model=ApiResponse)
def live_kitchen_session_recall(order_id: UUID, payload: KitchenActionRequest, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Order recalled.", data=kitchen_service.recall(client, device_session, order_id, payload))


@router.patch("/kitchen/live/session/orders/{order_id}/items/{item_id}", response_model=ApiResponse)
def live_kitchen_session_item(order_id: UUID, item_id: UUID, payload: KitchenItemCompletion, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Item progress saved.", data=kitchen_service.complete_item(client, device_session, order_id, item_id, payload))


@router.get("/kitchen/live/session/all-day")
def live_kitchen_session_all_day(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return kitchen_service.all_day(client, device_session)


@router.get("/kitchen/live/session/availability")
def live_kitchen_session_availability(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return kitchen_service.availability(client, device_session)


@router.patch("/kitchen/live/session/availability/{product_id}", response_model=ApiResponse)
def live_kitchen_session_availability_update(product_id: UUID, payload: KitchenAvailabilityUpdate, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Availability updated.", data=kitchen_service.set_availability(client, device_session, product_id, payload))


@router.post("/kitchen/live/session/overrides", response_model=ApiResponse)
def live_kitchen_session_override(payload: KitchenOverrideRequest, request: Request, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    assert_rate_limit(request, RateLimitRule("device:kitchen-override", 5, 300), identity_parts=[device_session])
    return ApiResponse(message="Kitchen override authorized.", data=kitchen_service.override(client, device_session, payload))


@router.get("/kitchen/live/session/preferences")
def live_kitchen_session_preferences(device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return kitchen_service.preferences(client, device_session)


@router.patch("/kitchen/live/session/preferences", response_model=ApiResponse)
def live_kitchen_session_preferences_update(payload: KitchenPreferenceUpdate, device_session: str | None = Cookie(default=None, alias=device_service.DEVICE_SESSION_COOKIE_NAME), client: DbClient = Depends(get_db_client)):
    return ApiResponse(message="Kitchen preferences updated.", data=kitchen_service.preferences(client, device_session, payload))


@router.get("/kitchen/live/{device_token}/orders", dependencies=[Depends(legacy_device_token_guard)])
def live_kitchen_orders(
    device_token: DeviceToken,
    request: Request,
    status: str | None = "active",
    start: datetime | None = None,
    end: datetime | None = None,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:kitchen-orders", DEVICE_READ_LIMIT, 60), identity_parts=[device_token, status])
    return device_service.list_kitchen_orders_for_device(client, device_token, status_filter=status, start=start, end=end)


@router.patch("/kitchen/live/{device_token}/orders/{order_id}/status", response_model=ApiResponse, dependencies=[Depends(legacy_device_token_guard)])
def live_kitchen_update_order_status(
    device_token: DeviceToken,
    order_id: UUID,
    payload: OrderStatusUpdate,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RateLimitRule("device:kitchen-status", DEVICE_WRITE_LIMIT, 60), identity_parts=[device_token, str(order_id)])
    order = device_service.update_kitchen_order_status_for_device(client, device_token, order_id, payload)
    return ApiResponse(message="Order status updated.", data=order)


def _set_device_session_cookie(response: Response, device: dict, settings: Settings) -> None:
    max_age = max(3600, int(settings.device_session_days or 30) * 24 * 60 * 60)
    response.set_cookie(
        key=device_service.DEVICE_SESSION_COOKIE_NAME,
        value=device_service.create_device_session_token(device),
        max_age=max_age,
        httponly=True,
        secure=_secure_cookie(settings),
        samesite="lax",
        path="/",
    )


def _clear_device_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=device_service.DEVICE_SESSION_COOKIE_NAME,
        path="/",
        secure=_secure_cookie(settings),
        samesite="lax",
    )


def _secure_cookie(settings: Settings) -> bool:
    return settings.environment.lower() in {"prod", "production"}
