from uuid import uuid4

from services.home_mode_service import home_mode


class StubClient:
    def __init__(self, business, menu=True, payment=True):
        self.business = business
        self.menu = menu
        self.payment = payment

    def fetch_one(self, sql, params=None):
        if "from businesses" in sql:
            return self.business
        if "from products p" in sql:
            return {"ok": 1} if self.menu else None
        if "business_payment_accounts" in sql:
            return {"ok": 1} if self.payment else None
        raise AssertionError(f"unexpected query: {sql}")


COMPLETE = {
    "name": "Tasty Bug",
    "type": "restaurant",
    "kiosk_theme": "top_category:premium_light",
    "kiosk_layout": "wide_16_9",
    "kiosk_screen_orientation": "landscape",
    "kiosk_screen_size": "32",
    "kiosk_order_settings": {"display_configured": True},
    "kiosk_start_screen_settings": {"configured": True},
}


def test_any_completed_order_means_active():
    assert home_mode(StubClient({}), uuid4(), 3) == "active"


def test_ready_business_without_orders_gets_first_order_view():
    assert home_mode(StubClient(COMPLETE), uuid4(), 0) == "first_order"


def test_missing_menu_keeps_setup_view():
    assert home_mode(StubClient(COMPLETE, menu=False), uuid4(), 0) == "setup"


def test_unconfigured_welcome_screen_keeps_setup_view():
    business = dict(COMPLETE, kiosk_start_screen_settings={})
    assert home_mode(StubClient(business), uuid4(), 0) == "setup"


def test_online_payment_requires_a_connected_account():
    business = dict(COMPLETE, kiosk_order_settings={"display_configured": True, "default_payment_method": "razorpay"})
    assert home_mode(StubClient(business, payment=False), uuid4(), 0) == "setup"
    assert home_mode(StubClient(business, payment=True), uuid4(), 0) == "first_order"


def test_counter_payment_needs_no_online_account():
    business = dict(COMPLETE, kiosk_order_settings={"display_configured": True, "default_payment_method": "pay_at_counter"})
    assert home_mode(StubClient(business, payment=False), uuid4(), 0) == "first_order"
