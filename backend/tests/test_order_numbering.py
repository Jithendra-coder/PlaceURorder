from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

from services import order_service


def test_order_date_uses_the_business_timezone(monkeypatch):
    class FixedDateTime:
        @staticmethod
        def now(tz):
            return datetime(2026, 10, 24, 20, 0, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(order_service, "datetime", FixedDateTime)

    assert order_service._business_order_date({"timezone": "Asia/Kolkata"}) == "2026-10-25"
    assert order_service._business_order_date({"timezone": "Invalid/Timezone"}) == "2026-10-24"


def test_order_number_counter_uses_the_business_order_date():
    captured = {}

    def execute_one(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return {"order_number": 42}

    client = SimpleNamespace(execute_one=execute_one)
    business_id = UUID("00000000-0000-0000-0000-000000000001")

    assert order_service._next_order_number(client, business_id, "2026-10-25") == 42
    assert captured["params"] == {"business_id": str(business_id), "counter_date": "2026-10-25"}
    assert "on conflict (business_id, counter_date)" in captured["sql"]
