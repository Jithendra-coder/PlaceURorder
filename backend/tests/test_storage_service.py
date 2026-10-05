import asyncio
import base64
from types import SimpleNamespace
from urllib.error import HTTPError
from uuid import uuid4

import pytest
from fastapi import HTTPException

from services import storage_service


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)


class Upload:
    def __init__(self, content, content_type="image/png", filename="image.png"):
        self.content = content
        self.content_type = content_type
        self.filename = filename

    async def read(self, _size):
        return self.content


def supabase_settings():
    return SimpleNamespace(
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )


def test_upload_uses_supabase_storage_and_sanitizes_name(monkeypatch):
    uploaded = []
    monkeypatch.setattr(storage_service, "get_settings", supabase_settings)
    monkeypatch.setattr(storage_service, "_upload_to_supabase", lambda *args: uploaded.append(args))
    business_id = uuid4()

    result = asyncio.run(
        storage_service.upload_asset(
            business_id,
            Upload(PNG_1X1, filename="../My logo.png"),
            "brand",
            "supabase-user-access-token",
        )
    )

    assert result["bucket"] == "business-assets"
    assert result["path"].startswith(f"{business_id}/brand/")
    assert "My-logo.png" in result["path"]
    assert result["public_url"] == (
        f"https://project.supabase.co/storage/v1/object/public/business-assets/{result['path']}"
    )
    assert uploaded[0][2] == "supabase-user-access-token"
    assert uploaded[0][3] == result["path"]


def test_extension_must_match_verified_content(monkeypatch):
    monkeypatch.setattr(storage_service, "get_settings", supabase_settings)
    monkeypatch.setattr(
        storage_service,
        "_upload_to_supabase",
        lambda *_args: pytest.fail("invalid files must not be uploaded"),
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            storage_service.upload_asset(
                uuid4(), Upload(PNG_1X1, filename="image.jpg"), "products", "user-token"
            )
        )
    assert exc.value.status_code == 400


def test_upload_rejects_image_above_pixel_limit(monkeypatch):
    monkeypatch.setattr(storage_service, "get_settings", supabase_settings)
    bomb = (
        b"\x89PNG\r\n\x1a\n"
        + (13).to_bytes(4, "big")
        + b"IHDR"
        + (10000).to_bytes(4, "big")
        + (10000).to_bytes(4, "big")
        + b"\x08\x02\x00\x00\x00"
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            storage_service.upload_asset(uuid4(), Upload(bomb), "products", "user-token")
        )
    assert exc.value.status_code == 400


def test_storage_access_errors_do_not_leak_provider_details(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise HTTPError("https://storage.example", 403, "sensitive provider response", {}, None)

    monkeypatch.setattr(storage_service, "urlopen", forbidden)
    with pytest.raises(HTTPException) as exc:
        storage_service._upload_to_supabase(
            "https://project.supabase.co",
            "sb_publishable_test",
            "user-token",
            "business/brand/logo.png",
            "image/png",
            PNG_1X1,
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "This business cannot upload assets."
    assert "sensitive provider response" not in exc.value.detail
