from __future__ import annotations

import json
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient

from config import get_settings


def auth_request(path: str, *, method: str = "POST", body: dict | None = None, token: str | None = None) -> dict:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(status_code=503, detail="Supabase authentication is not configured.")

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/{path.lstrip('/')}"
    headers = {"apikey": settings.supabase_publishable_key, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        with urlopen(Request(url, data=data, headers=headers, method=method), timeout=12) as response:
            raw = response.read()
    except HTTPError as exc:
        if exc.code in {400, 401, 403}:
            detail = "Invalid email or password." if path.startswith("token?") else "Authentication request could not be completed."
            raise HTTPException(status_code=401 if path.startswith("token?") else exc.code, detail=detail) from exc
        if exc.code == 429:
            raise HTTPException(status_code=429, detail="Too many authentication requests. Please try again shortly.") from exc
        raise HTTPException(status_code=503, detail="Supabase authentication is temporarily unavailable.") from exc
    except (TimeoutError, URLError) as exc:
        raise HTTPException(status_code=503, detail="Supabase authentication is temporarily unavailable.") from exc

    return json.loads(raw) if raw else {}


@lru_cache(maxsize=1)
def _jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)


def verify_access_token(token: str) -> dict:
    settings = get_settings()
    if not settings.supabase_url:
        raise HTTPException(status_code=503, detail="Supabase authentication is not configured.")
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")
        if algorithm == "HS256":
            # Legacy shared-secret projects do not publish verifiable JWKS keys.
            user = auth_request("user", method="GET", token=token)
            claims = jwt.decode(token, options={"verify_signature": False})
            claims["sub"] = user["id"]
        elif algorithm in {"ES256", "RS256", "EdDSA"}:
            key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=[algorithm],
                issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
                audience="authenticated",
            )
        else:
            raise ValueError("Unsupported signing algorithm")
        if not claims.get("sub"):
            raise ValueError("Missing subject")
        return claims
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid auth token.") from exc
