from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PRODUCTION_PLACEHOLDERS = {
    "dev-only-change-me",
    "replace-with-a-long-random-secret-at-least-32-characters",
    "replace-with-a-long-random-maintenance-secret",
    "change-this-local-dev-secret-before-production",
}


class Settings(BaseSettings):
    app_name: str = "Universal Kiosk API"
    environment: str = "local"
    api_prefix: str = "/api"

    database_url: str = "postgresql://postgres:postgres@localhost:5432/universal_kiosk_app"
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_minutes: int = 60 * 24

    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    allow_dev_auth_bypass: bool = False
    rate_limit_enabled: bool = True
    rate_limit_trusted_proxy_cidrs: str = ""
    rate_limit_max_buckets: int = Field(default=10_000, ge=1, le=1_000_000)
    payment_expiry_cron_secret: str | None = None
    payment_expiry_minutes: int = 30
    device_session_days: int = 30

    upload_root: str = str(Path(__file__).resolve().parent / "uploads")
    public_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:3000"

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "no-reply@menutap.local"
    smtp_from_name: str = "MenuTap"
    smtp_use_tls: bool = True
    dev_expose_reset_links: bool = False
    email_outbox_dir: str = str(Path(__file__).resolve().parent / "email_outbox")

    redis_url: str | None = None
    redis_menu_ttl_seconds: int = 120

    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_connect_refresh_url: str | None = None
    stripe_connect_return_url: str | None = None

    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None

    paytm_mid: str | None = None
    paytm_merchant_key: str | None = None
    paytm_website_name: str = "DEFAULT"
    paytm_dynamic_qr_create_url: str | None = None
    paytm_transaction_status_url: str | None = None
    paytm_webhook_secret: str | None = None

    pexels_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("PEXELS_API_KEY", "PEXELS_API", "api"),
    )
    pexels_per_page: int = 12

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        validate_required_environment(self)
        if bool(self.supabase_url) != bool(self.supabase_publishable_key):
            raise ValueError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set together.")
        if self.environment.lower() not in {"prod", "production"}:
            return self

        if not self.supabase_url or not self.supabase_publishable_key:
            raise ValueError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in production.")

        if self.jwt_secret.strip().lower() in PRODUCTION_PLACEHOLDERS or len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be a strong production secret.")
        if "localhost" in self.database_url or "127.0.0.1" in self.database_url:
            raise ValueError("DATABASE_URL must point to a production PostgreSQL instance.")
        if self.allow_dev_auth_bypass:
            raise ValueError("ALLOW_DEV_AUTH_BYPASS must be false in production.")
        if not self.cors_origins or any(origin == "*" for origin in self.cors_origins):
            raise ValueError("ALLOWED_ORIGINS must contain explicit production browser origins.")
        if (
            not self.payment_expiry_cron_secret
            or self.payment_expiry_cron_secret.strip().lower() in PRODUCTION_PLACEHOLDERS
            or len(self.payment_expiry_cron_secret) < 24
        ):
            raise ValueError("PAYMENT_EXPIRY_CRON_SECRET must be set to a strong secret in production.")
        if self.dev_expose_reset_links:
            raise ValueError("DEV_EXPOSE_RESET_LINKS must be false in production.")
        return self


def validate_required_environment(settings: Settings) -> None:
    required = {
        "DATABASE_URL": settings.database_url,
        "JWT_SECRET": settings.jwt_secret,
    }
    for name, value in required.items():
        if not str(value or "").strip():
            raise ValueError(f"Missing required environment variable: {name}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
