from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from main import app
from routers import kiosk as kiosk_router
from services import business_service, order_service, payment_service, setup_service
from services.rate_limit_service import reset_rate_limits

client = TestClient(app)


def _business(**settings):
    return {
        "id": str(uuid4()),
        "slug": "demo-cafe",
        "name": "Demo Cafe",
        "is_active": True,
        "order_modes": ["dine_in", "takeaway"],
        "kiosk_order_settings": {"qr_ordering_enabled": True, **settings},
    }


@pytest.fixture
def store(monkeypatch):
    """Stubs the database layer so the public QR order rules run without Postgres."""
    state = {"business": _business(), "method": "pay_at_counter"}

    @contextmanager
    def fake_db():
        yield object()

    def reached_products(*_args, **_kwargs):
        raise RuntimeError("reached product validation")

    monkeypatch.setattr(kiosk_router, "db_context", fake_db)
    monkeypatch.setattr(order_service, "get_business_by_slug", lambda _client, _slug: dict(state["business"]))
    monkeypatch.setattr(business_service, "get_business_by_slug", lambda _client, _slug: dict(state["business"]))
    monkeypatch.setattr(setup_service, "live_configuration", lambda _client, business: {"business": {}, "products": [], "availability_rules": []})
    monkeypatch.setattr(order_service, "_business_is_open", lambda _business, now=None: True)
    monkeypatch.setattr(payment_service, "validate_kiosk_order_settings", lambda _client, _business, _payload: state["method"])
    monkeypatch.setattr(order_service, "_locked_products_for_order", reached_products)
    reset_rate_limits()
    return state


def _payload(**overrides):
    body = {
        "order_type": "takeaway",
        "payment_method": "pay_at_counter",
        "items": [{"product_id": str(uuid4()), "quantity": 2}],
    }
    body.update(overrides)
    return body


def test_qr_orders_are_rejected_until_the_owner_enables_them(store):
    store["business"] = _business(qr_ordering_enabled=False)
    response = client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload())
    assert response.status_code == 409
    assert response.json()["detail"] == "QR ordering is not enabled for this store."


def test_qr_orders_are_paid_at_the_counter_only(store):
    store["method"] = "stripe"
    response = client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload(payment_method="stripe"))
    assert response.status_code == 409
    assert response.json()["detail"] == "QR orders are paid at the counter when collected."


def test_dine_in_qr_orders_need_a_table(store):
    response = client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload(order_type="dine_in"))
    assert response.status_code == 422
    assert response.json()["detail"] == "Add a table number for dine-in orders."


def test_qr_orders_require_a_name_when_the_store_asks_for_one(store):
    store["business"] = _business(require_customer_name=True)
    response = client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload())
    assert response.status_code == 422
    assert response.json()["detail"] == "Customer name is required."


def test_valid_qr_order_passes_the_store_rules_and_reaches_product_checks(store):
    with pytest.raises(RuntimeError, match="reached product validation"):
        client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload(table_label="4", order_type="dine_in"))


def test_store_status_is_public_and_reports_qr_ordering(store, monkeypatch):
    store["business"] = _business()
    response = client.get("/api/kiosk/demo-cafe/store")
    assert response.status_code == 200
    body = response.json()
    assert body["qr_ordering_enabled"] is True
    assert body["is_open"] is True
    assert body["store_url"].endswith("/order/demo-cafe")
    assert "id" not in body and "business_id" not in body


def test_owner_qr_switch_wins_over_a_stale_published_snapshot(store, monkeypatch):
    # The published menu snapshot can be older than the owner's switch; the live switch must still decide.
    store["business"] = _business(qr_ordering_enabled=True)
    monkeypatch.setattr(setup_service, "live_configuration", lambda _client, _business: {"business": {"kiosk_order_settings": {"qr_ordering_enabled": False}}, "products": [], "availability_rules": []})
    with pytest.raises(RuntimeError, match="reached product validation"):
        client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload())
    store["business"] = _business(qr_ordering_enabled=False)
    response = client.post("/api/kiosk/demo-cafe/qr-orders", json=_payload())
    assert response.status_code == 409
    assert response.json()["detail"] == "QR ordering is not enabled for this store."


def test_production_refuses_a_localhost_customer_link():
    from pydantic import ValidationError

    from config import Settings

    with pytest.raises(ValidationError) as exc:
        Settings(
            _env_file=None,
            environment="production",
            database_url="postgresql://prod-db.example.com:5432/menutap",
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            jwt_secret="x" * 40,
            allow_dev_auth_bypass=False,
            payment_expiry_cron_secret="y" * 40,
            frontend_base_url="http://localhost:3000",
        )
    assert "FRONTEND_BASE_URL must be the public https app URL" in str(exc.value)
