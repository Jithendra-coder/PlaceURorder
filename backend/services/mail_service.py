from __future__ import annotations

import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from re import sub
from time import time

from config import get_settings


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.smtp_host and settings.smtp_username and settings.smtp_password)


def send_email(to_email: str, subject: str, text: str, html: str | None = None) -> bool:
    settings = get_settings()
    if not is_configured():
        _write_dev_outbox(to_email, subject, text, html)
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    message["To"] = to_email
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")

    try:
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                if settings.smtp_use_tls:
                    server.starttls()
                server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(message)
        return True
    except Exception:
        _write_dev_outbox(to_email, subject, text, html)
        return False


def _write_dev_outbox(to_email: str, subject: str, text: str, html: str | None = None) -> None:
    settings = get_settings()
    if settings.environment.lower() in {"prod", "production"}:
        return

    outbox = Path(settings.email_outbox_dir)
    if not outbox.is_absolute():
        outbox = Path(__file__).resolve().parents[1] / outbox
    outbox.mkdir(parents=True, exist_ok=True)

    safe_subject = sub(r"[^a-zA-Z0-9._-]+", "-", subject).strip("-").lower() or "email"
    safe_email = sub(r"[^a-zA-Z0-9._-]+", "-", to_email).strip("-").lower() or "recipient"
    base = outbox / f"{int(time())}-{safe_email}-{safe_subject}"
    base.with_suffix(".txt").write_text(
        f"To: {to_email}\nSubject: {subject}\n\n{text}\n",
        encoding="utf-8",
    )
    if html:
        base.with_suffix(".html").write_text(html, encoding="utf-8")


def send_password_reset(to_email: str, reset_url: str) -> bool:
    text = (
        "Use this secure link to reset your PlaceURorder password. "
        "The link expires in 30 minutes.\n\n"
        f"{reset_url}\n\n"
        "If you did not request this, you can ignore this email."
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#2D3436">
      <h2>Reset your PlaceURorder password</h2>
      <p>Use this secure link to reset your kiosk admin password. The link expires in 30 minutes.</p>
      <p><a href="{reset_url}" style="display:inline-block;background:#1A4D2E;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Reset password</a></p>
      <p style="color:#64746B;font-size:13px">If you did not request this, you can ignore this email.</p>
    </div>
    """
    return send_email(to_email, "Reset your PlaceURorder password", text, html)


def send_email_verification(to_email: str, code: str) -> bool:
    text = (
        "Verify your PlaceURorder account with this 6-digit code:\n\n"
        f"{code}\n\n"
        "The code expires in 10 minutes. If you did not create this account, you can ignore this email."
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#2D3436">
      <h2>Verify your PlaceURorder account</h2>
      <p>Use this 6-digit code to finish creating your kiosk owner account.</p>
      <p style="display:inline-block;background:#E6F6EF;color:#064E3B;padding:14px 20px;border-radius:12px;font-size:28px;font-weight:800;letter-spacing:6px">{code}</p>
      <p style="color:#64746B;font-size:13px">This code expires in 10 minutes. If you did not create this account, you can ignore this email.</p>
    </div>
    """
    return send_email(to_email, "Verify your PlaceURorder account", text, html)


def send_welcome_email(to_email: str) -> bool:
    text = (
        "Welcome to PlaceURorder.\n\n"
        "Your owner account is ready. Sign in to set up your business branding, menu items, "
        "kiosk screen, kitchen display, and analytics dashboard."
    )
    html = """
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#2D3436">
      <h2>Welcome to PlaceURorder</h2>
      <p>Your owner account is ready.</p>
      <p>Sign in to set up your business branding, menu items, kiosk screen, kitchen display, and analytics dashboard.</p>
    </div>
    """
    return send_email(to_email, "Welcome to PlaceURorder", text, html)


def send_staff_invite(to_email: str, business_name: str, role: str, reset_url: str) -> bool:
    text = (
        f"You have been invited to {business_name} as {role} staff on PlaceURorder.\n\n"
        "Create your password using this secure link:\n"
        f"{reset_url}\n\n"
        "Kitchen-only users can sign in and open the kitchen display for assigned stores."
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#2D3436">
      <h2>{business_name} invited you</h2>
      <p>You were added as <strong>{role}</strong> staff on PlaceURorder.</p>
      <p><a href="{reset_url}" style="display:inline-block;background:#1A4D2E;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Create password</a></p>
      <p style="color:#64746B;font-size:13px">Kitchen-only users can sign in and open the kitchen display for assigned stores.</p>
    </div>
    """
    return send_email(to_email, f"{business_name} staff access", text, html)
