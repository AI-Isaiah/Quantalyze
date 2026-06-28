# Quantalyze

Portfolio intelligence platform for quant allocators. Connect exchange API keys, get a unified dashboard across all your strategies with TWR/MWR analytics, correlation matrix, risk decomposition, attribution, and a relationship/document layer. Asset managers publish exchange-verified strategies; allocators discover, compare, allocate, and track.

## Prerequisites

- Node.js 20+ (pinned in `.nvmrc`; enforced by `package.json` `engines`)
- Python 3.12 (for the analytics service — pinned; matches the Dockerfile and CI)
- [Supabase CLI](https://supabase.com/docs/guides/cli) and a [Supabase](https://supabase.com) project

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/AI-Isaiah/Quantalyze.git
cd quantalyze
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase project URL and anon key

# 3. Apply database migrations with the Supabase CLI
#   supabase link --project-ref <your-project-ref>
#   supabase db push
# (supabase/migrations/ holds 190+ timestamp-named migrations.) Set the
# admin email before the is_admin backfill migration runs, so it backfills
# automatically:
#   ALTER DATABASE postgres SET app.admin_email = 'you@example.com';
#
# IMPORTANT: on this repo, merging a supabase/migrations/** file to main
# AUTO-APPLIES it to the PRODUCTION database. Read CONTRIBUTING.md
# ("Deploy semantics") before touching migrations.

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
      demo/           # Public editorial /demo hero — 3 personas (?persona=active|cold|stalled)
      api/            # API routes
        cron/         # Vercel Cron handlers (warm-analytics, sync-funding, reconcile-strategies, cleanup-wizard-drafts, cleanup-ack-tokens, founder-lp-report)
        demo/         # Public demo endpoints (signed-token portfolio-pdf)
        # plus: verify-strategy, portfolio-*, alert-digest, admin/match/*, preferences, factsheet/[id]/pdf
    components/       # React components (ui/, layout/, charts/, strategy/, portfolio/, admin/, preferences/, landing/, auth/)
    hooks/            # Reusable React hooks (useKeyboardShortcuts, useBreakpoint SSR-safe viewport class, useMediaQuery, useTapPin touch tap-to-pin chart reveal)
    lib/              # Utilities, types, Supabase clients, queries, preferences, personas, portfolio-insights
  analytics-service/  # FastAPI backend (Python) — strategy + portfolio + match analytics
    services/         # metrics, portfolio_metrics, portfolio_risk, portfolio_optimizer, match_engine, match_eval
    routers/          # analytics, cron, exchange, portfolio, match
  supabase/           # Database migrations (timestamp-named; auto-applied to prod on merge — see CONTRIBUTING.md)
  e2e/                # Playwright specs (auth, discovery, match-queue, demo-public, portfolio-pdf-demo, ...)
  .github/workflows/  # CI + nightly probes (demo PDF cold-start)
  docs/
    architecture/     # ADRs (RLS authz, observability, error handling, secret handling, ...)
    runbooks/         # Operational runbooks (match-engine.md, bridge-outcome-cron.md, ...)
    superpowers/plans/ # Design + implementation plans from /autoplan
    pitch/            # Cap-intro partner pitch artifacts (qualification script, term sheet, one-pager)
    demos/            # Demo scripts + before/after metric capture for the partner demo
```

Version and changelog live in `VERSION` (4-digit `MAJOR.MINOR.PATCH.MICRO`) and
`CHANGELOG.md` — `/ship` bumps both. The current release is tracked in `VERSION`.

## Deploys

Merging to `main` deploys to production automatically: Vercel (frontend) on
every push, Railway (analytics) on green CI, and Supabase migrations under
`supabase/migrations/**` apply to the prod database on merge. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the full deploy semantics and the
operational gotchas (test-DB lag, Railway skip-on-red-CI, version-bump rules)
before merging.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS 4 |
| Charts | Lightweight Charts, Recharts, @nivo/boxplot |
| Database | Supabase (PostgreSQL + Auth + RLS + Storage) |
| Analytics | FastAPI + quantstats + numpy + pandas + scipy + CCXT |
| Email | Resend |
| PDF | Puppeteer |
| Observability | Sentry (frontend + analytics service), structlog, end-to-end `correlation_id` |
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
| `npm run verify:phase18` | Verify Phase 18 artifacts (canonical redactor parity, founder LP cron, migration 100) |
| `npm run check:founder-lp-readiness` | Pre-flight check for `FOUNDER_LP_STRATEGY_ID` (status=published, has factsheet) before the monthly cron's first tick |
| `npm run worker:dev` | Run the analytics worker locally against `analytics-service/.env` |
| `npm run schema:functions` | Regenerate the canonical SQL function snapshot in `supabase/schema/functions/` (run after a migration adds/changes/drops a function; the "SQL Function Snapshot — Drift Gate" CI check fails if it is stale) |

## Analytics Service (Optional)

The Python analytics service computes strategy metrics from exchange trade data.

```bash
cd analytics-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt   # generated lock — to change deps, edit requirements.in and run `make lock`

# Set environment variables (see .env.example for full list)
export SERVICE_KEY=your-key
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your-service-role-key

uvicorn main:app --reload
```

## Troubleshooting

### Local repro of the API-key flow

If a customer reports a wizard failure (or you want to verify a fix), reproduce
the flow locally without hitting any broker:

```bash
bash scripts/repro-key-flow.sh
```

This replays 12 pre-recorded `vcrpy` cassettes (`analytics-service/tests/cassettes/`)
covering OKX / Binance / Bybit × happy / auth-fail / rate-limit / schema-drift.
Replay is deterministic and offline.

The script also greps the cassette files for any known `DEBUG_KEY_FLOW_*` env
value AND scans for high-entropy literals in signing-key-named fields. Either
hit exits 1 (do NOT commit the offending cassette).

Cassette recording is a one-time founder operation (Phase 16 / OBSERV-08); see
`.planning/phases/16-diagnostic-spike-observability/16-08-PLAN.md` Task 3
checkpoint for the procedure.

## Environment Variables

See [`.env.example`](.env.example) for all required and optional variables.
