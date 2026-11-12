from services import growth_recommendation_service as svc


def metrics(**overrides):
    base = dict(
        revenue=100_000.0, previous_revenue=100_000.0, orders=200, previous_orders=200,
        gross=95_000.0, discounts=1_000.0, cancelled_orders=2, cancelled_value=600.0,
        hour_orders={12: 20, 13: 20, 19: 10}, item_lines=[], menu=[], location_revenue={},
        location_names={}, orders_without_drink=0, avg_drink_price=0.0,
    )
    base.update(overrides)
    return svc.Metrics(**base)


def test_score_is_zero_without_impact_or_sales():
    assert svc.score_candidate(0, 100_000, 200) == 0
    assert svc.score_candidate(5_000, 0, 200) == 0


def test_score_grows_with_impact_and_with_more_orders():
    small_sample = svc.score_candidate(5_000, 100_000, 20)
    full_sample = svc.score_candidate(5_000, 100_000, 300)
    assert 0 < small_sample < full_sample <= 100


def test_sales_drop_is_reported_only_when_meaningful():
    assert svc._sales_down(metrics(revenue=95_000, previous_revenue=100_000)) is None
    candidate = svc._sales_down(metrics(revenue=80_000, previous_revenue=100_000))
    assert candidate and candidate.rule_key == "sales_down" and candidate.impact == 20_000


def test_idle_items_need_enough_orders_and_several_items():
    menu = [{"name": "Classic", "is_available": True}, {"name": "Salad", "is_available": True}, {"name": "Soup", "is_available": True}]
    lines = [{"product_name": "Classic", "total_price": 200}]
    assert svc._idle_items(metrics(menu=menu, item_lines=lines, orders=10)) is None
    candidate = svc._idle_items(metrics(menu=menu, item_lines=lines, orders=200))
    assert candidate and candidate.evidence["idle_count"] == 2


def test_cancellations_flag_high_rate_only():
    assert svc._cancellations(metrics(cancelled_orders=2)) is None
    candidate = svc._cancellations(metrics(cancelled_orders=20, cancelled_value=8_000))
    assert candidate and candidate.impact == 4_000


def test_location_gap_compares_best_and_weakest():
    m = metrics(location_revenue={"a": 100_000, "b": 60_000}, location_names={"a": "Banjara Hills", "b": "Kondapur"})
    candidate = svc._location_gap(m)
    assert candidate and candidate.evidence["weaker_location"] == "Kondapur"
    assert svc._location_gap(metrics(location_revenue={"a": 100_000, "b": 90_000}, location_names={})) is None


def test_evaluate_keeps_the_strongest_five_in_order(monkeypatch):
    candidates = [
        svc.Candidate(f"rule_{index}", f"Rule {index}", "", "Open", "/x", impact=index * 1_000, evidence={})
        for index in range(1, 8)
    ]
    rules = tuple(lambda _m, c=candidate: c for candidate in candidates)
    monkeypatch.setattr(svc, "RULES", rules)
    results = svc.evaluate(metrics())
    assert len(results) == svc.MAX_RECOMMENDATIONS
    scores = [item["score"] for item in results]
    assert scores == sorted(scores, reverse=True)


def test_a_failing_rule_does_not_hide_the_others(monkeypatch):
    def broken(_m):
        raise RuntimeError("bad data")

    healthy = svc.Candidate("healthy", "Healthy", "", "Open", "/x", impact=5_000, evidence={})
    monkeypatch.setattr(svc, "RULES", (broken, lambda _m: healthy))
    results = svc.evaluate(metrics())
    assert [item["rule_key"] for item in results] == ["healthy"]


def test_no_sales_drop_is_claimed_when_the_earlier_period_is_incomplete():
    incomplete = metrics(revenue=20_000, previous_revenue=200_000, baseline_available=False)
    assert svc._sales_down(incomplete) is None
    assert svc._summary(incomplete, "All locations", "INR")["paid_total_change_percent"] is None


def test_quiet_hours_are_flagged_when_they_carry_almost_no_orders():
    busy = {hour: 40 for hour in range(11, 22)}
    busy.update({14: 0, 15: 1, 16: 1})
    candidate = svc._quiet_hours(metrics(hour_orders=busy, orders=sum(busy.values())))
    assert candidate and candidate.rule_key == "quiet_hours"
    assert "14:00" in candidate.evidence["quiet_hours"]
    assert svc._quiet_hours(metrics(hour_orders={hour: 40 for hour in range(11, 22)}, orders=440)) is None
