from decimal import Decimal

from money import round_money, to_minor_units
from services.order_service import _active_product_price
from services.payment_service import _minor_amount


def test_currency_rounding_uses_half_up_for_order_and_payment_amounts():
    assert round_money(Decimal("1.005")) == Decimal("1.01")
    assert _active_product_price({"price": Decimal("10.01"), "discount_type": "percentage", "discount_value": 50}) == Decimal("5.01")
    assert _minor_amount(Decimal("1.005")) == 101
    assert to_minor_units(Decimal("10.05")) == 1005
