from __future__ import annotations

from datetime import datetime, time, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from database import DbClient
from schemas import AvailabilityRuleCreate, AvailabilityRuleUpdate
from services import cache_service
from services.business_service import FULL_ACCESS_ROLES, assert_business_access


TARGET_TABLES = {"item": "products", "category": "categories", "combo": "menu_combos", "location": "business_locations"}
DAY_INDEX = {name: index for index, name in enumerate(("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"))}


def overview(client: DbClient, business_id: UUID, user_id: UUID, location_id: UUID | None = None) -> dict:
    business = assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    locations = client.table("business_locations").select("*").eq("business_id", str(business_id)).order("name").execute().data or []
    if location_id and not any(str(row["id"]) == str(location_id) for row in locations):
        raise HTTPException(status_code=404, detail="Location not found.")
    products = client.table("products").select("*").eq("business_id", str(business_id)).order("created_at", desc=True).execute().data or []
    rules = list_rules(client, business_id)
    resolved = []
    for product in products:
        if location_id:
            state = resolve_product(product, business, rules, str(location_id))
        elif len(locations) > 1:
            states = [resolve_product(product, business, rules, str(location["id"])) for location in locations]
            state = states[0] if states else resolve_product(product, business, rules)
            if any(entry["available"] != state["available"] for entry in states[1:]):
                state = {**state, "mixed": True, "source": "location", "reason": "Mixed across locations"}
        else:
            state = resolve_product(product, business, rules, str(locations[0]["id"]) if locations else None)
        resolved.append({"product_id": product["id"], **state})
    return {"rules": rules, "locations": locations, "resolved": resolved}


def list_rules(client: DbClient, business_id: UUID | str) -> list[dict]:
    return client.table("availability_rules").select("*").eq("business_id", str(business_id)).order("created_at", desc=True).execute().data or []


def create_rule(client: DbClient, business_id: UUID, user_id: UUID, payload: AvailabilityRuleCreate) -> dict:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json")
    _validate_scope(client, business_id, data)
    _validate_conflicts(client, business_id, data)
    data.update({"business_id": str(business_id), "created_by": str(user_id), "updated_by": str(user_id)})
    rows = client.table("availability_rules").insert(data).execute().data or []
    if not rows:
        raise HTTPException(status_code=400, detail="Availability rule could not be created.")
    _audit(client, business_id, user_id, "availability_rule_created", rows[0], {"target_type": rows[0]["target_type"], "rule_type": rows[0]["rule_type"], "target_id": str(rows[0].get("target_id") or "")})
    _changed(client, business_id)
    return rows[0]


def update_rule(client: DbClient, business_id: UUID, rule_id: UUID, user_id: UUID, payload: AvailabilityRuleUpdate) -> dict:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    current = _rule(client, business_id, rule_id)
    changes = payload.model_dump(mode="json", exclude_unset=True)
    if not changes:
        return current
    candidate = {**current, **changes}
    _validate_rule_candidate(candidate)
    _validate_scope(client, business_id, candidate)
    _validate_conflicts(client, business_id, candidate, rule_id)
    changes.update({"updated_by": str(user_id), "updated_at": datetime.now(timezone.utc).isoformat()})
    rows = client.table("availability_rules").update(changes).eq("id", str(rule_id)).eq("business_id", str(business_id)).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Availability rule not found.")
    _audit(client, business_id, user_id, "availability_rule_updated", rows[0], {"fields": sorted(key for key in changes if key not in {"updated_by", "updated_at"})})
    _changed(client, business_id)
    return rows[0]


def delete_rule(client: DbClient, business_id: UUID, rule_id: UUID, user_id: UUID) -> None:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    current = _rule(client, business_id, rule_id)
    client.table("availability_rules").delete().eq("id", str(rule_id)).eq("business_id", str(business_id)).execute()
    _audit(client, business_id, user_id, "availability_rule_deleted", current, {"target_type": current["target_type"], "rule_type": current["rule_type"], "target_id": str(current.get("target_id") or "")})
    _changed(client, business_id)


def resolve_product(product: dict, business: dict, rules: list[dict], location_id: str | None = None, now: datetime | None = None) -> dict:
    clock = now or datetime.now(_timezone(business.get("timezone")))
    matching = [rule for rule in rules if _targets_product(rule, product, location_id) and _applies_to_location(rule, location_id) and rule.get("status") == "active"]
    precedence = (
        ("exception", "location"), ("exception", "menu"), ("exception", "item"), ("exception", "category"),
        ("schedule", "item"), ("schedule", "category"), ("schedule", "menu"),
    )
    for rule_type, target_type in precedence:
        candidates = [rule for rule in matching if rule.get("rule_type") == rule_type and rule.get("target_type") == target_type and _rule_active(rule, clock)]
        if candidates:
            rule = max(candidates, key=lambda entry: str(entry.get("updated_at") or entry.get("created_at") or ""))
            return {
                "available": bool(rule.get("is_available")), "mixed": False, "source": rule_type,
                "reason": rule.get("reason") or _source_label(rule), "next_change_at": _next_change(rule, clock), "rule_id": rule.get("id"),
            }
    available = bool(product.get("is_available")) and _legacy_schedule_active(product, clock)
    source = "schedule" if product.get("availability_type") == "scheduled" else "default"
    return {"available": available, "mixed": False, "source": source, "reason": "Product schedule" if source == "schedule" else "Default", "next_change_at": None, "rule_id": None}


def _rule(client: DbClient, business_id: UUID, rule_id: UUID) -> dict:
    rows = client.table("availability_rules").select("*").eq("id", str(rule_id)).eq("business_id", str(business_id)).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Availability rule not found.")
    return rows[0]


def _validate_scope(client: DbClient, business_id: UUID, data: dict) -> None:
    target_type, target_id = data.get("target_type"), data.get("target_id")
    if target_type != "menu":
        table = TARGET_TABLES.get(target_type)
        rows = client.table(table).select("id").eq("id", str(target_id)).eq("business_id", str(business_id)).limit(1).execute().data if table else []
        if not rows:
            raise HTTPException(status_code=404, detail="Availability target not found.")
    location_ids = {str(value) for value in data.get("location_ids") or []}
    if location_ids:
        rows = client.table("business_locations").select("id").eq("business_id", str(business_id)).execute().data or []
        if not location_ids.issubset({str(row["id"]) for row in rows}):
            raise HTTPException(status_code=404, detail="One or more locations are outside this business.")


def _validate_rule_candidate(candidate: dict) -> None:
    if candidate.get("rule_type") == "schedule" and candidate.get("status") == "active" and (not candidate.get("days") or not candidate.get("time_windows")):
        raise HTTPException(status_code=422, detail="An active schedule needs at least one day and time window.")
    starts_at, ends_at = _datetime(candidate.get("starts_at")), _datetime(candidate.get("ends_at"))
    if starts_at and ends_at and starts_at >= ends_at:
        raise HTTPException(status_code=422, detail="Availability end must be after its start.")


def _validate_conflicts(client: DbClient, business_id: UUID, candidate: dict, current_id: UUID | None = None) -> None:
    if candidate.get("rule_type") != "schedule" or candidate.get("status") != "active":
        return
    for rule in list_rules(client, business_id):
        if str(rule.get("id")) == str(current_id) or rule.get("rule_type") != "schedule" or rule.get("status") != "active":
            continue
        if rule.get("target_type") != candidate.get("target_type") or str(rule.get("target_id")) != str(candidate.get("target_id")):
            continue
        if not _scope_overlaps(rule.get("location_ids") or [], candidate.get("location_ids") or []):
            continue
        if set(_days(rule)) & set(_days(candidate)) and _windows_overlap(rule.get("time_windows") or [], candidate.get("time_windows") or []):
            raise HTTPException(status_code=409, detail=f"Schedule overlaps with {rule.get('name') or 'an existing availability rule'}.")


def _targets_product(rule: dict, product: dict, location_id: str | None) -> bool:
    target_type, target_id = rule.get("target_type"), str(rule.get("target_id") or "")
    return target_type == "menu" or target_type == "item" and target_id == str(product.get("id")) or target_type == "category" and target_id == str(product.get("category_id") or "") or target_type == "location" and bool(location_id) and target_id == location_id


def _applies_to_location(rule: dict, location_id: str | None) -> bool:
    scopes = {str(value) for value in rule.get("location_ids") or []}
    return not scopes or bool(location_id) and location_id in scopes


def _rule_active(rule: dict, clock: datetime) -> bool:
    start, end = _datetime(rule.get("starts_at")), _datetime(rule.get("ends_at"))
    if start and clock.astimezone(timezone.utc) < start:
        return False
    if end and clock.astimezone(timezone.utc) >= end:
        return False
    if rule.get("rule_type") == "exception":
        return True
    if clock.strftime("%A").lower() not in _days(rule):
        return False
    return any(_time_in_window(clock.time(), window) for window in rule.get("time_windows") or [])


def _next_change(rule: dict, clock: datetime) -> str | None:
    end = _datetime(rule.get("ends_at"))
    if rule.get("rule_type") == "exception" and end:
        return end.isoformat()
    if rule.get("rule_type") == "schedule":
        ends = [_parse_time(window.get("end")) for window in rule.get("time_windows") or []]
        future = sorted(value for value in ends if value and value > clock.time())
        if future:
            return datetime.combine(clock.date(), future[0], clock.tzinfo).isoformat()
    return None


def _legacy_schedule_active(product: dict, clock: datetime) -> bool:
    if product.get("availability_type") != "scheduled":
        return True
    days = {str(day).lower() for day in product.get("available_days") or []}
    if days and clock.strftime("%A").lower() not in days:
        return False
    start, end = _parse_time(product.get("availability_start_time")), _parse_time(product.get("availability_end_time"))
    return not start and not end or _time_in_window(clock.time(), {"start": start, "end": end})


def _time_in_window(value: time, window: dict) -> bool:
    start, end = _parse_time(window.get("start")), _parse_time(window.get("end"))
    if not start or not end:
        return False
    return start <= value < end if start < end else value >= start or value < end


def _windows_overlap(left: list[dict], right: list[dict]) -> bool:
    def minutes(value) -> int:
        parsed = _parse_time(value)
        return parsed.hour * 60 + parsed.minute if parsed else -1
    def spans(window: dict) -> list[tuple[int, int]]:
        start, end = minutes(window.get("start")), minutes(window.get("end"))
        if start < 0 or end < 0:
            return []
        return [(start, end)] if start < end else [(start, 1440), (0, end)]
    return any(max(a, c) < min(b, d) for first in left for second in right for a, b in spans(first) for c, d in spans(second))


def _scope_overlaps(left: list, right: list) -> bool:
    return not left or not right or bool({str(value) for value in left} & {str(value) for value in right})


def _days(rule: dict) -> list[str]:
    return [str(day).lower() for day in rule.get("days") or [] if str(day).lower() in DAY_INDEX]


def _source_label(rule: dict) -> str:
    if rule.get("target_type") == "category":
        return "Inherited from category"
    if rule.get("target_type") == "location":
        return "Location override"
    return "Temporary override" if rule.get("rule_type") == "exception" else "Schedule"


def _datetime(value) -> datetime | None:
    if not value:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _parse_time(value) -> time | None:
    if isinstance(value, time):
        return value
    try:
        return time.fromisoformat(str(value)[:8])
    except (TypeError, ValueError):
        return None


def _timezone(value: str | None):
    try:
        return ZoneInfo(value or "UTC")
    except ZoneInfoNotFoundError:
        return timezone.utc


def _changed(client: DbClient, business_id: UUID) -> None:
    cache_service.invalidate_business(client, str(business_id))


def _audit(client: DbClient, business_id: UUID, user_id: UUID, action: str, rule: dict, metadata: dict) -> None:
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(user_id), "action": action, "entity": "availability_rule", "entity_id": str(rule["id"]), "metadata": metadata}).execute()
