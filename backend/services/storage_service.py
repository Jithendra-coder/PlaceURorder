import re
import warnings
import asyncio
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from config import get_settings


SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_IMAGE_TYPES = {
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
IMAGE_EXTENSIONS = {
    "image/gif": {".gif"},
    "image/jpeg": {".jpeg", ".jpg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}


async def upload_asset(
    business_id: UUID,
    file: UploadFile,
    folder: str,
    access_token: str | None,
) -> dict:
    if folder not in {"products", "brand"}:
        raise HTTPException(status_code=400, detail="Unsupported upload folder.")
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, GIF, or WebP images are allowed.")

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded image must be 5 MB or smaller.")
    if not _looks_like_allowed_image(content, content_type):
        raise HTTPException(status_code=400, detail="Uploaded file content does not match a supported image format.")
    _validate_image_dimensions(content)

    raw_name = Path(file.filename or "upload").name
    suffix = Path(raw_name).suffix.lower()
    if suffix and suffix not in IMAGE_EXTENSIONS[content_type]:
        raise HTTPException(status_code=400, detail="Uploaded filename extension does not match its image format.")
    safe_name = (SAFE_NAME_RE.sub("-", raw_name).strip("-") or "upload")[-120:]
    filename = f"{uuid4().hex}-{safe_name}"
    relative_path = f"{business_id}/{folder}/{filename}"

    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_publishable_key or not access_token:
        raise HTTPException(status_code=503, detail="Supabase Storage is not configured for this session.")
    await asyncio.to_thread(_upload_to_supabase, settings.supabase_url, settings.supabase_publishable_key, access_token, relative_path, content_type, content)
    public_url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/business-assets/{quote(relative_path, safe='/')}"
    return {
        "bucket": "business-assets",
        "path": relative_path,
        "public_url": public_url,
    }


def _upload_to_supabase(base_url: str, publishable_key: str, access_token: str, path: str, content_type: str, content: bytes) -> None:
    url = f"{base_url.rstrip('/')}/storage/v1/object/business-assets/{quote(path, safe='/')}"
    request = Request(
        url,
        data=content,
        headers={
            "apikey": publishable_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": content_type,
            "x-upsert": "false",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20):
            pass
    except HTTPError as exc:
        status_code = 413 if exc.code == 413 else 403 if exc.code in {401, 403} else 409 if exc.code == 409 else 503
        message = "This business cannot upload assets." if status_code == 403 else "Supabase Storage is temporarily unavailable."
        raise HTTPException(status_code=status_code, detail=message) from exc
    except (TimeoutError, URLError) as exc:
        raise HTTPException(status_code=503, detail="Supabase Storage is temporarily unavailable.") from exc


def _looks_like_allowed_image(content: bytes, content_type: str) -> bool:
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/gif":
        return content.startswith((b"GIF87a", b"GIF89a"))
    if content_type == "image/webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return False


def _validate_image_dimensions(content: bytes) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("image is too large")
                image.verify()
    except (Image.DecompressionBombWarning, UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Uploaded image is invalid or exceeds the pixel limit.") from exc
