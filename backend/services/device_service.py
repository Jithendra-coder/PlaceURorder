from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from config import get_settings
from database import DbClient
from schemas import (
    CounterOrderComplete,
    CounterPaymentMarkPaid,
    DeviceActivate,
    DeviceActivationCodeCreate,
    DeviceCreate,
    DeviceHeartbeat,
    DevicePairingApprove,
    DevicePairingClaim,
    DevicePairingRequestCreate,
    DeviceUpdate,
    OrderStatusUpdate,
    PaymentStatus,
)
from services import order_service, payment_service
from services.business_service import (
    DEVICE_ADMIN_ROLES,
    assert_business_access,
    get_business_by_slug,
    serialize_business_for_response,
)
from utils import timestamps_for_status

HEARTBEAT_ONLINE_SECONDS = 90
HEARTBEAT_WARNING_SECONDS = 45
DEVICE_TOKEN_PREFIX = "device_"
LEGACY_KIOSK_TOKEN_PREFIX = "kiosk_"
DEVICE_TOKEN_PREFIXES = (DEVICE_TOKEN_PREFIX, LEGACY_KIOSK_TOKEN_PREFIX)
VALID_DEVICE_TYPES = {"kiosk", "kitchen", "counter"}
DEVICE_SESSION_COOKIE_NAME = "menutap_device_session"
DEVICE_SESSION_TYPE = "device_session"
PAIRING_CODE_TTL_MINUTES = 10
PAIRING_MAX_ATTEMPTS = 5
PAIRING_LOCK_MINUTES = 15
PAIRING_REQUEST_WINDOW_MINUTES = 1
PAIRING_REQUEST_MAX_PER_WINDOW = 3
MISSING_PAIRING_MAX_ATTEMPTS = 8
MISSING_PAIRING_LOCK_MINUTES = 5
_MISSING_PAIRING_ATTEMPTS: dict[str, tuple[int, datetime]] = {}


def list_devices(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    rows = client.table("devices").select("*").eq("business_id", str(business_id)).order("created_at", desc=True).execute().data or []
    return [_serialize_device(_with_computed_status(client, row)) for row in rows]


def create_device(client: DbClient, business_id: UUID, user_id: UUID, payload: DeviceCreate) -> dict:
    business = assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    token = _generate_device_token(payload.device_type)
    device_id = payload.device_id or _next_device_id(client, business_id, payload.device_type)
    response = client.table("devices").insert(
        {
            "business_id": str(business_id),
            "device_id": device_id,
            "name": payload.name,
            "device_type": payload.device_type,
            "status": "never_connected",
            "assigned_kiosk_slug": payload.assigned_kiosk_slug or business.get("slug"),
            "location_label": payload.location_label,
            "token_hash": _hash_device_token(token),
            "token_created_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True,
            "metadata": payload.metadata,
        }
    ).execute()
    row = response.data[0]
    return _serialize_device(row, launch_token=token)


def update_device(client: DbClient, business_id: UUID, user_id: UUID, device_row_id: UUID, payload: DeviceUpdate) -> dict:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    fields = payload.model_dump(mode="json", exclude_unset=True)
    if not fields:
        return get_device_for_admin(client, business_id, user_id, device_row_id)
    if "is_active" in fields and fields["is_active"] is False:
        fields["status"] = "disabled"
        fields["disabled_at"] = datetime.now(timezone.utc).isoformat()
    elif "is_active" in fields and fields["is_active"] is True:
        fields["disabled_at"] = None
        fields["status"] = "never_connected"
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    response = client.table("devices").update(fields).eq("id", str(device_row_id)).eq("business_id", str(business_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Device not found.")
    return _serialize_device(response.data[0])


def get_device_for_admin(client: DbClient, business_id: UUID, user_id: UUID, device_row_id: UUID) -> dict:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    response = client.table("devices").select("*").eq("id", str(device_row_id)).eq("business_id", str(business_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Device not found.")
    return _serialize_device(_with_computed_status(client, response.data[0]))


def regenerate_device_link(client: DbClient, business_id: UUID, user_id: UUID, device_row_id: UUID) -> dict:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    existing = client.table("devices").select("*").eq("id", str(device_row_id)).eq("business_id", str(business_id)).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Device not found.")
    device_type = existing.data[0].get("device_type") or "kiosk"
    token = _generate_device_token(device_type)
    response = (
        client.table("devices")
        .update(
            {
                "token_hash": _hash_device_token(token),
                "token_created_at": datetime.now(timezone.utc).isoformat(),
                "is_active": True,
                "status": "never_connected",
                "disabled_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", str(device_row_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Device not found.")
    return _serialize_device(response.data[0], launch_token=token)


def delete_device(client: DbClient, business_id: UUID, user_id: UUID, device_id: UUID) -> None:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    response = client.table("devices").delete().eq("id", str(device_id)).eq("business_id", str(business_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Device not found.")


def heartbeat(client: DbClient, business_slug: str, payload: DeviceHeartbeat) -> dict:
    _record_invalid_heartbeat_alert(client, None, f"Legacy slug heartbeat rejected for {business_slug}.")
    raise HTTPException(status_code=410, detail="Device heartbeat requires a secure live device token.")


def heartbeat_for_token(client: DbClient, device_token: str, payload: DeviceHeartbeat, expected_type: str | None = None) -> dict:
    _business, device = business_for_device_token(client, device_token, expected_type=expected_type)
    return heartbeat_for_device(client, device, payload)


def heartbeat_for_device(client: DbClient, device: dict, payload: DeviceHeartbeat) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    metadata = _safe_heartbeat_metadata(payload)
    status = "issue" if payload.last_error else "online"
    response = (
        client.table("devices")
        .update(
            {
                "status": status,
                "last_seen": now,
                "app_version": payload.app_version,
                "user_agent": payload.user_agent,
                "current_route": payload.current_route,
                "last_error": payload.last_error,
                "metadata": metadata,
                "updated_at": now,
            }
        )
        .eq("id", device["id"])
        .eq("business_id", device["business_id"])
        .execute()
    )
    row = response.data[0]
    _resolve_device_offline_alert(client, UUID(str(device["business_id"])), device["device_id"])
    if payload.last_error:
        _record_device_error_alert(client, row, payload.last_error)
    return _serialize_device(row)


def resolve_device_by_token(client: DbClient, device_token: str) -> dict:
    token = (device_token or "").strip()
    if not token.startswith(DEVICE_TOKEN_PREFIXES) or len(token) < 24:
        _record_invalid_heartbeat_alert(client, None, "Malformed live device token.")
        raise HTTPException(status_code=404, detail="Live device not found.")
    response = client.table("devices").select("*").eq("token_hash", _hash_device_token(token)).limit(1).execute()
    if not response.data:
        _record_invalid_heartbeat_alert(client, None, "Unknown live device token.")
        raise HTTPException(status_code=404, detail="Live device not found.")
    return response.data[0]


def business_for_device_token(client: DbClient, device_token: str, expected_type: str | None = "kiosk") -> tuple[dict, dict]:
    device = resolve_device_by_token(client, device_token)
    return business_for_device(client, device, expected_type=expected_type)


def business_for_device(client: DbClient, device: dict, expected_type: str | None = "kiosk") -> tuple[dict, dict]:
    if expected_type and device.get("device_type") != expected_type:
        raise HTTPException(status_code=403, detail=f"This device is not a live {expected_type}.")
    if device.get("is_active") is False or device.get("status") == "disabled":
        _record_disabled_device_alert(client, device)
        raise HTTPException(status_code=403, detail="This device link is disabled.")
    business = client.table("businesses").select("*").eq("id", device["business_id"]).limit(1).execute().data
    if not business:
        raise HTTPException(status_code=404, detail="Device business not found.")
    return business[0], device


def live_device_context(client: DbClient, device_token: str, expected_type: str | None = None) -> dict:
    business, device = business_for_device_token(client, device_token, expected_type=expected_type)
    return live_device_context_from_device(client, business, device, clean=False, launch_token=device_token)


def live_device_session_context(client: DbClient, device_session_token: str | None, expected_type: str | None = None) -> dict:
    business, device = business_for_device_session(client, device_session_token, expected_type=expected_type)
    return live_device_context_from_device(client, business, device, clean=True)


def live_device_context_from_device(client: DbClient, business: dict, device: dict, clean: bool = True, launch_token: str | None = None) -> dict:
    return {
        "business": serialize_business_for_response(business),
        "device": _serialize_device(_with_computed_status(client, device)),
        "launch_path": _clean_launch_path(device.get("device_type") or "kiosk") if clean else _launch_path(device.get("device_type") or "kiosk", launch_token or ""),
    }


def exchange_device_token_for_session(client: DbClient, device_token: str, expected_type: str | None = None) -> tuple[dict, dict, dict]:
    business, device = business_for_device_token(client, device_token, expected_type=expected_type)
    return business, device, live_device_context_from_device(client, business, device, clean=True)


def create_device_session_token(device: dict) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=max(1, int(settings.device_session_days or 30)))
    payload = {
        "type": DEVICE_SESSION_TYPE,
        "sub": str(device["id"]),
        "business_id": str(device["business_id"]),
        "device_type": device.get("device_type") or "kiosk",
        "device_id": device.get("device_id"),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_device_session_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Device session required.")
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid device session.") from exc
    if payload.get("type") != DEVICE_SESSION_TYPE or not payload.get("sub") or not payload.get("business_id"):
        raise HTTPException(status_code=401, detail="Invalid device session.")
    return payload


def business_for_device_session(client: DbClient, device_session_token: str | None, expected_type: str | None = None) -> tuple[dict, dict]:
    payload = decode_device_session_token(device_session_token)
    response = (
        client.table("devices")
        .select("*")
        .eq("id", str(payload["sub"]))
        .eq("business_id", str(payload["business_id"]))
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Live device session not found.")
    device = response.data[0]
    return business_for_device(client, device, expected_type=expected_type)


def list_pairing_requests(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    _expire_pairing_requests(client, business_id)
    rows = (
        client.table("device_pairing_requests")
        .select("*")
        .eq("business_id", str(business_id))
        .order("requested_at", desc=True)
        .limit(60)
        .execute()
        .data
        or []
    )
    return [_serialize_pairing_request(row) for row in rows]


def request_device_pairing(client: DbClient, payload: DevicePairingRequestCreate) -> dict:
    business = get_business_by_slug(client, payload.business_slug.strip())
    _assert_pairing_request_not_throttled(client, UUID(str(business["id"])), payload.device_type)
    code = _generate_pairing_code(client)
    polling_secret = _generate_pairing_secret()
    now = datetime.now(timezone.utc)
    row = (
        client.table("device_pairing_requests")
        .insert(
            {
                "business_id": business["id"],
                "pairing_code": code,
                "device_type": payload.device_type,
                "device_name": payload.device_name or _default_device_name(payload.device_type),
                "location_label": payload.location_label,
                "source": "device_request",
                "status": "pending",
                "requested_at": now.isoformat(),
                "expires_at": (now + timedelta(minutes=PAIRING_CODE_TTL_MINUTES)).isoformat(),
                "polling_secret_hash": _hash_pairing_secret(polling_secret),
                "attempt_count": 0,
                "app_version": payload.app_version,
                "user_agent": payload.user_agent,
                "metadata": _safe_pairing_metadata(payload.metadata),
            }
        )
        .execute()
        .data[0]
    )
    return _serialize_pairing_request(row, include_business=True, business=business, public=True) | {"polling_secret": polling_secret}


def create_activation_code(client: DbClient, business_id: UUID, user_id: UUID, payload: DeviceActivationCodeCreate) -> dict:
    business = assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    code = _generate_pairing_code(client)
    now = datetime.now(timezone.utc)
    row = (
        client.table("device_pairing_requests")
        .insert(
            {
                "business_id": str(business_id),
                "pairing_code": code,
                "device_type": payload.device_type,
                "device_name": payload.device_name or _default_device_name(payload.device_type),
                "location_label": payload.location_label,
                "source": "admin_activation",
                "status": "approved",
                "requested_at": now.isoformat(),
                "expires_at": (now + timedelta(minutes=payload.expires_in_minutes)).isoformat(),
                "approved_at": now.isoformat(),
                "approved_by": str(user_id),
                "attempt_count": 0,
                "metadata": _safe_pairing_metadata(payload.metadata),
            }
        )
        .execute()
        .data[0]
    )
    return _serialize_pairing_request(row, include_business=True, business=business)


def get_pairing_status(client: DbClient, pairing_code: str, polling_secret: str | None = None) -> dict:
    row = _pairing_by_code(client, pairing_code)
    row = _expire_pairing_request_if_needed(client, row)
    _ensure_pairing_not_locked(row)
    _require_pairing_polling_secret(client, row, polling_secret)
    business = None
    include_business = row.get("status") in {"approved", "claimed"} and row.get("source") == "device_request"
    if include_business:
        business_response = client.table("businesses").select("*").eq("id", row["business_id"]).limit(1).execute().data
        business = business_response[0] if business_response else None
    return _serialize_pairing_request(row, include_business=include_business, business=business, public=True)


def approve_pairing_request(
    client: DbClient,
    business_id: UUID,
    user_id: UUID,
    request_id: UUID,
    payload: DevicePairingApprove,
) -> dict:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    row = _pairing_by_id(client, business_id, request_id)
    row = _expire_pairing_request_if_needed(client, row)
    if row.get("source") != "device_request":
        raise HTTPException(status_code=409, detail="Activation codes are already approved.")
    if row.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Pairing request is {row.get('status')}.")
    updates = {
        "status": "approved",
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approved_by": str(user_id),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.device_name:
        updates["device_name"] = payload.device_name
    if payload.location_label is not None:
        updates["location_label"] = payload.location_label
    response = (
        client.table("device_pairing_requests")
        .update(updates)
        .eq("id", str(request_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    return _serialize_pairing_request(response.data[0])


def reject_pairing_request(client: DbClient, business_id: UUID, user_id: UUID, request_id: UUID) -> dict:
    assert_business_access(client, business_id, user_id, DEVICE_ADMIN_ROLES)
    row = _pairing_by_id(client, business_id, request_id)
    if row.get("status") not in {"pending", "approved"}:
        raise HTTPException(status_code=409, detail=f"Pairing request is {row.get('status')}.")
    response = (
        client.table("device_pairing_requests")
        .update(
            {
                "status": "rejected",
                "rejected_at": datetime.now(timezone.utc).isoformat(),
                "rejected_by": str(user_id),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", str(request_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    return _serialize_pairing_request(response.data[0])


def claim_pairing_request(client: DbClient, pairing_code: str, payload: DevicePairingClaim) -> dict:
    return _claim_pairing_code(
        client,
        pairing_code,
        polling_secret=payload.polling_secret,
        device_name=None,
        location_label=None,
        app_version=payload.app_version,
        user_agent=payload.user_agent,
        metadata=payload.metadata,
    )


def activate_device(client: DbClient, payload: DeviceActivate) -> dict:
    return _claim_pairing_code(
        client,
        payload.activation_code,
        polling_secret=None,
        device_name=payload.device_name,
        location_label=payload.location_label,
        app_version=payload.app_version,
        user_agent=payload.user_agent,
        metadata=payload.metadata,
    )


def list_counter_payments_for_device(client: DbClient, device_token: str) -> dict:
    business, device = business_for_device_token(client, device_token, expected_type="counter")
    return _list_counter_payments_for_device(client, business, device)


def list_counter_payments_for_device_session(client: DbClient, device_session_token: str | None) -> dict:
    business, device = business_for_device_session(client, device_session_token, expected_type="counter")
    return _list_counter_payments_for_device(client, business, device)


def _list_counter_payments_for_device(client: DbClient, business: dict, device: dict) -> dict:
    payments = (
        client.table("payments")
        .select("*")
        .eq("business_id", business["id"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
        or []
    )
    for payment in payments:
        if payment.get("order_id"):
            payment["order"] = payment_service._get_order_snapshot(client, UUID(payment["order_id"]), UUID(str(business["id"])))
    return {
        "business": serialize_business_for_response(business),
        "device": _serialize_device(_with_computed_status(client, device)),
        "payments": payments,
    }


def mark_counter_payment_paid_for_device(
    client: DbClient,
    device_token: str,
    payment_id: UUID,
    payload: CounterPaymentMarkPaid,
) -> dict:
    business, device = business_for_device_token(client, device_token, expected_type="counter")
    return _mark_counter_payment_paid_for_device(client, business, device, payment_id, payload)


def mark_counter_payment_paid_for_device_session(
    client: DbClient,
    device_session_token: str | None,
    payment_id: UUID,
    payload: CounterPaymentMarkPaid,
) -> dict:
    business, device = business_for_device_session(client, device_session_token, expected_type="counter")
    existing = client.execute_one("select status from payments where id=%(payment_id)s and business_id=%(business_id)s", {"business_id": str(business["id"]), "payment_id": str(payment_id)})
    claim = client.execute_one("select id from counter_payment_claims where business_id=%(business_id)s and payment_id=%(payment_id)s and device_id=%(device_id)s and status='claimed' and expires_at > now()", {"business_id": str(business["id"]), "payment_id": str(payment_id), "device_id": str(device["id"])})
    if existing and existing.get("status") != PaymentStatus.PAID.value and not claim:
        raise HTTPException(status_code=409, detail="Claim this payment before collecting it.")
    return _mark_counter_payment_paid_for_device(client, business, device, payment_id, payload)


def _mark_counter_payment_paid_for_device(
    client: DbClient,
    business: dict,
    device: dict,
    payment_id: UUID,
    payload: CounterPaymentMarkPaid,
) -> dict:
    business_id = UUID(str(business["id"]))
    client.execute_one("select pg_advisory_xact_lock(hashtextextended(%(key)s, 0)) as locked", {"key": f"counter-payment:{payment_id}"})
    payment = payment_service._get_payment(client, payment_id, business_id)
    if payment.get("provider") != "pay_at_counter":
        raise HTTPException(status_code=409, detail="Only counter payments can be marked paid here.")
    claim = client.execute_one("select id from counter_payment_claims where business_id=%(business_id)s and payment_id=%(payment_id)s and device_id=%(device_id)s and status='claimed' and expires_at > now()", {"business_id": str(business_id), "payment_id": str(payment_id), "device_id": str(device["id"])})
    if payment.get("status") == PaymentStatus.PAID.value:
        return payment | {"order": payment_service._get_order_snapshot(client, UUID(payment["order_id"]), business_id)}
    collected_amount = payload.amount if payload.amount is not None else payment.get("amount")
    if (payload.method or "counter").lower() in {"cash", "counter"} and float(collected_amount or 0) < float(payment.get("amount") or 0):
        raise HTTPException(status_code=422, detail="Amount received is less than the order total.")
    payment_service._set_payment_status(
        client,
        payment_id,
        business_id,
        PaymentStatus.PAID.value,
        {"marked_by_device": device.get("id"), "collection_method": payload.method or "counter"},
    )
    client.table("payments").update(
        {
            "collected_by": None,
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "collected_amount": collected_amount,
            "collection_method": payload.method or "counter",
        }
    ).eq("id", str(payment_id)).eq("business_id", str(business_id)).execute()
    client.table("orders").update({"payment_status": PaymentStatus.PAID.value}).eq("id", payment["order_id"]).eq("business_id", str(business_id)).execute()
    if claim:
        client.execute_command("update counter_payment_claims set status='completed',released_at=now() where id=%(claim_id)s", {"claim_id": str(claim["id"])})
    _insert_device_audit(client, business_id, device, "counter_payment_marked_paid", "payments", payment_id, {"order_id": payment.get("order_id")})
    refreshed = payment_service._get_payment(client, payment_id, business_id)
    return refreshed | {"change_due": round(max(float(collected_amount or 0) - float(payment.get("amount") or 0), 0), 2), "order": payment_service._get_order_snapshot(client, UUID(payment["order_id"]), business_id)}


def complete_counter_order_for_device(
    client: DbClient,
    device_token: str,
    order_id: UUID,
    payload: CounterOrderComplete,
) -> dict:
    business, device = business_for_device_token(client, device_token, expected_type="counter")
    return _complete_counter_order_for_device(client, business, device, order_id, payload)


def complete_counter_order_for_device_session(
    client: DbClient,
    device_session_token: str | None,
    order_id: UUID,
    payload: CounterOrderComplete,
) -> dict:
    business, device = business_for_device_session(client, device_session_token, expected_type="counter")
    return _complete_counter_order_for_device(client, business, device, order_id, payload)


def _complete_counter_order_for_device(
    client: DbClient,
    business: dict,
    device: dict,
    order_id: UUID,
    payload: CounterOrderComplete,
) -> dict:
    business_id = UUID(str(business["id"]))
    order = payment_service._get_order_snapshot(client, order_id, business_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    payment_status = order.get("payment_status")
    if payment_status not in {PaymentStatus.PAID.value, PaymentStatus.PAY_AT_COUNTER_PENDING.value}:
        raise HTTPException(status_code=409, detail="Only paid or counter-pending orders can be handed over.")
    if payment_status == PaymentStatus.PAY_AT_COUNTER_PENDING.value:
        raise HTTPException(status_code=409, detail="Collect payment before handover.")
    previous = order.get("status")
    if previous != "ready":
        raise HTTPException(status_code=409, detail="Only kitchen-ready orders can be handed over.")
    response = (
        client.table("orders")
        .update({"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(order_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    _insert_kitchen_event_for_device(client, business_id, order_id, previous, "completed", device)
    _insert_device_audit(client, business_id, device, "counter_order_handed_over", "orders", order_id, {"payment_status": payment_status})
    return payment_service._get_order_snapshot(client, order_id, business_id)


def list_kitchen_orders_for_device(
    client: DbClient,
    device_token: str,
    status_filter: str | None = "active",
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict:
    business, device = business_for_device_token(client, device_token, expected_type="kitchen")
    return _list_kitchen_orders_for_device(client, business, device, status_filter=status_filter, start=start, end=end)


def list_kitchen_orders_for_device_session(
    client: DbClient,
    device_session_token: str | None,
    status_filter: str | None = "active",
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict:
    business, device = business_for_device_session(client, device_session_token, expected_type="kitchen")
    return _list_kitchen_orders_for_device(client, business, device, status_filter=status_filter, start=start, end=end)


def _list_kitchen_orders_for_device(
    client: DbClient,
    business: dict,
    device: dict,
    status_filter: str | None = "active",
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict:
    orders = order_service.list_orders(client, UUID(str(business["id"])), status_filter=status_filter, start=start, end=end)
    return {
        "business": serialize_business_for_response(business),
        "device": _serialize_device(_with_computed_status(client, device)),
        "orders": orders,
    }


def update_kitchen_order_status_for_device(
    client: DbClient,
    device_token: str,
    order_id: UUID,
    payload: OrderStatusUpdate,
) -> dict:
    business, device = business_for_device_token(client, device_token, expected_type="kitchen")
    return _update_kitchen_order_status_for_device(client, business, device, order_id, payload)


def update_kitchen_order_status_for_device_session(
    client: DbClient,
    device_session_token: str | None,
    order_id: UUID,
    payload: OrderStatusUpdate,
) -> dict:
    business, device = business_for_device_session(client, device_session_token, expected_type="kitchen")
    return _update_kitchen_order_status_for_device(client, business, device, order_id, payload)


def _update_kitchen_order_status_for_device(
    client: DbClient,
    business: dict,
    device: dict,
    order_id: UUID,
    payload: OrderStatusUpdate,
) -> dict:
    business_id = UUID(str(business["id"]))
    order = order_service.get_order(client, order_id, business_id)
    current_status = order["status"]
    next_status = payload.status.value
    if next_status not in order_service.VALID_TRANSITIONS.get(current_status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move order from {current_status} to {next_status}.")
    if next_status == "cancelled" and not (payload.cancel_reason or "").strip():
        raise HTTPException(status_code=400, detail="Cancellation reason is required.")
    update_payload = {"status": next_status}
    update_payload.update(timestamps_for_status(next_status))
    if next_status == "cancelled":
        update_payload["cancel_reason"] = payload.cancel_reason.strip()
    response = (
        client.table("orders")
        .update(update_payload)
        .eq("id", str(order_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    _insert_kitchen_event_for_device(client, business_id, order_id, current_status, next_status, device)
    return order_service.get_order(client, order_id, business_id)


def refresh_offline_device_alerts(client: DbClient, business_id: UUID) -> None:
    devices = client.table("devices").select("*").eq("business_id", str(business_id)).execute().data or []
    for device in devices:
        computed = _with_computed_status(client, device)
        if computed["status"] == "offline":
            client.execute_one(
                """
                insert into alerts (business_id, type, severity, title, message, source, status, dedupe_key, metadata)
                values (%(business_id)s, 'device_offline', 'critical', 'Device offline', %(message)s, 'devices', 'open', %(dedupe_key)s, %(metadata)s)
                on conflict (business_id, dedupe_key) do nothing
                returning id
                """,
                {
                    "business_id": str(business_id),
                    "message": f"{computed.get('name')} has not sent a recent heartbeat.",
                    "dedupe_key": f"device:{computed.get('device_id')}:offline",
                    "metadata": Jsonb({"device_id": computed.get("device_id"), "device_row_id": computed.get("id")}),
                },
            )


def _with_computed_status(client: DbClient, device: dict) -> dict:
    status = device.get("status") or "never_connected"
    if device.get("is_active") is False:
        status = "disabled"
    elif status not in {"maintenance", "issue", "disabled"}:
        last_seen = _parse_datetime(device.get("last_seen"))
        if not last_seen:
            status = "never_connected"
        else:
            seconds = (datetime.now(timezone.utc) - last_seen).total_seconds()
            if seconds <= HEARTBEAT_WARNING_SECONDS:
                status = "online"
            elif seconds <= HEARTBEAT_ONLINE_SECONDS:
                status = "warning"
            else:
                status = "offline"
    if status != device.get("status"):
        client.table("devices").update({"status": status}).eq("id", device["id"]).eq("business_id", device["business_id"]).execute()
    return {**device, "status": status}


def _claim_pairing_code(
    client: DbClient,
    pairing_code: str,
    *,
    polling_secret: str | None,
    device_name: str | None,
    location_label: str | None,
    app_version: str | None,
    user_agent: str | None,
    metadata: dict,
) -> dict:
    code = _normalize_pairing_code(pairing_code)
    row = client.execute_one(
        "select * from device_pairing_requests where pairing_code = %(code)s for update",
        {"code": code},
    )
    if not row:
        _record_missing_pairing_attempt(code)
        raise HTTPException(status_code=404, detail="Pairing code not found.")
    row = _expire_pairing_request_if_needed(client, row)
    _ensure_pairing_not_locked(row)
    _require_pairing_polling_secret(client, row, polling_secret)
    if row.get("status") == "pending":
        raise HTTPException(status_code=409, detail="Pairing request is still waiting for admin approval.")
    if row.get("status") in {"claimed", "rejected", "expired"}:
        raise HTTPException(status_code=409, detail=f"Pairing code is {row.get('status')}.")
    if row.get("status") != "approved":
        raise HTTPException(status_code=409, detail="Pairing code cannot be claimed.")

    business = client.table("businesses").select("*").eq("id", row["business_id"]).limit(1).execute().data
    if not business:
        raise HTTPException(status_code=404, detail="Pairing business not found.")
    business_row = business[0]
    device_type = row.get("device_type") or "kiosk"
    token = _generate_device_token(device_type)
    now = datetime.now(timezone.utc).isoformat()
    request_metadata = row.get("metadata") or {}
    device_metadata = {
        **request_metadata,
        **_safe_pairing_metadata(metadata),
        "pairing_request_id": row["id"],
        "pairing_source": row.get("source"),
    }
    response = (
        client.table("devices")
        .insert(
            {
                "business_id": row["business_id"],
                "device_id": _next_device_id(client, UUID(str(row["business_id"])), device_type),
                "name": device_name or row.get("device_name") or _default_device_name(device_type),
                "device_type": device_type,
                "status": "never_connected",
                "assigned_kiosk_slug": business_row.get("slug"),
                "location_label": location_label if location_label is not None else row.get("location_label"),
                "token_hash": _hash_device_token(token),
                "token_created_at": now,
                "is_active": True,
                "app_version": app_version or row.get("app_version"),
                "user_agent": user_agent or row.get("user_agent"),
                "metadata": device_metadata,
            }
        )
        .execute()
    )
    device = response.data[0]
    claimed = (
        client.table("device_pairing_requests")
        .update(
            {
                "status": "claimed",
                "claimed_at": now,
                "device_id": device["id"],
                "updated_at": now,
            }
        )
        .eq("id", row["id"])
        .execute()
        .data[0]
    )
    serialized_device = _serialize_device(device)
    return {
        "pairing": _serialize_pairing_request(claimed, include_business=True, business=business_row),
        "device": serialized_device,
        "session": {
            "device_type": device_type,
            "launch_path": _clean_launch_path(device_type),
            "launch_url": f"{get_settings().frontend_base_url.rstrip('/')}{_clean_launch_path(device_type)}",
        },
    }


def _serialize_device(device: dict, launch_token: str | None = None) -> dict:
    safe = dict(device)
    safe.pop("token_hash", None)
    if safe.get("name") and not safe.get("display_name"):
        safe["display_name"] = safe["name"]
    safe["has_launch_token"] = bool(device.get("token_hash"))
    if launch_token:
        safe["launch_token"] = launch_token
        safe["launch_path"] = _launch_path(safe.get("device_type") or "kiosk", launch_token)
        safe["launch_url"] = f"{get_settings().frontend_base_url.rstrip('/')}{safe['launch_path']}"
    return safe


def _serialize_pairing_request(row: dict, include_business: bool = False, business: dict | None = None, public: bool = False) -> dict:
    safe = dict(row)
    safe["pairing_code"] = _format_pairing_code(safe.get("pairing_code") or "")
    safe.pop("polling_secret_hash", None)
    if public:
        for key in ("business_id", "approved_by", "rejected_by", "metadata", "user_agent", "app_version"):
            safe.pop(key, None)
    if include_business and business:
        safe["business"] = {
            "id": business.get("id"),
            "name": business.get("name"),
            "slug": business.get("slug"),
            "type": business.get("type"),
        }
    return safe


def _next_device_id(client: DbClient, business_id: UUID, device_type: str) -> str:
    prefix = device_type if device_type in VALID_DEVICE_TYPES else "device"
    rows = client.table("devices").select("device_id").eq("business_id", str(business_id)).execute().data or []
    used = {row["device_id"] for row in rows}
    for index in range(1, 1000):
        candidate = f"{prefix}-{index}"
        if candidate not in used:
            return candidate
    return f"{prefix}-{uuid4()}"


def _generate_device_token(device_type: str | None = None) -> str:
    prefix = DEVICE_TOKEN_PREFIX
    if device_type in VALID_DEVICE_TYPES:
        prefix = f"{DEVICE_TOKEN_PREFIX}{device_type}_"
    return f"{prefix}{secrets.token_urlsafe(32).replace('-', '').replace('_', '')}"


def _hash_device_token(token: str) -> str:
    secret = get_settings().jwt_secret.encode("utf-8")
    return hmac.new(secret, token.encode("utf-8"), hashlib.sha256).hexdigest()


def _generate_pairing_secret() -> str:
    return secrets.token_urlsafe(32)


def _hash_pairing_secret(secret: str) -> str:
    app_secret = get_settings().jwt_secret.encode("utf-8")
    value = f"pairing:{secret}".encode("utf-8")
    return hmac.new(app_secret, value, hashlib.sha256).hexdigest()


def _pairing_secret_matches(row: dict, polling_secret: str | None) -> bool:
    expected = row.get("polling_secret_hash")
    if not expected or not polling_secret:
        return False
    return hmac.compare_digest(str(expected), _hash_pairing_secret(polling_secret))


def _safe_heartbeat_metadata(payload: DeviceHeartbeat) -> dict:
    metadata = payload.metadata or {}
    safe = {
        key: value
        for key, value in metadata.items()
        if key in {"path", "orientation", "active_page", "screen", "viewport", "device_memory", "language"}
    }
    if payload.current_route:
        safe["current_route"] = payload.current_route
    return safe


def _safe_pairing_metadata(metadata: dict | None) -> dict:
    metadata = metadata or {}
    safe = {
        key: value
        for key, value in metadata.items()
        if key in {"path", "orientation", "active_page", "screen", "viewport", "device_memory", "language", "platform"}
    }
    return safe


def _launch_path(device_type: str, token: str) -> str:
    if device_type == "counter":
        return f"/counter/live/{token}"
    if device_type == "kitchen":
        return f"/kitchen/live/{token}"
    return f"/kiosk/live/{token}"


def _clean_launch_path(device_type: str) -> str:
    if device_type == "counter":
        return "/counter/live"
    if device_type == "kitchen":
        return "/kitchen/live"
    return "/kiosk/live"


def _default_device_name(device_type: str) -> str:
    labels = {"kiosk": "Kiosk terminal", "counter": "Counter terminal", "kitchen": "Kitchen display"}
    return labels.get(device_type, "PlaceURorder device")


def _normalize_pairing_code(code: str) -> str:
    return "".join(character for character in (code or "").upper() if character.isalnum())


def _format_pairing_code(code: str) -> str:
    normalized = _normalize_pairing_code(code)
    if len(normalized) == 6:
        return f"{normalized[:3]}-{normalized[3:]}"
    return normalized


def _generate_pairing_code(client: DbClient) -> str:
    for _ in range(20):
        code = f"{secrets.randbelow(1_000_000):06d}"
        existing = client.table("device_pairing_requests").select("id").eq("pairing_code", code).limit(1).execute().data
        if not existing:
            return code
    raise HTTPException(status_code=503, detail="Could not allocate a pairing code. Try again.")


def _assert_pairing_request_not_throttled(client: DbClient, business_id: UUID, device_type: str) -> None:
    since = (datetime.now(timezone.utc) - timedelta(minutes=PAIRING_REQUEST_WINDOW_MINUTES)).isoformat()
    rows = (
        client.table("device_pairing_requests")
        .select("id")
        .eq("business_id", str(business_id))
        .eq("source", "device_request")
        .eq("device_type", device_type)
        .gte("requested_at", since)
        .execute()
        .data
        or []
    )
    if len(rows) >= PAIRING_REQUEST_MAX_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Too many pairing requests. Wait a minute and try again.")


def _ensure_pairing_not_locked(row: dict) -> None:
    locked_until = _parse_datetime(row.get("locked_until"))
    if locked_until and locked_until > datetime.now(timezone.utc):
        raise HTTPException(status_code=429, detail="Pairing code is temporarily locked after too many attempts.")


def _require_pairing_polling_secret(client: DbClient, row: dict, polling_secret: str | None) -> None:
    if row.get("source") != "device_request":
        return
    if _pairing_secret_matches(row, polling_secret):
        return
    _record_pairing_failure(client, row, "Invalid pairing polling secret.")


def _record_pairing_failure(client: DbClient, row: dict, detail: str) -> None:
    attempts = int(row.get("attempt_count") or 0) + 1
    now = datetime.now(timezone.utc)
    updates = {
        "attempt_count": attempts,
        "last_attempt_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    status_code = 403
    if attempts >= PAIRING_MAX_ATTEMPTS:
        updates["locked_until"] = (now + timedelta(minutes=PAIRING_LOCK_MINUTES)).isoformat()
        status_code = 429
        detail = "Pairing code is temporarily locked after too many attempts."
    client.table("device_pairing_requests").update(updates).eq("id", row["id"]).execute()
    raise HTTPException(status_code=status_code, detail=detail)


def _record_missing_pairing_attempt(code: str) -> None:
    now = datetime.now(timezone.utc)
    key = _normalize_pairing_code(code) or "blank"
    attempts, locked_until = _MISSING_PAIRING_ATTEMPTS.get(key, (0, datetime.fromtimestamp(0, tz=timezone.utc)))
    if locked_until > now:
        raise HTTPException(status_code=429, detail="Too many pairing attempts. Wait and try again.")
    attempts += 1
    next_locked_until = locked_until
    if attempts >= MISSING_PAIRING_MAX_ATTEMPTS:
        attempts = 0
        next_locked_until = now + timedelta(minutes=MISSING_PAIRING_LOCK_MINUTES)
    _MISSING_PAIRING_ATTEMPTS[key] = (attempts, next_locked_until)
    if next_locked_until > now:
        raise HTTPException(status_code=429, detail="Too many pairing attempts. Wait and try again.")


def _pairing_by_code(client: DbClient, pairing_code: str) -> dict:
    code = _normalize_pairing_code(pairing_code)
    response = client.table("device_pairing_requests").select("*").eq("pairing_code", code).limit(1).execute()
    if not response.data:
        _record_missing_pairing_attempt(code)
        raise HTTPException(status_code=404, detail="Pairing code not found.")
    return response.data[0]


def _pairing_by_id(client: DbClient, business_id: UUID, request_id: UUID) -> dict:
    response = (
        client.table("device_pairing_requests")
        .select("*")
        .eq("id", str(request_id))
        .eq("business_id", str(business_id))
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Pairing request not found.")
    return response.data[0]


def _expire_pairing_requests(client: DbClient, business_id: UUID | None = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    query = (
        client.table("device_pairing_requests")
        .update({"status": "expired", "updated_at": now})
        .in_("status", ["pending", "approved"])
        .lte("expires_at", now)
    )
    if business_id:
        query = query.eq("business_id", str(business_id))
    query.execute()


def _expire_pairing_request_if_needed(client: DbClient, row: dict) -> dict:
    if row.get("status") not in {"pending", "approved"}:
        return row
    expires_at = _parse_datetime(row.get("expires_at"))
    if expires_at and expires_at <= datetime.now(timezone.utc):
        response = (
            client.table("device_pairing_requests")
            .update({"status": "expired", "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", row["id"])
            .execute()
        )
        if response.data:
            return response.data[0]
    return row


def _insert_kitchen_event_for_device(
    client: DbClient,
    business_id: UUID,
    order_id: UUID,
    old_status: str | None,
    new_status: str,
    device: dict,
) -> None:
    client.table("kitchen_events").insert(
        {
            "business_id": str(business_id),
            "order_id": str(order_id),
            "old_status": old_status,
            "new_status": new_status,
            "changed_by": None,
        }
    ).execute()
    _insert_device_audit(client, business_id, device, "device_order_status_changed", "orders", order_id, {"old_status": old_status, "new_status": new_status})


def _insert_device_audit(
    client: DbClient,
    business_id: UUID,
    device: dict,
    action: str,
    entity: str,
    entity_id: UUID,
    metadata: dict,
) -> None:
    client.table("audit_logs").insert(
        {
            "business_id": str(business_id),
            "user_id": None,
            "action": action,
            "entity": entity,
            "entity_id": str(entity_id),
            "metadata": {"device_id": device.get("id"), "device_key": device.get("device_id"), **metadata},
        }
    ).execute()


def _record_invalid_heartbeat_alert(client: DbClient, business_id: UUID | None, message: str) -> None:
    if not business_id:
        return
    client.execute_one(
        """
        insert into alerts (business_id, type, severity, title, message, source, status, dedupe_key, metadata)
        values (%(business_id)s, 'invalid_device_heartbeat', 'warning', 'Invalid device heartbeat', %(message)s, 'devices', 'open', %(dedupe_key)s, %(metadata)s)
        on conflict (business_id, dedupe_key) do update
        set message = excluded.message,
            updated_at = now()
        returning id
        """,
        {
            "business_id": str(business_id),
            "message": message,
            "dedupe_key": "device:invalid-heartbeat",
            "metadata": Jsonb({"message": message}),
        },
    )


def _record_disabled_device_alert(client: DbClient, device: dict) -> None:
    client.execute_one(
        """
        insert into alerts (business_id, type, severity, title, message, source, status, dedupe_key, metadata)
        values (%(business_id)s, 'disabled_device_heartbeat', 'warning', 'Disabled device link used', %(message)s, 'devices', 'open', %(dedupe_key)s, %(metadata)s)
        on conflict (business_id, dedupe_key) do update
        set message = excluded.message,
            updated_at = now()
        returning id
        """,
        {
            "business_id": device["business_id"],
            "message": f"{device.get('name')} attempted to use a disabled launch link.",
            "dedupe_key": f"device:{device.get('device_id')}:disabled-heartbeat",
            "metadata": Jsonb({"device_id": device.get("device_id"), "device_row_id": device.get("id")}),
        },
    )


def _record_device_error_alert(client: DbClient, device: dict, error: str) -> None:
    client.execute_one(
        """
        insert into alerts (business_id, type, severity, title, message, source, status, dedupe_key, metadata)
        values (%(business_id)s, 'device_error', 'warning', 'Device error reported', %(message)s, 'devices', 'open', %(dedupe_key)s, %(metadata)s)
        on conflict (business_id, dedupe_key) do update
        set message = excluded.message,
            metadata = excluded.metadata,
            updated_at = now()
        returning id
        """,
        {
            "business_id": device["business_id"],
            "message": f"{device.get('name')} reported: {error[:180]}",
            "dedupe_key": f"device:{device.get('device_id')}:error",
            "metadata": Jsonb({"device_id": device.get("device_id"), "device_row_id": device.get("id"), "error": error}),
        },
    )


def _resolve_device_offline_alert(client: DbClient, business_id: UUID, device_id: str) -> None:
    client.execute_one(
        """
        update alerts
        set status = 'resolved',
            resolved_at = now(),
            updated_at = now()
        where business_id = %(business_id)s
          and dedupe_key = %(dedupe_key)s
          and status <> 'resolved'
        returning id
        """,
        {"business_id": str(business_id), "dedupe_key": f"device:{device_id}:offline"},
    )


def _parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
