from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException

from database import DbClient
from schemas import StaffInvite, StaffRole, StaffUpdate
from services import auth_service
from services.business_service import FULL_ACCESS_ROLES, assert_business_access


def list_staff(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    return client.fetch_all(
        """
        select bs.id, bs.business_id, bs.user_id, bs.role, bs.created_at,
               u.email, u.full_name
        from business_staff bs
        join app_users u on u.id = bs.user_id
        where bs.business_id = %(business_id)s
        order by bs.created_at asc
        """,
        {"business_id": str(business_id)},
    )


def invite_staff(
    client: DbClient,
    business_id: UUID,
    owner_user_id: UUID,
    payload: StaffInvite,
) -> dict:
    business = assert_business_access(client, business_id, owner_user_id, FULL_ACCESS_ROLES)
    email = payload.email.strip().lower()
    user = client.execute_one(
        "select id, email, full_name, is_active from app_users where email = %(email)s limit 1",
        {"email": email},
    )

    if not user:
        user = auth_service.ensure_auth_user_for_invite(client, email)
        client.table("profiles").upsert({"id": user["id"], "email": email, "full_name": payload.full_name}).execute()
    elif not user.get("is_active"):
        auth_service.send_signup_otp(email)

    role = payload.role.value if isinstance(payload.role, StaffRole) else str(payload.role)
    client.table("business_staff").upsert(
        {
            "business_id": str(business_id),
            "user_id": user["id"],
            "role": role,
        }
    ).execute()

    row = client.execute_one(
        """
        select bs.id, bs.business_id, bs.user_id, bs.role, bs.created_at,
               u.email, u.full_name
        from business_staff bs
        join app_users u on u.id = bs.user_id
        where bs.business_id = %(business_id)s and bs.user_id = %(user_id)s
        limit 1
        """,
        {"business_id": str(business_id), "user_id": user["id"]},
    )
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(owner_user_id), "action": "staff_invited", "entity": "business_staff", "entity_id": str(row["id"]), "metadata": {"role": role}}).execute()
    return row


def remove_staff(client: DbClient, business_id: UUID, owner_user_id: UUID, staff_id: UUID) -> None:
    assert_business_access(client, business_id, owner_user_id, FULL_ACCESS_ROLES)
    row = client.execute_one(
        """
        select id, role
        from business_staff
        where id = %(staff_id)s and business_id = %(business_id)s
        limit 1
        """,
        {"staff_id": str(staff_id), "business_id": str(business_id)},
    )
    if not row:
        return
    if row.get("role") == StaffRole.OWNER.value:
        return
    client.table("business_staff").delete().eq("id", str(staff_id)).eq("business_id", str(business_id)).execute()
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(owner_user_id), "action": "staff_removed", "entity": "business_staff", "entity_id": str(staff_id), "metadata": {}}).execute()


def update_staff(
    client: DbClient,
    business_id: UUID,
    owner_user_id: UUID,
    staff_id: UUID,
    payload: StaffUpdate,
) -> dict:
    assert_business_access(client, business_id, owner_user_id, FULL_ACCESS_ROLES)
    row = client.execute_one(
        """
        select bs.id, bs.business_id, bs.user_id, bs.role, u.email, u.full_name
        from business_staff bs
        join app_users u on u.id = bs.user_id
        where bs.id = %(staff_id)s and bs.business_id = %(business_id)s
        limit 1
        """,
        {"staff_id": str(staff_id), "business_id": str(business_id)},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    if row.get("role") == StaffRole.OWNER.value:
        raise HTTPException(status_code=400, detail="Owner access cannot be changed.")

    updates: dict[str, str] = {}
    if payload.role is not None:
        if payload.role == StaffRole.OWNER:
            raise HTTPException(status_code=400, detail="Owner role cannot be assigned here.")
        updates["role"] = payload.role.value if isinstance(payload.role, StaffRole) else str(payload.role)

    if updates:
        client.table("business_staff").update(updates).eq("id", str(staff_id)).eq("business_id", str(business_id)).execute()

    if payload.full_name is not None:
        client.table("app_users").update({"full_name": payload.full_name.strip() or None}).eq("id", row["user_id"]).execute()
        client.table("profiles").upsert({"id": row["user_id"], "email": row["email"], "full_name": payload.full_name.strip() or None}).execute()

    if updates or payload.full_name is not None:
        fields = [*updates, *(["full_name"] if payload.full_name is not None else [])]
        client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(owner_user_id), "action": "staff_updated", "entity": "business_staff", "entity_id": str(staff_id), "metadata": {"fields": sorted(fields)}}).execute()

    return client.execute_one(
        """
        select bs.id, bs.business_id, bs.user_id, bs.role, bs.created_at,
               u.email, u.full_name
        from business_staff bs
        join app_users u on u.id = bs.user_id
        where bs.id = %(staff_id)s and bs.business_id = %(business_id)s
        limit 1
        """,
        {"staff_id": str(staff_id), "business_id": str(business_id)},
    )
