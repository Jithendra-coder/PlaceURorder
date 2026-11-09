from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException

from schemas import TestRuntimeItemProgress as RuntimeItemProgress, TestRuntimeKitchenAction as RuntimeKitchenAction, TestRuntimeOrderCreate as RuntimeOrderCreate, TestRuntimeOrderStatusUpdate as RuntimeOrderStatusUpdate, TestRuntimeReworkRequest as RuntimeReworkRequest
from services import test_runtime_service


SESSION = {"id": "session-1", "business_id": "business-1", "created_by": "user-1"}
PRODUCT_ID = UUID("00000000-0000-0000-0000-000000000001")
ORDER_ID = UUID("00000000-0000-0000-0000-000000000002")
ITEM_ID = UUID("00000000-0000-0000-0000-000000000003")
ITEM_TWO_ID = UUID("00000000-0000-0000-0000-000000000004")


class Table:
    def __init__(self, client):
        self.client = client

    def insert(self, payload):
        self.client.events.append(payload)
        return self

    def execute(self):
        return type("Response", (), {"data": [self.client.events[-1]]})()


class RuntimeClient:
    def __init__(self):
        self.events = []
        self.commands = []
        self.orders_by_key = {}
        self.order = {
            "id": str(ORDER_ID), "test_session_id": "session-1", "business_id": "business-1",
            "source": "kiosk", "order_type": "dine_in", "payment_status": "awaiting_payment",
            "kitchen_status": "pending_payment", "items": [],
        }

    def table(self, _name):
        return Table(self)

    def fetch_all(self, sql, params):
        if "from products" in sql:
            return [{"id": str(PRODUCT_ID), "name": "Tea", "price": 10, "is_available": True, "menu_status": "shown"}]
        if "test_runtime_availability_overrides" in sql:
            return []
        return []

    def fetch_one(self, sql, params):
        if "from test_runtime_orders" in sql and "idempotency_key" in sql and "select *" in sql:
            return self.orders_by_key.get(params["idempotency_key"])
        if "insert into test_runtime_orders" in sql:
            self.order = {**self.order, "source": params["source"], "order_type": params["order_type"], "items": params["items"].obj, "subtotal": params["subtotal"], "tax_amount": params["tax"], "total_amount": params["total"], "payment_status": "awaiting_payment", "kitchen_status": "pending_payment", "idempotency_key": params["idempotency_key"]}
            if params["idempotency_key"]:
                self.orders_by_key[params["idempotency_key"]] = self.order
            return self.order
        if "update test_runtime_orders" in sql:
            if self.order["payment_status"] == "awaiting_payment":
                self.order.update(payment_status="paid", kitchen_status="pending")
                return self.order
            return None
        if "from business_locations" in sql:
            return None
        if "select kiosk_order_settings from businesses" in sql:
            return {"kiosk_order_settings": {}}
        if "select tax_percent from businesses" in sql:
            return {"tax_percent": 5}
        if "test_runtime_order_events" in sql:
            return self.events
        if "select * from test_runtime_orders" in sql:
            return self.order
        raise AssertionError(sql)

    def execute_command(self, sql, params):
        self.commands.append((sql, params))
        return 1

    def execute_one(self, sql, params):
        self.commands.append((sql, params))
        return None


def payload(source="kiosk", key=None):
    return RuntimeOrderCreate(source=source, items=[{"product_id": PRODUCT_ID, "quantity": 2}], idempotency_key=key)


def test_create_uses_server_session_scope_and_one_shared_order(monkeypatch):
    client = RuntimeClient()
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**SESSION, "app_type": "kiosk"})

    order = test_runtime_service.create(client, "ignored-token", "kiosk", payload("kiosk", "create-1"))

    assert order["test_session_id"] == SESSION["id"]
    assert order["business_id"] == SESSION["business_id"]
    assert order["source"] == "kiosk"
    assert client.events[0]["event_type"] == "created"
    assert "business_id" not in payload().model_dump()


def test_create_serializes_and_reuses_idempotent_retries(monkeypatch):
    client = RuntimeClient()
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**SESSION, "app_type": "kiosk"})

    first = test_runtime_service.create(client, "token", "kiosk", payload("kiosk", "create-retry"))
    second = test_runtime_service.create(client, "token", "kiosk", payload("kiosk", "create-retry"))

    assert first == second
    assert sum(event["event_type"] == "created" for event in client.events) == 1
    assert sum("pg_advisory_xact_lock" in sql for sql, _params in client.commands) == 2


def test_counter_cannot_create_a_kiosk_source_order(monkeypatch):
    client = RuntimeClient()
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**SESSION, "app_type": "counter"})

    with pytest.raises(HTTPException) as exc:
        test_runtime_service.create(client, "token", "counter", payload("kiosk"))
    assert exc.value.status_code == 403


def test_simulated_payment_is_atomic_and_retry_is_idempotent(monkeypatch):
    client = RuntimeClient()
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**SESSION, "app_type": "counter"})

    first = test_runtime_service.mark_paid(client, "token", ORDER_ID)
    second = test_runtime_service.mark_paid(client, "token", ORDER_ID)

    assert first["payment_status"] == "paid"
    assert second["payment_status"] == "paid"
    assert sum(event["event_type"] == "simulated_payment" for event in client.events) == 1


def test_invalid_lifecycle_transition_fails_without_mutation(monkeypatch):
    client = RuntimeClient()
    client.order.update(payment_status="paid", kitchen_status="ready")
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**SESSION, "app_type": "kitchen"})

    with pytest.raises(HTTPException) as exc:
        test_runtime_service.update_status(client, "token", "kitchen", ORDER_ID, RuntimeOrderStatusUpdate(status="preparing"))

    assert exc.value.status_code == 409
    assert not any("update test_runtime_orders" in sql for sql, _params in client.commands)


def test_kitchen_list_hides_orders_waiting_for_payment(monkeypatch):
    client = RuntimeClient()
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**SESSION, "app_type": "kitchen"})

    orders = test_runtime_service.list_current(client, "token", "kitchen")

    assert orders == []


class KitchenClient(RuntimeClient):
    def __init__(self, status="pending", paid=True, created_at=None, delay_minutes=None):
        super().__init__()
        self.order.update({
            "payment_status": "paid" if paid else "awaiting_payment",
            "kitchen_status": status if paid else "pending_payment",
            "is_held": False,
            "held_at": None,
            "held_by": None,
            "hold_reason": None,
            "previous_kitchen_status": None,
            "created_at": created_at or datetime.now(timezone.utc),
            "preparing_started_at": None,
            "ready_at": None,
            "completed_at": None,
            "rework_requested": False,
            "rework_reason": None,
            "rework_requested_at": None,
            "items": [
                {"id": str(ITEM_ID), "product_id": str(PRODUCT_ID), "name": "Tea", "quantity": 1, "modifiers": [], "completed_quantity": 0},
                {"id": str(ITEM_TWO_ID), "product_id": str(PRODUCT_ID), "name": "Tea", "quantity": 1, "modifiers": [], "completed_quantity": 0},
            ],
        })
        self.delay_minutes = delay_minutes
        self.overrides = {}

    def fetch_all(self, sql, params):
        if "test_runtime_availability_overrides" in sql:
            value = self.overrides.get((params["test_session_id"], str(PRODUCT_ID)))
            return [] if value is None else [{"product_id": str(PRODUCT_ID), "is_available": value}]
        if "product_modifier_options" in sql:
            return [{"id": "modifier-1", "group_id": "group-1", "product_id": str(PRODUCT_ID), "group_name": "Size", "name": "Large", "price_delta": 2, "is_available": True}]
        if "from test_runtime_orders" in sql:
            if "handed_over_at is not null" in sql and not self.order.get("handed_over_at"):
                return []
            if "kitchen_status in ('pending','preparing','ready')" in sql and self.order["kitchen_status"] not in {"pending", "preparing", "ready"}:
                return []
            if "kitchen_status=%(status)s" in sql and self.order["kitchen_status"] != params.get("status"):
                return []
            return [self.order]
        return super().fetch_all(sql, params)

    def fetch_one(self, sql, params):
        if "select kiosk_order_settings from businesses" in sql:
            return {"kiosk_order_settings": {"kitchen_delay_minutes": self.delay_minutes} if self.delay_minutes else {}}
        if "from products where id=%(product_id)s" in sql:
            return {"id": str(PRODUCT_ID), "name": "Tea", "is_available": True} if params["business_id"] == self.order["business_id"] else None
        if "update test_runtime_orders" in sql:
            if "handed_over_at=now()" in sql:
                self.order.update(handed_over_at=datetime.now(timezone.utc), handed_over_by=params["handed_over_by"], kitchen_status="completed", completed_at=datetime.now(timezone.utc))
                return self.order
            if "kitchen_status=%(status)s" in sql:
                if self.order["kitchen_status"] != params["previous_status"] or self.order["is_held"]:
                    return None
                self.order["kitchen_status"] = params["status"]
                if params["status"] == "preparing":
                    self.order["preparing_started_at"] = datetime.now(timezone.utc)
                if params["status"] == "ready":
                    self.order["ready_at"] = datetime.now(timezone.utc)
                if params["status"] == "completed":
                    self.order["completed_at"] = datetime.now(timezone.utc)
                return self.order
            if "items=%(items)s" in sql:
                self.order["items"] = params["items"].obj
                if "rework_requested=true" in sql:
                    self.order.update(kitchen_status="preparing", preparing_started_at=datetime.now(timezone.utc), rework_requested=True, rework_reason=params["reason"], rework_requested_at=datetime.now(timezone.utc), rework_metadata=params["metadata"].obj)
                return self.order
            if "rework_requested=true" in sql:
                self.order.update(kitchen_status="preparing", preparing_started_at=datetime.now(timezone.utc), rework_requested=True, rework_reason=params["reason"], rework_requested_at=datetime.now(timezone.utc), rework_metadata=params["metadata"].obj)
                return self.order
            if "set is_held=true" in sql:
                self.order.update(is_held=True, previous_kitchen_status=self.order["kitchen_status"], held_at=datetime.now(timezone.utc), held_by=params["held_by"], hold_reason=params["reason"])
                return self.order
            if "set is_held=false" in sql:
                self.order.update(is_held=False, previous_kitchen_status=None, held_at=None, held_by=None, hold_reason=None)
                return self.order
            if "insert into test_runtime_availability_overrides" in sql:
                self.overrides[(params["test_session_id"], params["product_id"])] = params["is_available"]
                return {"product_id": params["product_id"], "is_available": params["is_available"]}
        if "select * from test_runtime_orders" in sql and (params.get("business_id") != self.order["business_id"] or params.get("test_session_id") != self.order["test_session_id"]):
            return None
        return super().fetch_one(sql, params)


def kitchen_context(monkeypatch, app_type="kitchen", session=SESSION):
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**session, "app_type": app_type})


def kitchen_action(reason="busy"):
    return RuntimeKitchenAction(reason=reason)


def test_paid_order_appears_in_new_and_summary(monkeypatch):
    client = KitchenClient(status="pending", paid=True)
    kitchen_context(monkeypatch)

    orders = test_runtime_service.list_current(client, "token", "kitchen")
    counts = test_runtime_service.summary(client, "token")["counts"]

    assert orders[0]["kitchen"]["stage"] == "pending"
    assert counts["new"] == 1
    assert counts["held"] == 0


def test_start_preparing_and_duplicate_request_create_one_event(monkeypatch):
    client = KitchenClient()
    kitchen_context(monkeypatch)

    first = test_runtime_service.start(client, "token", ORDER_ID)
    second = test_runtime_service.start(client, "token", ORDER_ID)

    assert first["kitchen"]["stage"] == "preparing"
    assert second["kitchen"]["stage"] == "preparing"
    assert sum(event["event_type"] == "kitchen_preparing_started" for event in client.events) == 1


def test_item_progress_persists_and_ready_requires_every_item(monkeypatch):
    client = KitchenClient()
    kitchen_context(monkeypatch)
    test_runtime_service.start(client, "token", ORDER_ID)

    progress = test_runtime_service.complete_item(client, "token", ORDER_ID, ITEM_ID, RuntimeItemProgress(completed_quantity=1))
    assert progress["items"][0]["completed_quantity"] == 1
    with pytest.raises(HTTPException) as exc:
        test_runtime_service.ready(client, "token", ORDER_ID)
    assert exc.value.status_code == 409

    test_runtime_service.complete_item(client, "token", ORDER_ID, ITEM_TWO_ID, RuntimeItemProgress(completed_quantity=1))
    ready = test_runtime_service.ready(client, "token", ORDER_ID)
    duplicate = test_runtime_service.ready(client, "token", ORDER_ID)
    assert ready["kitchen"]["stage"] == "ready"
    assert duplicate["kitchen"]["stage"] == "ready"
    assert sum(event["event_type"] == "kitchen_ready" for event in client.events) == 1


def test_hold_resume_from_new_preserves_new_lane(monkeypatch):
    client = KitchenClient()
    kitchen_context(monkeypatch)

    held = test_runtime_service.hold(client, "token", ORDER_ID, kitchen_action("waiting"))
    resumed = test_runtime_service.resume(client, "token", ORDER_ID)

    assert held["kitchen"]["is_held"] is True
    assert held["kitchen"]["previous_state"] == "pending"
    assert resumed["kitchen"]["stage"] == "pending"
    assert resumed["kitchen"]["is_held"] is False


def test_hold_resume_from_preparing_preserves_progress_and_lane(monkeypatch):
    client = KitchenClient()
    kitchen_context(monkeypatch)
    test_runtime_service.start(client, "token", ORDER_ID)
    test_runtime_service.complete_item(client, "token", ORDER_ID, ITEM_ID, RuntimeItemProgress(completed_quantity=1))

    test_runtime_service.hold(client, "token", ORDER_ID, kitchen_action("ingredient delay"))
    resumed = test_runtime_service.resume(client, "token", ORDER_ID)

    assert resumed["kitchen"]["stage"] == "preparing"
    assert resumed["items"][0]["completed_quantity"] == 1


def test_delayed_is_a_classification_not_a_lane(monkeypatch):
    client = KitchenClient(created_at=datetime.now(timezone.utc) - timedelta(minutes=5), delay_minutes=1)
    kitchen_context(monkeypatch)

    order = test_runtime_service.list_current(client, "token", "kitchen")[0]
    summary = test_runtime_service.summary(client, "token")

    assert order["kitchen"]["is_delayed"] is True
    assert order["kitchen"]["stage"] == "pending"
    assert summary["counts"]["delayed"] == 1


def test_recall_and_rework_return_ready_order_to_preparing(monkeypatch):
    client = KitchenClient(status="ready")
    for item in client.order["items"]:
        item["completed_quantity"] = item["quantity"]
    kitchen_context(monkeypatch)

    recalled = test_runtime_service.recall(client, "token", ORDER_ID, kitchen_action("quality check"))
    assert recalled["kitchen"]["stage"] == "preparing"
    test_runtime_service.ready(client, "token", ORDER_ID)
    reworked = test_runtime_service.rework(client, "token", ORDER_ID, RuntimeReworkRequest(reason="missing garnish", item_ids=[ITEM_ID]))

    assert reworked["kitchen"]["stage"] == "preparing"
    assert reworked["kitchen"]["rework_requested"] is True
    assert reworked["items"][0]["completed_quantity"] == 0
    assert sum(event["event_type"] == "kitchen_ready" for event in client.events) == 1
    assert sum(event["event_type"] == "kitchen_recalled" for event in client.events) == 1
    assert sum(event["event_type"] == "rework_requested" for event in client.events) == 1


def test_completed_order_moves_to_history(monkeypatch):
    client = KitchenClient(status="preparing")
    for item in client.order["items"]:
        item["completed_quantity"] = item["quantity"]
    kitchen_context(monkeypatch)

    test_runtime_service.ready(client, "token", ORDER_ID)
    completed = test_runtime_service.update_status(client, "token", "kitchen", ORDER_ID, RuntimeOrderStatusUpdate(status="completed"))

    assert completed["kitchen"]["stage"] == "completed"
    assert test_runtime_service.history(client, "token")[0]["kitchen"]["stage"] == "completed"
    assert test_runtime_service.list_current(client, "token", "kitchen") == []


def test_business_scope_and_expired_session_reject_kitchen_mutations(monkeypatch):
    client = KitchenClient()
    kitchen_context(monkeypatch, session={**SESSION, "business_id": "business-B"})
    with pytest.raises(HTTPException) as scope_error:
        test_runtime_service.start(client, "token", ORDER_ID)
    assert scope_error.value.status_code == 404

    def expired(*_args):
        raise HTTPException(status_code=401, detail="This test kiosk session is invalid or expired.")
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", expired)
    with pytest.raises(HTTPException) as session_error:
        test_runtime_service.start(client, "expired", ORDER_ID)
    assert session_error.value.status_code == 401


def counter_context(monkeypatch, session=SESSION):
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", lambda *_args: {**session, "app_type": "counter"})


def counter_payload(order_type="dine_in", modifiers=None):
    return RuntimeOrderCreate(source="counter", order_type=order_type, table_label="T12" if order_type == "dine_in" else None, notes="No onions", items=[{"product_id": PRODUCT_ID, "quantity": 2, "modifiers": modifiers or []}])


def test_counter_creates_dine_in_and_takeaway_orders_with_pricing_and_lines(monkeypatch):
    client = KitchenClient()
    counter_context(monkeypatch)
    dine_in = test_runtime_service.create(client, "token", "counter", counter_payload("dine_in", [{"option_id": "modifier-1"}]))
    assert dine_in["source"] == "counter"
    assert dine_in["order_type"] == "dine_in"
    assert dine_in["items"][0]["quantity"] == 2
    assert dine_in["items"][0]["modifiers"][0]["name"] == "Large"
    assert dine_in["total_amount"] > dine_in["subtotal"]

    client.order["idempotency_key"] = None
    takeaway = test_runtime_service.create(client, "token", "counter", counter_payload("takeaway"))
    assert takeaway["order_type"] == "takeaway"
    assert takeaway["table_label"] if "table_label" in takeaway else True


def test_counter_respects_test_availability_without_mutating_product(monkeypatch):
    client = KitchenClient()
    client.overrides[(SESSION["id"], str(PRODUCT_ID))] = False
    counter_context(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        test_runtime_service.create(client, "token", "counter", counter_payload())
    assert exc.value.status_code == 409
    assert client.order.get("is_available", True) is True


def test_counter_payment_and_kiosk_pay_at_counter_flow_reaches_kitchen_once(monkeypatch):
    client = KitchenClient(status="pending", paid=False)
    client.order.update(source="kiosk", kitchen_status="pending_payment", payment_status="awaiting_payment")
    counter_context(monkeypatch)

    pending = test_runtime_service.counter_pending_payments(client, "token")
    assert len(pending) == 1
    assert pending[0]["source"] == "kiosk"
    assert test_runtime_service.counter_kitchen_orders(client, "token") == []

    paid = test_runtime_service.mark_paid(client, "token", ORDER_ID)
    retry = test_runtime_service.mark_paid(client, "token", ORDER_ID)
    kitchen_orders = test_runtime_service.counter_kitchen_orders(client, "token")
    assert paid["payment_status"] == "paid"
    assert retry["payment_status"] == "paid"
    assert len(kitchen_orders) == 1
    assert sum(event["event_type"] == "simulated_payment" for event in client.events) == 1


def test_counter_observes_preparing_and_ready_for_handover(monkeypatch):
    client = KitchenClient()
    kitchen_context(monkeypatch)
    test_runtime_service.start(client, "token", ORDER_ID)
    counter_context(monkeypatch)
    assert test_runtime_service.counter_kitchen_orders(client, "token")[0]["counter_state"] == "preparing"

    kitchen_context(monkeypatch)
    for item in client.order["items"]:
        test_runtime_service.complete_item(client, "token", ORDER_ID, UUID(item["id"]), RuntimeItemProgress(completed_quantity=item["quantity"]))
    test_runtime_service.ready(client, "token", ORDER_ID)
    counter_context(monkeypatch)
    assert test_runtime_service.counter_kitchen_orders(client, "token")[0]["counter_state"] == "ready_for_handover"


def test_handover_is_ready_only_idempotent_and_history_is_isolated(monkeypatch):
    client = KitchenClient(status="ready")
    for item in client.order["items"]:
        item["completed_quantity"] = item["quantity"]
    counter_context(monkeypatch)

    with pytest.raises(HTTPException):
        invalid = KitchenClient(status="pending")
        test_runtime_service.handover(invalid, "token", ORDER_ID)
    handed = test_runtime_service.handover(client, "token", ORDER_ID)
    duplicate = test_runtime_service.handover(client, "token", ORDER_ID)
    history = test_runtime_service.handover_history(client, "token")

    assert handed["counter_state"] == "handed_over"
    assert duplicate["counter_state"] == "handed_over"
    assert len(history) == 1
    assert sum(event["event_type"] == "counter_handover_completed" for event in client.events) == 1


def test_counter_rework_returns_to_kitchen_and_back_to_handover(monkeypatch):
    client = KitchenClient(status="ready")
    for item in client.order["items"]:
        item["completed_quantity"] = item["quantity"]
    counter_context(monkeypatch)

    rework = test_runtime_service.request_rework(client, "token", ORDER_ID, RuntimeReworkRequest(reason="Missing garnish", item_ids=[ITEM_ID]))
    assert rework["kitchen"]["stage"] == "preparing"
    kitchen_context(monkeypatch)
    for item in client.order["items"]:
        test_runtime_service.complete_item(client, "token", ORDER_ID, UUID(item["id"]), RuntimeItemProgress(completed_quantity=item["quantity"]))
    test_runtime_service.ready(client, "token", ORDER_ID)
    counter_context(monkeypatch)
    assert test_runtime_service.counter_kitchen_orders(client, "token")[0]["counter_state"] == "ready_for_handover"


def test_counter_session_and_business_scope_reject_access_and_expired_mutation(monkeypatch):
    client = KitchenClient(status="ready")
    counter_context(monkeypatch, {**SESSION, "id": "session-b"})
    with pytest.raises(HTTPException) as session_error:
        test_runtime_service.handover(client, "token", ORDER_ID)
    assert session_error.value.status_code == 404

    counter_context(monkeypatch, {**SESSION, "business_id": "business-b"})
    with pytest.raises(HTTPException) as business_error:
        test_runtime_service.handover(client, "token", ORDER_ID)
    assert business_error.value.status_code == 404

    def expired(*_args):
        raise HTTPException(status_code=401, detail="This test kiosk session is invalid or expired.")
    monkeypatch.setattr(test_runtime_service.test_session_service, "runtime_context", expired)
    with pytest.raises(HTTPException) as expired_error:
        test_runtime_service.handover(client, "expired", ORDER_ID)
    assert expired_error.value.status_code == 401
