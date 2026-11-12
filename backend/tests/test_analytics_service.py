from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from services import analytics_service


NOW = datetime(2026, 7, 11, 12, tzinfo=timezone.utc)


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


class FakeClient:
    def __init__(self, orders=None, order_items=None):
        self.rows = {"orders": orders or [], "order_items": order_items or []}
        self.queries = []

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, client, name):
        self.client = client
        self.name = name
        self.filters = []

    def select(self, columns):
        self.columns = columns
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def gte(self, column, value):
        self.filters.append(("gte", column, value))
        return self

    def lte(self, column, value):
        self.filters.append(("lte", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def execute(self):
        rows = list(self.client.rows[self.name])
        for operator, column, value in self.filters:
            if operator == "eq":
                rows = [row for row in rows if str(row.get(column)) == str(value)]
            elif operator == "gte":
                threshold = datetime.fromisoformat(value.replace("Z", "+00:00"))
                rows = [row for row in rows if datetime.fromisoformat(row[column].replace("Z", "+00:00")) >= threshold]
            elif operator == "lte":
                threshold = datetime.fromisoformat(value.replace("Z", "+00:00"))
                rows = [row for row in rows if datetime.fromisoformat(row[column].replace("Z", "+00:00")) <= threshold]
            else:
                rows = [row for row in rows if row.get(column) in value]
        self.client.queries.append((self.name, self.columns, self.filters))
        return SimpleNamespace(data=rows)


def order(order_id, business_id, placed_at, total=10, status="completed"):
    return {"id": order_id, "business_id": business_id, "placed_at": placed_at, "total_amount": total, "status": status}


def item(order_id, business_id, name, quantity, total):
    return {"order_id": order_id, "business_id": business_id, "product_id": None, "product_name": name, "quantity": quantity, "total_price": total}


def dashboard(monkeypatch, client, business_id):
    monkeypatch.setattr(analytics_service, "datetime", FixedDateTime)
    return analytics_service.dashboard_stats(client, business_id)


def test_no_matching_orders_skips_item_query(monkeypatch):
    business_id = uuid4()
    old_id = str(uuid4())
    client = FakeClient(
        [order(old_id, str(business_id), "2026-07-01T10:00:00+00:00")],
        [item(old_id, str(business_id), "Old item", 99, 999)],
    )

    result = dashboard(monkeypatch, client, business_id)

    assert result["top_selling_item"] is None
    assert result["revenue_today"] == 0
    assert result["orders_past_7_days"] == 0
    assert [name for name, _columns, _filters in client.queries] == ["orders"]


def test_home_activation_counts_only_completed_production_orders():
    business_id = uuid4()
    client = FakeClient(
        [
            order(str(uuid4()), str(business_id), "2026-07-11T10:00:00+00:00"),
            order(str(uuid4()), str(business_id), "2026-07-11T10:01:00+00:00", status="cancelled"),
            order(str(uuid4()), str(business_id), "2026-07-11T10:02:00+00:00", status="completed"),
        ]
    )
    client.rows["orders"][2]["payment_status"] = "failed"

    assert analytics_service.home_activation(client, business_id) == {"state": "new", "completed_order_count": 1}


def test_items_are_limited_to_selected_orders_and_business(monkeypatch):
    business_id = uuid4()
    other_business_id = uuid4()
    recent_id, old_id = str(uuid4()), str(uuid4())
    client = FakeClient(
        [
            order(recent_id, str(business_id), "2026-07-11T10:00:00+00:00", 12.5),
            order(old_id, str(business_id), "2026-07-01T10:00:00+00:00", 50),
        ],
        [
            item(recent_id, str(business_id), "Burger", 2, 10),
            item(old_id, str(business_id), "Old item", 100, 1000),
            item(recent_id, str(other_business_id), "Other tenant", 100, 1000),
        ],
    )

    result = dashboard(monkeypatch, client, business_id)

    assert result["top_selling_item"] == {"name": "Burger", "quantity": 2, "revenue": 10.0}
    assert result["revenue_today"] == 12.5
    assert result["weekly_revenue"][0]["revenue"] == 12.5
    item_filters = client.queries[1][2]
    assert ("eq", "business_id", str(business_id)) in item_filters
    assert ("in", "order_id", [recent_id]) in item_filters


def test_multiple_orders_preserve_totals_ties_and_unique_ids(monkeypatch):
    business_id = uuid4()
    first_id, second_id = str(uuid4()), str(uuid4())
    first = order(first_id, str(business_id), "2026-07-11T09:00:00+00:00", 10)
    client = FakeClient(
        [first, first, order(second_id, str(business_id), "2026-07-11T10:00:00+00:00", 20)],
        [
            item(first_id, str(business_id), "Coffee", 2, 8),
            item(first_id, str(business_id), "Tea", 1, 4),
            item(second_id, str(business_id), "Coffee", 1, 4),
            item(second_id, str(business_id), "Tea", 2, 8),
        ],
    )

    result = dashboard(monkeypatch, client, business_id)

    assert result["top_selling_item"] == {"name": "Coffee", "quantity": 3, "revenue": 12.0}
    assert result["revenue_today"] == 40
    assert result["weekly_revenue"][0]["revenue"] == 40
    assert ("in", "order_id", [first_id, second_id]) in client.queries[1][2]


def test_dashboard_projects_only_required_fields_and_bounds_the_database_query(monkeypatch):
    business_id = uuid4()
    client = FakeClient([
        order(str(uuid4()), str(business_id), "2026-07-11T10:00:00+00:00"),
        order(str(uuid4()), str(business_id), "2026-07-12T10:00:00+00:00"),
    ])

    result = dashboard(monkeypatch, client, business_id)

    assert result["completed_orders"] == 1
    _name, columns, filters = client.queries[0]
    assert columns == ", ".join(analytics_service.ANALYTICS_ORDER_COLUMNS)
    assert ("lte", "placed_at", NOW.isoformat()) in filters


def test_daily_revenue_covers_the_selected_period(monkeypatch):
    business_id = uuid4()
    client = FakeClient(
        [
            order(str(uuid4()), str(business_id), "2026-07-09T10:00:00+00:00", 100),
            order(str(uuid4()), str(business_id), "2026-07-09T15:00:00+00:00", 50),
            order(str(uuid4()), str(business_id), "2026-07-11T09:00:00+00:00", 30),
        ]
    )
    monkeypatch.setattr(analytics_service, "datetime", FixedDateTime)

    result = analytics_service.dashboard_stats(client, business_id, start=datetime(2026, 7, 8, tzinfo=timezone.utc))

    days = result["daily_revenue"]
    assert [day["date"] for day in days] == ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"]
    assert days[1] == {"date": "2026-07-09", "orders": 2, "revenue": 150.0, "average_order_value": 75.0}
    assert days[2] == {"date": "2026-07-10", "orders": 0, "revenue": 0.0, "average_order_value": 0.0}
    assert days[3]["revenue"] == 30.0
