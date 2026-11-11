"""Rate limiting with a process-local development store and Redis-backed production enforcement."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Iterable

from fastapi import HTTPException, Request, status
from redis import Redis
from redis.exceptions import RedisError

from config import get_settings


@dataclass(frozen=True)
class RateLimitRule:
    scope: str
    max_requests: int
    window_seconds: int


@dataclass
class _Bucket:
    timestamps: deque[float] = field(default_factory=deque)
    window_seconds: int = 1


_BUCKETS: dict[str, _Bucket] = {}
_LOCK = threading.RLock()
_LAST_CLEANUP_AT = 0.0
_CLEANUP_INTERVAL_SECONDS = 60
_REDIS_INCREMENT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
"""


def assert_rate_limit(
    request: Request,
    rule: RateLimitRule,
    *,
    identity_parts: Iterable[str | None] = (),
    enabled: bool | None = None,
) -> None:
    settings = get_settings()
    if enabled is None:
        enabled = settings.rate_limit_enabled
    if not enabled:
        return

    now = time.monotonic()
    window_seconds = max(1, rule.window_seconds)
    identity = tuple(part for part in identity_parts if part and part.strip())
    keys = [_bucket_key(request, f"{rule.scope}:source", (), settings.jwt_secret, settings.rate_limit_trusted_proxy_cidrs)]
    if identity:
        keys.append(_identity_bucket_key(rule.scope, identity, settings.jwt_secret))
    if getattr(settings, "environment", "local").lower() in {"prod", "production"} and settings.redis_url:
        for key in keys:
            _assert_shared_bucket(key, rule, window_seconds, settings.redis_url)
        return
    with _LOCK:
        _cleanup_inactive(now)
        for key in keys:
            _assert_bucket(key, rule, now, window_seconds, settings.rate_limit_max_buckets)


def reset_rate_limits() -> None:
    global _LAST_CLEANUP_AT
    with _LOCK:
        _BUCKETS.clear()
        _LAST_CLEANUP_AT = 0.0


@lru_cache(maxsize=4)
def _redis_client(redis_url: str) -> Redis:
    return Redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)


def _assert_shared_bucket(key: str, rule: RateLimitRule, window_seconds: int, redis_url: str | None) -> None:
    if not redis_url:
        raise HTTPException(status_code=503, detail="Rate-limit enforcement is unavailable.")
    try:
        count, ttl = _redis_client(redis_url).eval(
            _REDIS_INCREMENT_SCRIPT,
            1,
            f"menutap:rate-limit:{key}",
            window_seconds,
        )
    except RedisError as exc:
        raise HTTPException(status_code=503, detail="Rate-limit enforcement is unavailable.") from exc
    if int(count) > max(1, rule.max_requests):
        _raise_rate_limit(max(1, int(ttl)))


def _bucket_key(
    request: Request,
    scope: str,
    identity_parts: Iterable[str | None],
    secret: str,
    trusted_proxy_cidrs: str = "",
) -> str:
    raw_identity = "|".join(part.strip().lower() for part in identity_parts if part and part.strip())
    fingerprint = (
        hmac.new(secret.encode("utf-8"), f"rate-limit\0{raw_identity}".encode("utf-8"), hashlib.sha256).hexdigest()
        if raw_identity
        else "anonymous"
    )
    return f"{scope}:{_client_ip(request, trusted_proxy_cidrs)}:{fingerprint}"


def _identity_bucket_key(scope: str, identity_parts: Iterable[str], secret: str) -> str:
    raw_identity = "|".join(part.strip().lower() for part in identity_parts)
    fingerprint = hmac.new(secret.encode("utf-8"), f"rate-limit\\0{raw_identity}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{scope}:identity:{fingerprint}"


def _assert_bucket(key: str, rule: RateLimitRule, now: float, window_seconds: int, max_buckets: int) -> None:
    bucket = _BUCKETS.get(key)
    if bucket is None:
        if len(_BUCKETS) >= max_buckets:
            _cleanup_inactive(now, force=True)
        if len(_BUCKETS) >= max_buckets:
            _raise_rate_limit(1)
        bucket = _BUCKETS.setdefault(key, _Bucket(window_seconds=window_seconds))
    bucket.window_seconds = window_seconds
    cutoff = now - window_seconds
    while bucket.timestamps and bucket.timestamps[0] <= cutoff:
        bucket.timestamps.popleft()
    if len(bucket.timestamps) >= max(1, rule.max_requests):
        _raise_rate_limit(math.ceil(bucket.timestamps[0] + window_seconds - now))
    bucket.timestamps.append(now)


def _cleanup_inactive(now: float, *, force: bool = False) -> None:
    global _LAST_CLEANUP_AT
    if not force and now - _LAST_CLEANUP_AT < _CLEANUP_INTERVAL_SECONDS:
        return
    for key, bucket in list(_BUCKETS.items()):
        cutoff = now - bucket.window_seconds
        while bucket.timestamps and bucket.timestamps[0] <= cutoff:
            bucket.timestamps.popleft()
        if not bucket.timestamps:
            _BUCKETS.pop(key, None)
    _LAST_CLEANUP_AT = now


def _raise_rate_limit(retry_after: int) -> None:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests. Please wait a moment and try again.",
        headers={"Retry-After": str(max(1, retry_after))},
    )


def _client_ip(request: Request, trusted_proxy_cidrs: str = "") -> str:
    direct_host = request.client.host if request.client else "unknown"
    direct_ip = _parse_ip(direct_host)
    if direct_ip is None:
        return direct_host.strip().lower() or "unknown"

    trusted_networks = _trusted_networks(trusted_proxy_cidrs)
    if not trusted_networks or not _is_trusted(direct_ip, trusted_networks):
        return str(direct_ip)

    forwarded_for = request.headers.get("x-forwarded-for", "")
    if not forwarded_for:
        return str(direct_ip)
    chain = [_parse_ip(part) for part in forwarded_for.split(",")]
    if not chain or any(ip is None for ip in chain):
        return str(direct_ip)

    client_ip = direct_ip
    for hop in reversed(chain):
        if not _is_trusted(client_ip, trusted_networks):
            break
        client_ip = hop
    return str(client_ip)


def _trusted_networks(value: str) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    networks = []
    for item in value.split(","):
        if not item.strip():
            continue
        try:
            networks.append(ipaddress.ip_network(item.strip(), strict=False))
        except ValueError:
            continue
    return tuple(networks)


def _is_trusted(
    address: ipaddress.IPv4Address | ipaddress.IPv6Address,
    networks: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...],
) -> bool:
    return any(address.version == network.version and address in network for network in networks)


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    text = value.strip()
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        pass
    if text.startswith("[") and "]" in text:
        host, suffix = text[1:].split("]", 1)
        if not suffix or (suffix.startswith(":") and _valid_port(suffix[1:])):
            try:
                return ipaddress.ip_address(host)
            except ValueError:
                return None
    if text.count(":") == 1:
        host, port = text.rsplit(":", 1)
        if _valid_port(port):
            try:
                return ipaddress.ip_address(host)
            except ValueError:
                return None
    return None


def _valid_port(value: str) -> bool:
    return value.isdigit() and 0 <= int(value) <= 65535
