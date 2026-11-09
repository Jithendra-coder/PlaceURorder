from uuid import UUID

import pytest
from fastapi import HTTPException

from services import business_service, order_service, test_session_service


BUSINESS_ID = UUID("00000000-0000-0000-0000-000000000001")
USER_ID = UUID("00000000-0000-0000-0000-000000000002")


class SessionClient:
    def __init__(self):
        self.insert_params = None
        self.commands = []

    def execute_command(self, sql, params):
        self.commands.append((sql, params))

    def fetch_one(self, sql, params):
        if "insert into kiosk_test_sessions" in sql:
            self.insert_params = params
            return {"id": "session-1", "business_id": str(BUSINESS_ID), "expires_at": params["expires_at"]}
        if "from kiosk_test_sessions" in sql and params["token_hash"] == test_session_service._hash("valid-token"):
            return {"id": "session-1", "business_id": str(BUSINESS_ID), "created_by": str(USER_ID), "expires_at": "future"}
        return None


def test_test_sessions_store_only_hashes_and_reject_unknown_tokens(monkeypatch):
    client = SessionClient()
    monkeypatch.setattr(business_service, "assert_business_access", lambda *_args, **_kwargs: {"slug": "demo"})
    created = test_session_service.create(client, BUSINESS_ID, USER_ID)

    assert created["token"]
    assert client.insert_params["token_hash"] == test_session_service._hash(created["token"])
    assert created["token"] not in client.insert_params.values()
    with pytest.raises(HTTPException) as exc:
        test_session_service.exchange(client, "unknown-token")
    assert exc.value.status_code == 401


def test_cookie_session_activity_touch_is_throttled():
    client = SessionClient()

    session = test_session_service.from_cookie(client, "valid-token")

    sql, params = client.commands[-1]
    assert session["id"] == "session-1"
    assert "last_used_at is null or last_used_at < now() - interval '1 minute'" in sql
    assert params == {"id": "session-1"}


class ReplayClient:
    def __init__(self):
        self.locked = False

    def execute_one(self, sql, _params):
        assert "pg_advisory_xact_lock" in sql
        self.locked = True

    def fetch_one(self, sql, params):
        assert self.locked
        assert "idempotency_key" in sql
        assert params["key"] == "submission-123"
        return {"id": "00000000-0000-0000-0000-000000000099"}


def test_idempotent_order_replay_returns_existing_order_before_repricing(monkeypatch):
    client = ReplayClient()
    existing = {"id": "00000000-0000-0000-0000-000000000099", "total_amount": 42}
    monkeypatch.setattr(order_service, "get_business_by_slug", lambda *_args: {"id": str(BUSINESS_ID)})
    monkeypatch.setattr(order_service, "get_order", lambda *_args: existing)
    monkeypatch.setattr(order_service.setup_service, "live_configuration", lambda *_args: pytest.fail("replay must not rebuild the order"))

    result = order_service.create_kiosk_order(client, "demo", object(), idempotency_key="submission-123")
    assert result == existing


def test_canonical_layout_and_welcome_fields_update_legacy_readers():
    layout = {"kiosk_layout_id": "side-navigation"}
    business_service._normalize_kiosk_configuration(layout, {"kiosk_theme": "top_category:premium_light"}, {"kiosk_layout_id"})
    assert layout["kiosk_theme"] == "left_category:premium_light"
    assert layout["kiosk_order_settings"]["display_configured"] is True

    welcome = {
        "welcome_screen": {
            "enabled": True,
            "heading": "Hello",
            "supporting_text": "Choose an item",
            "instruction_text": "Tap start",
            "start_button_text": "Start",
            "text_position": "bottom",
            "touch_anywhere_to_start": True,
            "show_business_logo": False,
        }
    }
    business_service._normalize_kiosk_configuration(welcome, {}, {"welcome_screen"})
    assert welcome["kiosk_start_text_position"] == "bottom"
    assert welcome["kiosk_start_screen_settings"]["configured"] is True
