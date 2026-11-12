# Production runbook and security review

This document is the deploy checklist and the record of the security review. The backend refuses to start in
`ENVIRONMENT=production` when the settings below are unsafe, so most of the checklist is enforced at boot.

## 1. Environment (backend)

| Variable | Required value |
| --- | --- |
| `ENVIRONMENT` | `production` (the container image sets this by default) |
| `DATABASE_URL` | Production PostgreSQL. Not localhost. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Your Supabase project. Set together. |
| `JWT_SECRET` | At least 32 random characters. Not a placeholder. |
| `FRONTEND_BASE_URL` | Public `https://` app URL. Customer QR links and auth emails are built from it. |
| `ALLOWED_ORIGINS` | Explicit origins only. No `*`. |
| `REDIS_URL` | Recommended. Rate limits are shared across instances through Redis. Without it, the backend refuses to start unless `RATE_LIMIT_ACCEPT_PROCESS_LOCAL_IN_PRODUCTION=true`, which accepts per-instance limits (weaker, see accepted risks). |
| `PAYMENT_EXPIRY_CRON_SECRET` | At least 24 random characters. |
| `ALLOW_DEV_AUTH_BYPASS` | `false` |
| `DEV_EXPOSE_RESET_LINKS` | `false` |
| `LEGACY_DEVICE_TOKEN_ROUTES` | `false`, unless a hardware client still uses token-in-URL device routes. Turning it on is a deliberate risk acceptance. |
| `RATE_LIMIT_TRUSTED_PROXY_CIDRS` | Only the address range of your load balancer or proxy. Leave empty if there is none. |
| `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | Configured, so email is delivered. Without SMTP, messages are not sent. They are never written to disk in production. |

Never copy `.env` or `.env.local` into an image or a host. The root `.dockerignore` excludes them.

## 2. Database

Apply the migrations in `backend/migrations/` in date order, including `20261112_security_hardening.sql`. It adds
`orders.idempotency_fingerprint` and widens the public order token to 64 bits. Existing orders keep working.

## 3. Frontend

- Build with `next build` and set `BACKEND_API_ORIGIN` to the backend origin.
- Security headers are set for every page in `next.config.ts`: a Content Security Policy, HSTS, `X-Frame-Options`
  (same-origin, because the admin preview embeds the kiosk), `Referrer-Policy`, `Permissions-Policy` and
  `Cross-Origin-Opener-Policy`.
- The dev-only demo sign-in button and password are not in the production bundle. The demo email address is
  present in the bundle, with no password. It identifies a local development account only.

## 4. Findings and status

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | High | A reused idempotency key returned another order, including customer name and phone, without checking the request. | Fixed. A keyed fingerprint of each request is stored with the order. A reused key with a different request gets 409. Covered by `tests/test_security_hardening.py`. |
| F2 | High | The local mail outbox wrote plaintext reset links and verification messages to disk. It was guarded by a deny-list, so `staging` or a mistyped environment would write files. | Fixed. Written only for `local`, `dev`, `test` environments (allow-list). Failed deliveries are logged without message content. |
| F3 | High | Device tokens sat in URL paths on nine routes, where proxies and logs record them. | Fixed. Those routes return 404 unless `LEGACY_DEVICE_TOKEN_ROUTES` is on, and production refuses that setting. First-party clients exchange the token through `POST /api/devices/live/session/exchange` with the token in the body. |
| F4 | Medium | Test-runtime routes had no rate limit. The test-session exchange and refresh endpoints were not limited either. | Fixed. Per-session limits on test runtime, per-cap limits on the test exchange and refresh. |
| F5 | Medium | 6-digit activation and pairing codes could be guessed by rotating addresses. | Fixed. Shared cap across all clients on activation, pairing status and claim, in addition to the per-IP and per-code limits. |
| F6 | Medium | A public static mount served files from the API's disk. | Fixed. Removed. Images are served from Supabase storage. |
| F7 | Medium | The health endpoint disclosed the environment and database configuration. | Fixed. The root endpoint returns only status and service name. |
| F8 | Medium | The payment-status token could be sent in the URL query string, where logs record it. | Fixed. The query parameter is ignored. The token is accepted only in the header or body. |
| F9 | Medium | The assistant accepted any staff role, including kitchen, kiosk and cashier device accounts. | Fixed. Dashboard roles only (owner, admin, manager, viewer). |
| F10 | Medium | API responses had no HSTS, no CSP and no `no-store`. The frontend had no security headers at all. | Fixed for both backend and frontend. |
| F11 | Low | Production did not require a shared rate-limit store, so limits were per process. | Fixed. `REDIS_URL` is required in production unless the per-instance risk is explicitly accepted. |
| F12 | Low | The image build could copy environment files. Container default environment was not production. | Fixed. `.dockerignore` excludes env files at any depth. The Dockerfile sets `ENVIRONMENT=production`. |
| F13 | Low | Dynamic SQL column names were built from request model keys (QR updates). | Fixed with an explicit allow-list. Other dynamic SQL uses fixed table names and keys defined in code. |
| F14 | Low | The public order token had 32 bits of randomness. | Fixed. 64 bits for new orders. Nothing looks orders up by this token. |
| F15 | Low | The `python main.py` entry point bound to `0.0.0.0` with reload always on. The container uses uvicorn directly and was not affected. | Fixed. Binds to `127.0.0.1`, and reload is opt-in with `UVICORN_RELOAD=1`. |

Reviewed and found sound (no change needed): every ID-only mutation checks the owning business from the stored row;
owner PIN lockout; Stripe, Razorpay and Paytm webhook signature checks; maintenance secret comparison with
`compare_digest`; refresh and session cookies (`HttpOnly`, `SameSite=Lax`, `Secure` in production); device
sessions are rejected once a device is disabled; redirect validation after sign-in; order numbers are allocated
atomically; test-runtime availability writes are scoped to the session's business; uploads check file signatures
and size.

## 5. Accepted risks (documented, with mitigations)

- **No shared rate-limit store (no Redis).** Each serverless instance counts requests separately, so a caller spread
  across instances can exceed a limit. Enabled only by `RATE_LIMIT_ACCEPT_PROCESS_LOCAL_IN_PRODUCTION=true`. Mitigation:
  add `REDIS_URL` (Upstash or similar) and remove the flag. This is the first thing to fix after launch.
- **Owner PIN lockout is business-wide.** Anyone can lock a kiosk owner PIN by failing it repeatedly. The lock lasts
  a fixed time, an owner alert is raised, and an owner can reset it by setting a new PIN in the dashboard. Blocking
  this entirely would weaken PIN brute-force protection, so the trade-off stays.
- **Anonymous QR and kiosk ordering has no CAPTCHA.** Mitigations: a 20-per-minute cap per store, a per-IP limit,
  QR ordering is off until the owner enables it, and orders are pay-at-counter so nothing is charged online.
  Add Turnstile or similar if the store sees abuse.
- **Assistant answers are generated by an external model (Gemini).** Business data in the question and context is
  sent to that provider. Only dashboard roles can use the assistant. Disclose this to customers if you use it.
- **Test sessions** create orders in an isolated table and simulate payment. Their idempotency keys are scoped to
  the owner's test session and are not fingerprinted.
- **Legacy hardware routes** (`LEGACY_DEVICE_TOKEN_ROUTES`) remain available only if you enable them.

## 6. Verification

- Backend: `pytest` (336 passed, 3 live-database tests skipped unless `RUN_LIVE_DB_TESTS=1`).
- Frontend: `tsc --noEmit`, `eslint`, the style and typography checks, and the Playwright suite.
- Known external blocker: the Supabase project was unreachable from the development machine during the review, so
  the three sign-up specs could not pass there. They depend on Supabase, not on this code.
