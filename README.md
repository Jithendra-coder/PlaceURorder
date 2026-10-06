# PlaceURorder

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

`	ext
universal-kiosk-app/
├── backend/
│   ├── migrations/             # Schema migration scripts
│   ├── routers/                # Modular API route controllers
│   ├── services/               # Business logic and domain services
│   ├── tests/                  # Backend unit and integration tests
│   ├── config.py               # Application settings and environment variables
│   ├── database.py             # PostgreSQL connection pool and query helpers
│   ├── main.py                 # FastAPI application entry point
│   ├── postgres_schema.sql     # Database tables, triggers, and indices
│   ├── requirements.txt        # Python production dependencies
│   └── README.md               # Dedicated backend documentation
│
├── frontend/
│   ├── public/                 # Static assets, branding presets, and icons
│   ├── scripts/                # Verification and linting scripts
│   ├── src/
│   │   ├── app/                # Next.js 16 App Router pages and layouts
│   │   │   ├── (auth)/         # Sign-in, sign-up, password reset
│   │   │   ├── counter/        # Counter POS interface
│   │   │   ├── dashboard/      # Merchant administration portal
│   │   │   ├── device/         # Device activation and pairing
│   │   │   ├── kiosk/          # Customer self-service kiosk
│   │   │   ├── kitchen/        # Kitchen display system (KDS)
│   │   │   └── setup/          # Business onboarding and setup wizard
│   │   ├── components/         # Reusable UI components
│   │   ├── features/           # Domain-specific feature modules
│   │   ├── lib/                # Client utilities and helpers
│   │   └── services/           # Frontend API client and auth services
│   ├── tests/                  # Playwright E2E test specs
│   ├── package.json            # Node.js dependencies and scripts
│   └── playwright.config.ts    # End-to-end testing configuration
│
├── .env.example                # Root environment template
└── README.md                   # Project overview and guide
`

---

## Getting Started

### Prerequisites

- **Node.js** 20+ and **npm** 10+
- **Python** 3.11+
- **PostgreSQL** 14+

### One-command local demo

With Docker Engine and Docker Compose v2 installed, run from the repository root:

```bash
docker compose up --build
```

Open `http://localhost:3000`; the API is at `http://localhost:8000`. The first startup creates the database schema and local volumes for uploads and email previews. The services are bound to localhost. Stop with `Ctrl+C`; `docker compose down` stops the services while keeping demo data.

To enable sign-in and authenticated admin flows, put `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in a repository-root `.env` file before starting Compose. Without them, the app starts but authentication endpoints return `503`.

> **Local demo only:** the Compose credentials are documented development defaults. Change them and review the security settings before any deployment with real data.

---

### 1. Database Setup

Create a PostgreSQL database for the application:

`ash
# Using psql
psql -U postgres -c "CREATE DATABASE universal_kiosk_app;"

# Apply the database schema
psql -U postgres -d universal_kiosk_app -f backend/postgres_schema.sql
`

---

### 2. Backend Setup

1. Navigate to the backend directory:
   `ash
   cd backend
   `

2. Create a virtual environment and activate it:
   `ash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   `

3. Install dependencies:
   `ash
   pip install -r requirements.txt
   `

4. Configure environment variables:
   `ash
   cp .env.example .env
   `
   Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` for the Supabase project, plus `JWT_SECRET` and any payment provider credentials. Copy the database connection string from Supabase Dashboard → Connect; keep its password private.

5. Start the FastAPI development server:
   `ash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   `
   API interactive documentation will be available at http://localhost:8000/docs.

---

### 3. Frontend Setup

1. Navigate to the frontend directory:
   `ash
   cd frontend
   `

2. Install dependencies:
   `ash
   npm install
   `

3. Configure environment variables:
   `ash
   cp .env.example .env.local
   `

4. Start the Next.js development server:
   `ash
   npm run dev
   `
   Open http://localhost:3000 to access the application.

---

## Testing & Quality Assurance

### Frontend Typecheck & Linting
`ash
cd frontend
npm run typecheck
npm run lint
`

### End-to-End Tests (Playwright)
`ash
cd frontend
npx playwright test
`

### Backend Unit Tests
`ash
cd backend
pytest
`

---

## Security & Best Practices

- **Authentication**: Uses secure, httpOnly session cookies for browser dashboard sessions with JWT fallback for API clients.
- **Role-Based Access Control**: Strict permissions for Owner, Manager, Cashier, and Kitchen Staff.
- **Credential Protection**: Environment files (.env, .env.local) are strictly excluded via .gitignore.
- **Input Sanitization**: All inputs validated via Pydantic models and parameterized SQL queries to prevent SQL injection.

---

## License

This project is licensed under the MIT License.
