"""Single source of truth for which Home screen a business sees.

The server decides the mode from the same data the dashboard shows, and returns it with the
activation response. The browser renders that mode once; it never recomputes it from separate
requests, which is what made new users see the setup screen and then jump to the dashboard.
"""

from uuid import UUID

from database import DbClient

HOME_MODES = ("setup", "first_order", "active")
NON_ONLINE_PAYMENTS = {"cash", "counter", "pay_at_counter"}


def home_mode(client: DbClient, business_id: UUID, completed_order_count: int) -> str:
    if completed_order_count > 0:
        return "active"
    business = client.fetch_one(
        "select name, type, kiosk_theme, kiosk_layout, kiosk_screen_orientation, kiosk_screen_size, "
        "kiosk_order_settings, kiosk_start_screen_settings from businesses where id = %(id)s",
        {"id": str(business_id)},
    ) or {}
    settings = business.get("kiosk_order_settings") or {}
    start_screen = business.get("kiosk_start_screen_settings") or {}

    business_ready = bool(str(business.get("name") or "").strip() and business.get("type"))
    kiosk_ready = bool(
        settings.get("display_configured") is True
        and business.get("kiosk_theme")
        and business.get("kiosk_layout")
        and business.get("kiosk_screen_orientation")
        and business.get("kiosk_screen_size")
    )
    welcome_ready = start_screen.get("configured") is True
    menu_ready = client.fetch_one(
        "select 1 as ok from products p join categories c on c.id = p.category_id "
        "where p.business_id = %(id)s and p.is_available and c.is_active limit 1",
        {"id": str(business_id)},
    ) is not None
    payment = settings.get("default_payment_method")
    needs_online_payment = bool(payment and payment not in NON_ONLINE_PAYMENTS)
    payment_ready = (not needs_online_payment) or client.fetch_one(
        "select 1 as ok from business_payment_accounts where business_id = %(id)s "
        "and payments_enabled and connection_status in ('active', 'connected') limit 1",
        {"id": str(business_id)},
    ) is not None

    essentials = business_ready and kiosk_ready and welcome_ready and menu_ready and payment_ready
    return "first_order" if essentials else "setup"
