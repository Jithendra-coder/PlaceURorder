"""Sales momentum recommendations, produced by saved, reviewable rules (no external model).

Each rule looks at the same paid, completed orders the dashboard reports on, estimates the revenue
an action could recover, and is scored from 0 to 100 against the period's sales. The top results
are saved per business, scope and day, so the page reads stored, explainable results instead of
asking a model on every visit. Rules that do not apply are not saved.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from psycopg.types.json import Jsonb

from database import DbClient

log = logging.getLogger(__name__)

PERIOD_DAYS = 28
MAX_RECOMMENDATIONS = 5
FULL_CONFIDENCE_ORDERS = 150
NON_REVENUE_PAYMENTS = {"refunded", "cancelled", "failed", "expired"}
DRINK_WORDS = ("drink", "shake", "beverage", "coffee", "tea", "juice", "lemonade", "cola")


@dataclass
class Candidate:
    rule_key: str
    title: str
    detail: str
    action_label: str
    action_href: str
    impact: float
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class Metrics:
    revenue: float
    previous_revenue: float
    orders: int
    previous_orders: int
    gross: float
    discounts: float
    cancelled_orders: int
    cancelled_value: float
    hour_orders: dict[int, int]
    item_lines: list[dict[str, Any]]
    menu: list[dict[str, Any]]
    location_revenue: dict[str, float]
    location_names: dict[str, str]
    orders_without_drink: int
    avg_drink_price: float
    # False when the business is younger than the comparison window, so the earlier period is incomplete.
    baseline_available: bool = True


def score_candidate(impact: float, revenue: float, orders: int) -> int:
    """Share of period sales the action could recover, weighted by how much data backs it."""
    if impact <= 0 or revenue <= 0:
        return 0
    opportunity = min(1.0, impact / revenue / 0.05)  # recovering 5% of period sales scores full marks
    confidence = min(1.0, orders / FULL_CONFIDENCE_ORDERS)
    return max(1, min(100, round(100 * opportunity * (0.4 + 0.6 * confidence))))


def _pct(part: float, whole: float) -> float:
    return (part / whole * 100) if whole else 0.0


def _sales_down(m: Metrics) -> Candidate | None:
    if not m.baseline_available or m.previous_revenue <= 0 or m.revenue >= m.previous_revenue * 0.92:
        return None
    change = _pct(m.revenue - m.previous_revenue, m.previous_revenue)
    gap = m.previous_revenue - m.revenue
    return Candidate(
        "sales_down", "Sales are down on the previous four weeks",
        f"Paid sales are {abs(change):.0f}% below the four weeks before. Check which days and items fell first.",
        "Review Sales & Orders", "/dashboard/insights/sales-reports", gap,
        {"current": round(m.revenue, 2), "previous": round(m.previous_revenue, 2), "change_percent": round(change, 1)},
    )


def _idle_items(m: Metrics) -> Candidate | None:
    sold = {line["product_name"] for line in m.item_lines}
    if m.orders < 30:
        return None
    idle = [item for item in m.menu if item["is_available"] and item["name"] not in sold]
    if len(idle) < 2:
        return None
    impact = min(0.05, 0.01 * len(idle)) * m.revenue
    names = ", ".join(item["name"] for item in idle[:4])
    return Candidate(
        "idle_menu_items", f"{len(idle)} available items sold nothing this period",
        f"Items with no sales: {names}{'…' if len(idle) > 4 else ''}. Feature them, rewrite their descriptions, or retire them.",
        "Review menu", "/dashboard/kiosk-experience/menu", impact,
        {"idle_count": len(idle), "examples": [item["name"] for item in idle[:6]]},
    )


def _attach_drinks(m: Metrics) -> Candidate | None:
    if m.orders < 30 or m.avg_drink_price <= 0 or m.orders_without_drink == 0:
        return None
    # Assume roughly one in seven orders without a drink would add one at the counter or kiosk.
    impact = m.orders_without_drink * (1 / 7) * m.avg_drink_price
    return Candidate(
        "drink_attach", "Offer a drink with more orders",
        f"{m.orders_without_drink} of {m.orders} orders had no drink. A drink upsell at checkout is the cheapest lift available.",
        "Open Kiosk & Menu", "/dashboard/kiosk-experience/screens", impact,
        {"orders_without_drink": m.orders_without_drink, "avg_drink_price": round(m.avg_drink_price, 2)},
    )


def _peak_hours(m: Metrics) -> Candidate | None:
    total = sum(m.hour_orders.values())
    if total < 40:
        return None
    top = sorted(m.hour_orders.items(), key=lambda item: item[1], reverse=True)[:2]
    share = sum(count for _, count in top) / total
    if share < 0.45:
        return None
    hours = ", ".join(f"{hour:02d}:00" for hour, _ in top)
    return Candidate(
        "peak_concentration", "Demand is concentrated in two hours",
        f"{share * 100:.0f}% of orders arrive around {hours}. Staff the kitchen and counter for those hours and prep ahead.",
        "Open kitchen display", "/dashboard/operations/kitchen-display", m.revenue * 0.05,
        {"top_hours": [f"{hour:02d}:00" for hour, _ in top], "share_percent": round(share * 100, 1)},
    )


def _quiet_hours(m: Metrics) -> Candidate | None:
    if len(m.hour_orders) < 4 or m.orders < 60:
        return None
    first, last = min(m.hour_orders), max(m.hour_orders)
    window = [hour for hour in range(first, last + 1)]
    average = m.orders / len(window)
    quiet = [hour for hour in window if m.hour_orders.get(hour, 0) <= 0.3 * average]
    if len(quiet) < 2:
        return None
    quiet_share = sum(m.hour_orders.get(hour, 0) for hour in quiet) / m.orders
    if quiet_share > 0.05:
        return None
    labels = ", ".join(f"{hour:02d}:00" for hour in quiet)
    return Candidate(
        "quiet_hours", "Some trading hours are almost empty",
        f"{labels} brought in {quiet_share * 100:.1f}% of orders. A targeted offer in those hours can fill them without discounting peak time.",
        "Review promotions", "/dashboard/kiosk-experience/promotions", m.revenue * quiet_share * 0.5,
        {"quiet_hours": [f"{hour:02d}:00" for hour in quiet], "share_percent": round(quiet_share * 100, 2)},
    )


def _cancellations(m: Metrics) -> Candidate | None:
    attempted = m.orders + m.cancelled_orders
    rate = _pct(m.cancelled_orders, attempted)
    if attempted < 30 or rate < 4:
        return None
    return Candidate(
        "cancellation_rate", "Orders are being cancelled too often",
        f"{rate:.1f}% of orders were cancelled. Recovering half of that value is a realistic target.",
        "Review order history", "/dashboard/operations/order-history", m.cancelled_value * 0.5,
        {"cancelled_orders": m.cancelled_orders, "rate_percent": round(rate, 1)},
    )


def _discounts(m: Metrics) -> Candidate | None:
    rate = _pct(m.discounts, m.gross)
    if m.gross <= 0 or rate < 6:
        return None
    return Candidate(
        "discount_leakage", "Discounts are eating into sales",
        f"Discounts are {rate:.1f}% of gross sales. Keep offers tied to slow hours or items, not everything.",
        "Review promotions", "/dashboard/kiosk-experience/promotions", m.discounts * 0.5,
        {"discounts": round(m.discounts, 2), "rate_percent": round(rate, 1)},
    )


def _location_gap(m: Metrics) -> Candidate | None:
    if len(m.location_revenue) < 2:
        return None
    best_id, best = max(m.location_revenue.items(), key=lambda item: item[1])
    worst_id, worst = min(m.location_revenue.items(), key=lambda item: item[1])
    if best <= 0 or worst >= best * 0.7:
        return None
    name = m.location_names.get(worst_id, "the weaker location")
    return Candidate(
        "location_gap", f"{name} trails your best location",
        f"{name} took {worst / best * 100:.0f}% of the best location's sales this period. Compare menus, hours and staffing.",
        "Compare locations", "/dashboard/administration/locations", (best - worst) * 0.25,
        {"best_location": m.location_names.get(best_id, ""), "weaker_location": name},
    )


def _top_item_dependence(m: Metrics) -> Candidate | None:
    if m.revenue <= 0 or m.orders < 40 or not m.item_lines:
        return None
    totals: dict[str, float] = {}
    for line in m.item_lines:
        totals[line["product_name"]] = totals.get(line["product_name"], 0.0) + line["total_price"]
    top_name, top_value = max(totals.items(), key=lambda item: item[1])
    share = _pct(top_value, sum(totals.values()))
    if share < 35:
        return None
    return Candidate(
        "top_item_dependence", f"{top_name} carries {share:.0f}% of item sales",
        "One item driving most of your sales is a risk if it sells out or a competitor copies it. Promote a second hero item.",
        "Feature an item", "/dashboard/kiosk-experience/menu", top_value * 0.1,
        {"item": top_name, "share_percent": round(share, 1)},
    )


RULES: tuple[Callable[[Metrics], Candidate | None], ...] = (
    _sales_down, _cancellations, _discounts, _idle_items, _attach_drinks, _peak_hours, _quiet_hours, _location_gap, _top_item_dependence,
)


def evaluate(metrics: Metrics) -> list[dict[str, Any]]:
    """Run every saved rule, score each applicable result, and keep the strongest few."""
    results = []
    for rule in RULES:
        try:
            candidate = rule(metrics)
        except Exception:  # one rule failing must never hide the others
            log.exception("growth rule %s failed", rule.__name__)
            continue
        if candidate is None:
            continue
        score = score_candidate(candidate.impact, metrics.revenue, metrics.orders)
        if score <= 0:
            continue
        results.append({
            "rule_key": candidate.rule_key,
            "title": candidate.title,
            "detail": candidate.detail,
            "action_label": candidate.action_label,
            "action_href": candidate.action_href,
            "score": score,
            "impact_estimate": round(candidate.impact, 2),
            "evidence": candidate.evidence,
        })
    results.sort(key=lambda item: (item["score"], item["impact_estimate"]), reverse=True)
    return results[:MAX_RECOMMENDATIONS]


def _as_datetime(value: Any) -> datetime:
    """DbClient returns timestamps as ISO text; compare them as timezone-aware datetimes."""
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _is_paid(row: dict[str, Any]) -> bool:
    return row["status"] == "completed" and row.get("payment_status") not in NON_REVENUE_PAYMENTS


def _business_zone(client: DbClient, business_id: UUID) -> ZoneInfo:
    row = client.fetch_one("select timezone from businesses where id = %(id)s", {"id": str(business_id)}) or {}
    try:
        return ZoneInfo(row.get("timezone") or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _metrics(client: DbClient, business_id: UUID, location_id: UUID | None, now: datetime) -> Metrics:
    zone = _business_zone(client, business_id)
    current_start = now - timedelta(days=PERIOD_DAYS)
    previous_start = now - timedelta(days=PERIOD_DAYS * 2)
    scope = "" if location_id is None else " and o.location_id = %(location)s"
    params: dict[str, Any] = {"business": str(business_id), "previous_start": previous_start, "current_start": current_start, "now": now}
    if location_id is not None:
        params["location"] = str(location_id)

    earliest = client.fetch_one("select min(placed_at) as first_order from orders where business_id = %(business)s", {"business": str(business_id)}) or {}
    baseline_available = bool(earliest.get("first_order")) and _as_datetime(earliest["first_order"]) <= previous_start + timedelta(days=3)

    orders = client.fetch_all(
        "select o.id, o.location_id, o.status, o.payment_status, o.placed_at, o.subtotal, o.discount_amount, o.total_amount "
        "from orders o where o.business_id = %(business)s and o.placed_at >= %(previous_start)s and o.placed_at < %(now)s" + scope,
        params,
    )
    for row in orders:
        row["placed_at"] = _as_datetime(row["placed_at"])
    current = [row for row in orders if row["placed_at"] >= current_start]
    previous = [row for row in orders if row["placed_at"] < current_start]
    current_paid = [row for row in current if _is_paid(row)]
    previous_paid = [row for row in previous if _is_paid(row)]
    paid_ids = {str(row["id"]) for row in current_paid}

    lines = client.fetch_all(
        "select oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.total_price, c.name as category "
        "from order_items oi join orders o on o.id = oi.order_id "
        "left join products p on p.id = oi.product_id left join categories c on c.id = p.category_id "
        "where o.business_id = %(business)s and o.placed_at >= %(current_start)s and o.placed_at < %(now)s and o.status = 'completed'" + scope,
        params,
    )
    item_lines = [line for line in lines if str(line["order_id"]) in paid_ids]
    menu = client.fetch_all(
        "select p.id, p.name, p.price, p.is_available, c.name as category from products p "
        "left join categories c on c.id = p.category_id where p.business_id = %(business)s and p.menu_status = 'shown'",
        {"business": str(business_id)},
    )

    hour_orders: dict[int, int] = {}
    for row in current_paid:
        local = row["placed_at"].astimezone(zone)
        hour_orders[local.hour] = hour_orders.get(local.hour, 0) + 1

    order_items: dict[str, list[dict[str, Any]]] = {}
    for line in item_lines:
        order_items.setdefault(str(line["order_id"]), []).append(line)
    drink_orders = 0
    orders_without_drink = 0
    drink_prices: list[float] = []
    for order_id, rows in order_items.items():
        drinks = [row for row in rows if any(word in str(row.get("category") or "").lower() for word in DRINK_WORDS)]
        if drinks:
            drink_orders += 1
            drink_prices.extend(float(row["total_price"]) / max(1, int(row["quantity"])) for row in drinks)
        else:
            orders_without_drink += 1

    location_names = {str(row["id"]): row["name"] for row in client.fetch_all(
        "select id, name from business_locations where business_id = %(business)s", {"business": str(business_id)})}
    location_revenue: dict[str, float] = {}
    if location_id is None:
        for row in current_paid:
            key = str(row.get("location_id") or "")
            if key:
                location_revenue[key] = location_revenue.get(key, 0.0) + float(row["total_amount"] or 0)

    return Metrics(
        revenue=sum(float(row["total_amount"] or 0) for row in current_paid),
        previous_revenue=sum(float(row["total_amount"] or 0) for row in previous_paid),
        orders=len(current_paid),
        previous_orders=len(previous_paid),
        gross=sum(float(row["subtotal"] or 0) for row in current_paid),
        discounts=sum(float(row["discount_amount"] or 0) for row in current_paid),
        cancelled_orders=sum(1 for row in current if row["status"] == "cancelled"),
        cancelled_value=sum(float(row["total_amount"] or 0) for row in current if row["status"] == "cancelled"),
        hour_orders=hour_orders,
        item_lines=item_lines,
        menu=[{"id": str(row["id"]), "name": row["name"], "price": float(row["price"] or 0), "is_available": bool(row["is_available"]), "category": row.get("category")} for row in menu],
        location_revenue=location_revenue,
        location_names=location_names,
        orders_without_drink=orders_without_drink,
        avg_drink_price=(sum(drink_prices) / len(drink_prices)) if drink_prices else 0.0,
        baseline_available=baseline_available,
    )


def _summary(metrics: Metrics, scope_name: str, currency: str) -> dict[str, Any]:
    comparable = metrics.baseline_available and metrics.previous_revenue > 0
    change = round(_pct(metrics.revenue - metrics.previous_revenue, metrics.previous_revenue), 1) if comparable else None
    return {
        "period_days": PERIOD_DAYS,
        "scope_name": scope_name,
        "currency": currency,
        "current_paid_total": round(metrics.revenue, 2),
        "previous_paid_total": round(metrics.previous_revenue, 2),
        "current_orders": metrics.orders,
        "previous_orders": metrics.previous_orders,
        "paid_total_change_percent": change,
    }


def recommendations(client: DbClient, business_id: UUID, location_id: UUID | None = None, *, refresh: bool = False, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    zone = _business_zone(client, business_id)
    today = now.astimezone(zone).date()
    scope_key = str(location_id) if location_id else "all"
    business = client.fetch_one("select currency_code from businesses where id = %(id)s", {"id": str(business_id)}) or {}
    scope_name = "All locations"
    if location_id:
        located = client.fetch_one("select name from business_locations where id = %(id)s and business_id = %(business)s", {"id": str(location_id), "business": str(business_id)})
        scope_name = located["name"] if located else "Selected location"

    if not refresh:
        saved = client.fetch_all(
            "select rule_key, title, detail, action_label, action_href, score, impact_estimate, evidence, generated_at "
            "from business_growth_recommendations where business_id = %(business)s and scope_key = %(scope)s and period_end = %(day)s "
            "order by score desc, impact_estimate desc limit %(limit)s",
            {"business": str(business_id), "scope": scope_key, "day": today, "limit": MAX_RECOMMENDATIONS},
        )
        if saved:
            metrics = _metrics(client, business_id, location_id, now)
            return {"as_of": saved[0]["generated_at"], "summary": _summary(metrics, scope_name, business.get("currency_code") or "INR"), "recommendations": saved, "source": "saved"}

    metrics = _metrics(client, business_id, location_id, now)
    results = evaluate(metrics)
    client.execute_command(
        "delete from business_growth_recommendations where business_id = %(business)s and scope_key = %(scope)s and period_end = %(day)s",
        {"business": str(business_id), "scope": scope_key, "day": today},
    )
    for item in results:
        client.execute_command(
            "insert into business_growth_recommendations (business_id, location_id, scope_key, period_end, rule_key, title, detail, action_label, action_href, score, impact_estimate, evidence) "
            "values (%(business)s, %(location)s, %(scope)s, %(day)s, %(rule)s, %(title)s, %(detail)s, %(action_label)s, %(action_href)s, %(score)s, %(impact)s, %(evidence)s) "
            "on conflict (business_id, scope_key, period_end, rule_key) do update set title = excluded.title, detail = excluded.detail, "
            "action_label = excluded.action_label, action_href = excluded.action_href, score = excluded.score, impact_estimate = excluded.impact_estimate, "
            "evidence = excluded.evidence, generated_at = now()",
            {
                "business": str(business_id), "location": str(location_id) if location_id else None, "scope": scope_key, "day": today,
                "rule": item["rule_key"], "title": item["title"], "detail": item["detail"], "action_label": item["action_label"],
                "action_href": item["action_href"], "score": item["score"], "impact": item["impact_estimate"], "evidence": Jsonb(item["evidence"]),
            },
        )
    return {"as_of": now, "summary": _summary(metrics, scope_name, business.get("currency_code") or "INR"), "recommendations": results, "source": "generated"}
