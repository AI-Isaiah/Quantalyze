# Quantalyze

Verified quantitative strategy marketplace. Asset managers publish strategies with exchange-verified performance data. Allocators discover, compare, and request introductions.

## Prerequisites

- Node.js 20.9+
- Python 3.12+ (for analytics service)
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
# In Supabase SQL Editor, run:
#   supabase/migrations/001_initial_schema.sql
#   supabase/migrations/002_rls_policies.sql

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
      (dashboard)/    # Authenticated pages (discovery, strategies, profile)
    components/       # React components (ui/, layout/, charts/, strategy/, auth/)
    lib/              # Utilities, types, Supabase clients, mock data
  analytics-service/  # FastAPI backend (Python)
  supabase/           # Database migrations
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS 4 |
| Charts | Lightweight Charts, Recharts, @nivo/boxplot |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Analytics | FastAPI + quantstats + CCXT |
| Deploy | Vercel (frontend), Railway (analytics) |

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checker |
| `npm test` | Run Vitest tests |

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
