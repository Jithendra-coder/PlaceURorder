from datetime import datetime
from uuid import UUID

import pytest
from fastapi import HTTPException

from routers.assistant import AssistantResponse
from schemas import StaffRole
from services import assistant_service, business_service, growth_coach_service


BUSINESS_ID = UUID("00000000-0000-0000-0000-000000000001")
USER_ID = UUID("00000000-0000-0000-0000-000000000002")


class GrowthClient:
    def __init__(self, totals=None, items=None):
        self.totals = totals or {
            "current_orders": 11,
            "current_total": 1500,
            "previous_orders": 12,
            "previous_total": 1900,
        }
        self.items = items if items is not None else [
            {"product_id": "00000000-0000-0000-0000-000000000011", "product_name": "Tea", "current_units": 12, "previous_units": 5, "current_item_total": 240, "previous_item_total": 100},
            {"product_id": "00000000-0000-0000-0000-000000000012", "product_name": "Pizza", "current_units": 7, "previous_units": 9, "current_item_total": 1400, "previous_item_total": 1800},
        ]
        self.queries = []

    def fetch_one(self, sql, params):
        self.queries.append((sql, params))
        if "currency_code" in sql:
            return {"currency_code": "INR"}
        return self.totals

    def fetch_all(self, sql, params):
        self.queries.append((sql, params))
        return self.items


def test_growth_question_routes_to_the_coach_before_generic_sales_intent():
    question = "How can I grow my menu sales?"

    assert assistant_service._classify_intent(assistant_service._tokens(question), True, question) == "growth_coach"


def test_coach_returns_access_checked_28_day_metrics_and_deterministic_actions(monkeypatch):
    client = GrowthClient()
    access = []
    monkeypatch.setattr(business_service, "assert_business_access", lambda *args: (access.append(args), {"owner_id": str(USER_ID)})[1])
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = assistant_service.answer(client, BUSINESS_ID, USER_ID, "How can I grow my menu sales?")

    assert result["intent"] == "growth_coach"
    assert result["answer_kind"] == "data"
    assert result["total"] == 3
    assert result["growth_summary"] == {
        "period_days": 28,
        "current_paid_total": 1500.0,
        "previous_paid_total": 1900.0,
        "current_orders": 11,
        "previous_orders": 12,
        "paid_total_change_percent": -21.1,
        "currency": "INR",
        "scope": "business",
        "scope_name": "All locations",
    }
    assert any("Review Pizza" == row["title"] for row in result["results"])
    assert next(row for row in result["results"] if row["title"] == "Review Pizza")["classification"] == "attention"
    assert next(row for row in result["results"] if row["title"] == "Review Pizza")["href"] == "/dashboard/kiosk-experience/menu?product=00000000-0000-0000-0000-000000000012"
    assert next(row for row in result["results"] if row["title"] == "Keep Tea visible")["classification"] == "opportunity"
    assert any(row["title"] == "Review paid order total" for row in result["results"])
    assert any("Keep Tea visible" == row["title"] for row in result["results"])
    assert any(source["kind"] == "live" for source in result["sources"])
    assert any(source["kind"] == "policy" and source["title"] == "Menu Growth Coach" for source in result["sources"])
    assert access[0][1:] == (BUSINESS_ID, USER_ID, business_service.ADMIN_ROLES)
    sql = "\n".join(query for query, _ in client.queries)
    assert "payment_status = 'paid'" in sql
    assert "payment_status in ('paid', 'authorized')" not in sql
    assert "oi.product_id" in sql
    assert "not in ('test', 'preview', 'sandbox', 'preview_sandbox')" in sql
    assert all(params["business_id"] == str(BUSINESS_ID) for _, params in client.queries)
    assert all(isinstance(params["period_end"], datetime) for _, params in client.queries if "period_end" in params)
    AssistantResponse.model_validate(result)


def test_coach_has_a_clear_no_history_fallback(monkeypatch):
    client = GrowthClient(
        totals={"current_orders": 0, "current_total": 0, "previous_orders": 0, "previous_total": 0},
        items=[],
    )
    monkeypatch.setattr(business_service, "assert_business_access", lambda *_: {"owner_id": str(USER_ID)})
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = growth_coach_service.answer_growth_coach(client, BUSINESS_ID, USER_ID, "How can I grow menu sales?")

    assert result["results"] == []
    assert result["total"] == 0
    assert "not enough paid completed order history" in result["text"]


def test_order_trend_waits_for_a_minimum_comparison_baseline(monkeypatch):
    monkeypatch.setattr(business_service, "assert_business_access", lambda *_: {"owner_id": str(USER_ID)})
    client = GrowthClient(totals={"current_orders": 6, "current_total": 600, "previous_orders": 4, "previous_total": 400})

    metrics = growth_coach_service._load_metrics(client, BUSINESS_ID, USER_ID)

    assert metrics["paid_total_change_percent"] is None


def test_invalid_model_evidence_is_discarded():
    candidates = [{"evidence_id": "top_item", "kind": "feature_top_seller", "evidence": {}}]
    selections = [
        growth_coach_service.RecommendationChoice(kind="feature_top_seller", evidence_id="another_business_item"),
        growth_coach_service.RecommendationChoice(kind="review_sales_drop", evidence_id="top_item"),
        growth_coach_service.RecommendationChoice(kind="feature_top_seller", evidence_id="top_item"),
    ]

    assert growth_coach_service._validated_choices(selections, candidates) == [
        {"kind": "feature_top_seller", "evidence_id": "top_item"},
    ]


def test_decline_candidates_require_a_minimum_baseline_and_meaningful_drop():
    metrics = {
        "items": [
            {"name": "Low volume", "product_id": "", "current_units": 0, "previous_units": 4, "current_item_total": 0, "previous_item_total": 100},
            {"name": "Small change", "product_id": "", "current_units": 9, "previous_units": 10, "current_item_total": 90, "previous_item_total": 100},
            {"name": "Meaningful decline", "product_id": "", "current_units": 8, "previous_units": 10, "current_item_total": 80, "previous_item_total": 100},
        ],
        "paid_total_change_percent": None,
        "current": {"total": 0},
        "previous": {"total": 0},
    }

    candidates = growth_coach_service._recommendation_candidates(metrics)

    assert [candidate["evidence"]["name"] for candidate in candidates if candidate["kind"] == "review_declining_item"] == ["Meaningful decline"]


def test_fallback_balances_item_and_overall_signals():
    candidates = [
        {"kind": "review_declining_item", "evidence_id": "decline_0"},
        {"kind": "review_declining_item", "evidence_id": "decline_1"},
        {"kind": "feature_top_seller", "evidence_id": "top_item"},
        {"kind": "review_sales_drop", "evidence_id": "sales_trend"},
    ]


def test_model_choices_are_balanced_even_if_it_repeats_item_declines():
    candidates = [
        {"kind": "review_declining_item", "evidence_id": "decline_0"},
        {"kind": "review_declining_item", "evidence_id": "decline_1"},
        {"kind": "feature_top_seller", "evidence_id": "top_item"},
        {"kind": "review_sales_drop", "evidence_id": "sales_trend"},
    ]
    selections = [
        growth_coach_service.RecommendationChoice(kind="review_declining_item", evidence_id="decline_0"),
        growth_coach_service.RecommendationChoice(kind="review_declining_item", evidence_id="decline_1"),
        growth_coach_service.RecommendationChoice(kind="feature_top_seller", evidence_id="top_item"),
    ]

    result = growth_coach_service._validated_choices(selections, candidates)

    assert {choice["kind"] for choice in result} == {"review_declining_item", "feature_top_seller", "review_sales_drop"}

    assert growth_coach_service._fallback_choices(candidates) == [
        {"kind": "review_declining_item", "evidence_id": "decline_0"},
        {"kind": "review_sales_drop", "evidence_id": "sales_trend"},
        {"kind": "feature_top_seller", "evidence_id": "top_item"},
    ]


def test_top_item_without_prior_sales_has_clear_baseline_and_menu_link():
    item = {"name": "New item", "product_id": "product-123", "current_units": 3, "previous_units": 0}

    result = growth_coach_service._render_choice(
        {"kind": "feature_top_seller", "evidence_id": "top_item"},
        {"kind": "feature_top_seller", "evidence": item},
        {"currency": "INR"},
    )

    assert result["fields"][0]["value"] == "No sales baseline"
    assert result["href"] == "/dashboard/kiosk-experience/menu?product=product-123"


def test_gemini_chain_uses_structured_output_and_only_supplied_candidates(monkeypatch):
    from langchain_core.runnables import RunnableLambda
    import langchain_google_genai

    captured = {}

    class FakeModel:
        def __init__(self, **kwargs):
            captured["model_options"] = kwargs

        def with_structured_output(self, schema, *, method):
            captured["schema"] = schema
            captured["method"] = method

            def choose(messages):
                captured["prompt"] = messages.to_messages()
                return {"recommendations": [{"kind": "feature_top_seller", "evidence_id": "top_item"}]}

            return RunnableLambda(choose)

    monkeypatch.setattr(langchain_google_genai, "ChatGoogleGenerativeAI", FakeModel)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    candidates = [{"evidence_id": "top_item", "kind": "feature_top_seller", "evidence": {"name": "Tea", "current_units": 12, "product_id": "private-catalog-id"}}]

    choices = growth_coach_service._select_with_gemini("How can I grow sales?", [], candidates)

    assert choices == [growth_coach_service.RecommendationChoice(kind="feature_top_seller", evidence_id="top_item")]
    assert captured["model_options"]["api_key"] == "test-key"
    assert captured["model_options"]["vertexai"] is False
    assert captured["model_options"]["model"] == "gemini-3.1-flash-lite"
    assert captured["method"] == "json_schema"
    prompt_text = " ".join(message.content for message in captured["prompt"])
    assert "How can I grow sales?" in prompt_text
    assert "top_item" in prompt_text
    assert "Tea" in prompt_text
    assert "private-catalog-id" not in prompt_text


def test_denied_sales_role_returns_notice_without_retrieving_data_or_calling_gemini(monkeypatch):
    class DeniedClient:
        def fetch_one(self, *_):
            raise AssertionError("denied users must not retrieve business data")

        def fetch_all(self, *_):
            raise AssertionError("denied users must not retrieve business data")

    def deny(*_args):
        raise HTTPException(status_code=403, detail="Forbidden")

    monkeypatch.setattr(business_service, "assert_business_access", deny)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(growth_coach_service, "_select_with_gemini", lambda *_: (_ for _ in ()).throw(AssertionError("denied data must not be sent")))

    result = growth_coach_service.answer_growth_coach(DeniedClient(), BUSINESS_ID, USER_ID, "grow sales")

    assert result["sources"][0]["kind"] == "notice"
    assert result["results"] == []
    assert "limited by your role" in result["text"]


def test_manager_metrics_are_scoped_to_assigned_locations(monkeypatch):
    location_a = "00000000-0000-0000-0000-000000000101"
    location_b = "00000000-0000-0000-0000-000000000102"

    class ManagerClient(GrowthClient):
        def fetch_all(self, sql, params):
            self.queries.append((sql, params))
            if "business_staff_location_access" in sql:
                return [{"id": location_a, "name": "Downtown"}, {"id": location_b, "name": "Airport"}]
            return self.items

    monkeypatch.setattr(business_service, "assert_business_access", lambda *_: {"owner_id": "another-owner"})
    monkeypatch.setattr(business_service, "get_business_role_for_user", lambda *_: StaffRole.MANAGER)
    client = ManagerClient()

    metrics = growth_coach_service._load_metrics(client, BUSINESS_ID, USER_ID)

    assert metrics["scope"] == "assigned_locations"
    assert metrics["scope_name"] == "Your assigned locations"
    order_queries = [(sql, params) for sql, params in client.queries if "from orders" in sql]
    assert len(order_queries) == 2
    assert all("location_id = any(%(location_ids)s::uuid[])" in sql for sql, _ in order_queries)
    assert all(params["location_ids"] == [location_a, location_b] for _, params in order_queries)


def test_manager_cannot_request_a_location_outside_assignment(monkeypatch):
    assigned_id = "00000000-0000-0000-0000-000000000101"
    outside_id = UUID("00000000-0000-0000-0000-000000000102")

    class ManagerClient(GrowthClient):
        def fetch_all(self, sql, params):
            self.queries.append((sql, params))
            if "business_staff_location_access" in sql:
                return [{"id": assigned_id, "name": "Downtown"}]
            return self.items

    monkeypatch.setattr(business_service, "assert_business_access", lambda *_: {"owner_id": "another-owner"})
    monkeypatch.setattr(business_service, "get_business_role_for_user", lambda *_: StaffRole.MANAGER)
    client = ManagerClient()

    with pytest.raises(HTTPException) as exc:
        growth_coach_service._load_metrics(client, BUSINESS_ID, USER_ID, outside_id)
    assert exc.value.status_code == 403
    assert not any("from orders" in sql for sql, _ in client.queries)


def test_manager_can_compare_one_assigned_location(monkeypatch):
    location_id = UUID("00000000-0000-0000-0000-000000000101")

    class ManagerClient(GrowthClient):
        def fetch_all(self, sql, params):
            self.queries.append((sql, params))
            if "business_staff_location_access" in sql:
                return [{"id": str(location_id), "name": "Downtown"}]
            return self.items

    monkeypatch.setattr(business_service, "assert_business_access", lambda *_: {"owner_id": "another-owner"})
    monkeypatch.setattr(business_service, "get_business_role_for_user", lambda *_: StaffRole.MANAGER)
    client = ManagerClient()

    metrics = growth_coach_service._load_metrics(client, BUSINESS_ID, USER_ID, location_id)

    assert metrics["scope"] == "location"
    assert metrics["scope_name"] == "Downtown"
    order_queries = [(sql, params) for sql, params in client.queries if "from orders" in sql]
    assert len(order_queries) == 2
    assert all(params["location_ids"] == [str(location_id)] for _, params in order_queries)


def test_manager_without_assignments_cannot_read_sales(monkeypatch):
    class UnassignedManagerClient(GrowthClient):
        def fetch_all(self, sql, params):
            self.queries.append((sql, params))
            if "business_staff_location_access" in sql:
                return []
            return self.items

    monkeypatch.setattr(business_service, "assert_business_access", lambda *_: {"owner_id": "another-owner"})
    monkeypatch.setattr(business_service, "get_business_role_for_user", lambda *_: StaffRole.MANAGER)
    client = UnassignedManagerClient()

    with pytest.raises(HTTPException) as exc:
        growth_coach_service._load_metrics(client, BUSINESS_ID, USER_ID)
    assert exc.value.status_code == 403
    assert not any("from orders" in sql for sql, _ in client.queries)
