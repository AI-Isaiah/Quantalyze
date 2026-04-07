# Quantalyze

Portfolio intelligence platform for quant allocators. Connect exchange API keys, get a unified dashboard across all your strategies with TWR/MWR analytics, correlation matrix, risk decomposition, attribution, and a relationship/document layer. Asset managers publish exchange-verified strategies; allocators discover, compare, allocate, and track.

## Prerequisites

- Node.js 20.9+
- Python 3.14+ (for analytics service)
- A [Supabase](https://supabase.com) project

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/AI-Isaiah/Quantalyze.git
cd quantalyze
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase project URL and anon key

# 3. Run database migrations
# In Supabase SQL Editor, run all files in order:
#   supabase/migrations/001_initial_schema.sql
#   ...
#   supabase/migrations/011_perfect_match.sql
#
# For 011 specifically, set the admin email ahead of the migration so is_admin
# backfills automatically:
#   ALTER DATABASE postgres SET app.admin_email = 'you@example.com';

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to the login page.

## Project Structure

```
quantalyze/
  src/
    app/              # Next.js App Router pages
      (auth)/         # Login, signup, onboarding
      (dashboard)/    # Authenticated pages (discovery, strategies, portfolios, allocations, profile, preferences)
        admin/match/  # Founder-only Match Queue (triage + detail + eval dashboard)
        portfolios/   # Portfolio dashboard, management, documents
      api/            # API routes (verify-strategy, portfolio-*, alert-digest, admin/match/*, preferences)
    components/       # React components (ui/, layout/, charts/, strategy/, portfolio/, admin/, preferences/, landing/, auth/)
    hooks/            # Reusable React hooks (useKeyboardShortcuts)
    lib/              # Utilities, types, Supabase clients, queries, preferences
  analytics-service/  # FastAPI backend (Python) — strategy + portfolio + match analytics
    services/         # metrics, portfolio_metrics, portfolio_risk, portfolio_optimizer, match_engine, match_eval
    routers/          # analytics, cron, exchange, portfolio, match
  supabase/           # Database migrations (011 = perfect match engine)
  docs/
    runbooks/         # Operational runbooks (match-engine.md)
    superpowers/plans/ # Design + implementation plans from /autoplan
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS 4 |
| Charts | Lightweight Charts, Recharts, @nivo/boxplot |
| Database | Supabase (PostgreSQL + Auth + RLS + Storage) |
| Analytics | FastAPI + quantstats + numpy + pandas + scipy + CCXT |
| Email | Resend |
| PDF | Puppeteer |
| Deploy | Vercel (frontend), Railway (analytics) |

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checker |
| `npm test` | Run Vitest tests |
| `npm run test:e2e` | Run Playwright E2E tests |

## Analytics Service (Optional)

The Python analytics service computes strategy metrics from exchange trade data.

```bash
cd analytics-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set environment variables (see .env.example for full list)
export SERVICE_KEY=your-key
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your-service-role-key

uvicorn main:app --reload
```

## Environment Variables

See [`.env.example`](.env.example) for all required and optional variables.
