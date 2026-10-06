import os
import logging
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg import OperationalError

from config import get_settings
from database import db_context
from routers import administration, admin, alerts, auth, availability, businesses, combos, devices, kiosk, maintenance, media, orders, payments, presets, preview_kiosk, products, setup, test_runtime, uploads, promotions, qr_codes, versions
from schema_compat import ensure_schema_compatibility


settings = get_settings()
os.makedirs(settings.upload_root, exist_ok=True)
if os.getenv("RUN_SCHEMA_COMPATIBILITY_ON_STARTUP") == "1":
    ensure_schema_compatibility(settings.database_url)

app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    description="FastAPI backend for multi-tenant kiosk, kitchen, and admin screens.",
    docs_url=None if settings.environment.lower() in {"prod", "production"} else "/docs",
    redoc_url=None if settings.environment.lower() in {"prod", "production"} else "/redoc",
    openapi_url=None if settings.environment.lower() in {"prod", "production"} else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(businesses.onboarding_router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(businesses.router, prefix=settings.api_prefix)
app.include_router(presets.router, prefix=settings.api_prefix)
app.include_router(setup.router, prefix=settings.api_prefix)
app.include_router(test_runtime.router, prefix=settings.api_prefix)
app.include_router(kiosk.router, prefix=settings.api_prefix)
app.include_router(products.router, prefix=settings.api_prefix)
app.include_router(availability.router, prefix=settings.api_prefix)
app.include_router(combos.router, prefix=settings.api_prefix)
app.include_router(orders.router, prefix=settings.api_prefix)
app.include_router(payments.router, prefix=settings.api_prefix)
app.include_router(devices.router, prefix=settings.api_prefix)
app.include_router(maintenance.router, prefix=settings.api_prefix)
app.include_router(alerts.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(admin.bootstrap_router, prefix=settings.api_prefix)
app.include_router(administration.router, prefix=settings.api_prefix)
app.include_router(preview_kiosk.router, prefix=settings.api_prefix)
app.include_router(uploads.router, prefix=settings.api_prefix)
app.include_router(media.router, prefix=settings.api_prefix)
app.include_router(promotions.router, prefix=settings.api_prefix)
app.include_router(qr_codes.router, prefix=settings.api_prefix)
app.include_router(versions.router, prefix=settings.api_prefix)
app.mount("/uploads", StaticFiles(directory=settings.upload_root), name="uploads")

logger = logging.getLogger(__name__)
MAX_REQUEST_BYTES = 8 * 1024 * 1024


def _error(status_code: int, message: str, request: Request, detail=None) -> JSONResponse:
    code = {400: "BAD_REQUEST", 401: "AUTHENTICATION_REQUIRED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "REQUEST_TOO_LARGE", 422: "VALIDATION_ERROR", 503: "SERVICE_UNAVAILABLE"}.get(status_code, "INTERNAL_ERROR")
    body = {"error": {"code": code, "message": message, "request_id": request.state.request_id}, "detail": detail if detail is not None else message}
    return JSONResponse(body, status_code=status_code, headers={"X-Request-ID": request.state.request_id})


@app.exception_handler(HTTPException)
async def http_exception(request: Request, exc: HTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request could not be completed."
    return _error(exc.status_code, message, request, exc.detail)


@app.exception_handler(RequestValidationError)
async def validation_exception(request: Request, exc: RequestValidationError):
    return _error(422, "Please check the submitted fields.", request, exc.errors())


@app.exception_handler(OperationalError)
async def database_unavailable(request: Request, exc: OperationalError):
    logger.warning("Database connection unavailable request_id=%s path=%s", request.state.request_id, request.url.path)
    return _error(503, "PlaceURorder is temporarily unavailable. Please try again.", request)


@app.exception_handler(Exception)
async def unexpected_exception(request: Request, exc: Exception):
    logger.exception("Unhandled API exception request_id=%s path=%s", request.state.request_id, request.url.path)
    return _error(500, "The server could not complete this request. Please try again.", request)


@app.middleware("http")
async def add_security_headers(request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or str(uuid4())
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_REQUEST_BYTES:
        return _error(413, "Request body is too large.", request)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("X-Request-ID", request.state.request_id)
    return response


@app.get("/")
def health():
    return {
        "status": "online",
        "service": settings.app_name,
        "version": "2.0.0",
        "environment": settings.environment,
        "database_configured": bool(settings.database_url),
        "docs": None if settings.environment.lower() in {"prod", "production"} else "/docs",
        "api_prefix": settings.api_prefix,
    }


@app.get("/health")
@app.get(f"{settings.api_prefix}/health")
def deep_health():
    db_ok = False
    try:
        with db_context() as client:
            client.fetch_one("select 1 as ok")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "database_unavailable",
        "database": "connected" if db_ok else "not_verified",
        "payment_expiry_configured": bool(settings.payment_expiry_cron_secret),
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
