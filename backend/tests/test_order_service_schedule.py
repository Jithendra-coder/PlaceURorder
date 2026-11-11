from datetime import datetime
from zoneinfo import ZoneInfo

from services.order_service import _business_is_open


def business_with_schedule(tuesday, wednesday, *, overrides=None):
    return {
        "timezone": "Asia/Kolkata",
        "opening_time": "09:00",
        "closing_time": "22:00",
        "store_schedule": {
            "enabled": True,
            "weekly": {
                "tuesday": tuesday,
                "wednesday": wednesday,
            },
            "overrides": overrides or [],
        },
    }


def test_overnight_hours_continue_into_the_following_day():
    business = business_with_schedule(
        {"closed": False, "slots": [{"open": "22:00", "close": "02:00"}]},
        {"closed": False, "slots": [{"open": "09:00", "close": "17:00"}]},
    )

    assert _business_is_open(business, datetime(2026, 10, 28, 1, 30, tzinfo=ZoneInfo("Asia/Kolkata"))) is True


def test_overnight_hours_do_not_start_early_on_their_own_day():
    business = business_with_schedule(
        {"closed": False, "slots": [{"open": "09:00", "close": "17:00"}]},
        {"closed": False, "slots": [{"open": "22:00", "close": "02:00"}]},
    )

    assert _business_is_open(business, datetime(2026, 10, 28, 1, 30, tzinfo=ZoneInfo("Asia/Kolkata"))) is False


def test_previous_date_override_can_define_overnight_hours():
    business = business_with_schedule(
        {"closed": True, "slots": []},
        {"closed": False, "slots": [{"open": "09:00", "close": "17:00"}]},
        overrides=[{"date": "2026-10-27", "closed": False, "slots": [{"open": "22:00", "close": "02:00"}]}],
    )

    assert _business_is_open(business, datetime(2026, 10, 28, 1, 30, tzinfo=ZoneInfo("Asia/Kolkata"))) is True


def test_closed_date_override_suppresses_the_previous_days_overnight_hours():
    business = business_with_schedule(
        {"closed": False, "slots": [{"open": "22:00", "close": "02:00"}]},
        {"closed": False, "slots": [{"open": "09:00", "close": "17:00"}]},
        overrides=[{"date": "2026-10-28", "closed": True, "slots": []}],
    )

    assert _business_is_open(business, datetime(2026, 10, 28, 1, 30, tzinfo=ZoneInfo("Asia/Kolkata"))) is False
