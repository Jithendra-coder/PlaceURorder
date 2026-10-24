import pytest
from pydantic import TypeAdapter, ValidationError

from routers.devices import DeviceToken, PairingCode
from routers.kiosk import BusinessSlug
from schemas import (
    AuthLogin,
    ComboCreate,
    ComboSectionCreate,
    ComboUpdate,
    DeviceActivate,
    KioskTestOrderCreate,
    OrderCreate,
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
