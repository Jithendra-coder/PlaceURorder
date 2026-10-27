# PlaceURorder

[![Frontend quality checks](https://github.com/Jithendra-coder/PlaceURorder/actions/workflows/quality.yml/badge.svg?branch=main)](https://github.com/Jithendra-coder/PlaceURorder/actions/workflows/quality.yml)

> A modern, responsive self-service kiosk, counter point-of-sale (POS), kitchen display system (KDS), and merchant administration platform built with **Next.js 16 (React 19)** and **FastAPI (PostgreSQL)**.

---

## Overview

PlaceURorder is a restaurant ordering and operations platform for self-service kiosks, counter POS, kitchen displays, and merchant administration.

### Key Capabilities

- **Interactive Self-Service Kiosk**:
  - Three distinct layout themes: **Side Navigation**, **Top Navigation**, and **Category-First Grid**.
  - Dynamic customization: Brand colors, logo, welcome screens, banner imagery, and promotional carousels.
  - Dine-in and Takeaway flows with table selection and customer details.
  - Multi-method checkout: Dynamic QR payments (UPI/Paytm), Stripe, Razorpay, or Pay at Counter.
  - Live order tracking screen with real-time status transitions.

- **Counter POS Terminal**:
  - Fast-paced cashier ordering interface.
  - Instant order dispatch to the kitchen display system.
  - Offline-resilient queueing and recovery.

- **Kitchen Display System (KDS)**:
  - Real-time visual order queue (New -> In Preparation -> Ready -> Completed).
  - Audio and visual alerts for incoming high-priority orders.
  - Color-coded timers and order ticket breakdown.

- **Hardware & Device Pairing**:
  - Secure device authorization via one-time link tokens and device pairing codes.
  - Remote kiosk lock/unlock and status monitoring.

- **Merchant Operations & Insights Dashboard**:
  - **Menu Management**: Categories, products, modifiers, pricing, and dietary tags.
  - **Inventory & Availability**: Quick toggle for 86'd (out-of-stock) items.
  - **Promotions & Offers**: Percentage, fixed discount, and buy-one-get-one deals.
  - **Store Administration**: Operating hours, tax configuration, staff permissions, and activity audits.
  - **Business Analytics**: Hourly revenue trends, top-selling items, average ticket value, and order volumes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | [Next.js 16](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS v4](https://tailwindcss.com/), [Framer Motion](https://www.framer.com/motion/), [Lucide React](https://lucide.dev/) |
| **Backend** | [FastAPI](https://fastapi.tiangolo.com/), Python 3.11+, [Pydantic v2](https://docs.pydantic.dev/), [Uvicorn](https://www.uvicorn.org/) |
| **Database** | [PostgreSQL 14+](https://www.postgresql.org/) with robust schema, relational constraints, and indexes |
| **Testing** | [Playwright](https://playwright.dev/) for end-to-end testing, [Pytest](https://docs.pytest.org/) for backend test suites |
| **Integrations** | Optional Redis caching, Pexels media search, SMTP transactional emails |

---

## Repository Structure

The repository keeps the web app, API, and database migration history in separate top-level areas:

```text
.
├── .github/
│   └── workflows/quality.yml   # CI quality checks
├── backend/
│   ├── knowledge/              # Curated assistant help content
│   ├── migrations/             # Backend SQL migrations
│   ├── routers/                # FastAPI route handlers
│   ├── services/               # Business logic and integrations
│   ├── tests/                  # Backend tests
│   ├── config.py               # Application configuration
│   ├── database.py             # Database connection and query helpers
│   ├── main.py                 # FastAPI application entry point
│   ├── postgres_schema.sql     # Local PostgreSQL schema
│   ├── requirements.txt        # Backend dependencies
│   ├── README.md               # Backend setup and API notes
│   └── webhook_worker.py       # Queued webhook delivery worker
├── docs/legal/                 # Privacy notice and terms drafts
├── frontend/
│   ├── public/                 # Static assets
│   ├── scripts/                # Frontend quality checks
│   ├── src/
│   │   ├── app/                # App Router pages and route-specific components
│   │   ├── components/         # Shared UI components
│   │   ├── features/           # Domain-focused frontend modules
│   │   ├── lib/                # Shared utilities and types
│   │   └── services/           # API and authentication clients
│   ├── tests/                  # Playwright end-to-end tests
│   ├── package.json            # Frontend scripts and dependencies
│   └── playwright.config.ts    # End-to-end test configuration
├── supabase/migrations/        # Hosted Supabase schema migrations
├── .env.example                # Local environment template
├── compose.yaml                # Local development services
├── pytest.ini                  # Backend test configuration
└── README.md                   # Project setup and overview
```

The Next.js routes live under `frontend/src/app/` (`admin`, `auth`, `counter`, `dashboard`, `device`, `kiosk`, `kitchen`, `setup`, and `test`). Backend SQL migrations are in `backend/migrations/`; Supabase migrations are tracked separately in `supabase/migrations/`.

---

## Getting Started

### Prerequisites

- **Node.js** 20+ and **npm** 10+
- **Python** 3.11+
- **PostgreSQL** 14+

### Local development with Podman

Install Podman and a Compose provider (`podman compose` is a wrapper around an installed `podman-compose` or `docker-compose` provider), then run from the repository root:

```bash
podman compose up --build
```

Open `http://localhost:3000`; the API is at `http://localhost:8000`. The first startup creates the local database schema and volumes for database data, uploads, and email previews. The API and frontend ports are bound to localhost. A separate webhook worker delivers queued integration events. Stop with `Ctrl+C` or `podman compose down`; both keep demo data. Do not add `-v` unless you intentionally want to delete the local database and uploaded files.

The Compose stack uses local Postgres and Supabase Auth. To enable sign-in and authenticated admin flows, put `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in a repository-root `.env` file before starting Compose. Without them, the app starts but authentication endpoints return `503`.

> **Local demo only:** the Compose credentials are documented development defaults. Change them and review the security settings before any deployment with real data.

Useful commands:

```bash
podman compose ps
podman compose logs -f api webhook-worker
podman compose down
```

`podman compose` delegates Compose parsing to an external provider; see the [Podman Compose documentation](https://docs.podman.io/en/latest/markdown/podman-compose.1.html) if no provider is installed or a command is unsupported.

### Product and legal documents

- [PlaceURorder product help policy](backend/knowledge/placeurorder-help-policy.md) — source text for dashboard Ask AI retrieval and grounded answers.
- [Terms and Conditions review draft](docs/legal/TERMS_AND_CONDITIONS.md) and [Privacy Notice review draft](docs/legal/PRIVACY_POLICY.md) — not effective or ready for customer acceptance until the marked legal and operational details are completed and reviewed.

Ask AI handles approved live business lookups in MenuTap and retrieves relevant help-guide passages. The Menu Growth Coach compares paid completed orders and item quantities across two rolling 28-day periods; it is read-only and excludes customer-level details. When `GEMINI_API_KEY` is configured, help-style questions may be sent to Google's embedding API to find matching guide passages, then the question and selected passages may be sent to Gemini for answer drafting. Growth Coach questions, limited aggregate sales/item metrics, and retrieved passages may also be sent for grounded recommendation selection; the model has no SQL or app tools. Without Gemini, the coach returns deterministic recommendations. Keep the key server-side in the ignored root `.env`, and review the privacy draft and Google's current data-use terms before using Gemini with real merchant data.

---

### 1. Database Setup

Create a PostgreSQL database for the application:

```bash
# Using psql
psql -U postgres -c "CREATE DATABASE universal_kiosk_app;"

# Apply the database schema
psql -U postgres -d universal_kiosk_app -f backend/postgres_schema.sql
```

---

### 2. Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` for the Supabase project, plus `JWT_SECRET` and any payment provider credentials. Copy the database connection string from Supabase Dashboard → Connect; keep its password private.

5. Start the FastAPI development server:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
   API interactive documentation will be available at http://localhost:8000/docs.

---

### 3. Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 to access the application.

---

## Testing & Quality Assurance

### Frontend Typecheck & Linting
```bash
cd frontend
npm run typecheck
npm run lint
```

### End-to-End Tests (Playwright)
```bash
cd frontend
npx playwright test
```

### Backend Unit Tests
```bash
cd backend
pytest
```

---

## Security & Best Practices

- **Authentication**: Uses secure, httpOnly session cookies for browser dashboard sessions with JWT fallback for API clients.
- **Role-Based Access Control**: Strict permissions for Owner, Manager, Cashier, and Kitchen Staff.
- **Credential Protection**: Environment files (.env, .env.local) are strictly excluded via .gitignore.
- **Input Sanitization**: All inputs validated via Pydantic models and parameterized SQL queries to prevent SQL injection.

---

## License

This repository currently has no tracked `LICENSE` file, so its reuse and redistribution terms are not explicitly stated. Add a license before relying on those permissions.
