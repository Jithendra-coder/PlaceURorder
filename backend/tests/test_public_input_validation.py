import pytest
from pydantic import TypeAdapter, ValidationError

from routers.devices import DeviceToken, PairingCode
from routers.kiosk import BusinessSlug
from schemas import (
    AuthLogin,
    AvailabilityRuleCreate,
    BusinessCreate,
    ComboCreate,
    ComboSectionCreate,
    ComboUpdate,
    DeviceActivate,
    KioskTestOrderCreate,
    ModifierOptionCreate,
    OrderCreate,
    ProductCreate,
    PromotionCreate,
    PromotionUpdate,
    ResetPasswordRequest,
)


def test_generated_public_identifiers_are_accepted():
    assert TypeAdapter(PairingCode).validate_python("123-456") == "123-456"
    token = "mt_live_kiosk_" + "a" * 43
    assert TypeAdapter(DeviceToken).validate_python(token) == token
    assert TypeAdapter(BusinessSlug).validate_python("coffee-house") == "coffee-house"
    assert DeviceActivate(activation_code="123-456").activation_code == "123-456"
    assert ResetPasswordRequest(token="a" * 54, password="password123").token == "a" * 54


@pytest.mark.parametrize(
    ("adapter", "value"),
    [
        (TypeAdapter(PairingCode), "12345"),
        (TypeAdapter(PairingCode), "123!456"),
        (TypeAdapter(DeviceToken), "short"),
        (TypeAdapter(DeviceToken), "a" * 161),
        (TypeAdapter(BusinessSlug), "a" * 121),
    ],
)
def test_malformed_or_oversized_route_identifiers_are_rejected(adapter, value):
    with pytest.raises(ValidationError):
        adapter.validate_python(value)


def test_schema_boundaries_and_unknown_fields_remain_compatible():
    assert ResetPasswordRequest(token="a" * 4096, password="password123")
    with pytest.raises(ValidationError):
        ResetPasswordRequest(token="a" * 4097, password="password123")
    with pytest.raises(ValidationError):
        DeviceActivate(activation_code="123 456")

    login = AuthLogin(email="user@example.com", password="password123", unexpected="still-ignored")
    assert login.email == "user@example.com"


def test_live_order_item_count_is_bounded():
    item = {"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1}
    assert len(OrderCreate(items=[item] * 100).items) == 100
    with pytest.raises(ValidationError):
        OrderCreate(items=[item] * 101)


def test_onboarding_test_order_customizations_are_bounded():
    item = {"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1}
    assert len(KioskTestOrderCreate(items=[{**item, "customizations": [{}] * 20}]).items[0].customizations) == 20
    with pytest.raises(ValidationError):
        KioskTestOrderCreate(items=[{**item, "customizations": [{}] * 21}])


def test_combo_configuration_collections_are_bounded():
    section = {
        "title": "Options",
        "section_type": "optional_upgrades",
        "max_select": 0,
        "options": [],
    }
    with pytest.raises(ValidationError):
        ComboCreate(name="Lunch combo", sections=[section] * 101)
    with pytest.raises(ValidationError):
        ComboUpdate(sections=[section] * 101)
    with pytest.raises(ValidationError):
        ComboCreate(name="Lunch combo", tags=["popular"] * 51)
    with pytest.raises(ValidationError):
        ComboCreate(name="Lunch combo", available_days=["monday"] * 8)

    option = {"source_type": "exclusive_combo_item", "exclusive_name": "Cola"}
    with pytest.raises(ValidationError):
        ComboCreate(
            name="Lunch combo",
            sections=[{
                "title": "Options",
                "section_type": "optional_upgrades",
                "max_select": 100,
                "options": [option] * 101,
            }],
        )
    with pytest.raises(ValidationError):
        ComboUpdate(sections=[{
            "title": "Options",
            "section_type": "optional_upgrades",
            "max_select": 100,
            "options": [option] * 101,
        }])
    with pytest.raises(ValidationError):
        ComboSectionCreate(
            title="Options",
            section_type="optional_upgrades",
            max_select=100,
            options=[option] * 101,
        )


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (BusinessCreate, {"name": "Coffee Shop", "tax_percent": float("inf")}),
        (ProductCreate, {"name": "Latte", "price": float("inf")}),
        (PromotionCreate, {"name": "Summer deal", "discount_value": float("inf")}),
        (ModifierOptionCreate, {"name": "Extra shot", "price_delta": float("inf")}),
        (ComboCreate, {"name": "Lunch combo", "price": float("inf")}),
    ],
)
def test_financial_values_must_be_finite(model, payload):
    with pytest.raises(ValidationError):
        model(**payload)


def test_promotion_relation_lists_reject_duplicates_before_database_writes():
    target_id = "00000000-0000-0000-0000-000000000001"
    location_id = "00000000-0000-0000-0000-000000000002"
    with pytest.raises(ValidationError):
        PromotionCreate(name="Summer deal", target_ids=[target_id, target_id])
    with pytest.raises(ValidationError):
        PromotionUpdate(location_ids=[location_id, location_id])
    with pytest.raises(ValidationError):
        PromotionUpdate(placements=["welcome_screen", "welcome_screen"])


def test_availability_day_values_are_normalized_and_validated():
    assert ProductCreate(name="Latte", price=5, available_days=["MONDAY", " Tuesday "]).available_days == ["monday", "tuesday"]
    with pytest.raises(ValidationError):
        ProductCreate(name="Latte", price=5, available_days=["Funday"])
    with pytest.raises(ValidationError):
        AvailabilityRuleCreate(target_type="menu", rule_type="schedule", days=["mon"], time_windows=[{"start": "09:00", "end": "10:00"}])
