from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from services import rate_limit_service
from services.rate_limit_service import RateLimitRule, assert_rate_limit


def request(host="192.0.2.10", forwarded_for=None):
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (host, 1234)})


@pytest.fixture(autouse=True)
def limiter(monkeypatch):
    settings = SimpleNamespace(
        rate_limit_enabled=True,
        rate_limit_max_buckets=1000,
        rate_limit_trusted_proxy_cidrs="",
        jwt_secret="configured-test-secret",
    )
    monkeypatch.setattr(rate_limit_service, "get_settings", lambda: settings)
    rate_limit_service.reset_rate_limits()
    yield settings
    rate_limit_service.reset_rate_limits()


def test_direct_client_and_untrusted_forwarding(limiter):
    spoofed = request("192.0.2.10", "203.0.113.9")
    assert rate_limit_service._client_ip(spoofed, "") == "192.0.2.10"
    assert rate_limit_service._client_ip(spoofed, "10.0.0.0/8") == "192.0.2.10"


def test_trusted_proxy_chains_ipv4_ipv6_and_ports(limiter):
    trusted = "10.0.0.0/8,2001:db8:1::/48"
    assert rate_limit_service._client_ip(request("10.0.0.2", "203.0.113.9"), trusted) == "203.0.113.9"
    assert rate_limit_service._client_ip(
        request("10.0.0.3:443", "203.0.113.9, 10.0.0.1, 10.0.0.2"), trusted
    ) == "203.0.113.9"
    assert rate_limit_service._client_ip(
        request("[2001:db8:1::2]:443", "[2001:db8:2::9]:8443"), trusted
    ) == "2001:db8:2::9"


def test_nearest_untrusted_proxy_stops_spoofed_left_chain(limiter):
    chain = request("10.0.0.2", "198.51.100.77, 203.0.113.8")
    assert rate_limit_service._client_ip(chain, "10.0.0.0/8") == "203.0.113.8"


@pytest.mark.parametrize("forwarded", ["", "garbage", "203.0.113.8,", "[bad]:443", "192.0.2.1:99999"])
def test_malformed_forwarding_falls_back_to_direct_peer(limiter, forwarded):
    assert rate_limit_service._client_ip(request("10.0.0.2", forwarded), "10.0.0.0/8") == "10.0.0.2"


def test_identifier_keys_are_hmaced_and_isolated(limiter):
    rule = RateLimitRule("login", 5, 60)
    assert_rate_limit(request(), rule, identity_parts=["User@Example.com", "secret-token"])
    first_key = next(iter(rate_limit_service._BUCKETS))
    assert "user@example.com" not in first_key and "secret-token" not in first_key

    assert_rate_limit(request(), rule, identity_parts=["other@example.com", "secret-token"])
    assert len(rate_limit_service._BUCKETS) == 3


def test_source_and_identity_limits_are_independent(limiter):
    rule = RateLimitRule("login", 2, 60)
    assert_rate_limit(request(), rule, identity_parts=["first@example.com"])
    assert_rate_limit(request(), rule, identity_parts=["second@example.com"])
    with pytest.raises(HTTPException) as exc:
        assert_rate_limit(request(), rule, identity_parts=["third@example.com"])
    assert exc.value.status_code == 429

    rate_limit_service.reset_rate_limits()
    assert_rate_limit(request("192.0.2.10"), rule, identity_parts=["first@example.com"])
    assert_rate_limit(request("192.0.2.11"), rule, identity_parts=["first@example.com"])
    with pytest.raises(HTTPException) as exc:
        assert_rate_limit(request("192.0.2.12"), rule, identity_parts=["first@example.com"])
    assert exc.value.status_code == 429


def test_threshold_boundary_and_retry_after(monkeypatch, limiter):
    now = [100.0]
    monkeypatch.setattr(rate_limit_service.time, "monotonic", lambda: now[0])
    rule = RateLimitRule("login", 2, 10)
    assert_rate_limit(request(), rule)
    assert_rate_limit(request(), rule)
    now[0] = 103.2
    with pytest.raises(HTTPException) as exc:
        assert_rate_limit(request(), rule)
    assert exc.value.status_code == 429
    assert exc.value.detail == "Too many requests. Please wait a moment and try again."
    assert exc.value.headers == {"Retry-After": "7"}
    now[0] = 110.0
    assert_rate_limit(request(), rule)


def test_idle_cleanup_and_maximum_bucket_failure(monkeypatch, limiter):
    now = [0.0]
    monkeypatch.setattr(rate_limit_service.time, "monotonic", lambda: now[0])
    limiter.rate_limit_max_buckets = 4
    rule = RateLimitRule("reset", 2, 10)
    assert_rate_limit(request("192.0.2.10"), rule, identity_parts=["one"])
    assert_rate_limit(request("192.0.2.11"), rule, identity_parts=["two"])
    with pytest.raises(HTTPException) as exc:
        assert_rate_limit(request("192.0.2.12"), rule, identity_parts=["three"])
    assert exc.value.headers == {"Retry-After": "1"}
    assert len(rate_limit_service._BUCKETS) == 4

    now[0] = 61.0
    assert_rate_limit(request("192.0.2.12"), rule, identity_parts=["three"])
    assert len(rate_limit_service._BUCKETS) == 2


def test_concurrent_calls_share_one_protected_bucket(limiter):
    rule = RateLimitRule("concurrent", 50, 60)

    def call():
        try:
            assert_rate_limit(request(), rule)
            return True
        except HTTPException:
            return False

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda _index: call(), range(100)))
    assert sum(results) == 50
    assert len(rate_limit_service._BUCKETS) == 1


def test_process_local_limitation_is_documented():
    assert "process-local" in rate_limit_service.__doc__.lower()


def test_configured_production_redis_failure_fails_closed(monkeypatch, limiter):
    limiter.environment = "production"
    limiter.redis_url = "redis://rate-limiter.example.test"

    def unavailable(*_args):
        raise HTTPException(status_code=503, detail="Rate-limit enforcement is unavailable.")

    monkeypatch.setattr(rate_limit_service, "_assert_shared_bucket", unavailable)

    with pytest.raises(HTTPException) as error:
        assert_rate_limit(request(), RateLimitRule("login", 5, 60))

    assert error.value.status_code == 503
    assert rate_limit_service._BUCKETS == {}
