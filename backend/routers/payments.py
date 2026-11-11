from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from database import DbClient, get_db_client
from deps import require_user_id
from schemas import (
    ApiResponse,
    CounterOrderComplete,
    CounterPaymentMarkPaid,
    PaymentAccountConnect,
    PaymentAccountDisconnect,
    PaymentAccountUpdate,
    PaytmDynamicQrCreate,
    PaymentProvider,
    PaymentStatusCheck,
)
from services.rate_limit_service import RateLimitRule, assert_rate_limit
from services import payment_service


router = APIRouter(tags=["payments"])
PAYTM_QR_LIMIT = RateLimitRule("payment:paytm-qr", 60, 60)
PAYMENT_STATUS_LIMIT = RateLimitRule("payment:status", 120, 60)
STRIPE_WEBHOOK_LIMIT = RateLimitRule("payment:webhook:stripe", 300, 60)
RAZORPAY_WEBHOOK_LIMIT = RateLimitRule("payment:webhook:razorpay", 300, 60)
PAYTM_WEBHOOK_LIMIT = RateLimitRule("payment:webhook:paytm", 300, 60)


@router.get("/businesses/{business_id}/payments")
def list_payments(
    business_id: UUID,
    limit: int = Query(default=100, ge=1, le=250),
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    return payment_service.list_payments(client, business_id, user_id, limit=limit)


@router.get("/businesses/{business_id}/payment-accounts")
def list_payment_accounts(
    business_id: UUID,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    from services.business_service import PAYMENT_CONFIG_ROLES, assert_business_access

    assert_business_access(client, business_id, user_id, PAYMENT_CONFIG_ROLES)
    return {"accounts": [payment_service._safe_account(account) for account in payment_service.list_payment_accounts(client, business_id)]}


@router.post("/businesses/{business_id}/payment-accounts/{provider}/connect", response_model=ApiResponse)
def connect_payment_account(
    business_id: UUID,
    provider: PaymentProvider,
    payload: PaymentAccountConnect,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    result = payment_service.connect_payment_account(client, business_id, user_id, provider, payload)
    return ApiResponse(message="Payment provider connection updated.", data=result)


@router.post("/businesses/{business_id}/payment-accounts/{provider}/disconnect", response_model=ApiResponse)
def disconnect_payment_account(
    business_id: UUID,
    provider: PaymentProvider,
    payload: PaymentAccountDisconnect,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    result = payment_service.disconnect_payment_account(client, business_id, user_id, provider, payload)
    return ApiResponse(message="Payment provider disconnected.", data=result)


@router.patch("/businesses/{business_id}/payment-accounts/{provider}", response_model=ApiResponse)
def update_payment_account(
    business_id: UUID,
    provider: PaymentProvider,
    payload: PaymentAccountUpdate,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    result = payment_service.update_payment_account(client, business_id, user_id, provider, payload)
    return ApiResponse(message="Payment provider updated.", data=result)


@router.post("/businesses/{business_id}/payment-accounts/{provider}/refresh", response_model=ApiResponse)
def refresh_payment_account(
    business_id: UUID,
    provider: PaymentProvider,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    result = payment_service.refresh_payment_account_status(client, business_id, user_id, provider)
    return ApiResponse(message="Payment provider status refreshed.", data=result)


@router.patch("/payments/{payment_id}/counter-paid", response_model=ApiResponse)
def mark_counter_payment_paid(
    payment_id: UUID,
    payload: CounterPaymentMarkPaid,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    payment = payment_service.mark_counter_payment_paid(client, payment_id, user_id, payload)
    return ApiResponse(message="Counter payment marked paid.", data=payment)


@router.patch("/orders/{order_id}/counter-complete", response_model=ApiResponse)
def complete_counter_order(
    order_id: UUID,
    payload: CounterOrderComplete,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    order = payment_service.complete_counter_order(client, order_id, user_id, payload)
    return ApiResponse(message="Order handed over.", data=order)


@router.post("/payments/paytm/dynamic-qr/create", response_model=ApiResponse)
def create_paytm_dynamic_qr(
    payload: PaytmDynamicQrCreate,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, PAYTM_QR_LIMIT, identity_parts=[str(payload.payment_id)])
    status = payment_service.create_paytm_dynamic_qr(client, payload)
    return ApiResponse(message="Paytm Dynamic QR created.", data=status)


@router.get("/payments/{payment_id}/status")
def payment_status(
    payment_id: UUID,
    request: Request,
    x_payment_status_token: str | None = Header(default=None, alias="X-Payment-Status-Token", min_length=8, max_length=120),
    client: DbClient = Depends(get_db_client),
):
    token = x_payment_status_token
    assert_rate_limit(request, PAYMENT_STATUS_LIMIT, identity_parts=[str(payment_id)])
    return payment_service.payment_status(client, payment_id, token)


@router.post("/payments/{payment_id}/status")
def payment_status_post(
    payment_id: UUID,
    payload: PaymentStatusCheck,
    request: Request,
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, PAYMENT_STATUS_LIMIT, identity_parts=[str(payment_id)])
    return payment_service.payment_status(client, payment_id, payload.payment_token)


@router.post("/payments/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature", min_length=1, max_length=512),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, STRIPE_WEBHOOK_LIMIT, identity_parts=[stripe_signature])
    result = payment_service.process_stripe_webhook(client, await request.body(), stripe_signature)
    return result


@router.post("/payments/webhooks/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature", min_length=1, max_length=512),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, RAZORPAY_WEBHOOK_LIMIT, identity_parts=[x_razorpay_signature])
    result = payment_service.process_razorpay_webhook(client, await request.body(), x_razorpay_signature)
    return result


@router.post("/payments/webhooks/paytm")
@router.post("/webhooks/paytm")
async def paytm_webhook(
    request: Request,
    x_paytm_signature: str | None = Header(default=None, alias="X-Paytm-Signature", min_length=1, max_length=512),
    x_paytm_checksum: str | None = Header(default=None, alias="X-Paytm-Checksum", min_length=1, max_length=512),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, PAYTM_WEBHOOK_LIMIT, identity_parts=[x_paytm_signature or x_paytm_checksum])
    result = payment_service.process_paytm_webhook(client, await request.body(), x_paytm_signature or x_paytm_checksum)
    return result
