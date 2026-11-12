from __future__ import annotations

import hashlib
import hmac
import base64
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from database import DbClient
from schemas import ApiKeyCreate, CustomRoleAssignment, CustomRoleInput, IntegrationInput, InvitationAccept, PaymentLocationAssignmentInput, SecurityPolicyInput, WebhookCreate
from services.administration_service import _audit
from services.business_service import FULL_ACCESS_ROLES, assert_business_access

PAYMENT_METHODS = {"card", "upi", "wallet", "cash", "pay_at_counter"}
PERMISSIONS = {"home.read", "insights.read", "operations.read", "kiosk.manage", "administration.manage", "payments.manage", "team.manage", "security.manage"}


def _seal_secret(secret: str) -> str:
    from config import get_settings
    key = hashlib.sha256(get_settings().jwt_secret.encode()).digest()
    return base64.urlsafe_b64encode(bytes(value ^ key[index % len(key)] for index, value in enumerate(secret.encode()))).decode()


def unseal_webhook_secret(ciphertext: str) -> str:
    from config import get_settings
    key = hashlib.sha256(get_settings().jwt_secret.encode()).digest()
    raw = base64.urlsafe_b64decode(ciphertext.encode())
    return bytes(value ^ key[index % len(key)] for index, value in enumerate(raw)).decode()


def _admin(client: DbClient, business_id: UUID, user_id: UUID) -> None:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)


def payment_assignments(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("""select a.*, l.name as location_name from payment_location_assignments a join business_locations l on l.id=a.location_id where a.business_id=%(business_id)s order by l.name""", {"business_id": str(business_id)})


def save_payment_assignment(client: DbClient, business_id: UUID, user_id: UUID, location_id: UUID, payload: PaymentLocationAssignmentInput) -> dict:
    _admin(client, business_id, user_id)
    location = client.execute_one("select id from business_locations where id=%(id)s and business_id=%(business_id)s", {"id": str(location_id), "business_id": str(business_id)})
    account = client.execute_one("select provider, is_enabled, connection_status from business_payment_accounts where business_id=%(business_id)s and provider=%(provider)s", {"business_id": str(business_id), "provider": payload.provider})
    if not location or not account or not account.get("is_enabled") or account.get("connection_status") not in {"active", "connected"}:
        raise HTTPException(status_code=409, detail="Select a connected provider for this location.")
    methods = set(payload.enabled_methods)
    if not methods.issubset(PAYMENT_METHODS):
        raise HTTPException(status_code=422, detail="One or more payment methods are unsupported.")
    if payload.fallback_provider:
        fallback = client.execute_one("select provider from business_payment_accounts where business_id=%(business_id)s and provider=%(provider)s and is_enabled=true", {"business_id": str(business_id), "provider": payload.fallback_provider})
        if not fallback or payload.fallback_provider == payload.provider:
            raise HTTPException(status_code=422, detail="Fallback provider must be a different enabled provider.")
    row = client.execute_one("""insert into payment_location_assignments (business_id,location_id,provider,enabled_methods,is_override,fallback_provider,terminal_reference,updated_by) values (%(business_id)s,%(location_id)s,%(provider)s,%(methods)s,%(override)s,%(fallback)s,%(terminal)s,%(user_id)s) on conflict (business_id,location_id) do update set provider=excluded.provider,enabled_methods=excluded.enabled_methods,is_override=excluded.is_override,fallback_provider=excluded.fallback_provider,terminal_reference=excluded.terminal_reference,updated_by=excluded.updated_by,updated_at=now() returning *""", {"business_id": str(business_id), "location_id": str(location_id), "provider": payload.provider, "methods": Jsonb(list(methods)), "override": payload.is_override, "fallback": payload.fallback_provider, "terminal": payload.terminal_reference, "user_id": str(user_id)})
    _audit(client, business_id, user_id, "payment_location_assignment_updated", "payment_location_assignment", row["id"], {"location_id": str(location_id), "provider": payload.provider})
    from services.webhook_delivery_service import enqueue_event
    enqueue_event(client, business_id, "payment.connection_changed", {"location_id": str(location_id), "provider": payload.provider}, location_id)
    return row


def invitations(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select id,email,role,location_ids,expires_at,status,created_at,accepted_at,revoked_at from business_invitations where business_id=%(business_id)s order by created_at desc", {"business_id": str(business_id)})


def create_invitation(client: DbClient, business_id: UUID, user_id: UUID, email: str, role: str, location_ids: list[UUID], expires_in_days: int) -> dict:
    _admin(client, business_id, user_id)
    if role == "owner": raise HTTPException(status_code=403, detail="Owner invitations require an explicit ownership workflow.")
    valid_locations = {str(row["id"]) for row in client.fetch_all("select id from business_locations where business_id=%(business_id)s and id = any(%(ids)s)", {"business_id": str(business_id), "ids": [str(value) for value in location_ids]})} if location_ids else set()
    if len(valid_locations) != len(location_ids): raise HTTPException(status_code=422, detail="Invitation includes a location outside this business.")
    policy = client.execute_one("select invitation_expiry_days from business_security_policies where business_id=%(business_id)s", {"business_id": str(business_id)})
    if policy and expires_in_days == 7: expires_in_days = int(policy["invitation_expiry_days"])
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days)
    row = client.execute_one("""insert into business_invitations (business_id,email,role,location_ids,token_hash,expires_at,created_by) values (%(business_id)s,%(email)s,%(role)s,%(locations)s,%(token_hash)s,%(expires_at)s,%(user_id)s) returning id,email,role,location_ids,expires_at,status,created_at""", {"business_id": str(business_id), "email": email.strip().lower(), "role": role, "locations": Jsonb([str(x) for x in location_ids]), "token_hash": token_hash, "expires_at": expires_at, "user_id": str(user_id)})
    _audit(client, business_id, user_id, "invitation_created", "business_invitation", row["id"], {"role": role})
    from config import get_settings
    from services import mail_service
    business = client.execute_one("select name from businesses where id=%(id)s", {"id": str(business_id)}) or {"name": "your business"}
    url = f"{get_settings().frontend_base_url.rstrip('/')}/accept-invitation?token={token}"
    delivered = mail_service.send_staff_invite(email.strip().lower(), business["name"], role, url)
    return {**row, "invitation_url": url, "email_delivered": bool(delivered)}


def revoke_invitation(client: DbClient, business_id: UUID, user_id: UUID, invitation_id: UUID) -> None:
    _admin(client, business_id, user_id)
    row = client.execute_one("update business_invitations set status='revoked',revoked_at=now() where id=%(id)s and business_id=%(business_id)s and status='pending' returning id", {"id": str(invitation_id), "business_id": str(business_id)})
    if not row: raise HTTPException(status_code=404, detail="Pending invitation not found.")
    _audit(client, business_id, user_id, "invitation_revoked", "business_invitation", invitation_id)


def resend_invitation(client: DbClient, business_id: UUID, user_id: UUID, invitation_id: UUID) -> dict:
    _admin(client, business_id, user_id)
    invitation = client.execute_one("select i.*, b.name as business_name from business_invitations i join businesses b on b.id=i.business_id where i.id=%(id)s and i.business_id=%(business_id)s", {"id": str(invitation_id), "business_id": str(business_id)})
    if not invitation or invitation.get("status") == "accepted": raise HTTPException(status_code=409, detail="This invitation cannot be resent.")
    token = secrets.token_urlsafe(32); expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    row = client.execute_one("update business_invitations set token_hash=%(token_hash)s,expires_at=%(expires_at)s,status='pending',revoked_at=null where id=%(id)s and business_id=%(business_id)s returning id,email,role,expires_at,status", {"token_hash": hashlib.sha256(token.encode()).hexdigest(), "expires_at": expires_at, "id": str(invitation_id), "business_id": str(business_id)})
    from config import get_settings
    from services import mail_service
    url = f"{get_settings().frontend_base_url.rstrip('/')}/accept-invitation?token={token}"
    delivered = mail_service.send_staff_invite(invitation["email"], invitation["business_name"], invitation["role"], url)
    _audit(client, business_id, user_id, "invitation_resent", "business_invitation", invitation_id, {"delivered": delivered})
    return {**row, "invitation_url": url, "email_delivered": bool(delivered)}


def accept_invitation(client: DbClient, user_id: UUID, payload: InvitationAccept) -> dict:
    user = client.execute_one("select id,email from app_users where id=%(id)s and is_active=true", {"id": str(user_id)})
    if not user: raise HTTPException(status_code=401, detail="Authentication required.")
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()
    invitation = client.execute_one("select * from business_invitations where token_hash=%(token_hash)s for update", {"token_hash": token_hash})
    if not invitation: raise HTTPException(status_code=400, detail="Invitation is invalid or expired.")
    if invitation.get("status") == "accepted": raise HTTPException(status_code=409, detail="Invitation has already been accepted.")
    expires_at = invitation["expires_at"]
    if isinstance(expires_at, str): expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expires_at.tzinfo is None: expires_at = expires_at.replace(tzinfo=timezone.utc)
    if invitation.get("status") != "pending" or expires_at <= datetime.now(timezone.utc):
        client.execute_command("update business_invitations set status='expired' where id=%(id)s and status='pending'", {"id": invitation["id"]})
        raise HTTPException(status_code=410, detail="Invitation is expired or revoked.")
    if user["email"].lower() != invitation["email"].lower(): raise HTTPException(status_code=403, detail="Invitation recipient does not match the signed-in account.")
    if invitation["role"] == "owner": raise HTTPException(status_code=403, detail="Owner invitations require an explicit ownership workflow.")
    staff = client.execute_one("insert into business_staff (business_id,user_id,role) values (%(business_id)s,%(user_id)s,%(role)s) on conflict (business_id,user_id) do update set role=excluded.role returning id", {"business_id": invitation["business_id"], "user_id": str(user_id), "role": invitation["role"]})
    for location_id in invitation.get("location_ids") or []:
        client.execute_command("insert into business_staff_location_access (business_staff_id,location_id) values (%(staff_id)s,%(location_id)s) on conflict do nothing", {"staff_id": staff["id"], "location_id": location_id})
    row = client.execute_one("update business_invitations set status='accepted',accepted_at=now() where id=%(id)s and status='pending' returning id,status,accepted_at", {"id": invitation["id"]})
    _audit(client, UUID(str(invitation["business_id"])), user_id, "invitation_accepted", "business_invitation", invitation["id"], {})
    return row


def custom_roles(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select id,name,permissions,created_at from business_custom_roles where business_id=%(business_id)s order by name", {"business_id": str(business_id)})


def save_custom_role(client: DbClient, business_id: UUID, user_id: UUID, payload: CustomRoleInput) -> dict:
    _admin(client, business_id, user_id)
    permissions = set(payload.permissions)
    if not permissions.issubset(PERMISSIONS): raise HTTPException(status_code=422, detail="Invalid permission assignment.")
    row = client.execute_one("insert into business_custom_roles (business_id,name,permissions,created_by) values (%(business_id)s,%(name)s,%(permissions)s,%(user_id)s) returning *", {"business_id": str(business_id), "name": payload.name.strip(), "permissions": Jsonb(list(permissions)), "user_id": str(user_id)})
    _audit(client, business_id, user_id, "custom_role_created", "business_custom_role", row["id"], {"permissions": sorted(permissions)})
    return row


def assign_custom_role(client: DbClient, business_id: UUID, user_id: UUID, staff_id: UUID, payload: CustomRoleAssignment) -> dict:
    _admin(client, business_id, user_id)
    role = client.execute_one("select id,permissions from business_custom_roles where id=%(id)s and business_id=%(business_id)s", {"id": str(payload.custom_role_id), "business_id": str(business_id)})
    staff = client.execute_one("select id,role from business_staff where id=%(id)s and business_id=%(business_id)s", {"id": str(staff_id), "business_id": str(business_id)})
    if not role or not staff: raise HTTPException(status_code=404, detail="Role or member not found.")
    if staff["role"] == "owner": raise HTTPException(status_code=409, detail="The owner role is protected.")
    valid_locations = {str(row["id"]) for row in client.fetch_all("select id from business_locations where business_id=%(business_id)s and id = any(%(ids)s)", {"business_id": str(business_id), "ids": [str(value) for value in payload.location_ids]})} if payload.location_ids else set()
    if len(valid_locations) != len(payload.location_ids): raise HTTPException(status_code=422, detail="Role access includes a location outside this business.")
    row = client.execute_one("update business_staff set custom_role_id=%(role_id)s where id=%(staff_id)s and business_id=%(business_id)s returning id,custom_role_id", {"role_id": str(payload.custom_role_id), "staff_id": str(staff_id), "business_id": str(business_id)})
    client.execute_command("delete from business_staff_location_access where business_staff_id=%(staff_id)s", {"staff_id": str(staff_id)})
    for location_id in payload.location_ids: client.execute_command("insert into business_staff_location_access (business_staff_id,location_id) values (%(staff_id)s,%(location_id)s) on conflict do nothing", {"staff_id": str(staff_id), "location_id": str(location_id)})
    _audit(client, business_id, user_id, "custom_role_assigned", "business_staff", staff_id, {"custom_role_id": str(payload.custom_role_id), "location_ids": [str(x) for x in payload.location_ids]})
    return row


def resolve_permissions(client: DbClient, business_id: UUID, user_id: UUID) -> set[str]:
    member = client.execute_one("select role,custom_role_id from business_staff where business_id=%(business_id)s and user_id=%(user_id)s union all select 'owner' as role,null as custom_role_id from businesses where id=%(business_id)s and owner_id=%(user_id)s limit 1", {"business_id": str(business_id), "user_id": str(user_id)})
    if not member: return set()
    if member["role"] in {"owner", "admin"}: return set(PERMISSIONS)
    if member.get("custom_role_id"):
        role = client.execute_one("select permissions from business_custom_roles where id=%(id)s and business_id=%(business_id)s", {"id": member["custom_role_id"], "business_id": str(business_id)})
        return set(role.get("permissions") or []) if role else set()
    return {"home.read", "insights.read", "operations.read"}


def security_policy(client: DbClient, business_id: UUID, user_id: UUID, payload: SecurityPolicyInput | None = None) -> dict:
    _admin(client, business_id, user_id)
    if payload is None:
        return client.execute_one("select * from business_security_policies where business_id=%(business_id)s", {"business_id": str(business_id)}) or {"session_duration_minutes": 480, "reauthentication_minutes": 15, "invitation_expiry_days": 7, "two_factor_required": False, "inactive_account_days": 90}
    row = client.execute_one("""insert into business_security_policies (business_id,session_duration_minutes,reauthentication_minutes,invitation_expiry_days,two_factor_required,inactive_account_days,updated_by) values (%(business_id)s,%(session)s,%(reauth)s,%(invite)s,%(twofa)s,%(inactive)s,%(user_id)s) on conflict (business_id) do update set session_duration_minutes=excluded.session_duration_minutes,reauthentication_minutes=excluded.reauthentication_minutes,invitation_expiry_days=excluded.invitation_expiry_days,two_factor_required=excluded.two_factor_required,inactive_account_days=excluded.inactive_account_days,updated_by=excluded.updated_by,updated_at=now() returning *""", {"business_id": str(business_id), "session": payload.session_duration_minutes, "reauth": payload.reauthentication_minutes, "invite": payload.invitation_expiry_days, "twofa": payload.two_factor_required, "inactive": payload.inactive_account_days, "user_id": str(user_id)})
    _audit(client, business_id, user_id, "security_policy_updated", "business_security_policy", row["id"])
    return row


def integrations(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select * from integration_accounts where business_id=%(business_id)s order by created_at desc", {"business_id": str(business_id)})


def create_integration(client: DbClient, business_id: UUID, user_id: UUID, payload: IntegrationInput) -> dict:
    _admin(client, business_id, user_id)
    location_ids = _validate_integration_locations(client, business_id, payload)
    row = client.execute_one("insert into integration_accounts (business_id,name,integration_type,status,last_error,created_by) values (%(business_id)s,%(name)s,%(type)s,%(status)s,null,%(user_id)s) returning *", {"business_id": str(business_id), "name": payload.name, "type": payload.integration_type, "status": payload.status, "user_id": str(user_id)})
    for location_id in location_ids: client.execute_command("insert into integration_location_mappings (integration_id,location_id) values (%(integration_id)s,%(location_id)s) on conflict do nothing", {"integration_id": row["id"], "location_id": str(location_id)})
    for mapping in payload.hardware_mappings:
        location_id = mapping.get("location_id")
        client.execute_command("insert into integration_hardware_mappings (integration_id,hardware_type,external_reference,location_id) values (%(integration_id)s,%(hardware_type)s,%(external_reference)s,%(location_id)s)", {"integration_id": row["id"], "hardware_type": mapping.get("hardware_type", "other"), "external_reference": mapping.get("external_reference", ""), "location_id": str(UUID(location_id)) if location_id else None})
    _audit(client, business_id, user_id, "integration_created", "integration_account", row["id"], {"type": payload.integration_type})
    from services.webhook_delivery_service import enqueue_event
    enqueue_event(client, business_id, "integration.connected", {"integration_id": str(row["id"]), "type": payload.integration_type})
    return row


def _validate_integration_locations(client: DbClient, business_id: UUID, payload: IntegrationInput) -> list[str]:
    requested = [str(location_id) for location_id in payload.location_ids]
    hardware_ids = []
    for mapping in payload.hardware_mappings:
        value = mapping.get("location_id")
        if not value:
            continue
        try:
            hardware_ids.append(str(UUID(value)))
        except (ValueError, AttributeError) as exc:
            raise HTTPException(status_code=422, detail="Integration mappings include an invalid location.") from exc
    all_ids = list(dict.fromkeys(requested + hardware_ids))
    if not all_ids:
        return requested
    valid = {
        str(row["id"])
        for row in client.fetch_all(
            "select id from business_locations where business_id=%(business_id)s and id = any(%(ids)s)",
            {"business_id": str(business_id), "ids": all_ids},
        )
    }
    if len(valid) != len(all_ids):
        raise HTTPException(status_code=422, detail="Integration mappings include a location outside this business.")
    return requested


def create_api_key(client: DbClient, business_id: UUID, user_id: UUID, payload: ApiKeyCreate) -> dict:
    _admin(client, business_id, user_id)
    secret = f"mtk_{secrets.token_urlsafe(32)}"; expires_at = datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days) if payload.expires_in_days else None
    row = client.execute_one("insert into integration_api_keys (business_id,name,key_hash,key_prefix,scopes,expires_at,created_by) values (%(business_id)s,%(name)s,%(hash)s,%(prefix)s,%(scopes)s,%(expires_at)s,%(user_id)s) returning id,name,key_prefix,scopes,expires_at,created_at", {"business_id": str(business_id), "name": payload.name, "hash": hashlib.sha256(secret.encode()).hexdigest(), "prefix": secret[:8], "scopes": Jsonb(payload.scopes), "expires_at": expires_at, "user_id": str(user_id)})
    _audit(client, business_id, user_id, "api_key_created", "integration_api_key", row["id"], {"scopes": payload.scopes})
    return {**row, "secret": secret}


def api_keys(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select id,name,key_prefix,scopes,expires_at,last_used_at,revoked_at,created_at from integration_api_keys where business_id=%(business_id)s order by created_at desc", {"business_id": str(business_id)})


def create_webhook(client: DbClient, business_id: UUID, user_id: UUID, payload: WebhookCreate) -> dict:
    _admin(client, business_id, user_id)
    from services.webhook_delivery_service import validate_endpoint_url
    endpoint_url = validate_endpoint_url(payload.endpoint_url)
    secret = secrets.token_urlsafe(32)
    row = client.execute_one("insert into integration_webhooks (business_id,endpoint_url,events,signing_secret_hash,signing_secret_ciphertext,created_by) values (%(business_id)s,%(url)s,%(events)s,%(hash)s,%(ciphertext)s,%(user_id)s) returning id,endpoint_url,events,is_active,created_at", {"business_id": str(business_id), "url": endpoint_url, "events": Jsonb(payload.events), "hash": hashlib.sha256(secret.encode()).hexdigest(), "ciphertext": _seal_secret(secret), "user_id": str(user_id)})
    _audit(client, business_id, user_id, "webhook_created", "integration_webhook", row["id"], {"events": payload.events})
    return {**row, "signing_secret": secret}


def webhooks(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select id,endpoint_url,events,is_active,last_delivered_at,created_at from integration_webhooks where business_id=%(business_id)s order by created_at desc", {"business_id": str(business_id)})


def verify_webhook_signature(body: bytes, secret: str, signature: str | None) -> bool:
    return bool(signature) and hmac.compare_digest(hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(), signature)


def rotate_api_key(client: DbClient, business_id: UUID, user_id: UUID, key_id: UUID) -> dict:
    _admin(client, business_id, user_id)
    old = client.execute_one("select id,name,scopes from integration_api_keys where id=%(id)s and business_id=%(business_id)s and revoked_at is null", {"id": str(key_id), "business_id": str(business_id)})
    if not old: raise HTTPException(status_code=404, detail="Active API key not found.")
    client.execute_command("update integration_api_keys set revoked_at=now() where id=%(id)s", {"id": str(key_id)})
    result = create_api_key(client, business_id, user_id, ApiKeyCreate(name=old["name"], scopes=old.get("scopes") or []))
    client.execute_command("update integration_api_keys set rotated_from_id=%(old)s where id=%(id)s", {"old": str(key_id), "id": str(result["id"])})
    _audit(client, business_id, user_id, "api_key_rotated", "integration_api_key", key_id, {"replacement_id": str(result["id"])})
    return result


def revoke_api_key(client: DbClient, business_id: UUID, user_id: UUID, key_id: UUID) -> None:
    _admin(client, business_id, user_id)
    if not client.execute_command("update integration_api_keys set revoked_at=coalesce(revoked_at,now()) where id=%(id)s and business_id=%(business_id)s", {"id": str(key_id), "business_id": str(business_id)}): raise HTTPException(status_code=404, detail="API key not found.")
    _audit(client, business_id, user_id, "api_key_revoked", "integration_api_key", key_id)


def verify_api_key(client: DbClient, raw_key: str, required_scope: str | None = None) -> UUID:
    row = client.execute_one("select business_id,scopes,expires_at,revoked_at from integration_api_keys where key_hash=%(hash)s", {"hash": hashlib.sha256(raw_key.encode()).hexdigest()})
    if not row or row.get("revoked_at"): raise HTTPException(status_code=401, detail="API key is invalid or revoked.")
    expires_at = row.get("expires_at")
    if expires_at and ((datetime.fromisoformat(expires_at.replace("Z", "+00:00")) if isinstance(expires_at, str) else expires_at) <= datetime.now(timezone.utc)): raise HTTPException(status_code=401, detail="API key has expired.")
    if required_scope and required_scope not in (row.get("scopes") or []): raise HTTPException(status_code=403, detail="API key scope is insufficient.")
    client.execute_command("update integration_api_keys set last_used_at=now() where key_hash=%(hash)s", {"hash": hashlib.sha256(raw_key.encode()).hexdigest()})
    return UUID(str(row["business_id"]))


def set_webhook_state(client: DbClient, business_id: UUID, user_id: UUID, webhook_id: UUID, active: bool) -> dict:
    _admin(client, business_id, user_id)
    row = client.execute_one("update integration_webhooks set is_active=%(active)s where id=%(id)s and business_id=%(business_id)s returning id,is_active", {"active": active, "id": str(webhook_id), "business_id": str(business_id)})
    if not row: raise HTTPException(status_code=404, detail="Webhook not found.")
    _audit(client, business_id, user_id, "webhook_enabled" if active else "webhook_disabled", "integration_webhook", webhook_id)
    from services.webhook_delivery_service import enqueue_event
    enqueue_event(client, business_id, "integration.configuration_changed", {"webhook_id": str(webhook_id), "active": active})
    return row


def delete_webhook(client: DbClient, business_id: UUID, user_id: UUID, webhook_id: UUID) -> None:
    _admin(client, business_id, user_id)
    if not client.execute_command("update integration_webhooks set is_active=false where id=%(id)s and business_id=%(business_id)s", {"id": str(webhook_id), "business_id": str(business_id)}): raise HTTPException(status_code=404, detail="Webhook not found.")
    _audit(client, business_id, user_id, "webhook_deleted", "integration_webhook", webhook_id)


def webhook_deliveries(client: DbClient, business_id: UUID, user_id: UUID, webhook_id: UUID) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select d.* from integration_webhook_deliveries d join integration_webhooks w on w.id=d.webhook_id where d.webhook_id=%(webhook_id)s and w.business_id=%(business_id)s order by d.requested_at desc", {"webhook_id": str(webhook_id), "business_id": str(business_id)})


def integration_activity(client: DbClient, business_id: UUID, user_id: UUID, limit: int = 50) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select id,action,entity_type,entity_id,metadata,created_at from audit_logs where business_id=%(business_id)s and entity_type in ('integration_account','integration_api_key','integration_webhook') order by created_at desc limit %(limit)s", {"business_id": str(business_id), "limit": limit})


def sessions(client: DbClient, business_id: UUID, user_id: UUID, current_session_id: UUID | None = None) -> list[dict]:
    _admin(client, business_id, user_id)
    return client.fetch_all("select s.id,s.created_at,s.expires_at,s.last_active_at,s.revoked_at,s.user_agent,s.ip_address,u.email,(s.id=%(current)s) as is_current from auth_sessions s join app_users u on u.id=s.user_id where s.revoked_at is null and s.expires_at > now() and (u.id=%(user_id)s or exists(select 1 from business_staff bs where bs.business_id=%(business_id)s and bs.user_id=s.user_id)) order by s.last_active_at desc", {"business_id": str(business_id), "user_id": str(user_id), "current": str(current_session_id) if current_session_id else "00000000-0000-0000-0000-000000000000"})


def revoke_session(client: DbClient, business_id: UUID, user_id: UUID, session_id: UUID, all_others: bool = False, current_session_id: UUID | None = None) -> int:
    _admin(client, business_id, user_id)
    if all_others:
        sql = "update auth_sessions set revoked_at=now(),revoked_by=%(actor)s where user_id=%(user_id)s and revoked_at is null"
        params: dict[str, str | None] = {"user_id": str(user_id), "actor": str(user_id)}
        if current_session_id:
            sql += " and id <> %(current)s::uuid"
            params["current"] = str(current_session_id)
        count = client.execute_command(sql, params)
    else:
        count = client.execute_command("update auth_sessions set revoked_at=now(),revoked_by=%(actor)s where id=%(id)s and user_id=%(user_id)s and revoked_at is null", {"id": str(session_id), "user_id": str(user_id), "actor": str(user_id)})
    _audit(client, business_id, user_id, "session_revoked", "auth_session", session_id, {"all_others": all_others})
    return count
