from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from schemas import OrderCreate
from services import order_service, payment_service, setup_service


class FakeClient:
    """Only the calls the idempotency branch makes; no database needed."""

    def __init__(self, existing=None):
        self.existing = existing

    def execute_one(self, sql, params=None):
        return {"locked": True}

    def fetch_one(self, sql, params=None):
        return self.existing


@pytest.fixture
def stores(monkeypatch):
    business = {"id": str(uuid4()), "slug": "demo-cafe", "name": "Demo Cafe", "is_active": True, "order_modes": ["dine_in", "takeaway"], "kiosk_order_settings": {}}
    monkeypatch.setattr(order_service, "get_business_by_slug", lambda _client, _slug: dict(business))
    monkeypatch.setattr(setup_service, "live_configuration", lambda _client, _business: {"business": {}, "products": [], "availability_rules": []})
    monkeypatch.setattr(order_service, "_business_is_open", lambda _business, now=None: True)
    monkeypatch.setattr(payment_service, "validate_kiosk_order_settings", lambda _client, _business, _payload: "pay_at_counter")
    monkeypatch.setattr(payment_service, "checkout_for_order", lambda _client, _order: None)
    return business


def _payload(quantity=1):
    return OrderCreate(order_type="takeaway", items=[{"product_id": str(uuid4()), "quantity": quantity}])


def test_reused_idempotency_key_with_a_different_request_is_refused(stores, monkeypatch):
    original = _payload(quantity=1)
    stored = order_service._request_fingerprint(UUID(stores["id"]), "hardware_kiosk", original)
    # The key belongs to an earlier order whose fingerprint is different from this retry.
    client = FakeClient(existing={"id": str(uuid4()), "idempotency_fingerprint": "not-this-request"})
    monkeypatch.setattr(order_service, "get_order", lambda *_args, **_kwargs: pytest.fail("another order must not be returned"))
    with pytest.raises(HTTPException) as exc:
        order_service.create_kiosk_order(client, "demo-cafe", _payload(quantity=3), source="hardware_kiosk", idempotency_key="order-key-123")
    assert exc.value.status_code == 409
    assert exc.value.detail == "This request key was already used for a different order."
    assert stored  # fingerprint is deterministic for the same request


def test_identical_replay_returns_the_original_order(stores, monkeypatch):
    payload = _payload(quantity=2)
    fingerprint = order_service._request_fingerprint(UUID(stores["id"]), "hardware_kiosk", payload)
    existing_id = str(uuid4())
    client = FakeClient(existing={"id": existing_id, "idempotency_fingerprint": fingerprint})
    monkeypatch.setattr(order_service, "get_order", lambda _client, order_id, _business_id: {"id": str(order_id), "status": "pending"})
    order = order_service.create_kiosk_order(client, "demo-cafe", payload, source="hardware_kiosk", idempotency_key="order-key-123")
    assert order["id"] == existing_id


def test_fingerprint_changes_when_the_request_changes(stores):
    business_id = UUID(stores["id"])
    base = _payload(quantity=1)
    same = OrderCreate(order_type=base.order_type, items=base.items)
    assert order_service._request_fingerprint(business_id, "hardware_kiosk", base) == order_service._request_fingerprint(business_id, "hardware_kiosk", same)
    changed = OrderCreate(order_type=base.order_type, items=[{"product_id": str(base.items[0].product_id), "quantity": 2}])
    assert order_service._request_fingerprint(business_id, "hardware_kiosk", base) != order_service._request_fingerprint(business_id, "hardware_kiosk", changed)
    assert order_service._request_fingerprint(business_id, "hardware_kiosk", base) != order_service._request_fingerprint(business_id, "qr_order", base)


# ---- Device tokens never travel in URL paths by default -------------------------------------------------

from fastapi.testclient import TestClient  # noqa: E402

from config import Settings, get_settings  # noqa: E402
from main import app  # noqa: E402
from services.rate_limit_service import reset_rate_limits  # noqa: E402

api = TestClient(app)
LEGACY_TOKEN = "device_token_value_1234567890"


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", f"/api/kiosk/live/{LEGACY_TOKEN}/menu"),
        ("POST", f"/api/kiosk/live/{LEGACY_TOKEN}/orders"),
        ("GET", f"/api/devices/live/{LEGACY_TOKEN}"),
        ("POST", f"/api/devices/live/{LEGACY_TOKEN}/session"),
        ("GET", f"/api/counter/live/{LEGACY_TOKEN}/payments"),
        ("GET", f"/api/kitchen/live/{LEGACY_TOKEN}/orders"),
    ],
)
def test_token_in_path_routes_are_off_by_default(method, path, monkeypatch):
    monkeypatch.setenv("LEGACY_DEVICE_TOKEN_ROUTES", "false")
    get_settings.cache_clear()
    try:
        response = api.request(method, path, json={})
        assert response.status_code == 404
    finally:
        get_settings.cache_clear()


def test_body_based_device_exchange_is_the_supported_path(monkeypatch):
    # The new route exists and rejects a malformed token before touching the database.
    response = api.post("/api/devices/live/session/exchange", json={"device_token": "short"})
    assert response.status_code == 422


# ---- Plaintext email outbox is local-only -----------------------------------------------------------------

from services import mail_service  # noqa: E402


def _settings(environment, outbox):
    return type("S", (), {"environment": environment, "email_outbox_dir": str(outbox), "smtp_host": None, "smtp_username": None, "smtp_password": None})()


@pytest.mark.parametrize("environment", ["production", "staging", "Production ", "unknown"])
def test_outbox_never_writes_message_bodies_outside_local_environments(environment, tmp_path, monkeypatch):
    monkeypatch.setattr(mail_service, "get_settings", lambda: _settings(environment, tmp_path))
    delivered = mail_service.send_email("owner@example.test", "Reset your PlaceURorder password", "https://app.example.test/reset?token=abc")
    assert delivered is False
    assert list(tmp_path.iterdir()) == []


def test_outbox_still_works_for_local_development(tmp_path, monkeypatch):
    monkeypatch.setattr(mail_service, "get_settings", lambda: _settings("local", tmp_path))
    mail_service.send_email("owner@example.test", "Reset your PlaceURorder password", "body")
    assert any(path.suffix == ".txt" for path in tmp_path.iterdir())


# ---- Production configuration refuses unsafe combinations --------------------------------------------------

def _production(**overrides):
    values = dict(
        _env_file=None,
        environment="production",
        database_url="postgresql://prod-db.example.com:5432/menutap",
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        jwt_secret="x" * 40,
        allow_dev_auth_bypass=False,
        payment_expiry_cron_secret="y" * 40,
        frontend_base_url="https://app.example.test",
        redis_url="redis://cache.example.test:6379/0",
    )
    values.update(overrides)
    return values


def test_production_requires_shared_rate_limit_storage():
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as exc:
        Settings(**_production(redis_url=None))
    assert "REDIS_URL must be set in production" in str(exc.value)


def test_production_refuses_legacy_device_token_routes():
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as exc:
        Settings(**_production(legacy_device_token_routes=True))
    assert "LEGACY_DEVICE_TOKEN_ROUTES must be false in production" in str(exc.value)


# ---- Public surface is minimal ----------------------------------------------------------------------------

def test_root_health_reveals_no_configuration():
    body = api.get("/").json()
    assert set(body) == {"status", "service"}


def test_uploads_are_not_served_from_the_api_filesystem():
    assert api.get("/uploads/anything.png").status_code == 404


def test_api_responses_carry_security_headers():
    reset_rate_limits()
    response = api.get("/api/kiosk/does-not-exist/menu")
    assert response.headers.get("Cache-Control") == "no-store"
    assert "default-src 'none'" in response.headers.get("Content-Security-Policy", "")
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
