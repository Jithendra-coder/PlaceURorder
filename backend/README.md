# Universal Kiosk FastAPI Backend

## Local Setup

For local development, the root Podman Compose stack runs local Postgres, uses Supabase Auth for accounts and sessions, and stores local uploads in a volume. A directly launched backend can instead use a Supabase Postgres connection and Supabase Storage. Keep database passwords server-side; never put a service-role or secret key in frontend environment variables.

From the repository root, start the supported local stack with `podman compose up --build`. It includes the API, frontend, local database, and webhook delivery worker. Compose uses local-only development credentials; it is not a production deployment recipe. The local schema bootstrap is `backend/postgres_schema.sql` plus the API's compatibility startup step. Hosted database schema history remains tracked in `supabase/migrations`.

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
SMTP_FROM_NAME=PlaceURorder
SMTP_USE_TLS=true
DEV_EXPOSE_RESET_LINKS=false
EMAIL_OUTBOX_DIR=email_outbox

# Optional Redis cache for public kiosk menu reads
REDIS_URL=redis://localhost:6379/0
REDIS_MENU_TTL_SECONDS=120

# Optional Pexels picker for admin product and offer images
PEXELS_API_KEY=your-pexels-api-key
PEXELS_PER_PAGE=12

# Optional server-side Ask AI generation; never use a NEXT_PUBLIC_ variable.
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
```

Live business lookups run inside MenuTap with role checks and tenant-scoped SQL. Product-help retrieval uses pgvector over the approved, versioned help guide; the index contains no merchant records. When `GEMINI_API_KEY` is configured, help-style questions are sent to Google's embedding API for semantic retrieval, and the question plus selected guide passages may be sent to Gemini for answer drafting. Without a key or when vector retrieval is unavailable, the backend uses local keyword retrieval; if answer generation fails, it returns those source passages. The Menu Growth Coach uses a LangGraph retrieval workflow over authorized, business-wide completed-order aggregates and the product help guide; with Gemini configured, the question, limited aggregates, and retrieved excerpts may be sent to Google for structured recommendation selection. Customer details and row-level orders are excluded, and the model has no SQL or app tools. Without Gemini, deterministic recommendations are returned. Review `docs/legal/PRIVACY_POLICY.md` and Google's current account data-use terms before using Gemini with real merchant data.

After the product owner reviews and the migration is applied to the intended database, index or refresh the help guide from the backend directory with `python index_assistant_knowledge.py`. This command writes only approved guide chunks and embeddings; confirm `DATABASE_URL` before running it. The local Compose database builds pgvector 0.8.7 into the existing PostgreSQL 16 Alpine image. Existing volumes are not reset or reinitialized automatically.

For Vercel, add `GEMINI_API_KEY` as a Secret on the `universal-kiosk-api` project only (not `universal-kiosk-app` or any `NEXT_PUBLIC_*` variable), then redeploy the API. `GEMINI_MODEL` is optional configuration; the code defaults to Google's `gemini-3.1-flash-lite` model.

The session-pooler URL above is for a directly launched backend targeting Supabase Postgres. Replace `[YOUR-PASSWORD]` in your ignored local `.env` file with the database password from **Supabase Dashboard → Connect**; never commit or share that value. Keep `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` pointed at this same project. The root Compose workflow uses its own local Postgres database instead.

For the Vercel serverless API, use the **Transaction pooler** connection string from Supabase Dashboard → Connect (port `6543`) as the production `DATABASE_URL`. The backend disables Psycopg prepared statements for compatibility with transaction pooling. Add the rotated connection string directly to the Vercel `universal-kiosk-api` project's Production environment; never commit it or paste it into chat.

The project schema is tracked in `supabase/migrations`. Set the Supabase Auth Site URL to the deployed frontend and allow the frontend’s `/auth/sign-up` and `/auth/reset-password` URLs as redirects (also allow `http://localhost:3000` during local development). Signup and password reset links are sent by Supabase Auth; uploaded business images are stored in the public `business-assets` bucket with authenticated, business-scoped upload policies. This project’s initial schema migration has already been applied to its hosted project.

In the root Compose workflow, application records live in its local Postgres volume while Supabase Auth handles sign-in. In a direct Supabase-backed setup, keep `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` aligned with the same Supabase project.

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

Authenticated admin/kitchen endpoints use an HTTP-only session cookie set by `/api/auth/login` and `/api/auth/verify-email`; Supabase refresh tokens stay in a separate HTTP-only cookie. Uploaded images are stored in Supabase Storage.

Supabase Auth sends signup and password reset emails. Redis remains optional; without `REDIS_URL`, kiosk menu APIs read directly from Supabase Postgres. Pexels image search remains optional.
