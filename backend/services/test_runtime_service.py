from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from database import DbClient
from schemas import TestRuntimeItemProgress, TestRuntimeKitchenAction, TestRuntimeOrderCreate, TestRuntimeOrderStatusUpdate, TestRuntimeReworkRequest
from services import setup_service, test_session_service


def _context(client: DbClient, token: str | None, app_type: str) -> dict:
    return test_session_service.runtime_context(client, token, app_type)


def _scope(session: dict) -> dict[str, str]:
    return {"test_session_id": str(session["id"]), "business_id": str(session["business_id"])}


def _assert_location(client: DbClient, location_id: UUID | None, business_id: str) -> None:
    if location_id and not client.fetch_one(
        "select id from business_locations where id=%(location_id)s and business_id=%(business_id)s",
        {"location_id": str(location_id), "business_id": business_id},
    ):
        raise HTTPException(status_code=404, detail="Location not found for this business.")


def _product_lines(client: DbClient, payload: TestRuntimeOrderCreate, business_id: str, session_id: str) -> list[dict]:
    ids = list(dict.fromkeys(str(item.product_id) for item in payload.items))
    rows = client.fetch_all(
        "select id,name,price,discount_type,discount_value,is_available,menu_status from products where business_id=%(business_id)s and id::text = any(%(product_ids)s)",
        {"business_id": business_id, "product_ids": ids},
    )
    products = {str(row["id"]): row for row in rows}
    overrides = {
        str(row["product_id"]): row["is_available"]
        for row in client.fetch_all(
            """select o.product_id,o.is_available from test_runtime_availability_overrides o
            join products p on p.id=o.product_id and p.business_id=%(business_id)s
            where o.test_session_id=%(test_session_id)s and o.product_id::text = any(%(product_ids)s)""",
            {"business_id": business_id, "test_session_id": session_id, "product_ids": ids},
        )
    }
    lines = []
    for item in payload.items:
        product = products.get(str(item.product_id))
        if not product or not product["is_available"] or product["menu_status"] != "shown" or overrides.get(str(item.product_id), True) is False:
            raise HTTPException(status_code=409, detail="One or more test items are unavailable.")
        unit_price = setup_service._effective_price(product)
        option_total, modifiers = setup_service._validated_options(client, business_id, product, item.modifiers) if item.modifiers else (Decimal("0"), [])
        unit_price += option_total
        lines.append({"id": str(uuid4()), "product_id": str(product["id"]), "name": product["name"], "quantity": item.quantity, "unit_price": float(unit_price), "line_total": float(unit_price * item.quantity), "modifiers": modifiers, "completed_quantity": 0})
    return lines


def _get(client: DbClient, session: dict, order_id: UUID, for_update: bool = False) -> dict:
    scope = _scope(session)
    row = client.fetch_one(
        f"select * from test_runtime_orders where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s{' for update' if for_update else ''}",
        {"order_id": str(order_id), **scope},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Test runtime order not found.")
    return row


def create(client: DbClient, token: str | None, app_type: str, payload: TestRuntimeOrderCreate) -> dict:
    session = _context(client, token, app_type)
    if payload.source != app_type:
        raise HTTPException(status_code=403, detail="This test application cannot create that order source.")
    scope = _scope(session)
    _assert_location(client, payload.location_id, scope["business_id"])
    if payload.idempotency_key:
        client.execute_one(
            "select pg_advisory_xact_lock(hashtextextended(%(key)s, 0)) as locked",
            {"key": f"test-runtime:{scope['business_id']}:{scope['test_session_id']}:{payload.idempotency_key}"},
        )
        replay = client.fetch_one(
            "select * from test_runtime_orders where test_session_id=%(test_session_id)s and business_id=%(business_id)s and idempotency_key=%(idempotency_key)s",
            {**scope, "idempotency_key": payload.idempotency_key},
        )
        if replay:
            return replay
    lines = _product_lines(client, payload, scope["business_id"], scope["test_session_id"])
    business = client.fetch_one("select tax_percent from businesses where id=%(business_id)s", {"business_id": scope["business_id"]}) or {}
    subtotal = sum((Decimal(str(line["line_total"])) for line in lines), Decimal("0"))
    tax = (subtotal * Decimal(str(business.get("tax_percent") or 0)) / Decimal("100")).quantize(Decimal("0.01"))
    order = client.fetch_one(
        """insert into test_runtime_orders
        (test_session_id,business_id,source,order_type,location_id,table_label,items,notes,subtotal,tax_amount,total_amount,payment_method,payment_status,kitchen_status,idempotency_key)
        values (%(test_session_id)s,%(business_id)s,%(source)s,%(order_type)s,%(location_id)s,%(table_label)s,%(items)s,%(notes)s,%(subtotal)s,%(tax)s,%(total)s,'simulated_test','awaiting_payment','pending_payment',%(idempotency_key)s)
        returning *""",
        {**scope, "source": payload.source, "order_type": payload.order_type, "location_id": str(payload.location_id) if payload.location_id else None, "table_label": payload.table_label, "items": Jsonb(lines), "notes": payload.notes, "subtotal": subtotal, "tax": tax, "total": subtotal + tax, "idempotency_key": payload.idempotency_key},
    )
    _event(client, session, order, app_type, "created", None, "pending_payment", {})
    return order


def list_current(client: DbClient, token: str | None, app_type: str, status: str | None = None) -> list[dict]:
    session = _context(client, token, app_type)
    scope = _scope(session)
    if status and status not in {"pending_payment", "pending", "preparing", "ready", "completed"}:
        raise HTTPException(status_code=422, detail="Unsupported test runtime order status.")
    params = {**scope, "status": status}
    if app_type == "kitchen" and status == "pending_payment":
        return []
    where = " and kitchen_status=%(status)s" if status else " and kitchen_status in ('pending','preparing','ready')" if app_type == "kitchen" else ""
    rows = client.fetch_all(f"select * from test_runtime_orders where test_session_id=%(test_session_id)s and business_id=%(business_id)s{where} order by created_at desc", params)
    return [_project(client, session, row) for row in rows] if app_type == "kitchen" else rows


def get_one(client: DbClient, token: str | None, app_type: str, order_id: UUID) -> dict:
    session = _context(client, token, app_type)
    order = _get(client, session, order_id)
    if app_type == "kitchen" and order["kitchen_status"] == "pending_payment":
        raise HTTPException(status_code=404, detail="Test runtime order not found.")
    return _project(client, session, order) if app_type == "kitchen" else order


def mark_paid(client: DbClient, token: str | None, order_id: UUID) -> dict:
    session = _context(client, token, "counter")
    scope = _scope(session)
    row = client.fetch_one(
        """update test_runtime_orders set payment_status='paid', kitchen_status='pending', paid_at=now(), updated_at=now()
        where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s
          and payment_status='awaiting_payment' and kitchen_status='pending_payment' returning *""",
        {"order_id": str(order_id), **scope},
    )
    if row:
        _event(client, session, row, "counter", "simulated_payment", "pending_payment", "pending", {})
        return row
    current = _get(client, session, order_id)
    if current["payment_status"] == "paid":
        return current
    raise HTTPException(status_code=409, detail="This test order cannot be paid in its current state.")


def update_status(client: DbClient, token: str | None, app_type: str, order_id: UUID, payload: TestRuntimeOrderStatusUpdate) -> dict:
    session = _context(client, token, app_type)
    if app_type != "kitchen":
        raise HTTPException(status_code=403, detail="Only the test Kitchen can change kitchen status.")
    current = _get(client, session, order_id, for_update=True)
    if payload.status == "ready" and current["kitchen_status"] != "ready":
        _assert_items_complete(current)
    return _transition_locked(client, session, current, payload.status, "kitchen_status_changed", payload.metadata)


def start(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeKitchenAction | None = None) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    if current["is_held"]:
        raise HTTPException(status_code=409, detail="Held orders must be resumed before preparation starts.")
    return _transition_locked(client, session, current, "preparing", "kitchen_preparing_started", (payload.metadata if payload else {}))


def complete_item(client: DbClient, token: str | None, order_id: UUID, item_id: UUID, payload: TestRuntimeItemProgress) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    if current["kitchen_status"] != "preparing" or current["is_held"]:
        raise HTTPException(status_code=409, detail="Items can only be completed while an order is Preparing.")
    items = [dict(item) for item in (current.get("items") or [])]
    item = next((item for item in items if str(item.get("id")) == str(item_id)), None)
    if not item:
        raise HTTPException(status_code=404, detail="Test runtime order item not found.")
    quantity = int(item.get("quantity") or 0)
    if payload.completed_quantity > quantity:
        raise HTTPException(status_code=422, detail="Completed quantity cannot exceed ordered quantity.")
    if int(item.get("completed_quantity") or 0) == payload.completed_quantity:
        return _project(client, session, current)
    item["completed_quantity"] = payload.completed_quantity
    scope = _scope(session)
    row = client.fetch_one("update test_runtime_orders set items=%(items)s,updated_at=now() where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s returning *", {**scope, "order_id": str(order_id), "items": Jsonb(items)})
    _event(client, session, row, "kitchen", "kitchen_item_completed", current["kitchen_status"], current["kitchen_status"], {"item_id": str(item_id), "completed_quantity": payload.completed_quantity})
    return _project(client, session, row)


def hold(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeKitchenAction) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    if current["is_held"]:
        return _project(client, session, current)
    if current["kitchen_status"] not in {"pending", "preparing"}:
        raise HTTPException(status_code=409, detail="Only New or Preparing orders can be held.")
    scope = _scope(session)
    row = client.fetch_one("update test_runtime_orders set is_held=true,previous_kitchen_status=kitchen_status,held_at=now(),held_by=%(held_by)s,hold_reason=%(reason)s,updated_at=now() where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s and is_held=false returning *", {**scope, "order_id": str(order_id), "held_by": session.get("created_by"), "reason": payload.reason})
    _event(client, session, row, "kitchen", "kitchen_held", current["kitchen_status"], current["kitchen_status"], {"reason": payload.reason, **payload.metadata})
    return _project(client, session, row)


def resume(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeKitchenAction | None = None) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    if not current["is_held"]:
        raise HTTPException(status_code=409, detail="Test runtime order is not held.")
    target = current.get("previous_kitchen_status")
    if target not in {"pending", "preparing"}:
        raise HTTPException(status_code=409, detail="Held order has no valid previous Kitchen state.")
    scope = _scope(session)
    row = client.fetch_one("update test_runtime_orders set is_held=false,previous_kitchen_status=null,held_at=null,held_by=null,hold_reason=null,updated_at=now() where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s and is_held=true returning *", {**scope, "order_id": str(order_id)})
    _event(client, session, row, "kitchen", "kitchen_resumed", current["kitchen_status"], target, {"resume_to": target, **((payload.metadata if payload else {}))})
    return _project(client, session, row)


def ready(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeKitchenAction | None = None) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    if current["kitchen_status"] == "ready" and not current["is_held"]:
        return _project(client, session, current)
    if current["kitchen_status"] != "preparing" or current["is_held"]:
        raise HTTPException(status_code=409, detail="Only Preparing orders can be marked Ready.")
    _assert_items_complete(current)
    return _transition_locked(client, session, current, "ready", "kitchen_ready", (payload.metadata if payload else {}))


def recall(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeKitchenAction | None = None) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    if current["kitchen_status"] != "ready" or current["is_held"]:
        raise HTTPException(status_code=409, detail="Only Ready orders can be recalled.")
    return _transition_locked(client, session, current, "preparing", "kitchen_recalled", {"reason": payload.reason if payload else None, **((payload.metadata if payload else {}))})


def rework(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeReworkRequest) -> dict:
    session = _context(client, token, "kitchen")
    current = _get(client, session, order_id, for_update=True)
    return _request_rework_locked(client, session, current, payload, "kitchen")


def request_rework(client: DbClient, token: str | None, order_id: UUID, payload: TestRuntimeReworkRequest) -> dict:
    session = _context(client, token, "counter")
    current = _get(client, session, order_id, for_update=True)
    return _request_rework_locked(client, session, current, payload, "counter")


def _request_rework_locked(client: DbClient, session: dict, current: dict, payload: TestRuntimeReworkRequest, app_type: str) -> dict:
    if current["kitchen_status"] != "ready" or current["is_held"]:
        raise HTTPException(status_code=409, detail="Rework can only be requested for a Ready order.")
    item_ids = {str(item.get("id")) for item in (current.get("items") or [])}
    if payload.item_ids and not set(map(str, payload.item_ids)).issubset(item_ids):
        raise HTTPException(status_code=404, detail="One or more rework items are not in this order.")
    affected = set(map(str, payload.item_ids)) or item_ids
    reworked_items = [
        {**item, "completed_quantity": 0} if str(item.get("id")) in affected else dict(item)
        for item in (current.get("items") or [])
    ]
    scope = _scope(session)
    row = client.fetch_one("update test_runtime_orders set kitchen_status='preparing',preparing_started_at=now(),items=%(items)s,rework_requested=true,rework_reason=%(reason)s,rework_requested_at=now(),rework_metadata=%(metadata)s,updated_at=now() where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s and kitchen_status='ready' returning *", {**scope, "order_id": str(current["id"]), "items": Jsonb(reworked_items), "reason": payload.reason, "metadata": Jsonb({**payload.metadata, "item_ids": [str(item_id) for item_id in payload.item_ids]})})
    _event(client, session, row, app_type, "counter_rework_requested" if app_type == "counter" else "rework_requested", current["kitchen_status"], "preparing", {"reason": payload.reason, "item_ids": [str(item_id) for item_id in payload.item_ids], **payload.metadata})
    return _project(client, session, row)


def counter_pending_payments(client: DbClient, token: str | None) -> list[dict]:
    session = _context(client, token, "counter")
    rows = client.fetch_all("select * from test_runtime_orders where test_session_id=%(test_session_id)s and business_id=%(business_id)s and payment_status='awaiting_payment' order by created_at desc", _scope(session))
    return [{**_project(client, session, row), "counter_state": "awaiting_payment", "payment_required": True} for row in rows]


def counter_kitchen_orders(client: DbClient, token: str | None) -> list[dict]:
    session = _context(client, token, "counter")
    rows = client.fetch_all("select * from test_runtime_orders where test_session_id=%(test_session_id)s and business_id=%(business_id)s and kitchen_status in ('pending','preparing','ready') order by created_at desc", _scope(session))
    return [{**_project(client, session, row), "counter_state": _counter_state(row)} for row in rows]


def handover(client: DbClient, token: str | None, order_id: UUID, metadata: dict | None = None) -> dict:
    session = _context(client, token, "counter")
    current = _get(client, session, order_id, for_update=True)
    if current.get("handed_over_at"):
        return {**_project(client, session, current), "counter_state": "handed_over"}
    if current["kitchen_status"] != "ready" or current["is_held"]:
        raise HTTPException(status_code=409, detail="Only Ready orders can be handed over.")
    scope = _scope(session)
    row = client.fetch_one("update test_runtime_orders set handed_over_at=now(),handed_over_by=%(handed_over_by)s,kitchen_status='completed',completed_at=coalesce(completed_at,now()),handover_metadata=%(metadata)s,updated_at=now() where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s and kitchen_status='ready' and handed_over_at is null returning *", {**scope, "order_id": str(order_id), "handed_over_by": session.get("created_by"), "metadata": Jsonb(metadata or {})})
    if not row:
        raise HTTPException(status_code=409, detail="Test order changed before handover completed.")
    _event(client, session, row, "counter", "counter_handover_completed", current["kitchen_status"], "completed", metadata or {})
    return {**_project(client, session, row), "counter_state": _counter_state(row)}


def handover_history(client: DbClient, token: str | None) -> list[dict]:
    session = _context(client, token, "counter")
    rows = client.fetch_all("select * from test_runtime_orders where test_session_id=%(test_session_id)s and business_id=%(business_id)s and handed_over_at is not null order by handed_over_at desc", _scope(session))
    return [{**_project(client, session, row), "counter_state": "handed_over"} for row in rows]


def _counter_state(order: dict) -> str:
    if order.get("handed_over_at"):
        return "handed_over"
    if order.get("kitchen_status") == "ready":
        return "ready_for_handover"
    return str(order.get("kitchen_status") or "unknown")


def history(client: DbClient, token: str | None) -> list[dict]:
    return list_current(client, token, "kitchen", "completed")


def summary(client: DbClient, token: str | None) -> dict:
    orders = list_current(client, token, "kitchen")
    counts = {"new": 0, "preparing": 0, "ready": 0, "held": 0, "delayed": 0}
    oldest = {"new": None, "preparing": None, "ready": None}
    for order in orders:
        lane = order["kitchen"]["stage"]
        if order["kitchen"]["is_held"]:
            counts["held"] += 1
            continue
        counts[{"pending": "new", "preparing": "preparing", "ready": "ready"}[lane]] += 1
        if order["kitchen"]["is_delayed"]:
            counts["delayed"] += 1
        timestamp = order["kitchen"].get({"pending": "created_at", "preparing": "preparing_started_at", "ready": "ready_at"}[lane]) or order.get("created_at")
        lane_key = {"pending": "new", "preparing": "preparing", "ready": "ready"}[lane]
        if timestamp and (oldest[lane_key] is None or _dt(timestamp) < _dt(oldest[lane_key])):
            oldest[lane_key] = timestamp
    return {"counts": counts, "oldest": oldest}


def _transition_locked(client: DbClient, session: dict, current: dict, next_status: str, event_type: str, metadata: dict) -> dict:
    if current["kitchen_status"] == next_status:
        return _project(client, session, current)
    allowed = {"pending": {"preparing"}, "preparing": {"ready"}, "ready": {"preparing", "completed"}}
    if current.get("is_held", False) or next_status not in allowed.get(current["kitchen_status"], set()):
        raise HTTPException(status_code=409, detail=f"Cannot move test order from {current['kitchen_status']} to {next_status}.")
    scope = _scope(session)
    timestamps = {
        "preparing": ",preparing_started_at=now()",
        "ready": ",ready_at=now()",
        "completed": ",completed_at=now()",
    }
    row = client.fetch_one(
        f"update test_runtime_orders set kitchen_status=%(status)s,updated_at=now(){timestamps.get(next_status, '')} where id=%(order_id)s and test_session_id=%(test_session_id)s and business_id=%(business_id)s and kitchen_status=%(previous_status)s and is_held=false returning *",
        {**scope, "order_id": str(current["id"]), "status": next_status, "previous_status": current["kitchen_status"]},
    )
    if not row:
        raise HTTPException(status_code=409, detail="Test runtime order changed before this Kitchen action completed.")
    _event(client, session, row, "kitchen", event_type, current["kitchen_status"], next_status, metadata)
    return _project(client, session, row)


def _assert_items_complete(order: dict) -> None:
    incomplete = [item for item in (order.get("items") or []) if int(item.get("completed_quantity") or 0) < int(item.get("quantity") or 0)]
    if incomplete:
        raise HTTPException(status_code=409, detail="All test Kitchen items must be completed before the order is Ready.")


def _project(client: DbClient, session: dict, order: dict) -> dict:
    items = []
    for raw in order.get("items") or []:
        item = dict(raw)
        completed = int(item.get("completed_quantity") or 0)
        item["completed_quantity"] = completed
        item["kitchen_status"] = "completed" if completed >= int(item.get("quantity") or 0) else "pending"
        items.append(item)
    threshold = _delay_threshold(client, str(session["business_id"]))
    delayed = False
    if threshold and order.get("created_at"):
        delayed = datetime.now(timezone.utc) > _dt(order["created_at"]) + threshold
    events = client.fetch_all(
        "select id,event_type,from_status,to_status,metadata,created_at from test_runtime_order_events where test_session_id=%(test_session_id)s and business_id=%(business_id)s and order_id=%(order_id)s order by created_at asc",
        {**_scope(session), "order_id": str(order["id"])},
    )
    return {
        **order,
        "items": items,
        "kitchen": {
            "stage": order.get("kitchen_status"),
            "is_held": bool(order.get("is_held")),
            "hold_reason": order.get("hold_reason"),
            "held_at": order.get("held_at"),
            "held_by": order.get("held_by"),
            "previous_state": order.get("previous_kitchen_status"),
            "is_delayed": delayed,
            "delayed": delayed,
            "delay_minutes": int(threshold.total_seconds() / 60) if threshold else None,
            "preparing_started_at": order.get("preparing_started_at"),
            "ready_at": order.get("ready_at"),
            "rework_requested": bool(order.get("rework_requested")),
            "rework_reason": order.get("rework_reason"),
            "rework_requested_at": order.get("rework_requested_at"),
        },
        "lifecycle_events": events,
    }


def _delay_threshold(client: DbClient, business_id: str):
    row = client.fetch_one("select kiosk_order_settings from businesses where id=%(business_id)s", {"business_id": business_id})
    settings = (row or {}).get("kiosk_order_settings") or {}
    minutes = settings.get("kitchen_delay_minutes") or (settings.get("kitchen") or {}).get("delay_minutes")
    try:
        return timedelta(minutes=int(minutes)) if minutes else None
    except (TypeError, ValueError):
        return None


def _dt(value) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def clear(client: DbClient, token: str | None, app_type: str) -> None:
    session = _context(client, token, app_type)
    client.execute_command(
        "delete from test_runtime_orders where test_session_id=%(test_session_id)s and business_id=%(business_id)s",
        _scope(session),
    )
    client.execute_command(
        "delete from test_runtime_availability_overrides o using products p where o.product_id=p.id and o.test_session_id=%(test_session_id)s and p.business_id=%(business_id)s",
        {"test_session_id": session["id"], "business_id": session["business_id"]},
    )


def availability(client: DbClient, token: str | None, app_type: str) -> list[dict]:
    session = _context(client, token, app_type)
    scope = _scope(session)
    return client.fetch_all(
        """select p.id as product_id,p.business_id,p.category_id,c.name as category_name,p.name,
        p.is_available as base_is_available,o.is_available as override_is_available,
        coalesce(o.is_available,p.is_available) as is_available,
        (o.product_id is not null) as has_override
        from products p
        left join categories c on c.id=p.category_id and c.business_id=p.business_id
        left join test_runtime_availability_overrides o
          on o.product_id=p.id and o.test_session_id=%(test_session_id)s
        where p.business_id=%(business_id)s order by p.name""",
        scope,
    )


def set_availability(client: DbClient, token: str | None, product_id: UUID, is_available: bool) -> dict:
    session = _context(client, token, "kitchen")
    scope = _scope(session)
    product = client.fetch_one(
        "select id,name,is_available from products where id=%(product_id)s and business_id=%(business_id)s",
        {"product_id": str(product_id), "business_id": scope["business_id"]},
    )
    if not product:
        raise HTTPException(status_code=404, detail="Test availability product not found.")
    return client.fetch_one(
        """insert into test_runtime_availability_overrides(test_session_id,product_id,is_available,updated_at)
        values (%(test_session_id)s,%(product_id)s,%(is_available)s,now())
        on conflict (test_session_id,product_id) do update set is_available=excluded.is_available,updated_at=now()
        returning test_session_id,product_id,is_available,updated_at""",
        {"test_session_id": scope["test_session_id"], "product_id": str(product_id), "is_available": is_available},
    )


def clear_availability(client: DbClient, token: str | None, product_id: UUID) -> None:
    session = _context(client, token, "kitchen")
    scope = _scope(session)
    product = client.fetch_one(
        "select id from products where id=%(product_id)s and business_id=%(business_id)s",
        {"product_id": str(product_id), "business_id": scope["business_id"]},
    )
    if not product:
        raise HTTPException(status_code=404, detail="Test availability product not found.")
    client.execute_command(
        "delete from test_runtime_availability_overrides where test_session_id=%(test_session_id)s and product_id=%(product_id)s",
        {"test_session_id": scope["test_session_id"], "product_id": str(product_id)},
    )


def _event(client: DbClient, session: dict, order: dict, app_type: str, event_type: str, from_status: str | None, to_status: str | None, metadata: dict) -> None:
    client.table("test_runtime_order_events").insert({"test_session_id": session["id"], "business_id": session["business_id"], "order_id": order["id"], "app_type": app_type, "event_type": event_type, "from_status": from_status, "to_status": to_status, "metadata": metadata}).execute()
