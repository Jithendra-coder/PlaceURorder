from __future__ import annotations

from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json

from fastapi import HTTPException, status

from config import get_settings


def search_photos(query: str, per_page: int | None = None) -> dict:
    settings = get_settings()
    api_key = (settings.pexels_api_key or "").strip().strip('"').strip("'")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pexels image search is not configured.",
        )

    cleaned = query.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Search query is required.")

    limit = max(1, min(per_page or settings.pexels_per_page, 24))
    params = urlencode({"query": cleaned, "per_page": limit, "orientation": "landscape"})
    request = Request(
        f"https://api.pexels.com/v1/search?{params}",
        headers={
            "Authorization": api_key,
            "User-Agent": "PlaceURorder/1.0",
        },
    )

    try:
        with urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 403}:
            detail = "Pexels image search credentials were rejected."
        else:
            detail = "Pexels image search is temporarily unavailable."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Pexels image search is temporarily unavailable.",
        ) from exc

    return {
        "photos": [
            {
                "id": photo.get("id"),
                "alt": photo.get("alt") or cleaned,
                "photographer": photo.get("photographer"),
                "url": photo.get("url"),
                "thumb": photo.get("src", {}).get("medium"),
                "image": photo.get("src", {}).get("large2x")
                or photo.get("src", {}).get("large")
                or photo.get("src", {}).get("original"),
            }
            for photo in payload.get("photos", [])
            if photo.get("src")
        ]
    }
