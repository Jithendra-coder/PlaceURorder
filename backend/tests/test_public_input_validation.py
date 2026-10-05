import pytest
from pydantic import TypeAdapter, ValidationError

from routers.devices import DeviceToken, PairingCode
from routers.kiosk import BusinessSlug
from schemas import AuthLogin, DeviceActivate, ResetPasswordRequest


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
