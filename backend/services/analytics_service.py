from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from database import DbClient
from schemas import OrderStatus
from services.home_mode_service import home_mode
from services.order_service import ACTIVE_STATUSES


FAILED_PAYMENT_STATUSES = {"failed", "cancelled", "expired"}
ANALYTICS_ORDER_COLUMNS = (
    "id", "status", "payment_status", "source", "placed_at", "subtotal",
    "discount_amount", "total_amount", "order_type", "payment_method",
)


def home_activation(client: DbClient, business_id: UUID, location_id: UUID | None = None) -> dict:
    query = (
        client.table("orders")
        .select("id, status, payment_status, source")
        .eq("business_id", str(business_id))
        .eq("status", OrderStatus.COMPLETED.value)
    )
    if location_id: query = query.eq("location_id", str(location_id))
    rows = query.execute().data or []
    completed_order_count = sum(1 for row in rows if _is_completed_order(row))
    return {
        "state": "returning" if completed_order_count > 1 else "new",
        "completed_order_count": completed_order_count,
        "mode": home_mode(client, business_id, _business_completed_for_mode(client, business_id, completed_order_count, location_id)),
    }


def _business_completed_for_mode(client: DbClient, business_id: UUID, location_count: int, location_id: UUID | None) -> int:
    """The Home mode is a business-wide decision. A location with no completed orders must not make an
    established business look new, so a business that has any completed order counts as having one."""
    if location_count > 0 or location_id is None:
        return location_count
    has_any = client.fetch_one(
        "select 1 as ok from orders where business_id = %(business)s and status = 'completed' limit 1",
        {"business": str(business_id)},
    )
    return 1 if has_any else 0


def dashboard_stats(
    client: DbClient,
    business_id: UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    location_id: UUID | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    period_end = _aware(end or now)
    today_start = period_end.replace(hour=0, minute=0, second=0, microsecond=0)
    last_hour = period_end - timedelta(hours=1)
    period_start = _aware(start) if start else today_start - timedelta(days=6)

    order_query = (
        client.table("orders")
        .select(", ".join(ANALYTICS_ORDER_COLUMNS))
        .eq("business_id", str(business_id))
        .gte("placed_at", period_start.isoformat())
        .lte("placed_at", period_end.isoformat())
    )
    if location_id: order_query = order_query.eq("location_id", str(location_id))
    orders_response = order_query.execute()
    orders = [{**row, "_placed_at": _parse_dt(row.get("placed_at"))} for row in (orders_response.data or [])]
    completed_orders = [order for order in orders if _is_completed_order(order)]
    period_gross_sales = sum(float(order.get("subtotal") or 0) for order in completed_orders)
    period_discounts = sum(float(order.get("discount_amount") or 0) for order in completed_orders)
    period_refunds = sum(float(order.get("total_amount") or 0) for order in orders if order.get("payment_status") == "refunded")
    period_cancellations = sum(float(order.get("total_amount") or 0) for order in orders if order.get("status") == OrderStatus.CANCELLED.value)
    period_net_sales = period_gross_sales - period_discounts - period_refunds

    today_orders = [
        order for order in completed_orders if order["_placed_at"] >= today_start
    ]
    last_hour_orders = [
        order for order in completed_orders if order["_placed_at"] >= last_hour
    ]
    revenue_today = sum(
        float(order.get("total_amount") or 0)
        for order in today_orders
        if order.get("payment_status") != "refunded"
    )
    gross_sales_today = sum(float(order.get("subtotal") or 0) for order in today_orders)
    discounts_today = sum(float(order.get("discount_amount") or 0) for order in today_orders)
    refunds_today = sum(
        float(order.get("total_amount") or 0)
        for order in orders
        if order["_placed_at"] >= today_start and order.get("payment_status") == "refunded"
    )
    cancellations_today = sum(
        float(order.get("total_amount") or 0)
        for order in orders
        if order["_placed_at"] >= today_start and order.get("status") == OrderStatus.CANCELLED.value
    )
    active_orders = len([order for order in orders if order.get("status") in ACTIVE_STATUSES])
    avg_order = revenue_today / len(today_orders) if today_orders else 0

    order_ids = list(dict.fromkeys(order["id"] for order in completed_orders))
    item_rows = []
    if order_ids:
        item_rows = (
            client.table("order_items")
            .select("product_id, product_name, quantity, total_price")
            .eq("business_id", str(business_id))
            .in_("order_id", order_ids)
            .execute()
            .data
            or []
        )
    item_totals = defaultdict(lambda: {"quantity": 0, "revenue": 0.0})
    for item in item_rows:
        key = item.get("product_name") or str(item.get("product_id"))
        item_totals[key]["quantity"] += int(item.get("quantity") or 0)
        item_totals[key]["revenue"] += float(item.get("total_price") or 0)
    top_items = [
        {"name": name, **stats}
        for name, stats in sorted(item_totals.items(), key=lambda entry: (-entry[1]["revenue"], entry[0]))[:5]
    ]
    items_sold = sum(int(item.get("quantity") or 0) for item in item_rows)
    top_item = top_items[0] if top_items else None

    order_type_summary: dict[str, int] = defaultdict(int)
    payment_method_summary: dict[str, int] = defaultdict(int)
    for order in completed_orders:
        order_type_summary[str(order.get("order_type") or "unknown")] += 1
        payment_method_summary[str(order.get("payment_method") or "unknown")] += 1
    funnel = {
        "started": len(orders),
        "awaiting_payment": sum(1 for order in orders if order.get("payment_status") in {"unpaid", "pending", "pay_at_counter_pending"}),
        "paid": sum(1 for order in orders if order.get("payment_status") in {"paid", "authorized"}),
        "sent": sum(1 for order in orders if order.get("status") in ACTIVE_STATUSES or order.get("status") == OrderStatus.COMPLETED.value),
        "completed": len(completed_orders),
        "cancelled_or_failed": sum(1 for order in orders if order.get("status") == OrderStatus.CANCELLED.value or order.get("payment_status") in FAILED_PAYMENT_STATUSES),
    }

    weekly = []
    for offset in range(7):
        day = today_start - timedelta(days=offset)
        next_day = day + timedelta(days=1)
        day_orders = [
            order
            for order in completed_orders
            if day <= order["_placed_at"] < next_day
        ]
        weekly.append(
            {
                "date": day.date().isoformat(),
                "orders": len(day_orders),
                "revenue": sum(float(order.get("total_amount") or 0) for order in day_orders),
            }
        )

    # One bucket per calendar day across the selected period (oldest first), so charts follow the
    # chosen range instead of always showing the last seven days. Capped to keep responses bounded.
    period_first_day = _aware(period_start).replace(hour=0, minute=0, second=0, microsecond=0)
    period_last_day = period_end.replace(hour=0, minute=0, second=0, microsecond=0)
    day_count = max(1, min(366, (period_last_day - period_first_day).days + 1))
    day_totals: dict = {}
    for order in completed_orders:
        bucket = day_totals.setdefault(order["_placed_at"].date(), {"orders": 0, "revenue": 0.0})
        bucket["orders"] += 1
        bucket["revenue"] += float(order.get("total_amount") or 0)
    daily_revenue = []
    for offset in range(day_count):
        day_date = (period_first_day + timedelta(days=offset)).date()
        bucket = day_totals.get(day_date, {"orders": 0, "revenue": 0.0})
        daily_revenue.append(
            {
                "date": day_date.isoformat(),
                "orders": bucket["orders"],
                "revenue": round(bucket["revenue"], 2),
                "average_order_value": round(bucket["revenue"] / bucket["orders"], 2) if bucket["orders"] else 0.0,
            }
        )

    return {
        "daily_revenue": daily_revenue,
        "revenue_today": round(revenue_today, 2),
        "active_orders": active_orders,
        "orders_today": len(today_orders),
        "orders_last_hour": len(last_hour_orders),
        "orders_past_7_days": len(completed_orders),
        "items_sold": items_sold,
        "average_order_value": round(avg_order, 2),
        "top_selling_item": top_item,
        "top_selling_items": top_items,
        "gross_sales_today": round(gross_sales_today, 2),
        "discounts_today": round(discounts_today, 2),
        "refunds_today": round(refunds_today, 2),
        "cancellations_today": round(cancellations_today, 2),
        "net_sales_today": round(gross_sales_today - discounts_today - refunds_today, 2),
        "weekly_revenue": weekly,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "completed_orders": len(completed_orders),
        "period_gross_sales": round(period_gross_sales, 2),
        "period_discounts": round(period_discounts, 2),
        "period_refunds": round(period_refunds, 2),
        "period_cancellations": round(period_cancellations, 2),
        "period_net_sales": round(period_net_sales, 2),
        "period_average_order_value": round(period_net_sales / len(completed_orders), 2) if completed_orders else 0,
        "order_type_summary": dict(order_type_summary),
        "payment_method_summary": dict(payment_method_summary),
        "order_funnel": funnel,
    }


def _is_completed_order(order: dict) -> bool:
    source = str(order.get("source") or "").lower()
    payment_status = str(order.get("payment_status") or "").lower()
    return (
        order.get("status") == OrderStatus.COMPLETED.value
        and not order.get("is_test")
        and source not in {"test", "preview", "sandbox"}
        and payment_status not in FAILED_PAYMENT_STATUSES | {"unpaid", "pending", "pay_at_counter_pending"}
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
