from decimal import Decimal, ROUND_HALF_UP
from typing import Any


def round_money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def to_minor_units(value: Any) -> int:
    return int(round_money(value) * 100)
