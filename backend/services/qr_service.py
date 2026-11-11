from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from urllib.parse import quote
from uuid import UUID

import qrcode
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from config import get_settings
from database import DbClient
from schemas import QrCodeCreate, QrCodeUpdate
from services import business_service, cache_service, order_service, setup_service


DESTINATIONS = {"main_menu", "category", "item", "deal", "table", "takeaway"}
QR_UPDATE_COLUMNS = {"name", "active", "expires_at", "tracking_metadata", "updated_by"}


def _business(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    return business_service.assert_business_access(client, business_id, user_id, business_service.FULL_ACCESS_ROLES)


def list_qr_codes(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    business = _business(client, business_id, user_id)
    rows = client.fetch_all("select * from kiosk_qr_codes where business_id = %(id)s order by created_at desc limit 250", {"id": str(business_id)})
    return {"qr_codes": [{**row, "url": destination_url(business, row)} for row in rows]}


def create_qr_code(client: DbClient, business_id: UUID, user_id: UUID, payload: QrCodeCreate) -> dict:
    business = _business(client, business_id, user_id)
    _validate_destination(client, business, payload)
    row = client.fetch_one("""insert into kiosk_qr_codes (business_id, name, destination_type, destination_id, location_id, table_token, expires_at, tracking_metadata, created_by, updated_by)
      values (%(business_id)s, %(name)s, %(destination_type)s, %(destination_id)s, %(location_id)s, %(table_token)s, %(expires_at)s, %(tracking_metadata)s, %(user_id)s, %(user_id)s) returning *""",
      {**payload.model_dump(), "business_id": str(business_id), "user_id": str(user_id), "tracking_metadata": Jsonb(payload.tracking_metadata)})
    _audit(client, business_id, user_id, "qr_created", row["id"])
    return {**row, "url": destination_url(business, row)}


def update_qr_code(client: DbClient, qr_id: UUID, user_id: UUID, payload: QrCodeUpdate) -> dict:
    row = client.fetch_one("select * from kiosk_qr_codes where id = %(id)s", {"id": str(qr_id)})
    if not row: raise HTTPException(status_code=404, detail="QR code not found.")
    business = _business(client, UUID(row["business_id"]), user_id)
    values = payload.model_dump(exclude_unset=True)
    if "tracking_metadata" in values: values["tracking_metadata"] = Jsonb(values["tracking_metadata"])
    if values:
        values["updated_by"] = str(user_id)
        unknown = set(values) - QR_UPDATE_COLUMNS
        if unknown:
            raise HTTPException(status_code=422, detail="Unsupported QR field.")
        sets = ", ".join(f"{key} = %({key})s" for key in values)
        row = client.fetch_one(f"update kiosk_qr_codes set {sets}, updated_at = now() where id = %(id)s returning *", {**values, "id": str(qr_id)})
    if payload.active is False: _audit(client, UUID(row["business_id"]), user_id, "qr_disabled", qr_id)
    return {**row, "url": destination_url(business, row)}


def delete_qr_code(client: DbClient, qr_id: UUID, user_id: UUID) -> None:
    row = client.fetch_one("select * from kiosk_qr_codes where id = %(id)s", {"id": str(qr_id)})
    if not row: raise HTTPException(status_code=404, detail="QR code not found.")
    _business(client, UUID(row["business_id"]), user_id)
    client.execute_command("delete from kiosk_qr_codes where id = %(id)s", {"id": str(qr_id)})
    _audit(client, UUID(row["business_id"]), user_id, "qr_deleted", qr_id)


def render_qr(client: DbClient, qr_id: UUID, user_id: UUID, fmt: str) -> tuple[bytes, str, str]:
    row = client.fetch_one("select * from kiosk_qr_codes where id = %(id)s", {"id": str(qr_id)})
    if not row: raise HTTPException(status_code=404, detail="QR code not found.")
    business = _business(client, UUID(row["business_id"]), user_id)
    if not row["active"] or row.get("expires_at") and row["expires_at"] < datetime.now(timezone.utc).isoformat(): raise HTTPException(status_code=409, detail="This QR destination is inactive or expired.")
    url = destination_url(business, row)
    if fmt == "svg": return svg(url), "image/svg+xml", f"{row['name']}.svg"
    if fmt == "png": return png(url), "image/png", f"{row['name']}.png"
    raise HTTPException(status_code=400, detail="Format must be png or svg.")


def public_base_url() -> str:
    return get_settings().frontend_base_url.rstrip("/")


def store_url(slug: str) -> str:
    """The shareable customer ordering link for a store. QR codes encode exactly this URL."""
    return f"{public_base_url()}/order/{quote(slug, safe='')}"


def destination_url(business: dict, row: dict) -> str:
    base = store_url(business["slug"])
    kind = row["destination_type"]
    if kind == "main_menu": return base
    if kind == "takeaway": return f"{base}?order_type=takeaway"
    if kind == "table": return f"{base}?table={quote(row.get('table_token') or '', safe='')}"
    return f"{base}?{kind}={quote(str(row.get('destination_id') or ''), safe='')}"


def store_ordering_status(client: DbClient, slug: str) -> dict:
    """Public, non-sensitive view of whether a store accepts QR orders right now."""
    business = business_service.get_business_by_slug(client, slug)
    configuration = setup_service.live_configuration(client, business)
    live = {**business, **configuration["business"]}
    settings = live.get("kiosk_order_settings") or {}
    return {
        "name": live.get("name") or "",
        "slug": live.get("slug") or slug,
        "currency_symbol": live.get("currency_symbol") or "",
        "tax_percent": float(live.get("tax_percent") or 0),
        "qr_ordering_enabled": (business.get("kiosk_order_settings") or {}).get("qr_ordering_enabled") is True,
        "is_open": order_service.store_is_open(live),
        "order_modes": live.get("order_modes") or ["dine_in", "takeaway"],
        "require_customer_name": bool(settings.get("require_customer_name")),
        "require_customer_phone": bool(settings.get("require_customer_phone")),
        "allow_customer_notes": settings.get("allow_customer_notes") is not False,
        "store_url": store_url(live.get("slug") or slug),
    }


def owner_store_ordering(client: DbClient, business_id: UUID, user_id: UUID) -> dict:
    business = _business(client, business_id, user_id)
    return {**store_ordering_status(client, business["slug"]), "business_id": str(business_id)}


def set_qr_ordering(client: DbClient, business_id: UUID, user_id: UUID, enabled: bool) -> dict:
    """Turns QR ordering on or off with one targeted JSON update, so other kiosk settings are never overwritten."""
    business = _business(client, business_id, user_id)
    client.execute_command(
        "update businesses set kiosk_order_settings = jsonb_set(coalesce(kiosk_order_settings, '{}'::jsonb), '{qr_ordering_enabled}', %(enabled)s, true) where id = %(id)s",
        {"id": str(business_id), "enabled": Jsonb(bool(enabled))},
    )
    cache_service.invalidate_slug(business.get("slug"))
    _audit(client, business_id, user_id, "qr_ordering_enabled" if enabled else "qr_ordering_disabled", business_id, entity="business")
    return {**store_ordering_status(client, business["slug"]), "business_id": str(business_id)}


def _validate_destination(client: DbClient, business: dict, payload: QrCodeCreate) -> None:
    if payload.destination_type not in DESTINATIONS: raise HTTPException(status_code=422, detail="Unsupported QR destination.")
    if payload.location_id and not client.fetch_one(
        "select id from business_locations where id = %(location_id)s and business_id = %(business_id)s",
        {"location_id": str(payload.location_id), "business_id": str(business["id"])},
    ):
        raise HTTPException(status_code=422, detail="The QR location is outside this business.")
    if payload.destination_type == "table" and not payload.table_token: raise HTTPException(status_code=422, detail="A table QR code needs a table token.")
    if payload.destination_type in {"main_menu", "takeaway", "table"}: return
    table = {"category": "categories", "item": "products", "deal": "kiosk_promotions"}[payload.destination_type]
    row = client.fetch_one(f"select * from {table} where id = %(id)s and business_id = %(business_id)s", {"id": str(payload.destination_id), "business_id": business["id"]})
    if not row or row.get("is_active") is False or row.get("status") in {"expired", "paused"}: raise HTTPException(status_code=409, detail="The selected destination is archived, inactive, or outside this business.")


def _audit(client: DbClient, business_id: UUID, user_id: UUID, action: str, entity_id: UUID, entity: str = "qr_code") -> None:
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(user_id), "action": action, "entity": entity, "entity_id": str(entity_id), "metadata": Jsonb({})}).execute()


def _qr(value: str, box_size: int) -> qrcode.QRCode:
    # Error correction M and a 4-module quiet zone keep the code scannable from phone cameras.
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=box_size, border=4)
    qr.add_data(value)
    qr.make(fit=True)
    return qr


def svg(value: str) -> bytes:
    matrix = _qr(value, box_size=1).get_matrix()
    size = len(matrix)
    cells = "".join(f"<rect x='{x}' y='{y}' width='1' height='1'/>" for y, row in enumerate(matrix) for x, bit in enumerate(row) if bit)
    return f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {size} {size}' shape-rendering='crispEdges'><rect width='100%' height='100%' fill='white'/><g fill='black'>{cells}</g></svg>".encode()


def png(value: str) -> bytes:
    image = _qr(value, box_size=12).make_image(fill_color="black", back_color="white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()
