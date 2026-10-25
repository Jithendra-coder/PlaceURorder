from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from database import DbClient
from schemas import PromotionCreate, PromotionUpdate
from services import business_service


def _access(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    return business_service.assert_business_access(client, business_id, user_id, business_service.FULL_ACCESS_ROLES)


def list_promotions(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    _access(client, business_id, user_id)
    rows = client.fetch_all("select * from kiosk_promotions where business_id = %(id)s order by created_at desc limit 250", {"id": str(business_id)})
    promotion_ids = [row["id"] for row in rows]
    if not promotion_ids:
        return {"promotions": rows}

    targets_by_promotion: dict[str, list[dict]] = defaultdict(list)
    for target in client.fetch_all(
        "select promotion_id, target_type, target_id from kiosk_promotion_targets where promotion_id = any(%(ids)s)",
        {"ids": promotion_ids},
    ):
        targets_by_promotion[str(target["promotion_id"])].append({"target_type": target["target_type"], "target_id": target["target_id"]})
    locations_by_promotion: dict[str, list[str]] = defaultdict(list)
    for location in client.fetch_all(
        "select promotion_id, location_id from kiosk_promotion_locations where promotion_id = any(%(ids)s)",
        {"ids": promotion_ids},
    ):
        locations_by_promotion[str(location["promotion_id"])].append(location["location_id"])
    placements_by_promotion: dict[str, list[str]] = defaultdict(list)
    for placement in client.fetch_all(
        "select promotion_id, placement from kiosk_promotion_placements where promotion_id = any(%(ids)s)",
        {"ids": promotion_ids},
    ):
        placements_by_promotion[str(placement["promotion_id"])].append(placement["placement"])
    for row in rows:
        promotion_id = str(row["id"])
        row["targets"] = targets_by_promotion[promotion_id]
        row["location_ids"] = locations_by_promotion[promotion_id]
        row["placements"] = placements_by_promotion[promotion_id]
    return {"promotions": rows}


def create_promotion(client: DbClient, business_id: UUID, user_id: UUID, payload: PromotionCreate) -> dict:
    _access(client, business_id, user_id)
    _validate_schedule(payload.starts_at, payload.ends_at)
    _validate_targets(client, business_id, payload.target_type, payload.target_ids)
    _validate_locations(client, business_id, payload.location_ids)
    if "deals_category" in payload.placements:
        _ensure_deals_category(client, business_id, payload.status in {"active", "scheduled"})
        _assert_single_deals_placement(client, business_id)
    row = client.fetch_one("""insert into kiosk_promotions (business_id, name, description, discount_type, discount_value, starts_at, ends_at, status, created_by, updated_by)
        values (%(business_id)s, %(name)s, %(description)s, %(discount_type)s, %(discount_value)s, %(starts_at)s, %(ends_at)s, %(status)s, %(user_id)s, %(user_id)s) returning *""",
        {**payload.model_dump(exclude={"target_ids", "location_ids", "placements"}), "business_id": str(business_id), "user_id": str(user_id)})
    _replace_relations(client, row["id"], payload.target_type, payload.target_ids, payload.location_ids, payload.placements)
    _audit(client, business_id, user_id, "promotion_created", row["id"])
    return row


def update_promotion(client: DbClient, promotion_id: UUID, user_id: UUID, payload: PromotionUpdate) -> dict:
    row = client.fetch_one("select * from kiosk_promotions where id = %(id)s", {"id": str(promotion_id)})
    if not row: raise HTTPException(status_code=404, detail="Promotion not found.")
    _access(client, UUID(row["business_id"]), user_id)
    _validate_schedule(payload.starts_at if payload.starts_at is not None else row.get("starts_at"), payload.ends_at if payload.ends_at is not None else row.get("ends_at"))
    values = payload.model_dump(exclude_unset=True, exclude={"target_ids", "location_ids", "placements", "target_type"})
    if values:
        values["updated_by"] = str(user_id)
        sets = ", ".join(f"{key} = %({key})s" for key in values)
        row = client.fetch_one(f"update kiosk_promotions set {sets}, updated_at = now() where id = %(id)s returning *", {**values, "id": str(promotion_id)})
    if payload.status in {"active", "scheduled"} and client.fetch_one("select 1 from kiosk_promotion_placements where promotion_id = %(id)s and placement = 'deals_category'", {"id": str(promotion_id)}):
        _assert_single_deals_placement(client, UUID(row["business_id"]), promotion_id)
    if payload.target_ids is not None or payload.location_ids is not None or payload.placements is not None or payload.target_type is not None:
        target_type, target_ids, location_ids, placements = _merged_relations(client, promotion_id, payload)
        _validate_targets(client, UUID(row["business_id"]), target_type, target_ids)
        _validate_locations(client, UUID(row["business_id"]), location_ids)
        if payload.placements and "deals_category" in payload.placements: _ensure_deals_category(client, UUID(row["business_id"]), (payload.status or row.get("status")) in {"active", "scheduled"})
        if payload.placements and "deals_category" in payload.placements: _assert_single_deals_placement(client, UUID(row["business_id"]), promotion_id)
        _replace_relations(client, promotion_id, target_type, target_ids, location_ids, placements)
    _audit(client, UUID(row["business_id"]), user_id, "promotion_updated", promotion_id)
    return row


def delete_promotion(client: DbClient, promotion_id: UUID, user_id: UUID) -> None:
    row = client.fetch_one("select * from kiosk_promotions where id = %(id)s", {"id": str(promotion_id)})
    if not row: raise HTTPException(status_code=404, detail="Promotion not found.")
    _access(client, UUID(row["business_id"]), user_id)
    if row["status"] in {"active", "scheduled"} or client.fetch_one("select 1 from kiosk_promotion_placements where promotion_id = %(id)s", {"id": str(promotion_id)}):
        raise HTTPException(status_code=409, detail="Pause and remove placements before deleting this promotion.")
    client.execute_command("delete from kiosk_promotions where id = %(id)s", {"id": str(promotion_id)})
    _audit(client, UUID(row["business_id"]), user_id, "promotion_deleted", promotion_id)


def _validate_targets(client: DbClient, business_id: UUID, target_type: str, ids: list[UUID]) -> None:
    if not ids: raise HTTPException(status_code=422, detail="A promotion needs at least one eligible target.")
    table = {"product": "products", "category": "categories", "combo": "menu_combos"}[target_type]
    count = client.fetch_one(f"select count(*)::int as count from {table} where business_id = %(business_id)s and id = any(%(ids)s)", {"business_id": str(business_id), "ids": [str(item) for item in ids]})
    if not count or count["count"] != len(set(str(item) for item in ids)): raise HTTPException(status_code=404, detail="One or more promotion targets are outside this business.")


def _validate_schedule(starts_at, ends_at) -> None:
    if starts_at and ends_at and starts_at >= ends_at: raise HTTPException(status_code=422, detail="Promotion end must be after its start.")


def _validate_locations(client: DbClient, business_id: UUID, ids: list[UUID]) -> None:
    if not ids: return
    count = client.fetch_one("select count(*)::int as count from business_locations where business_id = %(business_id)s and id = any(%(ids)s)", {"business_id": str(business_id), "ids": [str(item) for item in ids]})
    if not count or count["count"] != len(set(str(item) for item in ids)): raise HTTPException(status_code=404, detail="One or more locations are outside this business.")


def _merged_relations(client: DbClient, promotion_id: UUID, payload: PromotionUpdate) -> tuple[str, list[UUID], list[UUID], list[str]]:
    params = {"id": str(promotion_id)}
    targets = client.fetch_all("select target_type, target_id from kiosk_promotion_targets where promotion_id = %(id)s", params)
    locations = client.fetch_all("select location_id from kiosk_promotion_locations where promotion_id = %(id)s", params)
    placements = client.fetch_all("select placement from kiosk_promotion_placements where promotion_id = %(id)s", params)
    target_type = payload.target_type or (targets[0]["target_type"] if targets else "product")
    target_ids = payload.target_ids if payload.target_ids is not None else [UUID(str(row["target_id"])) for row in targets]
    location_ids = payload.location_ids if payload.location_ids is not None else [UUID(str(row["location_id"])) for row in locations]
    placement_values = payload.placements if payload.placements is not None else [row["placement"] for row in placements]
    return target_type, target_ids, location_ids, placement_values


def _ensure_deals_category(client: DbClient, business_id: UUID, first: bool = False) -> None:
    if not client.fetch_one("select id from categories where business_id = %(business_id)s and name = 'Deals' order by sort_order, id limit 1", {"business_id": str(business_id)}):
        client.fetch_one("insert into categories (business_id, name, sort_order, is_active) values (%(business_id)s, 'Deals', %(sort_order)s, true) returning id", {"business_id": str(business_id), "sort_order": 0 if first else 9999})
    elif first:
        client.execute_command("update categories set sort_order = 0 where business_id = %(business_id)s and name = 'Deals'", {"business_id": str(business_id)})


def _assert_single_deals_placement(client: DbClient, business_id: UUID, current_id: UUID | None = None) -> None:
    query = "select p.id from kiosk_promotions p join kiosk_promotion_placements x on x.promotion_id = p.id where p.business_id = %(business_id)s and x.placement = 'deals_category' and p.status in ('active','scheduled')"
    rows = client.fetch_all(query, {"business_id": str(business_id)})
    if any(str(row["id"]) != str(current_id) for row in rows): raise HTTPException(status_code=409, detail="This business already has an active Deals placement.")


def _replace_relations(client: DbClient, promotion_id: UUID, target_type: str, target_ids: list[UUID], location_ids: list[UUID], placements: list[str]) -> None:
    client.execute_command("delete from kiosk_promotion_targets where promotion_id = %(id)s", {"id": str(promotion_id)})
    client.execute_command("delete from kiosk_promotion_locations where promotion_id = %(id)s", {"id": str(promotion_id)})
    client.execute_command("delete from kiosk_promotion_placements where promotion_id = %(id)s", {"id": str(promotion_id)})
    if target_ids: client.table("kiosk_promotion_targets").insert([{"promotion_id": str(promotion_id), "target_type": target_type, "target_id": str(item)} for item in target_ids]).execute()
    if location_ids: client.table("kiosk_promotion_locations").insert([{"promotion_id": str(promotion_id), "location_id": str(item)} for item in location_ids]).execute()
    if placements: client.table("kiosk_promotion_placements").insert([{"promotion_id": str(promotion_id), "placement": item} for item in placements]).execute()


def _audit(client: DbClient, business_id: UUID, user_id: UUID, action: str, entity_id: UUID) -> None:
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(user_id), "action": action, "entity": "promotion", "entity_id": str(entity_id), "metadata": Jsonb({})}).execute()
