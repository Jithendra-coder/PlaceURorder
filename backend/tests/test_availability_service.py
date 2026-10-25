from datetime import datetime

import pytest
from fastapi import HTTPException
from zoneinfo import ZoneInfo

from services.availability_service import _validate_rule_candidate, _windows_overlap, resolve_product


BUSINESS = {"timezone": "Asia/Kolkata"}
PRODUCT = {"id": "item-1", "category_id": "category-1", "is_available": True, "availability_type": "always"}


def rule(**changes):
    return {
        "id": changes.pop("id", "rule-1"), "target_type": "item", "target_id": "item-1", "rule_type": "exception",
        "is_available": False, "status": "active", "days": [], "time_windows": [], "location_ids": [],
        "starts_at": None, "ends_at": None, "created_at": "2026-08-07T00:00:00Z", **changes,
    }


def test_exception_and_item_precedence_with_expiry():
    now = datetime(2026, 8, 7, 12, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    category = rule(id="category", target_type="category", target_id="category-1", is_available=False)
    item = rule(id="item", target_type="item", is_available=True, ends_at="2026-08-07T07:30:00Z", updated_at="2026-08-07T06:00:00Z")

    assert resolve_product(PRODUCT, BUSINESS, [category, item], now=now)["available"] is True
    assert resolve_product(PRODUCT, BUSINESS, [category, item], now=datetime(2026, 8, 7, 14, 0, tzinfo=ZoneInfo("Asia/Kolkata")))["available"] is False


def test_location_scope_and_multiple_schedule_windows():
    schedule = rule(rule_type="schedule", is_available=True, days=["friday"], time_windows=[{"start": "08:00", "end": "10:00"}, {"start": "17:00", "end": "23:00"}], location_ids=["downtown"])

    assert resolve_product({**PRODUCT, "is_available": False}, BUSINESS, [schedule], "downtown", datetime(2026, 8, 7, 18, 0, tzinfo=ZoneInfo("Asia/Kolkata")))["available"] is True
    assert resolve_product({**PRODUCT, "is_available": False}, BUSINESS, [schedule], "airport", datetime(2026, 8, 7, 18, 0, tzinfo=ZoneInfo("Asia/Kolkata")))["available"] is False


def test_schedule_overlap_including_overnight_windows():
    assert _windows_overlap([{"start": "22:00", "end": "02:00"}], [{"start": "01:00", "end": "03:00"}]) is True
    assert _windows_overlap([{"start": "08:00", "end": "10:00"}], [{"start": "10:00", "end": "12:00"}]) is False


def test_active_schedule_update_cannot_clear_required_days_or_windows():
    with pytest.raises(HTTPException) as error:
        _validate_rule_candidate({"rule_type": "schedule", "status": "active", "days": [], "time_windows": [{"start": "09:00", "end": "10:00"}]})
    assert error.value.status_code == 422


def test_schedule_update_rejects_an_end_before_its_start():
    with pytest.raises(HTTPException) as error:
        _validate_rule_candidate({"rule_type": "exception", "status": "active", "starts_at": "2026-10-26T12:00:00Z", "ends_at": "2026-10-26T11:00:00Z"})
    assert error.value.status_code == 422
