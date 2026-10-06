from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error, parse, request
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from config import get_settings
from database import DbClient
from schemas import (
    CounterOrderComplete,
    CounterPaymentMarkPaid,
    PaymentAccountConnect,
    PaymentAccountDisconnect,
    PaymentAccountUpdate,
    PaytmDynamicQrCreate,
    PaymentProvider,
    PaymentStatus,
)
from services import cache_service
from services.business_service import (
    COUNTER_ROLES,
    PAYMENT_CONFIG_ROLES,
    PAYMENT_VIEW_ROLES,
    assert_business_access,
    serialize_business_for_response,
)

COUNTER_METHODS = {"pay_at_counter", "counter", "cash"}
STRIPE_METHODS = {"stripe", "card"}
RAZORPAY_METHODS = {"razorpay", "upi"}
PAYTM_METHODS = {"paytm", "paytm_qr"}
ONLINE_METHODS = STRIPE_METHODS | RAZORPAY_METHODS | PAYTM_METHODS
KNOWN_METHODS = COUNTER_METHODS | ONLINE_METHODS
ONLINE_PROVIDERS = {"stripe", "razorpay", "paytm"}


def normalize_payment_method(value: str | None) -> str:
    method = (value or "pay_at_counter").strip().lower()
    if method == "counter":
        return "pay_at_counter"
    return method


def payment_provider_for_method(method: str) -> str:
    if method in COUNTER_METHODS:
        return PaymentProvider.PAY_AT_COUNTER.value
    if method in STRIPE_METHODS:
        return PaymentProvider.STRIPE.value
    if method in RAZORPAY_METHODS:
        return PaymentProvider.RAZORPAY.value
    if method in PAYTM_METHODS:
        return PaymentProvider.PAYTM.value
    raise HTTPException(status_code=409, detail="This payment method is not supported.")


def is_online_method(method: str) -> bool:
    return method in ONLINE_METHODS


def public_payment_summary(client: DbClient, business: dict) -> dict:
    business_id = UUID(str(business["id"]))
    accounts = {row["provider"]: row for row in list_payment_accounts(client, business_id)}
    methods = effective_payment_methods(business, accounts)
    return {
        "enabled_methods": methods,
        "default_payment_method": _default_method(business, methods),
        "provider_statuses": {
            provider: {
                "connection_status": row.get("connection_status"),
                "activation_status": row.get("activation_status"),
                "is_enabled": bool(row.get("is_enabled")),
                "is_default": bool(row.get("is_default")),
                "payments_enabled": bool(row.get("payments_enabled")),
                "charges_enabled": bool(row.get("charges_enabled")),
                "last_status_check_at": row.get("last_status_check_at"),
            }
            for provider, row in accounts.items()
        },
    }


def effective_payment_methods(business: dict, accounts: dict[str, dict] | None = None) -> list[str]:
    settings = business.get("kiosk_order_settings") or {}
    raw_methods = settings.get("payment_methods") or []
    if not raw_methods:
        raw_methods = []
        if settings.get("pay_at_counter", True):
            raw_methods.append("pay_at_counter")
        if settings.get("online_payments", True):
            raw_methods.extend(["stripe", "razorpay", "paytm"])

    normalized = []
    for value in raw_methods:
        method = normalize_payment_method(str(value))
        if method in KNOWN_METHODS and method not in normalized:
            normalized.append(method)

    if settings.get("pay_at_counter", True) is False:
        normalized = [method for method in normalized if method not in COUNTER_METHODS]
    if settings.get("online_payments", True) is False:
        normalized = [method for method in normalized if method not in ONLINE_METHODS]

    if accounts is not None:
        normalized = [
            method
            for method in normalized
            if method in COUNTER_METHODS or _provider_connected(accounts.get(payment_provider_for_method(method)))
        ]
    return normalized


def validate_kiosk_order_settings(client: DbClient, business: dict, payload) -> str:
    settings = business.get("kiosk_order_settings") or {}
    if settings.get("checkout_enabled") is False or settings.get("checkout_mode") == "display":
        raise HTTPException(status_code=409, detail="Ordering is disabled for this kiosk.")
    if settings.get("require_customer_name") and not (payload.customer_name or "").strip():
        raise HTTPException(status_code=422, detail="Customer name is required.")
    if settings.get("require_customer_phone") and not (payload.customer_phone or "").strip():
        raise HTTPException(status_code=422, detail="Customer phone is required.")
    if settings.get("allow_customer_notes") is False and (payload.notes or "").strip():
        raise HTTPException(status_code=422, detail="Customer notes are disabled.")

    method = normalize_payment_method(payload.payment_method)
    if method.startswith("preview") or method.startswith("test"):
        raise HTTPException(status_code=409, detail="Preview/test checkout cannot use production order APIs.")
    if method not in KNOWN_METHODS:
        raise HTTPException(status_code=409, detail="This payment method is not enabled.")

    accounts = {row["provider"]: row for row in list_payment_accounts(client, UUID(str(business["id"])))}
    allowed = effective_payment_methods(business, accounts)
    if method not in allowed:
        raise HTTPException(status_code=409, detail="This payment method is not enabled for this kiosk.")
    if method in ONLINE_METHODS:
        provider = payment_provider_for_method(method)
        if not _provider_connected(accounts.get(provider)):
            raise HTTPException(status_code=409, detail=f"{provider.title()} payments are not connected.")
    return method


def list_payment_accounts(client: DbClient, business_id: UUID) -> list[dict]:
    response = (
        client.table("business_payment_accounts")
        .select("*")
        .eq("business_id", str(business_id))
        .order("provider")
        .execute()
    )
    rows = {row["provider"]: row for row in response.data or []}
    return [
        rows.get("stripe") or _empty_account(business_id, "stripe"),
        rows.get("razorpay") or _empty_account(business_id, "razorpay"),
        rows.get("paytm") or _empty_account(business_id, "paytm"),
    ]


def connect_payment_account(
    client: DbClient,
    business_id: UUID,
    user_id: UUID,
    provider: PaymentProvider,
    payload: PaymentAccountConnect,
) -> dict:
    business = assert_business_access(client, business_id, user_id, PAYMENT_CONFIG_ROLES)
    if provider == PaymentProvider.STRIPE:
        result = _connect_stripe(client, business, payload)
        cache_service.invalidate_slug(business.get("slug"))
        return result
    if provider == PaymentProvider.RAZORPAY:
        result = _connect_razorpay(client, business, payload)
        cache_service.invalidate_slug(business.get("slug"))
        return result
    if provider == PaymentProvider.PAYTM:
        result = _connect_paytm(client, business, payload)
        cache_service.invalidate_slug(business.get("slug"))
        return result
    raise HTTPException(status_code=400, detail="Counter payments do not need provider connection.")


def update_payment_account(
    client: DbClient,
    business_id: UUID,
    user_id: UUID,
    provider: PaymentProvider,
    payload: PaymentAccountUpdate,
) -> dict:
    business = assert_business_access(client, business_id, user_id, PAYMENT_CONFIG_ROLES)
    if payload.business_id != business_id:
        raise HTTPException(status_code=403, detail="Payment account business mismatch.")
    if provider.value not in ONLINE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Counter payments do not have a provider account.")

    existing = _account_for_business(client, business_id, provider.value)
    fields: dict[str, Any] = {}
    if payload.display_name is not None:
        fields["display_name"] = payload.display_name
    if payload.provider_account_id is not None:
        fields["provider_account_id"] = payload.provider_account_id
    if payload.provider_merchant_id is not None:
        fields["provider_merchant_id"] = payload.provider_merchant_id
    if payload.is_enabled is not None:
        fields["is_enabled"] = payload.is_enabled
        if not payload.is_enabled:
            fields["connection_status"] = "disabled"
            fields["payments_enabled"] = False
            fields["charges_enabled"] = False
            fields["is_default"] = False
            _clear_default_provider(client, business_id)
        elif existing and existing.get("connection_status") == "disabled":
            fields["connection_status"] = "pending"
    if payload.is_default is not None:
        if payload.is_default:
            candidate = {**(existing or {}), **fields, "provider": provider.value}
            if not _provider_connected(candidate):
                raise HTTPException(status_code=409, detail="Only an active enabled provider can be the default.")
            _clear_default_provider(client, business_id)
            fields["is_default"] = True
        else:
            fields["is_default"] = False

    if not fields:
        account = existing or _empty_account(business_id, provider.value)
    else:
        account = _upsert_account(client, business_id, provider.value, fields)
    cache_service.invalidate_slug(business.get("slug"))
    return {"account": _safe_account(account)}


def refresh_payment_account_status(
    client: DbClient,
    business_id: UUID,
    user_id: UUID,
    provider: PaymentProvider,
) -> dict:
    business = assert_business_access(client, business_id, user_id, PAYMENT_CONFIG_ROLES)
    if provider.value not in ONLINE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Counter payments do not have provider status.")
    account = _account_for_business(client, business_id, provider.value) or _empty_account(business_id, provider.value)
    fields = _provider_status_fields(provider.value, account)
    fields["last_status_check_at"] = datetime.now(timezone.utc).isoformat()
    updated = _upsert_account(client, business_id, provider.value, fields)
    cache_service.invalidate_slug(business.get("slug"))
    return {"account": _safe_account(updated)}


def disconnect_payment_account(
    client: DbClient,
    business_id: UUID,
    user_id: UUID,
    provider: PaymentProvider,
    payload: PaymentAccountDisconnect,
) -> dict:
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Confirm disconnect before changing provider status.")
    business = assert_business_access(client, business_id, user_id, PAYMENT_CONFIG_ROLES)
    account = _upsert_account(
        client,
        business_id,
        provider.value,
        {
            "connection_status": "not_connected",
            "activation_status": "not_applicable",
            "charges_enabled": False,
            "payments_enabled": False,
            "payouts_enabled": False,
            "requirements_due": [],
            "onboarding_status": "disconnected",
            "is_enabled": False,
            "is_default": False,
        },
    )
    cache_service.invalidate_slug(business.get("slug"))
    return {"account": _safe_account(account)}


def create_payment_for_order(client: DbClient, business: dict, order: dict, method: str) -> dict:
    provider = payment_provider_for_method(method)
    status = PaymentStatus.PAY_AT_COUNTER_PENDING.value if provider == "pay_at_counter" else PaymentStatus.PENDING.value
    payment = client.table("payments").insert(
        {
            "business_id": order["business_id"],
            "order_id": order["id"],
            "provider": provider,
            "provider_reference": order["public_token"],
            "amount": order["total_amount"],
            "currency": business.get("currency_code") or "INR",
            "status": status,
            "payment_method": method,
            "raw_payload": {"source": "kiosk_checkout"},
        }
    ).execute().data[0]
    if provider == "pay_at_counter":
        return {"payment": _checkout_payment_record(payment), "checkout_url": None, "provider": provider}
    checkout = _create_online_checkout(client, business, order, payment, method, provider)
    return {
        "payment": _checkout_payment_record(checkout["payment"]),
        "checkout_url": checkout.get("checkout_url"),
        "qr": checkout.get("qr"),
        "provider": provider,
    }


def payment_status(client: DbClient, payment_id: UUID, payment_token: str | None = None) -> dict:
    response = client.table("payments").select("*").eq("id", str(payment_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Payment not found.")
    payment = response.data[0]
    _require_payment_status_token(payment, payment_token)
    if payment.get("provider") == "paytm" and payment.get("status") == PaymentStatus.PENDING.value:
        _refresh_paytm_payment_status(client, payment)
        response = client.table("payments").select("*").eq("id", str(payment_id)).limit(1).execute()
        payment = response.data[0] if response.data else payment
    return _public_payment_status(payment)


def create_paytm_dynamic_qr(client: DbClient, payload: PaytmDynamicQrCreate) -> dict:
    payment = _get_payment(client, payload.payment_id, payload.business_id)
    _require_payment_status_token(payment, payload.payment_token)
    if payment.get("provider") != "paytm":
        raise HTTPException(status_code=409, detail="This payment is not a Paytm payment.")
    if payment.get("status") != PaymentStatus.PENDING.value:
        return _public_payment_status(payment)
    order = _get_order_snapshot(client, UUID(payment["order_id"]), payload.business_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    business_response = client.table("businesses").select("*").eq("id", str(payload.business_id)).limit(1).execute()
    if not business_response.data:
        raise HTTPException(status_code=404, detail="Business not found.")
    qr = _paytm_dynamic_qr(business_response.data[0], order, payment)
    updated = _set_payment_status(
        client,
        payload.payment_id,
        payload.business_id,
        PaymentStatus.PENDING.value,
        {**(payment.get("raw_payload") or {}), "paytm_qr": qr},
        provider_order_id=qr.get("reference_id") or payment.get("provider_order_id"),
    )
    return _public_payment_status(updated)


def expire_abandoned_pending_online_payments(
    client: DbClient,
    older_than_minutes: int = 30,
    business_id: UUID | None = None,
    limit: int = 100,
) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max(1, older_than_minutes))
    params: dict[str, Any] = {
        "cutoff": cutoff,
        "limit": max(1, min(int(limit or 100), 500)),
        "pending": PaymentStatus.PENDING.value,
        "order_pending": "payment_pending",
    }
    business_filter = ""
    if business_id:
        params["business_id"] = str(business_id)
        business_filter = "and p.business_id = %(business_id)s"
    payments = client.fetch_all(
        f"""
        select p.*
        from payments p
        join orders o on o.id = p.order_id and o.business_id = p.business_id
        where p.status = %(pending)s
          and p.provider in ('stripe', 'razorpay', 'paytm')
          and o.status = %(order_pending)s
          and o.payment_status = %(pending)s
          and coalesce(p.created_at, o.placed_at) < %(cutoff)s
          {business_filter}
        order by coalesce(p.created_at, o.placed_at) asc
        limit %(limit)s
        for update skip locked
        """,
        params,
    )
    expired_ids: list[str] = []
    for payment in payments:
        _expire_online_payment(
            client,
            payment,
            {
                "source": "pending_payment_expiry",
                "expired_at": datetime.now(timezone.utc).isoformat(),
                "older_than_minutes": older_than_minutes,
            },
        )
        expired_ids.append(str(payment.get("id")))
    if business_id:
        _refresh_real_alerts_for_payments(client, business_id)
    return {"expired_count": len(expired_ids), "payment_ids": expired_ids}


def list_payments(client: DbClient, business_id: UUID, user_id: UUID, limit: int = 100) -> dict:
    business = assert_business_access(client, business_id, user_id, PAYMENT_VIEW_ROLES)
    _refresh_real_alerts_for_payments(client, business_id)
    bounded_limit = max(1, min(limit, 250))
    payments = (
        client.table("payments")
        .select("*")
        .eq("business_id", str(business_id))
        .order("created_at", desc=True)
        .limit(bounded_limit + 1)
        .execute()
        .data
        or []
    )
    has_more = len(payments) > bounded_limit
    payments = [_safe_payment_record(payment) for payment in payments[:bounded_limit]]
    for payment in payments:
        if payment.get("order_id"):
            payment["order"] = _get_order_snapshot(client, UUID(payment["order_id"]), business_id)
    accounts = {account["provider"]: account for account in list_payment_accounts(client, business_id)}
    return {
        "business": serialize_business_for_response(business),
        "payments": payments,
        "has_more": has_more,
        "accounts": [_safe_account(account) for account in accounts.values()],
        "summary": _payment_summary(business, payments, accounts),
    }


def mark_counter_payment_paid(
    client: DbClient,
    payment_id: UUID,
    user_id: UUID,
    payload: CounterPaymentMarkPaid,
) -> dict:
    business = assert_business_access(client, payload.business_id, user_id, COUNTER_ROLES)
    payment = _get_payment(client, payment_id, payload.business_id)
    if payment.get("provider") != "pay_at_counter":
        raise HTTPException(status_code=409, detail="Only counter payments can be marked paid here.")
    if payment.get("status") == PaymentStatus.PAID.value:
        return payment
    collected_amount = payload.amount if payload.amount is not None else payment.get("amount")
    updated = _set_payment_status(
        client,
        payment_id,
        payload.business_id,
        PaymentStatus.PAID.value,
        {"marked_by": str(user_id), "collection_method": payload.method or "counter"},
    )
    client.table("payments").update(
        {
            "collected_by": str(user_id),
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "collected_amount": collected_amount,
            "collection_method": payload.method or "counter",
        }
    ).eq("id", str(payment_id)).eq("business_id", str(payload.business_id)).execute()
    client.table("orders").update({"payment_status": PaymentStatus.PAID.value}).eq("id", payment["order_id"]).eq("business_id", str(payload.business_id)).execute()
    client.table("audit_logs").insert(
        {
            "business_id": str(payload.business_id),
            "user_id": str(user_id),
            "action": "counter_payment_marked_paid",
            "entity": "payments",
            "entity_id": str(payment_id),
            "metadata": {"order_id": payment.get("order_id")},
        }
    ).execute()
    refreshed = _get_payment(client, payment_id, payload.business_id)
    return refreshed | {"order": _get_order_snapshot(client, UUID(payment["order_id"]), UUID(str(business["id"])))}


def complete_counter_order(
    client: DbClient,
    order_id: UUID,
    user_id: UUID,
    payload: CounterOrderComplete,
) -> dict:
    business = assert_business_access(client, payload.business_id, user_id, COUNTER_ROLES)
    order = _get_order_snapshot(client, order_id, payload.business_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    payment_status = order.get("payment_status")
    if payment_status not in {PaymentStatus.PAID.value, PaymentStatus.PAY_AT_COUNTER_PENDING.value}:
        raise HTTPException(status_code=409, detail="Only paid or counter-pending orders can be handed over.")
    if payment_status == PaymentStatus.PAY_AT_COUNTER_PENDING.value:
        raise HTTPException(status_code=409, detail="Collect payment before handover.")
    previous = order.get("status")
    response = (
        client.table("orders")
        .update({"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(order_id))
        .eq("business_id", str(payload.business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    client.table("kitchen_events").insert(
        {
            "business_id": str(payload.business_id),
            "order_id": str(order_id),
            "old_status": previous,
            "new_status": "completed",
            "changed_by": str(user_id),
        }
    ).execute()
    client.table("audit_logs").insert(
        {
            "business_id": str(payload.business_id),
            "user_id": str(user_id),
            "action": "counter_order_handed_over",
            "entity": "orders",
            "entity_id": str(order_id),
            "metadata": {"payment_status": payment_status},
        }
    ).execute()
    return _get_order_snapshot(client, order_id, UUID(str(business["id"])))


def process_stripe_webhook(client: DbClient, payload_bytes: bytes, signature: str | None) -> dict:
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not configured.")
    if not _verify_stripe_signature(payload_bytes, signature, settings.stripe_webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature.")
    payload = json.loads(payload_bytes.decode("utf-8"))
    return _record_and_process_event(client, "stripe", payload.get("id"), payload.get("type"), payload, True)


def process_razorpay_webhook(client: DbClient, payload_bytes: bytes, signature: str | None) -> dict:
    settings = get_settings()
    if not settings.razorpay_webhook_secret:
        raise HTTPException(status_code=503, detail="Razorpay webhook secret is not configured.")
    expected = hmac.new(settings.razorpay_webhook_secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid Razorpay webhook signature.")
    payload = json.loads(payload_bytes.decode("utf-8"))
    event_id = payload.get("id") or f"{payload.get('event')}:{_razorpay_payment_id(payload)}:{payload.get('created_at')}"
    return _record_and_process_event(client, "razorpay", event_id, payload.get("event"), payload, True)


def process_paytm_webhook(client: DbClient, payload_bytes: bytes, signature: str | None) -> dict:
    settings = get_settings()
    secret = settings.paytm_webhook_secret or settings.paytm_merchant_key
    if not secret:
        raise HTTPException(status_code=503, detail="Paytm webhook secret is not configured.")
    if not _verify_paytm_signature(payload_bytes, signature, secret):
        raise HTTPException(status_code=400, detail="Invalid Paytm webhook signature.")
    payload = json.loads(payload_bytes.decode("utf-8"))
    event_id = str(payload.get("eventId") or payload.get("txnId") or payload.get("TXNID") or payload.get("orderId") or payload.get("ORDERID") or "")
    event_type = str(payload.get("eventType") or payload.get("status") or payload.get("STATUS") or "paytm.status")
    return _record_and_process_event(client, "paytm", event_id, event_type, payload, True)


def _connect_stripe(client: DbClient, business: dict, payload: PaymentAccountConnect) -> dict:
    settings = get_settings()
    business_id = UUID(str(business["id"]))
    if payload.provider_account_id:
        env_ready = bool(settings.stripe_secret_key)
        account = _upsert_account(
            client,
            business_id,
            "stripe",
            {
                "display_name": payload.display_name or "Stripe",
                "provider_account_id": payload.provider_account_id,
                "connection_status": "active" if env_ready else "setup_required",
                "activation_status": "activated" if env_ready else "incomplete",
                "charges_enabled": env_ready,
                "payments_enabled": env_ready,
                "payouts_enabled": env_ready,
                "onboarding_status": "manual_account_id" if env_ready else "backend_credentials_required",
                "requirements_due": [] if env_ready else ["STRIPE_SECRET_KEY"],
                "is_enabled": payload.is_enabled,
                "last_status_check_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return {"account": _safe_account(account), "onboarding_url": None}

    if not settings.stripe_secret_key:
        account = _upsert_account(
            client,
            business_id,
            "stripe",
            {
                "connection_status": "pending",
                "activation_status": "incomplete",
                "onboarding_status": "missing_platform_credentials",
                "is_enabled": payload.is_enabled,
                "requirements_due": ["STRIPE_SECRET_KEY"],
                "metadata": {"setup_required": "Set STRIPE_SECRET_KEY to create hosted onboarding links."},
                "last_status_check_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return {"account": _safe_account(account), "onboarding_url": None, "setup_required": True}

    account_id = _stripe_create_account(settings.stripe_secret_key, business)
    account_link = _stripe_create_account_link(settings.stripe_secret_key, account_id, business)
    account = _upsert_account(
        client,
        business_id,
        "stripe",
        {
            "provider_account_id": account_id,
            "connection_status": "pending",
            "activation_status": "pending",
            "charges_enabled": False,
            "payments_enabled": False,
            "payouts_enabled": False,
            "onboarding_status": "hosted_onboarding_started",
            "is_enabled": payload.is_enabled,
            "last_status_check_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"account": _safe_account(account), "onboarding_url": account_link.get("url")}


def _connect_razorpay(client: DbClient, business: dict, payload: PaymentAccountConnect) -> dict:
    business_id = UUID(str(business["id"]))
    settings = get_settings()
    # Razorpay does not provide the same general-purpose self-serve Connect OAuth flow as Stripe Connect.
    # PlaceURorder records a Route/linked-account id created through Razorpay partner/Route onboarding, then uses
    # server-side payment links/webhooks so no Razorpay secret is exposed to the kiosk frontend.
    if payload.provider_account_id:
        env_ready = bool(settings.razorpay_key_id and settings.razorpay_key_secret)
        account = _upsert_account(
            client,
            business_id,
            "razorpay",
            {
                "display_name": payload.display_name or "Razorpay",
                "provider_account_id": payload.provider_account_id,
                "connection_status": "active" if env_ready else "setup_required",
                "activation_status": "activated" if env_ready else "incomplete",
                "charges_enabled": env_ready,
                "payments_enabled": env_ready,
                "payouts_enabled": False,
                "onboarding_status": "linked_account_recorded" if env_ready else "backend_credentials_required",
                "requirements_due": [] if env_ready else ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
                "is_enabled": payload.is_enabled,
                "last_status_check_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return {"account": _safe_account(account), "onboarding_url": None}
    account = _upsert_account(
        client,
        business_id,
        "razorpay",
        {
            "connection_status": "pending",
            "activation_status": "incomplete",
            "onboarding_status": "route_linked_account_required",
            "is_enabled": payload.is_enabled,
            "requirements_due": ["Razorpay Route linked account id"],
            "metadata": {
                "setup_url": "https://razorpay.com/docs/payments/route/linked-account/",
                "limitation": "Create or approve a Razorpay Route linked account, then record the linked account id.",
            },
            "last_status_check_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {
        "account": _safe_account(account),
        "onboarding_url": "https://razorpay.com/docs/payments/route/linked-account/",
        "setup_required": True,
    }


def _connect_paytm(client: DbClient, business: dict, payload: PaymentAccountConnect) -> dict:
    business_id = UUID(str(business["id"]))
    settings = get_settings()
    merchant_id = payload.provider_merchant_id or payload.provider_account_id
    env_ready = bool(settings.paytm_mid and settings.paytm_merchant_key and settings.paytm_dynamic_qr_create_url)
    if merchant_id and env_ready:
        account = _upsert_account(
            client,
            business_id,
            "paytm",
            {
                "display_name": payload.display_name or "Paytm Dynamic QR",
                "provider_account_id": merchant_id,
                "provider_merchant_id": merchant_id,
                "connection_status": "active",
                "activation_status": "activated",
                "charges_enabled": True,
                "payments_enabled": True,
                "payouts_enabled": False,
                "onboarding_status": "dynamic_qr_configured",
                "is_enabled": payload.is_enabled,
                "requirements_due": [],
                "last_status_check_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return {"account": _safe_account(account), "onboarding_url": None}

    requirements = []
    if not merchant_id:
        requirements.append("Paytm merchant id")
    if not settings.paytm_mid:
        requirements.append("PAYTM_MID")
    if not settings.paytm_merchant_key:
        requirements.append("PAYTM_MERCHANT_KEY")
    if not settings.paytm_dynamic_qr_create_url:
        requirements.append("PAYTM_DYNAMIC_QR_CREATE_URL")
    account = _upsert_account(
        client,
        business_id,
        "paytm",
        {
            "display_name": payload.display_name or "Paytm Dynamic QR",
            "provider_account_id": merchant_id,
            "provider_merchant_id": merchant_id,
            "connection_status": "setup_required",
            "activation_status": "incomplete",
            "charges_enabled": False,
            "payments_enabled": False,
            "payouts_enabled": False,
            "onboarding_status": "backend_paytm_config_required",
            "is_enabled": payload.is_enabled,
            "requirements_due": requirements,
            "metadata": {"setup_required": "Configure Paytm merchant id, merchant key, dynamic QR endpoint, and webhook/status verification."},
            "last_status_check_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"account": _safe_account(account), "onboarding_url": None, "setup_required": True}


def _create_online_checkout(client: DbClient, business: dict, order: dict, payment: dict, method: str, provider: str) -> dict:
    if provider == "stripe":
        checkout = _stripe_checkout_session(business, order, payment)
        updated = _set_payment_status(
            client,
            UUID(payment["id"]),
            UUID(order["business_id"]),
            PaymentStatus.PENDING.value,
            {
                "checkout_session_id": checkout.get("id"),
                "url_created": bool(checkout.get("url")),
            },
            provider_order_id=checkout.get("id"),
            payment_intent_id=checkout.get("payment_intent"),
        )
        return {"payment": updated, "checkout_url": checkout.get("url")}
    if provider == "paytm":
        qr = _paytm_dynamic_qr(business, order, payment)
        updated = _set_payment_status(
            client,
            UUID(payment["id"]),
            UUID(order["business_id"]),
            PaymentStatus.PENDING.value,
            {"paytm_qr": qr},
            provider_order_id=qr.get("reference_id"),
        )
        return {"payment": updated, "checkout_url": None, "qr": qr}
    checkout = _razorpay_payment_link(business, order, payment, method)
    updated = _set_payment_status(
        client,
        UUID(payment["id"]),
        UUID(order["business_id"]),
        PaymentStatus.PENDING.value,
        {"payment_link_id": checkout.get("id")},
        provider_order_id=checkout.get("id"),
    )
    return {"payment": updated, "checkout_url": checkout.get("short_url")}


def _payment_summary(business: dict, payments: list[dict], accounts: dict[str, dict] | None = None) -> dict:
    paid = [payment for payment in payments if payment.get("status") == PaymentStatus.PAID.value]
    pending = [payment for payment in payments if payment.get("status") in {PaymentStatus.PENDING.value, PaymentStatus.PAY_AT_COUNTER_PENDING.value}]
    failed = [payment for payment in payments if payment.get("status") in {PaymentStatus.FAILED.value, PaymentStatus.CANCELLED.value, PaymentStatus.EXPIRED.value}]
    return {
        "total_collected": round(sum(float(payment.get("amount") or 0) for payment in paid), 2),
        "paid_count": len(paid),
        "pending_count": len(pending),
        "failed_count": len(failed),
        "enabled_methods": effective_payment_methods(business, accounts),
    }


def _record_and_process_event(
    client: DbClient,
    provider: str,
    event_id: str | None,
    event_type: str | None,
    payload: dict,
    signature_valid: bool,
) -> dict:
    if not event_id or not event_type:
        raise HTTPException(status_code=400, detail="Webhook event is missing an id or type.")
    payment = _payment_from_event(client, provider, payload)
    inserted = client.execute_one(
        """
        insert into payment_events (
          provider, event_id, business_id, order_id, payment_id, event_type,
          signature_valid, processed_at, raw_payload, idempotency_status
        )
        values (
          %(provider)s, %(event_id)s, %(business_id)s, %(order_id)s, %(payment_id)s, %(event_type)s,
          %(signature_valid)s, now(), %(raw_payload)s, 'processed'
        )
        on conflict (provider, event_id) do nothing
        returning id
        """,
        {
            "provider": provider,
            "event_id": event_id,
            "business_id": payment.get("business_id") if payment else None,
            "order_id": payment.get("order_id") if payment else None,
            "payment_id": payment.get("id") if payment else None,
            "event_type": event_type,
            "signature_valid": signature_valid,
            "raw_payload": Jsonb(payload),
        },
    )
    if not inserted:
        return {"status": "ignored", "reason": "duplicate"}
    if not payment:
        return {"status": "processed", "reason": "payment_not_found"}

    if _event_is_paid(provider, event_type, payload):
        _confirm_online_payment(client, payment, payload)
        return {"status": "processed", "payment_status": "paid"}
    if _event_is_failed(provider, event_type, payload):
        _fail_online_payment(client, payment, payload)
        return {"status": "processed", "payment_status": "failed"}
    return {"status": "processed", "payment_status": payment.get("status")}


def _confirm_online_payment(client: DbClient, payment: dict, payload: dict) -> None:
    payment_id = UUID(payment["id"])
    business_id = UUID(payment["business_id"])
    order_id = UUID(payment["order_id"])
    _set_payment_status(
        client,
        payment_id,
        business_id,
        PaymentStatus.PAID.value,
        payload,
        provider_payment_id=_provider_payment_id(payment.get("provider"), payload),
    )
    order = _get_order_snapshot(client, order_id, business_id)
    previous = order["status"]
    client.table("orders").update({"payment_status": PaymentStatus.PAID.value, "status": "pending"}).eq("id", str(order_id)).eq("business_id", str(business_id)).execute()
    client.table("kitchen_events").insert(
        {
            "business_id": str(business_id),
            "order_id": str(order_id),
            "old_status": previous,
            "new_status": "pending",
            "changed_by": None,
        }
    ).execute()


def _fail_online_payment(client: DbClient, payment: dict, payload: dict) -> None:
    payment_id = UUID(payment["id"])
    business_id = UUID(payment["business_id"])
    order_id = UUID(payment["order_id"])
    _set_payment_status(
        client,
        payment_id,
        business_id,
        PaymentStatus.FAILED.value,
        payload,
        provider_payment_id=_provider_payment_id(payment.get("provider"), payload),
    )
    client.table("orders").update(
        {
            "payment_status": PaymentStatus.FAILED.value,
            "status": "cancelled",
            "cancel_reason": "Online payment failed or expired.",
        }
    ).eq("id", str(order_id)).eq("business_id", str(business_id)).execute()
    _restore_reserved_inventory(client, business_id, order_id)


def _expire_online_payment(client: DbClient, payment: dict, payload: dict) -> None:
    payment_id = UUID(payment["id"])
    business_id = UUID(payment["business_id"])
    order_id = UUID(payment["order_id"])
    _set_payment_status(
        client,
        payment_id,
        business_id,
        PaymentStatus.EXPIRED.value,
        payload,
        provider_payment_id=payment.get("provider_payment_id"),
    )
    client.table("orders").update(
        {
            "payment_status": PaymentStatus.EXPIRED.value,
            "status": "cancelled",
            "cancel_reason": "Online payment expired before confirmation.",
        }
    ).eq("id", str(order_id)).eq("business_id", str(business_id)).execute()
    _restore_reserved_inventory(client, business_id, order_id)


def _restore_reserved_inventory(client: DbClient, business_id: UUID, order_id: UUID) -> None:
    items = client.table("order_items").select("*").eq("business_id", str(business_id)).eq("order_id", str(order_id)).execute().data or []
    for item in items:
        if not item.get("product_id"):
            continue
        client.execute_one(
            """
            update products
            set sold_today = greatest(sold_today - %(quantity)s, 0),
                stock_quantity = case
                  when track_stock and stock_quantity is not null then stock_quantity + %(quantity)s
                  else stock_quantity
                end,
                is_available = case
                  when menu_status in ('shown', 'unavailable') then true
                  else is_available
                end
            where id = %(product_id)s
              and business_id = %(business_id)s
            returning id
            """,
            {"quantity": int(item.get("quantity") or 0), "product_id": item["product_id"], "business_id": str(business_id)},
        )


def _payment_from_event(client: DbClient, provider: str, payload: dict) -> dict | None:
    payment_id = None
    if provider == "stripe":
        obj = payload.get("data", {}).get("object", {})
        metadata = obj.get("metadata") or {}
        payment_id = metadata.get("payment_id")
        provider_order_id = obj.get("id")
    elif provider == "razorpay":
        payment_id = _razorpay_notes(payload).get("payment_id")
        provider_order_id = _razorpay_payment_link_id(payload)
    else:
        body = payload.get("body") if isinstance(payload.get("body"), dict) else payload
        payment_id = body.get("paymentId") or body.get("payment_id")
        provider_order_id = body.get("orderId") or body.get("ORDERID")
    if payment_id:
        response = client.table("payments").select("*").eq("id", payment_id).limit(1).execute()
        return response.data[0] if response.data else None
    if provider_order_id:
        response = client.table("payments").select("*").eq("provider_order_id", provider_order_id).limit(1).execute()
        return response.data[0] if response.data else None
    return None


def _event_is_paid(provider: str, event_type: str, payload: dict) -> bool:
    if provider == "stripe":
        if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded"}:
            obj = payload.get("data", {}).get("object", {})
            return obj.get("payment_status") in {None, "paid"} or obj.get("status") in {"succeeded", "complete"}
    if provider == "paytm":
        body = payload.get("body") if isinstance(payload.get("body"), dict) else payload
        status = str(body.get("resultStatus") or body.get("STATUS") or body.get("status") or event_type).upper()
        return status in {"TXN_SUCCESS", "SUCCESS", "PAID"}
    return event_type in {"payment.captured", "order.paid", "payment_link.paid"}


def _event_is_failed(provider: str, event_type: str, payload: dict) -> bool:
    if provider == "stripe":
        return event_type in {"checkout.session.async_payment_failed", "payment_intent.payment_failed", "checkout.session.expired"}
    if provider == "paytm":
        body = payload.get("body") if isinstance(payload.get("body"), dict) else payload
        status = str(body.get("resultStatus") or body.get("STATUS") or body.get("status") or event_type).upper()
        return status in {"TXN_FAILURE", "FAILED", "FAILURE", "EXPIRED", "TXN_FAILURE"}
    return event_type in {"payment.failed", "payment_link.cancelled", "payment_link.expired"}


def _get_payment(client: DbClient, payment_id: UUID, business_id: UUID) -> dict:
    response = client.table("payments").select("*").eq("id", str(payment_id)).eq("business_id", str(business_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Payment not found.")
    return response.data[0]


def _set_payment_status(
    client: DbClient,
    payment_id: UUID,
    business_id: UUID,
    status: str,
    raw_payload: dict,
    provider_order_id: str | None = None,
    provider_payment_id: str | None = None,
    payment_intent_id: str | None = None,
) -> dict:
    update = {"status": status, "raw_payload": raw_payload, "updated_at": datetime.now(timezone.utc).isoformat()}
    if provider_order_id:
        update["provider_order_id"] = provider_order_id
    if provider_payment_id:
        update["provider_payment_id"] = provider_payment_id
    if payment_intent_id:
        update["payment_intent_id"] = payment_intent_id
    response = client.table("payments").update(update).eq("id", str(payment_id)).eq("business_id", str(business_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Payment not found.")
    return response.data[0]


def _get_order_snapshot(client: DbClient, order_id: UUID, business_id: UUID) -> dict:
    response = client.table("orders").select("*, order_items(*)").eq("id", str(order_id)).eq("business_id", str(business_id)).limit(1).execute()
    return response.data[0] if response.data else {}


def _upsert_account(client: DbClient, business_id: UUID, provider: str, fields: dict[str, Any]) -> dict:
    payload = {"business_id": str(business_id), "provider": provider, **fields, "updated_at": datetime.now(timezone.utc).isoformat()}
    if isinstance(payload.get("metadata"), dict):
        payload["metadata"] = Jsonb(payload["metadata"])
    if isinstance(payload.get("requirements_due"), list):
        payload["requirements_due"] = Jsonb(payload["requirements_due"])
    columns = ", ".join(payload.keys())
    values = ", ".join(f"%({key})s" for key in payload)
    assignments = ", ".join(f"{key} = excluded.{key}" for key in payload if key not in {"business_id", "provider"})
    row = client.execute_one(
        f"""
        insert into business_payment_accounts ({columns})
        values ({values})
        on conflict (business_id, provider)
        do update set {assignments}
        returning *
        """,
        payload,
    )
    return row or _empty_account(business_id, provider)


def _safe_account(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "business_id": row.get("business_id"),
        "provider": row.get("provider"),
        "display_name": row.get("display_name"),
        "provider_account_id": row.get("provider_account_id"),
        "provider_merchant_id": row.get("provider_merchant_id"),
        "connection_status": row.get("connection_status", "not_connected"),
        "activation_status": row.get("activation_status", row.get("onboarding_status", "not_applicable")),
        "charges_enabled": bool(row.get("charges_enabled")),
        "payments_enabled": bool(row.get("payments_enabled")),
        "payouts_enabled": bool(row.get("payouts_enabled")),
        "requirements_due": row.get("requirements_due") or [],
        "last_status_check_at": row.get("last_status_check_at"),
        "is_default": bool(row.get("is_default")),
        "is_enabled": row.get("is_enabled") is not False,
        "onboarding_status": row.get("onboarding_status", "not_started"),
        "metadata": row.get("metadata") or {},
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _empty_account(business_id: UUID, provider: str) -> dict:
    return {
        "id": None,
        "business_id": str(business_id),
        "provider": provider,
        "display_name": provider.title() if provider != "paytm" else "Paytm Dynamic QR",
        "provider_account_id": None,
        "provider_merchant_id": None,
        "connection_status": "not_connected",
        "activation_status": "not_applicable",
        "charges_enabled": False,
        "payments_enabled": False,
        "payouts_enabled": False,
        "requirements_due": [],
        "last_status_check_at": None,
        "is_default": False,
        "is_enabled": False,
        "onboarding_status": "not_started",
        "metadata": {},
        "created_at": None,
        "updated_at": None,
    }


def _provider_connected(row: dict | None) -> bool:
    if not row or row.get("is_enabled") is False:
        return False
    return bool(row.get("connection_status") in {"active", "connected"} and (row.get("payments_enabled") or row.get("charges_enabled")))


def _account_for_business(client: DbClient, business_id: UUID, provider: str) -> dict | None:
    response = (
        client.table("business_payment_accounts")
        .select("*")
        .eq("business_id", str(business_id))
        .eq("provider", provider)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def _clear_default_provider(client: DbClient, business_id: UUID) -> None:
    client.table("business_payment_accounts").update({"is_default": False}).eq("business_id", str(business_id)).execute()


def _provider_status_fields(provider: str, account: dict) -> dict[str, Any]:
    if account.get("is_enabled") is False:
        return {
            "connection_status": "disabled",
            "payments_enabled": False,
            "charges_enabled": False,
            "is_default": False,
        }
    if provider == "paytm":
        settings = get_settings()
        requirements = []
        if not account.get("provider_merchant_id") and not account.get("provider_account_id"):
            requirements.append("Paytm merchant id")
        if not settings.paytm_mid:
            requirements.append("PAYTM_MID")
        if not settings.paytm_merchant_key:
            requirements.append("PAYTM_MERCHANT_KEY")
        if not settings.paytm_dynamic_qr_create_url:
            requirements.append("PAYTM_DYNAMIC_QR_CREATE_URL")
        if requirements:
            return {
                "connection_status": "setup_required",
                "activation_status": "incomplete",
                "payments_enabled": False,
                "charges_enabled": False,
                "requirements_due": requirements,
            }
        return {
            "connection_status": "active",
            "activation_status": "activated",
            "payments_enabled": True,
            "charges_enabled": True,
            "requirements_due": [],
        }
    if provider == "stripe":
        if not account.get("provider_account_id"):
            return {
                "connection_status": "setup_required",
                "activation_status": "incomplete",
                "payments_enabled": False,
                "charges_enabled": False,
                "requirements_due": ["Stripe connected account id"],
            }
        if not get_settings().stripe_secret_key:
            return {
                "connection_status": "setup_required",
                "activation_status": "incomplete",
                "payments_enabled": False,
                "charges_enabled": False,
                "requirements_due": ["STRIPE_SECRET_KEY"],
            }
        return {
            "connection_status": account.get("connection_status") if account.get("connection_status") in {"active", "connected"} else "pending",
            "activation_status": account.get("activation_status") or account.get("onboarding_status") or "pending",
            "payments_enabled": bool(account.get("payments_enabled")),
            "charges_enabled": bool(account.get("charges_enabled")),
            "requirements_due": account.get("requirements_due") or [],
        }
    if provider == "razorpay":
        if not account.get("provider_account_id"):
            return {
                "connection_status": "setup_required",
                "activation_status": "incomplete",
                "payments_enabled": False,
                "charges_enabled": False,
                "requirements_due": ["Razorpay Route linked account id"],
            }
        if not get_settings().razorpay_key_id or not get_settings().razorpay_key_secret:
            return {
                "connection_status": "setup_required",
                "activation_status": "incomplete",
                "payments_enabled": False,
                "charges_enabled": False,
                "requirements_due": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
            }
        return {
            "connection_status": account.get("connection_status") if account.get("connection_status") in {"active", "connected"} else "pending",
            "activation_status": account.get("activation_status") or "pending",
            "payments_enabled": bool(account.get("payments_enabled")),
            "charges_enabled": bool(account.get("charges_enabled")),
            "requirements_due": account.get("requirements_due") or [],
        }
    return {}


def _default_method(business: dict, allowed: list[str]) -> str | None:
    default = normalize_payment_method((business.get("kiosk_order_settings") or {}).get("default_payment_method"))
    return default if default in allowed else (allowed[0] if allowed else None)


def _stripe_create_account(secret: str, business: dict) -> str:
    response = _stripe_request(
        secret,
        "/v1/accounts",
        {
            "type": "express",
            "country": "IN",
            "email": "",
            "business_type": "company",
            "capabilities[card_payments][requested]": "true",
            "capabilities[transfers][requested]": "true",
            "business_profile[name]": business.get("name") or "PlaceURorder merchant",
        },
    )
    return response["id"]


def _stripe_create_account_link(secret: str, account_id: str, business: dict) -> dict:
    settings = get_settings()
    base = settings.frontend_base_url.rstrip("/")
    return _stripe_request(
        secret,
        "/v1/account_links",
        {
            "account": account_id,
            "refresh_url": settings.stripe_connect_refresh_url or f"{base}/admin/payments?provider=stripe&status=refresh",
            "return_url": settings.stripe_connect_return_url or f"{base}/admin/payments?provider=stripe&status=returned",
            "type": "account_onboarding",
        },
    )


def _stripe_checkout_session(business: dict, order: dict, payment: dict) -> dict:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe server credentials are not configured.")
    account = _provider_account_for_business("stripe", UUID(order["business_id"]))
    base = settings.frontend_base_url.rstrip("/")
    currency = (business.get("currency_code") or "INR").lower()
    amount = _minor_amount(order["total_amount"])
    return _stripe_request(
        settings.stripe_secret_key,
        "/v1/checkout/sessions",
        {
            "mode": "payment",
            "success_url": f"{base}/kiosk/{business.get('slug')}?payment=processing&order={order['id']}",
            "cancel_url": f"{base}/kiosk/{business.get('slug')}?payment=cancelled&order={order['id']}",
            "line_items[0][price_data][currency]": currency,
            "line_items[0][price_data][unit_amount]": str(amount),
            "line_items[0][price_data][product_data][name]": f"Order {order.get('order_number') or order['public_token']}",
            "line_items[0][quantity]": "1",
            "metadata[payment_id]": payment["id"],
            "metadata[order_id]": order["id"],
            "payment_intent_data[metadata][payment_id]": payment["id"],
            "payment_intent_data[metadata][order_id]": order["id"],
        },
        stripe_account=account.get("provider_account_id"),
    )


def _razorpay_payment_link(business: dict, order: dict, payment: dict, method: str) -> dict:
    settings = get_settings()
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Razorpay server credentials are not configured.")
    base = settings.frontend_base_url.rstrip("/")
    body = {
        "amount": _minor_amount(order["total_amount"]),
        "currency": business.get("currency_code") or "INR",
        "accept_partial": False,
        "reference_id": payment["id"],
        "description": f"PlaceURorder order {order.get('order_number') or order['public_token']}",
        "callback_url": f"{base}/kiosk/{business.get('slug')}?payment=processing&order={order['id']}",
        "callback_method": "get",
        "notes": {
            "payment_id": payment["id"],
            "order_id": order["id"],
            "business_id": order["business_id"],
            "method": method,
        },
    }
    return _razorpay_request(settings.razorpay_key_id, settings.razorpay_key_secret, "/v1/payment_links", body)


def _paytm_dynamic_qr(business: dict, order: dict, payment: dict) -> dict:
    settings = get_settings()
    account = _provider_account_for_business("paytm", UUID(order["business_id"]))
    if not settings.paytm_mid or not settings.paytm_merchant_key or not settings.paytm_dynamic_qr_create_url:
        raise HTTPException(status_code=503, detail="Paytm Dynamic QR backend config is not complete.")
    reference_id = f"MT-{payment['id']}"
    amount = f"{float(payment.get('amount') or order.get('total_amount') or 0):.2f}"
    body = {
        "mid": settings.paytm_mid,
        "merchantId": account.get("provider_merchant_id") or account.get("provider_account_id"),
        "orderId": reference_id,
        "amount": amount,
        "businessId": order["business_id"],
        "paymentId": payment["id"],
        "websiteName": settings.paytm_website_name,
        "currency": payment.get("currency") or business.get("currency_code") or "INR",
    }
    signature = _paytm_signature(body, settings.paytm_merchant_key)
    req = request.Request(
        settings.paytm_dynamic_qr_create_url,
        data=json.dumps({"body": body, "head": {"signature": signature}}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    response = _json_request(req)
    response_body = response.get("body") if isinstance(response.get("body"), dict) else response
    qr_data = (
        response_body.get("qrData")
        or response_body.get("qrCodeData")
        or response_body.get("qrCode")
        or response_body.get("qr_url")
    )
    if not qr_data:
        raise HTTPException(status_code=502, detail="Paytm did not return QR data.")
    return {
        "provider": "paytm",
        "payment_id": payment["id"],
        "reference_id": reference_id,
        "amount": amount,
        "currency": body["currency"],
        "qr_data": qr_data,
        "expires_at": response_body.get("expiryDate") or response_body.get("expires_at"),
        "raw_status": response_body.get("resultInfo") or response_body.get("status"),
    }


def _refresh_paytm_payment_status(client: DbClient, payment: dict) -> None:
    settings = get_settings()
    if not settings.paytm_mid or not settings.paytm_merchant_key or not settings.paytm_transaction_status_url:
        return
    reference = payment.get("provider_order_id") or f"MT-{payment['id']}"
    body = {"mid": settings.paytm_mid, "orderId": reference}
    signature = _paytm_signature(body, settings.paytm_merchant_key)
    req = request.Request(
        settings.paytm_transaction_status_url,
        data=json.dumps({"body": body, "head": {"signature": signature}}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    response = _json_request(req)
    response_body = response.get("body") if isinstance(response.get("body"), dict) else response
    status = str(response_body.get("resultStatus") or response_body.get("STATUS") or response_body.get("status") or "").upper()
    if status in {"TXN_SUCCESS", "SUCCESS", "PAID"}:
        _confirm_online_payment(client, payment, response_body)
    elif status in {"TXN_FAILURE", "FAILED", "FAILURE"}:
        _fail_online_payment(client, payment, response_body)


def _require_payment_status_token(payment: dict, payment_token: str | None) -> None:
    expected = str(payment.get("provider_reference") or "")
    supplied = str(payment_token or "")
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=403, detail="Invalid payment token.")


def _public_payment_status(payment: dict) -> dict:
    raw_payload = payment.get("raw_payload") or {}
    paytm_qr = raw_payload.get("paytm_qr") if isinstance(raw_payload, dict) else None
    return {
        "id": payment.get("id"),
        "order_id": payment.get("order_id"),
        "provider": payment.get("provider"),
        "status": payment.get("status"),
        "amount": payment.get("amount"),
        "currency": payment.get("currency"),
        "payment_method": payment.get("payment_method"),
        "provider_order_id": payment.get("provider_order_id"),
        "qr": paytm_qr if payment.get("provider") == "paytm" else None,
        "updated_at": payment.get("updated_at"),
    }


def _safe_payment_record(payment: dict) -> dict:
    safe = dict(payment)
    safe.pop("raw_payload", None)
    safe.pop("provider_reference", None)
    return safe


def _checkout_payment_record(payment: dict) -> dict:
    safe = _safe_payment_record(payment)
    safe["provider_reference"] = payment.get("provider_reference")
    if payment.get("provider") == "paytm":
        safe["qr"] = _public_payment_status(payment).get("qr")
    return safe


def _provider_account_for_business(provider: str, business_id: UUID) -> dict:
    from database import db_context

    with db_context() as client:
        row = (
            client.table("business_payment_accounts")
            .select("*")
            .eq("business_id", str(business_id))
            .eq("provider", provider)
            .limit(1)
            .execute()
            .data
        )
        if not row or not _provider_connected(row[0]):
            raise HTTPException(status_code=409, detail=f"{provider.title()} payments are not connected.")
        return row[0]


def _paytm_signature(payload: dict, secret: str) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def _verify_paytm_signature(payload: bytes, signature: str | None, secret: str) -> bool:
    if not signature:
        return False
    try:
        decoded = json.loads(payload.decode("utf-8"))
    except ValueError:
        return False
    body = decoded.get("body") if isinstance(decoded.get("body"), dict) else decoded
    expected = _paytm_signature(body, secret)
    return hmac.compare_digest(expected, signature)


def _stripe_request(secret: str, path: str, data: dict[str, str], stripe_account: str | None = None) -> dict:
    encoded = parse.urlencode(data).encode("utf-8")
    headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/x-www-form-urlencoded"}
    if stripe_account:
        headers["Stripe-Account"] = stripe_account
    req = request.Request(f"https://api.stripe.com{path}", data=encoded, headers=headers, method="POST")
    return _json_request(req)


def _razorpay_request(key_id: str, key_secret: str, path: str, body: dict) -> dict:
    token = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    req = request.Request(
        f"https://api.razorpay.com{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Basic {token}", "Content-Type": "application/json"},
        method="POST",
    )
    return _json_request(req)


def _json_request(req: request.Request) -> dict:
    try:
        with request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        exc.read()
        raise HTTPException(status_code=502, detail="Payment provider request failed.") from exc
    except error.URLError as exc:
        raise HTTPException(status_code=502, detail="Payment provider is unavailable.") from exc


def _verify_stripe_signature(payload: bytes, signature: str | None, secret: str) -> bool:
    if not signature:
        return False
    parts: dict[str, list[str]] = {}
    for entry in signature.split(","):
        key, _, value = entry.partition("=")
        parts.setdefault(key, []).append(value)
    timestamp = parts.get("t", [""])[0]
    if not timestamp:
        return False
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
    except ValueError:
        return False
    signed_payload = f"{timestamp}.".encode("utf-8") + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, value) for value in parts.get("v1", []))


def _minor_amount(value: Any) -> int:
    return int(round(float(value or 0) * 100))


def _provider_payment_id(provider: str | None, payload: dict) -> str | None:
    if provider == "stripe":
        obj = payload.get("data", {}).get("object", {})
        return obj.get("payment_intent") or obj.get("id")
    if provider == "paytm":
        body = payload.get("body") if isinstance(payload.get("body"), dict) else payload
        return body.get("txnId") or body.get("TXNID") or body.get("transactionId")
    return _razorpay_payment_id(payload)


def _razorpay_payment_id(payload: dict) -> str | None:
    payment = payload.get("payload", {}).get("payment", {}).get("entity", {})
    return payment.get("id")


def _razorpay_payment_link_id(payload: dict) -> str | None:
    link = payload.get("payload", {}).get("payment_link", {}).get("entity", {})
    return link.get("id")


def _razorpay_notes(payload: dict) -> dict:
    payment = payload.get("payload", {}).get("payment", {}).get("entity", {})
    link = payload.get("payload", {}).get("payment_link", {}).get("entity", {})
    notes = payment.get("notes") or link.get("notes") or {}
    return notes if isinstance(notes, dict) else {}


def _refresh_real_alerts_for_payments(client: DbClient, business_id: UUID) -> None:
    failed = client.table("payments").select("*").eq("business_id", str(business_id)).in_("status", ["failed", "cancelled", "expired"]).limit(10).execute().data or []
    for payment in failed:
        client.execute_one(
            """
            insert into alerts (business_id, type, severity, title, message, source, status, dedupe_key, metadata)
            values (%(business_id)s, 'payment_failure', 'warning', 'Payment failed', %(message)s, 'payments', 'open', %(dedupe_key)s, %(metadata)s)
            on conflict (business_id, dedupe_key) do nothing
            returning id
            """,
            {
                "business_id": str(business_id),
                "message": f"Payment {payment.get('id')} is {payment.get('status')}.",
                "dedupe_key": f"payment:{payment.get('id')}",
                "metadata": Jsonb({"payment_id": payment.get("id"), "order_id": payment.get("order_id")}),
            },
        )
