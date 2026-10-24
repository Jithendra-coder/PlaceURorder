from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from database import DbClient
from schemas import OrderCreate, OrderStatus, OrderStatusUpdate
from services import availability_service, cache_service, payment_service, setup_service
from services.business_service import KITCHEN_ROLES, assert_business_access, get_business_by_slug
from utils import timestamps_for_status

ACTIVE_STATUSES = [OrderStatus.PENDING.value, OrderStatus.PREPARING.value, OrderStatus.READY.value]
VALID_TRANSITIONS = {
    OrderStatus.PAYMENT_PENDING.value: set(),
    OrderStatus.PENDING.value: {OrderStatus.PREPARING.value, OrderStatus.CANCELLED.value},
    OrderStatus.PREPARING.value: {OrderStatus.READY.value, OrderStatus.CANCELLED.value},
    OrderStatus.READY.value: {OrderStatus.COMPLETED.value, OrderStatus.CANCELLED.value},
    OrderStatus.COMPLETED.value: set(),
    OrderStatus.CANCELLED.value: set(),
}


def _next_order_number(client: DbClient, business_id: UUID, order_date: str) -> int:
    try:
        row = client.execute_one(
            """
            insert into order_counters as counters (business_id, counter_date, next_number)
            values (%(business_id)s::uuid, %(counter_date)s::date, 2)
            on conflict (business_id, counter_date)
            do update set next_number = counters.next_number + 1
            returning next_number - 1 as order_number
            """,
            {"business_id": str(business_id), "counter_date": order_date},
        )
        if row and row.get("order_number") is not None:
            return int(row["order_number"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not allocate an order number.") from exc

    raise HTTPException(status_code=500, detail="Could not allocate an order number.")


def _business_order_date(business: dict) -> str:
    try:
        tz = ZoneInfo(business.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    return datetime.now(tz).date().isoformat()


def _locked_products_for_order(client: DbClient, business_id: UUID, product_ids: list[str]) -> dict[str, dict]:
    unique_ids = list(dict.fromkeys(product_ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Order must contain at least one item.")

    params = {"business_id": str(business_id)}
    placeholders = []
    for index, product_id in enumerate(unique_ids):
        key = f"product_{index}"
        params[key] = product_id
        placeholders.append(f"%({key})s")

    rows = client.fetch_all(
        f"""
        select *
        from products
        where business_id = %(business_id)s::uuid
          and id in ({", ".join(f"{placeholder}::uuid" for placeholder in placeholders)})
        for update
        """,
        params,
    )
    return {row["id"]: row for row in rows}


def _modifier_catalog(client: DbClient, business_id: UUID, product_ids: list[str]) -> dict[str, dict]:
    unique_ids = list(dict.fromkeys(product_ids))
    if not unique_ids:
        return {}

    params = {"business_id": str(business_id)}
    placeholders = []
    for index, product_id in enumerate(unique_ids):
        key = f"modifier_product_{index}"
        params[key] = product_id
        placeholders.append(f"%({key})s::uuid")

    rows = client.fetch_all(
        f"""
        select
          pmg.id as group_id,
          pmg.product_id,
          pmg.name as group_name,
          pmg.min_select,
          pmg.max_select,
          pmg.is_required,
          pmo.id as option_id,
          pmo.name as option_name,
          pmo.price_delta,
          pmo.is_available
        from product_modifier_groups pmg
        left join product_modifier_options pmo on pmo.group_id = pmg.id
        where pmg.business_id = %(business_id)s::uuid
          and pmg.product_id in ({", ".join(placeholders)})
        order by pmg.sort_order asc, pmo.sort_order asc
        """,
        params,
    )

    catalog: dict[str, dict] = {}
    for row in rows:
        product_id = row["product_id"]
        group_id = row["group_id"]
        product_catalog = catalog.setdefault(product_id, {"groups": {}, "options": {}})
        group = product_catalog["groups"].setdefault(
            group_id,
            {
                "group_id": group_id,
                "group_name": row["group_name"],
                "min_select": int(row.get("min_select") or 0),
                "max_select": int(row.get("max_select") or 0),
                "is_required": bool(row.get("is_required")),
            },
        )
        if row.get("option_id"):
            option = {
                "group_id": group_id,
                "group_name": group["group_name"],
                "option_id": row["option_id"],
                "name": row["option_name"],
                "price_delta": float(row.get("price_delta") or 0),
                "is_available": bool(row.get("is_available")),
            }
            product_catalog["options"][row["option_id"]] = option
    return catalog


def _normalize_customizations(product: dict, customizations: list[dict], catalog: dict[str, dict]) -> tuple[list[dict], float]:
    product_catalog = catalog.get(product["id"]) or {"groups": {}, "options": {}}
    groups = product_catalog["groups"]
    options = product_catalog["options"]
    selected_by_group: dict[str, int] = defaultdict(int)
    normalized: list[dict] = []
    total_delta = 0.0

    for entry in customizations or []:
        option_id = str(entry.get("option_id") or "")
        if not option_id:
            continue
        option = options.get(option_id)
        if not option:
            raise HTTPException(status_code=409, detail=f"Invalid add-on selected for {product['name']}.")
        if not option.get("is_available"):
            raise HTTPException(status_code=409, detail=f"{option['name']} is unavailable.")
        group_id = option["group_id"]
        selected_by_group[group_id] += 1
        group = groups.get(group_id) or {}
        max_select = int(group.get("max_select") or 0)
        if max_select and selected_by_group[group_id] > max_select:
            raise HTTPException(status_code=409, detail=f"Too many selections for {group.get('group_name', 'an add-on')}.")
        total_delta += float(option["price_delta"] or 0)
        normalized.append(
            {
                "group_id": group_id,
                "group_name": option["group_name"],
                "option_id": option["option_id"],
                "name": option["name"],
                "price_delta": option["price_delta"],
            }
        )

    for group_id, group in groups.items():
        min_select = int(group.get("min_select") or 0)
        if group.get("is_required") and selected_by_group.get(group_id, 0) < min_select:
            raise HTTPException(status_code=409, detail=f"Select {group.get('group_name', 'required option')} for {product['name']}.")

    return normalized, total_delta


def _active_product_price(product: dict) -> float:
    price = float(product.get("price") or 0)
    discount_type = product.get("discount_type") or "none"
    discount_value = float(product.get("discount_value") or 0)
    if discount_type == "none" or discount_value <= 0 or not _discount_is_active(product):
        return price
    if discount_type == "percentage":
        return round(max(price - (price * min(discount_value, 100) / 100), 0), 2)
    if discount_type == "fixed":
        return round(max(price - discount_value, 0), 2)
    return price


def _discount_is_active(product: dict) -> bool:
    now = datetime.now(timezone.utc)
    starts = _to_datetime(product.get("discount_starts_at"))
    ends = _to_datetime(product.get("discount_ends_at"))
    if starts and now < starts:
        return False
    if ends and now > ends:
        return False
    return True


def _to_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def create_kiosk_order(
    client: DbClient,
    business_slug: str,
    payload: OrderCreate,
    request_mode: str | None = None,
    source: str = "hardware_kiosk",
    idempotency_key: str | None = None,
) -> dict:
    if (request_mode or "").strip().lower() in {"preview", "test", "sandbox"}:
        raise HTTPException(status_code=409, detail="Preview/test checkout cannot create production orders.")
    business = get_business_by_slug(client, business_slug)
    business_id = UUID(business["id"])
    if idempotency_key:
        client.execute_one(
            "select pg_advisory_xact_lock(hashtextextended(%(key)s, 0)) as locked",
            {"key": f"{business_id}:{idempotency_key}"},
        )
        existing = client.fetch_one(
            "select id from orders where business_id = %(business_id)s and idempotency_key = %(key)s limit 1",
            {"business_id": str(business_id), "key": idempotency_key},
        )
        if existing:
            return get_order(client, UUID(existing["id"]), business_id)
    configuration = setup_service.live_configuration(client, business)
    live_business = {**business, **configuration["business"], "is_active": business.get("is_active")}
    if not live_business.get("is_active", True):
        raise HTTPException(status_code=409, detail="This kiosk is currently inactive.")
    if not _business_is_open(live_business):
        raise HTTPException(status_code=409, detail="This store is outside business hours.")
    order_modes = live_business.get("order_modes") or ["dine_in", "takeaway"]
    if payload.order_type.value not in order_modes:
        raise HTTPException(status_code=409, detail=f"{payload.order_type.value} orders are not enabled.")
    payment_method = payment_service.validate_kiosk_order_settings(client, live_business, payload)
    online_payment = payment_service.is_online_method(payment_method)
    if source == "public_slug":
        settings = live_business.get("kiosk_order_settings") or {}
        if settings.get("public_online_ordering_enabled") is not True:
            raise HTTPException(status_code=409, detail="Public online ordering is not enabled for this business. Use an enrolled kiosk device.")
        if not online_payment:
            raise HTTPException(status_code=409, detail="Public online ordering requires an online payment method.")

    product_ids = [str(item.product_id) for item in payload.items]
    requested_quantities: dict[str, int] = defaultdict(int)
    for item in payload.items:
        requested_quantities[str(item.product_id)] += int(item.quantity)

    current_products = _locked_products_for_order(client, business_id, product_ids)
    configured_products = {row["id"]: row for row in configuration.get("products", []) if row.get("menu_status") in {"shown", "unavailable"}}
    products = {
        product_id: {
            **configured_products[product_id],
            **{key: current_products[product_id].get(key) for key in ("stock_quantity", "sold_today")},
        }
        for product_id in requested_quantities
        if product_id in configured_products and product_id in current_products
    }
    modifier_catalog = _modifier_catalog_from_configuration(configuration, product_ids)
    missing_ids = [product_id for product_id in requested_quantities if product_id not in products]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Product {missing_ids[0]} was not found.")

    for product_id, requested_quantity in requested_quantities.items():
        product = products[product_id]
        availability = availability_service.resolve_product(product, live_business, configuration.get("availability_rules", []), str(payload.location_id) if payload.location_id else None)
        if not availability["available"]:
            raise HTTPException(status_code=409, detail=f"{product['name']} is unavailable. {availability.get('reason') or ''}".strip())

        daily_limit = product.get("daily_limit")
        sold_today = product.get("sold_today") or 0
        if daily_limit is not None and int(sold_today) + requested_quantity > int(daily_limit):
            raise HTTPException(status_code=409, detail=f"{product['name']} has reached today's limit.")

        stock_quantity = product.get("stock_quantity")
        if product.get("track_stock") and stock_quantity is not None and requested_quantity > int(stock_quantity):
            raise HTTPException(status_code=409, detail=f"{product['name']} does not have enough stock.")

    line_items = []
    subtotal = 0.0
    discount_amount = 0.0
    for item in payload.items:
        product = products[str(item.product_id)]
        normalized_customizations, customization_delta = _normalize_customizations(
            product,
            item.customizations,
            modifier_catalog,
        )
        original_unit_price = float(product.get("price") or 0) + customization_delta
        unit_price = _active_product_price(product) + customization_delta
        total_price = round(unit_price * item.quantity, 2)
        subtotal += total_price
        discount_amount += round(max(original_unit_price - unit_price, 0) * item.quantity, 2)
        line_items.append(
            {
                "business_id": str(business_id),
                "product_id": str(item.product_id),
                "product_name": product["name"],
                "quantity": item.quantity,
                "unit_price": unit_price,
                "total_price": total_price,
                "notes": item.notes,
                "customizations": normalized_customizations,
                "_product": product,
            }
        )

    tax_rate = float(live_business.get("tax_percent") or 0)
    tax_amount = round(subtotal * tax_rate / 100, 2)
    total_amount = round(subtotal + tax_amount, 2)
    order_date = _business_order_date(live_business)
    order_number = _next_order_number(client, business_id, order_date)
    location_id = None
    if payload.location_id:
        location = client.table("business_locations").select("id").eq("business_id", str(business_id)).eq("id", str(payload.location_id)).execute().data or []
        if not location:
            raise HTTPException(status_code=404, detail="The selected location was not found for this business.")
        location_id = str(payload.location_id)
    customer_name = (payload.customer_name or "").strip() or f"Guest-{order_date}-{order_number}"

    order_payload = {
        "business_id": str(business_id),
        "location_id": location_id,
        "order_number": order_number,
        "order_date": order_date,
        "status": OrderStatus.PAYMENT_PENDING.value if online_payment else OrderStatus.PENDING.value,
        "order_type": payload.order_type.value,
        "table_label": payload.table_label,
        "customer_name": customer_name,
        "customer_phone": payload.customer_phone,
        "subtotal": subtotal,
        "tax_amount": tax_amount,
        "discount_amount": round(discount_amount, 2),
        "total_amount": total_amount,
        "payment_status": "pending" if online_payment else "pay_at_counter_pending",
        "payment_method": payment_method,
        "notes": payload.notes,
        "idempotency_key": idempotency_key,
        "source": "counter" if source == "counter_entry" else "kiosk",
    }
    order_response = client.table("orders").insert(order_payload).execute()
    if not order_response.data:
        raise HTTPException(status_code=400, detail="Order could not be created.")
    order = order_response.data[0]

    rows = []
    for item in line_items:
        item.pop("_product", None)
        item["order_id"] = order["id"]
        rows.append(item)

    for product_id, quantity in requested_quantities.items():
        product = products[product_id]
        sold_today = int(product.get("sold_today") or 0) + int(quantity)
        update = {"sold_today": sold_today}
        daily_limit = product.get("daily_limit")
        stock_quantity = product.get("stock_quantity")
        if product.get("track_stock") and stock_quantity is not None:
            new_stock = max(int(stock_quantity) - int(quantity), 0)
            update["stock_quantity"] = new_stock
            if new_stock == 0:
                update["is_available"] = False
        if daily_limit is not None and sold_today >= int(daily_limit):
            update["is_available"] = False
        client.table("products").update(update).eq("id", product["id"]).eq("business_id", str(business_id)).execute()

    if rows:
        client.table("order_items").insert(rows).execute()

    full_order = get_order(client, UUID(order["id"]), business_id)
    full_order["payment"] = payment_service.create_payment_for_order(client, live_business, full_order, payment_method)
    cache_service.invalidate_slug(business.get("slug"))
    return full_order


def _modifier_catalog_from_configuration(configuration: dict, product_ids: list[str]) -> dict[str, dict]:
    wanted = set(product_ids)
    catalog: dict[str, dict] = {}
    groups = {row["id"]: row for row in configuration.get("modifier_groups", []) if row.get("product_id") in wanted}
    for group_id, row in groups.items():
        product = catalog.setdefault(row["product_id"], {"groups": {}, "options": {}})
        product["groups"][group_id] = {
            "group_id": group_id,
            "group_name": row["name"],
            "min_select": int(row.get("min_select") or 0),
            "max_select": int(row.get("max_select") or 0),
            "is_required": bool(row.get("is_required")),
        }
    for row in configuration.get("modifier_options", []):
        group = groups.get(row.get("group_id"))
        if not group:
            continue
        product = catalog[group["product_id"]]
        product["options"][row["id"]] = {
            "group_id": group["id"],
            "group_name": group["name"],
            "option_id": row["id"],
            "name": row["name"],
            "price_delta": float(row.get("price_delta") or 0),
            "is_available": bool(row.get("is_available")),
        }
    return catalog


def get_order(client: DbClient, order_id: UUID, business_id: UUID | None = None) -> dict:
    query = client.table("orders").select("*, order_items(*)").eq("id", str(order_id)).limit(1)
    if business_id:
        query = query.eq("business_id", str(business_id))
    response = query.execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    return response.data[0]


def list_orders(
    client: DbClient,
    business_id: UUID,
    status_filter: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    location_id: UUID | None = None,
    limit: int = 100,
) -> list[dict]:
    query = client.table("orders").select("*, order_items(*)").eq("business_id", str(business_id))
    if status_filter == "active":
        query = query.in_("status", ACTIVE_STATUSES)
    elif status_filter == "completed":
        query = query.eq("status", OrderStatus.COMPLETED.value)
    elif status_filter in {"done", "closed"}:
        query = query.in_("status", [OrderStatus.COMPLETED.value, OrderStatus.CANCELLED.value])
    if start:
        query = query.gte("placed_at", _to_utc_iso(start))
    if end:
        query = query.lte("placed_at", _to_utc_iso(end))
    if location_id:
        query = query.eq("location_id", str(location_id))
    response = query.order("placed_at", desc=True).limit(max(1, min(limit, 250))).execute()
    return [row for row in (response.data or []) if _is_production_order(row)]


def _is_production_order(order: dict) -> bool:
    """Exclude preview/test sources from owner Operations data without changing order lifecycle."""
    return str(order.get("source") or "").strip().lower() not in {"test", "preview", "sandbox", "preview_sandbox"}


def _to_utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def update_order_status(client: DbClient, user_id: UUID, order_id: UUID, payload: OrderStatusUpdate) -> dict:
    business = assert_business_access(client, payload.business_id, user_id, KITCHEN_ROLES)
    order = get_order(client, order_id, UUID(business["id"]))
    current_status = order["status"]
    next_status = payload.status.value
    if next_status not in VALID_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot move order from {current_status} to {next_status}.",
        )
    if next_status == OrderStatus.CANCELLED.value and not (payload.cancel_reason or "").strip():
        raise HTTPException(status_code=400, detail="Cancellation reason is required.")

    update_payload = {"status": next_status}
    update_payload.update(timestamps_for_status(next_status))
    if next_status == OrderStatus.CANCELLED.value:
        update_payload["cancel_reason"] = payload.cancel_reason.strip()
        payment_service._restore_reserved_inventory(client, payload.business_id, order_id)
    response = (
        client.table("orders")
        .update(update_payload)
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
            "old_status": current_status,
            "new_status": next_status,
            "changed_by": str(payload.changed_by or user_id),
        }
    ).execute()
    return get_order(client, order_id, payload.business_id)


def _business_is_open(business: dict) -> bool:
    schedule = business.get("store_schedule") or {}
    if schedule.get("emergency_closed"):
        return False

    try:
        tz = ZoneInfo(business.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        tz = timezone.utc

    now = datetime.now(tz)
    if schedule and schedule.get("enabled", True):
        override = next(
            (
                entry
                for entry in schedule.get("overrides", [])
                if entry.get("date") == now.date().isoformat()
            ),
            None,
        )
        day_schedule = override or (schedule.get("weekly") or {}).get(now.strftime("%A").lower())
        if day_schedule:
            if day_schedule.get("closed"):
                return False
            slots = day_schedule.get("slots") or []
            if not slots:
                return False
            return any(
                _time_is_within_slot(now.time(), slot.get("open"), slot.get("close"))
                for slot in slots
            )

    opening = business.get("opening_time")
    closing = business.get("closing_time")
    if not opening or not closing:
        return True

    now_time = now.time()
    open_time = _parse_time(opening)
    close_time = _parse_time(closing)
    if not open_time or not close_time:
        return True
    if open_time <= close_time:
        return open_time <= now_time <= close_time
    return now_time >= open_time or now_time <= close_time


def _time_is_within_slot(now_time, opening, closing) -> bool:
    open_time = _parse_time(opening)
    close_time = _parse_time(closing)
    if not open_time or not close_time:
        return False
    if open_time == close_time:
        return True
    if open_time < close_time:
        return open_time <= now_time < close_time
    return now_time >= open_time or now_time < close_time


def _product_time_available(product: dict, business: dict) -> bool:
    start = product.get("availability_start_time")
    end = product.get("availability_end_time")
    if not start and not end:
        return True

    try:
        tz = ZoneInfo(business.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        tz = timezone.utc

    now_time = datetime.now(tz).time()
    start_time = _parse_time(start)
    end_time = _parse_time(end)
    if start_time and end_time:
        if start_time <= end_time:
            return start_time <= now_time <= end_time
        return now_time >= start_time or now_time <= end_time
    if start_time:
        return now_time >= start_time
    if end_time:
        return now_time <= end_time
    return True


def _product_day_available(product: dict, business: dict) -> bool:
    if product.get("availability_type") != "scheduled":
        return True
    days = product.get("available_days") or []
    if not days:
        return True
    try:
        tz = ZoneInfo(business.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    today = datetime.now(tz).strftime("%A").lower()
    return today in {str(day).strip().lower() for day in days}


def _parse_time(value):
    if hasattr(value, "hour"):
        return value
    try:
        return datetime.strptime(str(value)[:5], "%H:%M").time()
    except ValueError:
        return None
