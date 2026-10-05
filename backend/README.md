# Universal Kiosk FastAPI Backend

## Local Setup

The backend uses Supabase Postgres for application data, Supabase Auth for accounts and sessions, and Supabase Storage for uploaded images. Keep the database password server-side; the publishable key is safe for client use, but this app only needs it in the backend.

Create your local env file from the safe template:

```powershell
Copy-Item .env.example .env
```

```env
DATABASE_URL=postgresql://postgres.amamatsmrevomzazpfcq:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
SUPABASE_URL=https://amamatsmrevomzazpfcq.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_XA12dfhL7FWdSRovzkDivg_IALiThhQ
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
JWT_ACCESS_TOKEN_MINUTES=1440
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PUBLIC_BASE_URL=http://localhost:8000
FRONTEND_BASE_URL=http://localhost:3000
ALLOW_DEV_AUTH_BYPASS=false
PORT=8000

# Optional email delivery for welcome, reset-password, and staff-invite emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=your-email@gmail.com
SMTP_FROM_NAME=MenuTap
SMTP_USE_TLS=true
DEV_EXPOSE_RESET_LINKS=false
EMAIL_OUTBOX_DIR=email_outbox

# Optional Redis cache for public kiosk menu reads
REDIS_URL=redis://localhost:6379/0
REDIS_MENU_TTL_SECONDS=120

# Optional Pexels picker for admin product and offer images
PEXELS_API_KEY=your-pexels-api-key
PEXELS_PER_PAGE=12
```

The session-pooler URL above targets this Supabase project. Replace `[YOUR-PASSWORD]` in your ignored local `.env` file with the database password from **Supabase Dashboard → Connect**; never commit or share that value. Keep `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` pointed at this same project.

For the Vercel serverless API, use the **Transaction pooler** connection string from Supabase Dashboard → Connect (port `6543`) as the production `DATABASE_URL`. The backend disables Psycopg prepared statements for compatibility with transaction pooling. Add the rotated connection string directly to the Vercel `universal-kiosk-api` project's Production environment; never commit it or paste it into chat.

The project schema is tracked in `supabase/migrations`. Set the Supabase Auth Site URL to the deployed frontend and allow the frontend’s `/auth/sign-up` and `/auth/reset-password` URLs as redirects (also allow `http://localhost:3000` during local development). Signup and password reset links are sent by Supabase Auth; uploaded business images are stored in the public `business-assets` bucket with authenticated, business-scoped upload policies. This project’s initial schema migration has already been applied to its hosted project.

Use a Supabase database for local development as well: Auth sessions and user records are stored alongside application data. Keep `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` pointed at the same Supabase project.

Install and run:

```powershell
venv\Scripts\pip.exe install -r requirements.txt
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## Main API Areas

- `POST /api/auth/signup`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/businesses/{business_id}/staff`
- `POST /api/businesses/{business_id}/staff`
- `GET /api/onboarding/status`
- `GET /api/businesses/me`
- `POST /api/businesses`
- `PATCH /api/businesses/{business_id}`
- `GET /api/kiosk/{business_slug}/menu`
- `POST /api/kiosk/{business_slug}/orders`
- `GET /api/businesses/{business_id}/orders/active`
- `PATCH /api/orders/{order_id}/status`
- `GET /api/businesses/{business_id}/dashboard`
- `POST /api/businesses/{business_id}/uploads/product-image`
- `GET /api/media/pexels/search?q=pizza`

Authenticated admin/kitchen endpoints use the httpOnly `menutap_admin_session` cookie set by `/api/auth/login` and `/api/auth/verify-email`; Supabase refresh tokens stay in a separate httpOnly cookie. Uploaded images are stored in Supabase Storage.

Supabase Auth sends signup and password reset emails. Redis remains optional; without `REDIS_URL`, kiosk menu APIs read directly from Supabase Postgres. Pexels image search remains optional.
