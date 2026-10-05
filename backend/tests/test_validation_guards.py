import asyncio
import base64
import json
import re
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from psycopg.types.json import Jsonb
from starlette.requests import Request

from config import Settings
from database import JSON_FIELDS, _adapt_value
from deps import _authenticated_token, require_user_id
from routers import maintenance
from schemas import (
    BusinessCreate,
    BusinessUpdate,
    ComboCreate,
    ComboOptionInput,
    ComboSectionInput,
    DeviceCreate,
    ModifierGroupCreate,
    ModifierGroupUpdate,
    OwnerPinSet,
    OwnerPinVerify,
    PaytmDynamicQrCreate,
    PaymentStatus,
    ProductCreate,
    ProductUpdate,
    StaffInvite,
    StaffRole,
)
from services import business_service, combo_service, device_service, payment_service, pin_service, product_service, rate_limit_service, staff_service, storage_service


class DummySettings:
    def __init__(self, upload_root: str):
        self.upload_root = upload_root
        self.public_base_url = "http://testserver"
        self.supabase_url = "https://project.supabase.co"
        self.supabase_publishable_key = "sb_publishable_test"


class DummyUpload:
    def __init__(self, content: bytes, content_type: str, filename: str = "upload.png"):
        self._content = content
        self.content_type = content_type
        self.filename = filename

    async def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            return self._content
        return self._content[:size]


class FakeSlugClient:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.candidates: list[str] = []

    def table(self, _name: str):
        return self

    def select(self, _columns: str):
        return self

    def in_(self, _column: str, candidates: list[str]):
        self.candidates = candidates
        return self

    def execute(self):
        return SimpleNamespace(data=[row for row in self.rows if row["slug"] in self.candidates])


class FakeExecuteClient:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute_one(self, sql: str, params: dict):
        self.calls.append((sql, params))
        return {"id": "alert-id"}


class FakePinSaveClient:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute_one(self, sql: str, params: dict):
        self.calls.append((sql, params))
        return {"id": params.get("business_id", "business-id"), "owner_pin_set_at": "2026-06-24T10:00:00+00:00"}


class FakeBusinessAccessClient:
    def __init__(self, businesses: list[dict], staff: list[dict]):
        self.businesses = businesses
        self.staff = staff

    def table(self, name: str):
        return FakeBusinessAccessTable(self, name)


class FakeBusinessAccessTable:
    def __init__(self, client: FakeBusinessAccessClient, name: str):
        self.client = client
        self.name = name
        self.filters: dict[str, str] = {}

    def select(self, _columns: str):
        return self

    def eq(self, column: str, value: str):
        self.filters[column] = str(value)
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        rows = self.client.businesses if self.name == "businesses" else self.client.staff
        filtered = [
            row
            for row in rows
            if all(str(row.get(column)) == value for column, value in self.filters.items())
        ]
        return SimpleNamespace(data=filtered)


class FakePaymentExpiryClient:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.executed: list[tuple[str, dict]] = []

    def fetch_all(self, sql: str, params: dict):
        self.executed.append((sql, params))
        return self.rows


class FakeDeviceTokenClient:
    def __init__(self, devices: list[dict], businesses: list[dict] | None = None):
        self.devices = devices
        self.businesses = businesses or []

    def table(self, name: str):
        return FakeDeviceTokenTable(self, name)


class FakeDeviceTokenTable:
    def __init__(self, client: FakeDeviceTokenClient, name: str):
        self.client = client
        self.name = name
        self.filters: dict[str, str] = {}

    def select(self, _columns: str):
        return self

    def eq(self, column: str, value: str):
        self.filters[column] = str(value)
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        rows = self.client.devices if self.name == "devices" else self.client.businesses
        filtered = [
            row
            for row in rows
            if all(str(row.get(column)) == value for column, value in self.filters.items())
        ]
        return SimpleNamespace(data=filtered)


class FakePaymentExpireActionClient:
    def __init__(self):
        self.order_updates: list[tuple[str, dict]] = []

    def table(self, name: str):
        return FakePaymentExpireActionTable(self, name)


class FakePaymentExpireActionTable:
    def __init__(self, client: FakePaymentExpireActionClient, name: str):
        self.client = client
        self.name = name
        self.update_payload: dict | None = None
        self.filters: dict[str, str] = {}

    def update(self, payload: dict):
        self.update_payload = payload
        return self

    def eq(self, column: str, value: str):
        self.filters[column] = value
        return self

    def execute(self):
        if self.name == "orders":
            self.client.order_updates.append((self.name, self.update_payload or {}))
        return SimpleNamespace(data=[{"id": "updated"}])


def test_upload_rejects_spoofed_image_content(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_service, "get_settings", lambda: DummySettings(str(tmp_path)))
    file = DummyUpload(b"this is not a png", "image/png")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(async_upload(file))

    assert exc.value.status_code == 400


def test_upload_rejects_oversized_image(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_service, "get_settings", lambda: DummySettings(str(tmp_path)))
    oversized = b"\x89PNG\r\n\x1a\n" + (b"x" * storage_service.MAX_UPLOAD_BYTES)
    file = DummyUpload(oversized, "image/png")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(async_upload(file))

    assert exc.value.status_code == 413


def test_upload_accepts_supported_image_signature(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_service, "get_settings", lambda: DummySettings(str(tmp_path)))
    monkeypatch.setattr(storage_service, "_upload_to_supabase", lambda *_args: None)
    file = DummyUpload(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"), "image/png", "logo.png")

    result = asyncio.run(async_upload(file))

    assert result["bucket"] == "business-assets"
    assert "/brand/" in result["path"]
    assert result["public_url"].startswith("https://project.supabase.co/storage/v1/object/public/business-assets/")


def test_modifier_group_limits_must_be_consistent():
    with pytest.raises(ValidationError):
        ModifierGroupCreate(name="Size", min_select=2, max_select=1)

    with pytest.raises(ValidationError):
        ModifierGroupUpdate(min_select=3, max_select=2)


def test_combo_option_sources_are_mutually_exclusive():
    with pytest.raises(ValidationError):
        ComboOptionInput(source_type="existing_item")

    with pytest.raises(ValidationError):
        ComboOptionInput(
            source_type="exclusive_combo_item",
            existing_item_id=uuid4(),
            exclusive_name="Combo-only dip",
        )


def test_combo_section_limits_must_be_consistent():
    with pytest.raises(ValidationError):
        ComboSectionInput(
            title="Included items",
            section_type="included_items",
            min_select=2,
            max_select=1,
        )


def test_draft_combo_can_be_saved_without_options():
    combo = ComboCreate(name="Draft Combo", price=99, status="draft")

    assert combo.sections == []


def test_shown_combo_requires_an_included_item():
    with pytest.raises(HTTPException) as exc:
        combo_service._validate_publishable("shown", [])

    assert exc.value.status_code == 422


def test_new_business_uses_universal_kiosk_defaults():
    business = BusinessCreate(name="Test Business")

    assert business.kiosk_theme == "top_category:premium_light"
    assert business.offer_enabled is False


def test_database_adapter_wraps_every_jsonb_schema_column():
    schema_path = Path(__file__).parents[1] / "postgres_schema.sql"
    schema = schema_path.read_text(encoding="utf-8")
    jsonb_columns = set(re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s+jsonb\b", schema))

    assert jsonb_columns <= JSON_FIELDS
    for column in jsonb_columns:
        assert isinstance(_adapt_value(column, {}), Jsonb)


def test_payment_schema_has_single_provider_slots_and_paytm():
    schema_path = Path(__file__).parents[1] / "postgres_schema.sql"
    schema = schema_path.read_text(encoding="utf-8")

    assert "business_payment_accounts_business_provider_uidx" in schema
    assert "on business_payment_accounts(business_id, provider)" in schema.lower()
    assert "'paytm'" in schema
    assert "business_payment_accounts_one_default_uidx" in schema


def test_product_category_guard_blocks_cross_business(monkeypatch):
    business_id = uuid4()
    other_business_id = uuid4()

    monkeypatch.setattr(
        product_service,
        "get_category",
        lambda _client, _category_id: {"business_id": str(other_business_id)},
    )

    with pytest.raises(HTTPException) as exc:
        product_service._assert_category_in_business(object(), uuid4(), business_id)

    assert exc.value.status_code == 400


def test_product_category_is_required_for_non_draft_items():
    with pytest.raises(HTTPException) as exc:
        product_service._assert_product_category(object(), {"menu_status": "shown", "category_id": None}, uuid4())

    assert exc.value.status_code == 400
    assert exc.value.detail == "Select a category before saving this item."


def test_product_category_can_be_missing_for_incomplete_draft():
    product_service._assert_product_category(object(), {"menu_status": "draft", "category_id": None}, uuid4())


def test_legacy_uncategorized_product_requires_category_when_saved():
    current = {"menu_status": "shown", "category_id": None}

    with pytest.raises(HTTPException):
        product_service._assert_product_category(object(), {"name": "Updated legacy item"}, uuid4(), current)


def test_product_category_guard_validates_selected_category(monkeypatch):
    business_id = uuid4()
    category_id = uuid4()
    checked = []
    monkeypatch.setattr(
        product_service,
        "_assert_category_in_business",
        lambda _client, selected_category_id, selected_business_id: checked.append((selected_category_id, selected_business_id)),
    )

    product_service._assert_product_category(object(), {"menu_status": "shown", "category_id": category_id}, business_id)

    assert checked == [(category_id, business_id)]


def test_legacy_product_availability_keeps_item_visible_as_unavailable():
    create_payload = ProductCreate(name="Hidden item", price=10, is_available=False)
    create_data = create_payload.model_dump(mode="json")

    product_service._normalize_menu_status_fields(create_data, create_payload.model_fields_set)

    assert create_data["menu_status"] == "unavailable"
    assert create_data["is_available"] is False

    update_payload = ProductUpdate(is_available=True)
    update_data = update_payload.model_dump(mode="json", exclude_unset=True)

    product_service._normalize_menu_status_fields(update_data, update_payload.model_fields_set)

    assert update_data["menu_status"] == "shown"
    assert update_data["is_available"] is True


def test_explicit_menu_status_controls_legacy_availability():
    payload = ProductUpdate(menu_status="unavailable", is_available=True)
    data = payload.model_dump(mode="json", exclude_unset=True)

    product_service._normalize_menu_status_fields(data, payload.model_fields_set)

    assert data["menu_status"] == "unavailable"
    assert data["is_available"] is False


def test_next_available_slug_assigns_next_free_path():
    taken_owner = str(uuid4())
    client = FakeSlugClient(
        [
            {"id": taken_owner, "slug": "pizza-hut"},
            {"id": taken_owner, "slug": "pizza-hut-store"},
            {"id": taken_owner, "slug": "pizza-hut-2"},
        ]
    )

    assert business_service._next_available_slug(client, "Pizza Hut") == "pizza-hut-3"


def test_next_available_slug_allows_current_business_path():
    current_business_id = str(uuid4())
    client = FakeSlugClient([{"id": current_business_id, "slug": "pizza-hut"}])

    assert business_service._next_available_slug(client, "pizza-hut", current_business_id) == "pizza-hut"


def test_payment_methods_respect_individual_disabled_methods():
    business = {
        "id": str(uuid4()),
        "kiosk_order_settings": {
            "payment_methods": ["pay_at_counter", "upi"],
            "online_payments": True,
            "pay_at_counter": True,
            "default_payment_method": "card",
        },
    }
    accounts = {
        "razorpay": {"connection_status": "connected", "payments_enabled": True, "charges_enabled": True},
        "stripe": {"connection_status": "connected", "payments_enabled": True, "charges_enabled": True},
    }

    methods = payment_service.effective_payment_methods(business, accounts)

    assert methods == ["pay_at_counter", "upi"]
    assert payment_service._default_method(business, methods) == "pay_at_counter"


def test_default_online_methods_require_active_enabled_provider_slots():
    business = {
        "id": str(uuid4()),
        "kiosk_order_settings": {
            "online_payments": True,
            "pay_at_counter": True,
            "default_payment_method": "stripe",
        },
    }
    accounts = {
        "stripe": {"connection_status": "active", "payments_enabled": True, "charges_enabled": True, "is_enabled": True},
        "razorpay": {"connection_status": "active", "payments_enabled": True, "charges_enabled": True, "is_enabled": False},
        "paytm": {"connection_status": "setup_required", "payments_enabled": False, "charges_enabled": False, "is_enabled": True},
    }

    methods = payment_service.effective_payment_methods(business, accounts)

    assert methods == ["pay_at_counter", "stripe"]
    assert payment_service._default_method(business, methods) == "stripe"


def test_default_provider_falls_back_when_inactive_or_disabled():
    business = {
        "id": str(uuid4()),
        "kiosk_order_settings": {
            "payment_methods": ["pay_at_counter", "paytm"],
            "online_payments": True,
            "pay_at_counter": True,
            "default_payment_method": "paytm",
        },
    }
    accounts = {
        "paytm": {"connection_status": "disabled", "payments_enabled": False, "charges_enabled": False, "is_enabled": False},
    }

    methods = payment_service.effective_payment_methods(business, accounts)

    assert methods == ["pay_at_counter"]
    assert payment_service._default_method(business, methods) == "pay_at_counter"


def test_paytm_methods_and_webhook_signature_are_backend_verified():
    body = {"paymentId": str(uuid4()), "ORDERID": "order-ref", "TXNID": "txn-ref", "STATUS": "TXN_SUCCESS"}
    payload = {"body": body}
    raw = json.dumps(payload).encode("utf-8")
    signature = payment_service._paytm_signature(body, "backend-secret")

    assert payment_service.payment_provider_for_method("paytm") == "paytm"
    assert payment_service.payment_provider_for_method("paytm_qr") == "paytm"
    assert payment_service._verify_paytm_signature(raw, signature, "backend-secret")
    assert not payment_service._verify_paytm_signature(raw, signature, "wrong-secret")
    assert payment_service._event_is_paid("paytm", "ignored", payload)
    assert not payment_service._event_is_failed("paytm", "ignored", payload)


def test_provider_connected_rejects_disabled_or_incomplete_slots():
    assert payment_service._provider_connected({"connection_status": "active", "payments_enabled": True, "is_enabled": True})
    assert not payment_service._provider_connected({"connection_status": "active", "payments_enabled": True, "is_enabled": False})
    assert not payment_service._provider_connected({"connection_status": "pending", "payments_enabled": True, "is_enabled": True})
    assert not payment_service._provider_connected({"connection_status": "active", "payments_enabled": False, "charges_enabled": False, "is_enabled": True})


def test_online_off_removes_card_upi_and_providers():
    business = {
        "id": str(uuid4()),
        "kiosk_order_settings": {
            "payment_methods": ["pay_at_counter", "cash", "upi", "card", "stripe", "razorpay"],
            "online_payments": False,
            "pay_at_counter": True,
        },
    }

    assert payment_service.effective_payment_methods(business) == ["pay_at_counter", "cash"]


def test_disabled_card_payment_is_rejected_by_backend_validation(monkeypatch):
    business_id = uuid4()
    business = {
        "id": str(business_id),
        "kiosk_order_settings": {
            "checkout_enabled": True,
            "payment_methods": ["pay_at_counter"],
            "online_payments": True,
            "pay_at_counter": True,
        },
    }
    payload = SimpleNamespace(
        payment_method="card",
        customer_name=None,
        customer_phone=None,
        notes=None,
    )
    monkeypatch.setattr(payment_service, "list_payment_accounts", lambda _client, _business_id: [])

    with pytest.raises(HTTPException) as exc:
        payment_service.validate_kiosk_order_settings(object(), business, payload)

    assert exc.value.status_code == 409


def test_owner_pin_hash_is_not_plaintext_and_verifies():
    encoded = pin_service.hash_pin("123456")

    assert "123456" not in encoded
    assert pin_service.verify_pin("123456", encoded)
    assert not pin_service.verify_pin("000000", encoded)


def test_owner_pin_validation_allows_only_four_to_six_digits():
    assert OwnerPinSet(pin="1234", confirm_pin="1234").pin == "1234"
    assert OwnerPinVerify(pin="123456").pin == "123456"

    for value in ["123", "1234567", "abcd", "12 34"]:
        with pytest.raises(ValidationError):
            OwnerPinSet(pin=value, confirm_pin=value)
    with pytest.raises(ValidationError):
        OwnerPinSet(pin="1234", confirm_pin="9999")


def test_set_owner_pin_saves_hash_to_business_field(monkeypatch):
    business_id = uuid4()
    user_id = uuid4()
    client = FakePinSaveClient()
    monkeypatch.setattr(pin_service, "assert_business_access", lambda _client, _business_id, _user_id, _roles: {"id": str(business_id), "owner_pin_hash": None})

    result = pin_service.set_owner_pin(client, business_id, user_id, OwnerPinSet(pin="1234", confirm_pin="1234"))

    assert result["pin_configured"] is True
    sql, params = client.calls[0]
    assert "owner_pin_hash" in sql
    assert "kiosk_lock_settings" not in sql
    assert params["business_id"] == str(business_id)
    assert params["pin_hash"] != "1234"
    assert "1234" not in params["pin_hash"]
    assert pin_service.verify_pin("1234", params["pin_hash"])


def test_existing_owner_pin_change_requires_current_pin(monkeypatch):
    business_id = uuid4()
    user_id = uuid4()
    encoded = pin_service.hash_pin("1234")
    client = FakePinSaveClient()
    monkeypatch.setattr(pin_service, "assert_business_access", lambda _client, _business_id, _user_id, _roles: {"id": str(business_id), "owner_pin_hash": encoded})

    with pytest.raises(HTTPException) as missing:
        pin_service.set_owner_pin(client, business_id, user_id, OwnerPinSet(pin="5555", confirm_pin="5555"))
    assert missing.value.status_code == 400

    with pytest.raises(HTTPException) as wrong:
        pin_service.set_owner_pin(client, business_id, user_id, OwnerPinSet(current_pin="9999", pin="5555", confirm_pin="5555"))
    assert wrong.value.status_code == 403

    result = pin_service.set_owner_pin(client, business_id, user_id, OwnerPinSet(current_pin="1234", pin="5555", confirm_pin="5555"))
    assert result["pin_configured"] is True
    assert pin_service.verify_pin("5555", client.calls[-1][1]["pin_hash"])


def test_manager_is_forbidden_from_sensitive_staff_and_business_updates(monkeypatch):
    business_id = uuid4()
    user_id = uuid4()

    def deny_if_sensitive(_client, _business_id, _user_id, roles):
        assert roles == business_service.FULL_ACCESS_ROLES
        raise HTTPException(status_code=403, detail="Your staff role cannot perform this action.")

    monkeypatch.setattr(staff_service, "assert_business_access", deny_if_sensitive)
    with pytest.raises(HTTPException) as staff_exc:
        staff_service.invite_staff(object(), business_id, user_id, StaffInvite(email="team@example.com", role=StaffRole.KITCHEN))
    assert staff_exc.value.status_code == 403

    monkeypatch.setattr(business_service, "assert_business_access", deny_if_sensitive)
    with pytest.raises(HTTPException) as business_exc:
        business_service.update_business(object(), business_id, user_id, BusinessUpdate(name="New Cafe"))
    assert business_exc.value.status_code == 403


def test_manager_catalog_policy_is_read_only_outside_business_workspace():
    assert StaffRole.MANAGER in business_service.ADMIN_ROLES
    assert StaffRole.MANAGER in business_service.CATALOG_READ_ROLES
    assert StaffRole.MANAGER not in business_service.FULL_ACCESS_ROLES
    assert StaffRole.MANAGER not in business_service.PAYMENT_CONFIG_ROLES
    assert StaffRole.MANAGER not in business_service.DEVICE_ADMIN_ROLES
    assert StaffRole.MANAGER not in business_service.PIN_ADMIN_ROLES


def test_staff_membership_is_scoped_to_exact_business():
    user_id = uuid4()
    business_a = uuid4()
    business_b = uuid4()
    client = FakeBusinessAccessClient(
        businesses=[
            {"id": str(business_a), "owner_id": str(uuid4())},
            {"id": str(business_b), "owner_id": str(uuid4())},
        ],
        staff=[
            {"business_id": str(business_a), "user_id": str(user_id), "role": StaffRole.MANAGER.value},
        ],
    )

    assert business_service.assert_business_access(client, business_a, user_id, business_service.ADMIN_ROLES)["id"] == str(business_a)

    with pytest.raises(HTTPException) as exc:
        business_service.assert_business_access(client, business_b, user_id, business_service.ADMIN_ROLES)

    assert exc.value.status_code == 403


def test_production_rejects_dev_auth_bypass_enabled():
    with pytest.raises(ValidationError) as exc:
        Settings(
            _env_file=None,
            environment="production",
            database_url="postgresql://prod-db.example.com:5432/menutap",
            jwt_secret="x" * 40,
            allow_dev_auth_bypass=True,
            payment_expiry_cron_secret="y" * 40,
        )

    assert "ALLOW_DEV_AUTH_BYPASS" in str(exc.value)


def test_production_requires_payment_expiry_cron_secret():
    with pytest.raises(ValidationError) as exc:
        Settings(
            _env_file=None,
            environment="production",
            database_url="postgresql://prod-db.example.com:5432/menutap",
            jwt_secret="x" * 40,
            allow_dev_auth_bypass=False,
        )

    assert "PAYMENT_EXPIRY_CRON_SECRET" in str(exc.value)


def test_production_settings_accept_normal_auth_configuration():
    settings = Settings(
        _env_file=None,
        environment="production",
        database_url="postgresql://prod-db.example.com:5432/menutap",
        jwt_secret="x" * 40,
        allow_dev_auth_bypass=False,
        payment_expiry_cron_secret="y" * 40,
    )

    assert settings.allow_dev_auth_bypass is False


@pytest.mark.parametrize("secret", [
    "replace-with-a-long-random-secret-at-least-32-characters",
    "change-this-local-dev-secret-before-production",
])
def test_production_rejects_documented_placeholder_jwt_secrets(secret):
    with pytest.raises(ValidationError) as exc:
        Settings(
            _env_file=None,
            environment="production",
            database_url="postgresql://prod-db.example.com:5432/menutap",
            jwt_secret=secret,
            allow_dev_auth_bypass=False,
            payment_expiry_cron_secret="y" * 40,
        )

    assert "JWT_SECRET" in str(exc.value)


def test_dev_auth_bypass_only_works_in_explicit_dev_modes():
    user_id = uuid4()
    auth = _authenticated_token(
        authorization=None,
        x_user_id=str(user_id),
        settings=SimpleNamespace(allow_dev_auth_bypass=True, environment="local"),
    )
    allowed = asyncio.run(
        require_user_id(
            auth=auth,
            client=object(),
        )
    )
    assert allowed == user_id

    with pytest.raises(HTTPException) as exc:
        _authenticated_token(
            authorization=None,
            x_user_id=str(user_id),
            settings=SimpleNamespace(allow_dev_auth_bypass=True, environment="staging"),
        )
    assert exc.value.status_code == 401


def test_rate_limiter_blocks_repeated_sensitive_requests():
    rate_limit_service.reset_rate_limits()
    request = Request({"type": "http", "client": ("203.0.113.9", 50000), "headers": []})
    rule = rate_limit_service.RateLimitRule("unit:sensitive", 2, 60)

    rate_limit_service.assert_rate_limit(request, rule, identity_parts=["user@example.test"])
    rate_limit_service.assert_rate_limit(request, rule, identity_parts=["user@example.test"])
    with pytest.raises(HTTPException) as exc:
        rate_limit_service.assert_rate_limit(request, rule, identity_parts=["user@example.test"])

    assert exc.value.status_code == 429
    rate_limit_service.reset_rate_limits()


def test_maintenance_secret_required_for_payment_expiry():
    settings = SimpleNamespace(payment_expiry_cron_secret="maintenance-secret")

    with pytest.raises(HTTPException) as missing:
        maintenance._require_maintenance_secret(settings, None)
    assert missing.value.status_code == 403

    maintenance._require_maintenance_secret(settings, "maintenance-secret")


def test_payment_record_serializer_removes_provider_tokens_and_raw_payload():
    safe = payment_service._safe_payment_record(
        {
            "id": str(uuid4()),
            "provider_reference": "public-payment-token",
            "raw_payload": {"provider": "metadata"},
            "status": PaymentStatus.PENDING.value,
        }
    )

    assert "provider_reference" not in safe
    assert "raw_payload" not in safe


def test_payment_provider_http_error_is_redacted(monkeypatch):
    def fail_urlopen(_req, timeout=20):
        raise payment_service.error.HTTPError(
            "https://pay.example",
            400,
            "Bad Request",
            hdrs=None,
            fp=SimpleNamespace(read=lambda: b'{"error":"secret-token"}', close=lambda: None),
        )

    monkeypatch.setattr(payment_service.request, "urlopen", fail_urlopen)

    with pytest.raises(HTTPException) as exc_info:
        payment_service._json_request(payment_service.request.Request("https://pay.example"))

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Payment provider request failed."
    assert "secret-token" not in exc_info.value.detail


def test_kiosk_lock_enable_requires_configured_pin(monkeypatch):
    business_id = uuid4()
    user_id = uuid4()
    monkeypatch.setattr(
        business_service,
        "assert_business_access",
        lambda _client, _business_id, _user_id, _roles: {
            "id": str(business_id),
            "slug": "demo",
            "owner_pin_hash": None,
            "kiosk_lock_settings": {"enabled": False, "require_pin_to_exit": True},
        },
    )

    with pytest.raises(HTTPException) as exc:
        business_service.update_business(object(), business_id, user_id, BusinessUpdate(kiosk_lock_settings={"enabled": True, "require_pin_to_exit": True}))

    assert exc.value.status_code == 409
    assert "Create a kiosk PIN" in exc.value.detail


def test_kiosk_lock_disable_requires_valid_owner_pin():
    encoded = pin_service.hash_pin("1234")
    old_business = {"owner_pin_hash": encoded, "kiosk_lock_settings": {"enabled": True, "require_pin_to_exit": True}}

    with pytest.raises(HTTPException) as missing:
        business_service._validate_kiosk_lock_settings_change(old_business, {"enabled": False, "require_pin_to_exit": True}, None)
    assert missing.value.status_code == 400

    with pytest.raises(HTTPException) as wrong:
        business_service._validate_kiosk_lock_settings_change(old_business, {"enabled": False, "require_pin_to_exit": True}, "9999")
    assert wrong.value.status_code == 403

    business_service._validate_kiosk_lock_settings_change(old_business, {"enabled": False, "require_pin_to_exit": True}, "1234")


def test_business_serializer_returns_pin_configured_without_hash():
    safe = business_service.serialize_business_for_response(
        {
            "id": str(uuid4()),
            "name": "Cafe",
            "owner_pin_hash": "pbkdf2-secret",
            "pin_failed_attempts": 2,
            "pin_locked_until": None,
            "kiosk_lock_settings": {"enabled": True},
        }
    )

    assert safe["kiosk_lock_settings"]["owner_pin_configured"] is True
    assert "owner_pin_hash" not in safe
    assert "pin_failed_attempts" not in safe
    assert "pin_locked_until" not in safe


def test_verify_owner_pin_uses_saved_hash_and_clear_errors(monkeypatch):
    business_id = str(uuid4())
    encoded = pin_service.hash_pin("1234")
    client = FakeExecuteClient()
    monkeypatch.setattr(pin_service, "get_business_by_slug", lambda _client, _slug: {"id": business_id, "owner_pin_hash": encoded, "pin_failed_attempts": 0})

    assert pin_service.verify_owner_pin(client, "demo", OwnerPinVerify(pin="1234")) == {"ok": True}

    with pytest.raises(HTTPException) as exc:
        pin_service.verify_owner_pin(client, "demo", OwnerPinVerify(pin="9999"))

    assert exc.value.status_code == 403
    assert "Invalid owner PIN" in exc.value.detail


def test_verify_owner_pin_reports_not_configured_only_when_hash_missing(monkeypatch):
    monkeypatch.setattr(pin_service, "get_business_by_slug", lambda _client, _slug: {"id": str(uuid4()), "owner_pin_hash": None})

    with pytest.raises(HTTPException) as exc:
        pin_service.verify_owner_pin(object(), "demo", OwnerPinVerify(pin="1234"))

    assert exc.value.status_code == 409
    assert "not configured" in exc.value.detail.lower()


def test_device_launch_token_is_hashed_and_only_kiosk_gets_live_link(monkeypatch):
    monkeypatch.setattr(device_service, "get_settings", lambda: SimpleNamespace(jwt_secret="unit-test-secret", frontend_base_url="http://ui.test"))
    token = "kiosk_" + ("a" * 32)
    encoded = device_service._hash_device_token(token)

    assert token not in encoded
    assert encoded == device_service._hash_device_token(token)
    assert encoded != device_service._hash_device_token(token + "b")

    kiosk = device_service._serialize_device({"name": "Kiosk 1", "device_type": "kiosk", "token_hash": encoded}, token)
    counter = device_service._serialize_device({"name": "Counter", "device_type": "counter", "token_hash": encoded}, token)

    assert "token_hash" not in kiosk
    assert kiosk["launch_url"] == f"http://ui.test/kiosk/live/{token}"
    assert counter["launch_url"] == f"http://ui.test/counter/live/{token}"


def test_disabled_live_device_token_is_blocked(monkeypatch):
    monkeypatch.setattr(device_service, "get_settings", lambda: SimpleNamespace(jwt_secret="unit-test-secret", frontend_base_url="http://ui.test"))
    monkeypatch.setattr(device_service, "_record_disabled_device_alert", lambda _client, _device: None)
    token = "device_kiosk_" + ("a" * 32)
    business_id = uuid4()
    client = FakeDeviceTokenClient(
        [
            {
                "id": str(uuid4()),
                "business_id": str(business_id),
                "device_id": "kiosk-1",
                "device_type": "kiosk",
                "token_hash": device_service._hash_device_token(token),
                "is_active": False,
                "status": "disabled",
            }
        ]
    )

    with pytest.raises(HTTPException) as exc:
        device_service.business_for_device_token(client, token)

    assert exc.value.status_code == 403


def test_device_schema_supports_counter_without_fake_launch_id():
    payload = DeviceCreate(name="Front counter", device_type="counter")

    assert payload.device_type == "counter"
    assert payload.device_id is None


def test_paytm_dynamic_qr_requires_payment_token(monkeypatch):
    with pytest.raises(ValidationError):
        PaytmDynamicQrCreate(business_id=uuid4(), payment_id=uuid4())

    monkeypatch.setattr(
        payment_service,
        "_get_payment",
        lambda _client, _payment_id, _business_id: {"provider_reference": "secret-token", "provider": "paytm", "status": "pending"},
    )

    with pytest.raises(HTTPException) as exc:
        payment_service.create_paytm_dynamic_qr(
            object(),
            PaytmDynamicQrCreate(business_id=uuid4(), payment_id=uuid4(), payment_token="wrong-token"),
        )

    assert exc.value.status_code == 403


def test_repeated_owner_pin_failures_create_real_alert():
    client = FakeExecuteClient()
    business_id = str(uuid4())

    pin_service._record_failed_pin_alert(client, {"id": business_id}, 5, True)

    assert client.calls
    _, params = client.calls[0]
    assert params["business_id"] == business_id
    assert params["severity"] == "critical"
    assert params["dedupe_key"] == "kiosk:owner_pin_failed"


def test_abandoned_pending_online_payments_are_expired(monkeypatch):
    payment_id = uuid4()
    business_id = uuid4()
    client = FakePaymentExpiryClient(
        [
            {
                "id": str(payment_id),
                "business_id": str(business_id),
                "order_id": str(uuid4()),
                "provider": "stripe",
                "status": PaymentStatus.PENDING.value,
            }
        ]
    )
    expired: list[dict] = []
    monkeypatch.setattr(payment_service, "_expire_online_payment", lambda _client, payment, payload: expired.append({"payment": payment, "payload": payload}))
    monkeypatch.setattr(payment_service, "_refresh_real_alerts_for_payments", lambda _client, _business_id: None)

    result = payment_service.expire_abandoned_pending_online_payments(client, older_than_minutes=20, business_id=business_id)

    assert result == {"expired_count": 1, "payment_ids": [str(payment_id)]}
    assert expired[0]["payment"]["id"] == str(payment_id)
    assert expired[0]["payload"]["source"] == "pending_payment_expiry"
    sql, params = client.executed[0]
    assert "o.status = %(order_pending)s" in sql
    assert params["order_pending"] == "payment_pending"
    assert params["business_id"] == str(business_id)


def test_expiring_online_payment_marks_order_cancelled_and_restores_inventory(monkeypatch):
    payment_id = uuid4()
    business_id = uuid4()
    order_id = uuid4()
    client = FakePaymentExpireActionClient()
    status_updates: list[tuple[str, dict]] = []
    restored: list[tuple[UUID, UUID]] = []
    monkeypatch.setattr(
        payment_service,
        "_set_payment_status",
        lambda _client, _payment_id, _business_id, status, payload, provider_payment_id=None, provider_order_id=None: status_updates.append((status, payload)) or {"id": str(_payment_id), "status": status},
    )
    monkeypatch.setattr(payment_service, "_restore_reserved_inventory", lambda _client, _business_id, _order_id: restored.append((_business_id, _order_id)))

    payment_service._expire_online_payment(
        client,
        {"id": str(payment_id), "business_id": str(business_id), "order_id": str(order_id), "provider": "razorpay"},
        {"source": "unit-test"},
    )

    assert status_updates[0][0] == PaymentStatus.EXPIRED.value
    assert client.order_updates[0][1]["payment_status"] == PaymentStatus.EXPIRED.value
    assert client.order_updates[0][1]["status"] == "cancelled"
    assert restored == [(business_id, order_id)]


async def async_upload(file: DummyUpload) -> dict:
    return await storage_service.upload_asset(uuid4(), file, "brand", "supabase-user-access-token")


def test_bearer_token_case_insensitive():
    from deps import _bearer_token

    assert _bearer_token("Bearer test-token-123") == "test-token-123"
    assert _bearer_token("bearer test-token-456") == "test-token-456"
    assert _bearer_token("  Bearer   test-token-789  ") == "test-token-789"
    assert _bearer_token("BEARER uppercase-token") == "uppercase-token"
    assert _bearer_token("Basic dXNlcjpwYXNz") is None
    assert _bearer_token(None) is None
    assert _bearer_token("") is None


def test_admin_bootstrap_allows_kitchen_and_cashier_roles(monkeypatch):
    from routers import admin

    user_id = uuid4()
    business_id = uuid4()
    business = {"id": str(business_id), "name": "Kiosk Cafe"}

    monkeypatch.setattr(admin.auth_service, "get_user", lambda _client, _uid: {"id": str(_uid), "email": "staff@test.com"})
    monkeypatch.setattr(admin.business_service, "onboarding_status", lambda _client, _uid: {"completed": True})
    monkeypatch.setattr(admin.business_service, "get_primary_business_for_user", lambda _client, _uid: business)
    monkeypatch.setattr(admin.business_service, "serialize_business_for_response", lambda b: b)

    for staff_role in ["kitchen", "cashier"]:
        monkeypatch.setattr(
            admin.business_service,
            "get_business_role_for_user",
            lambda _client, _b, _uid, role=staff_role: SimpleNamespace(value=role),
        )

        response = admin.bootstrap(user_id=user_id, client=object())
        assert response["role"] == staff_role
        assert response["alerts"] == {"unresolved_count": 0, "active_count": 0, "alerts": []}
        assert response["setup"] is None


def test_order_status_update_cancelled_restores_inventory(monkeypatch):
    from schemas import OrderStatus, OrderStatusUpdate
    from services import order_service

    business_id = uuid4()
    order_id = uuid4()
    user_id = uuid4()
    restored: list[tuple[UUID, UUID]] = []

    monkeypatch.setattr(order_service, "assert_business_access", lambda _client, b_id, _uid, _roles: {"id": str(b_id)})
    monkeypatch.setattr(order_service, "get_order", lambda _client, o_id, b_id: {"id": str(o_id), "business_id": str(b_id), "status": "pending"})
    monkeypatch.setattr(order_service.payment_service, "_restore_reserved_inventory", lambda _client, b_id, o_id: restored.append((b_id, o_id)))

    class FakeOrdersClient:
        def table(self, name: str):
            self.last_table = name
            return self
        def update(self, payload: dict):
            self.update_payload = payload
            return self
        def eq(self, col: str, val: str):
            return self
        def execute(self):
            return SimpleNamespace(data=[{"id": str(order_id)}])
        def insert(self, payload: dict):
            return self

    client = FakeOrdersClient()
    payload = OrderStatusUpdate(business_id=business_id, status=OrderStatus.CANCELLED, cancel_reason="Out of stock")
    order_service.update_order_status(client, user_id, order_id, payload)

    assert restored == [(business_id, order_id)]


def test_preview_kiosk_attaches_modifier_groups(monkeypatch):
    from schemas_preview_kiosk import PreviewKioskRenderRequest
    from services import preview_kiosk_service

    business_id = uuid4()
    user_id = uuid4()
    product_id = uuid4()

    fake_business = {"id": str(business_id), "name": "Preview Cafe"}
    fake_product = {"id": str(product_id), "name": "Burger", "is_available": True}
    fake_group = {"id": "mg-1", "product_id": str(product_id), "name": "Toppings", "options": [{"id": "opt-1", "name": "Cheese"}]}

    monkeypatch.setattr(preview_kiosk_service.business_service, "assert_business_access", lambda _c, _b, _u, _r: fake_business)
    monkeypatch.setattr(preview_kiosk_service, "list_categories", lambda _c, _b: [])
    monkeypatch.setattr(preview_kiosk_service, "list_products", lambda _c, _b, include_unavailable=True: [dict(fake_product)])
    monkeypatch.setattr(preview_kiosk_service, "list_modifier_groups_for_products", lambda _c, _b, _pids: {str(product_id): [fake_group]})

    request = PreviewKioskRenderRequest(business_id=business_id, draft={})
    result = preview_kiosk_service.render_preview_kiosk(object(), user_id, request)

    assert len(result["products"]) == 1
    assert result["products"][0]["modifier_groups"] == [fake_group]
