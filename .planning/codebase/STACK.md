# Technology Stack

**Analysis Date:** 2026-04-17

## Languages

**Primary:**
- TypeScript `^5` — Next.js application (`src/`), all API routes and UI
- Python `3.12` / `3.14+` — FastAPI analytics service (`analytics-service/`), Dockerfile pins 3.12-slim; README recommends 3.14+ for local dev

**Secondary:**
- SQL (PostgreSQL dialect) — 58 migrations under `supabase/migrations/`
- TypeScript (Deno runtime) — Supabase Edge Functions under `supabase/functions/`
- CSS — Tailwind-based theme in `src/app/globals.css`

## Runtime

**Environment:**
- Node.js 20 (CI pins `actions/setup-node@v4` with `node-version: 20` in `.github/workflows/ci.yml`)
- README states `Node.js 20.9+` requirement
- Python 3.12 in Docker (`analytics-service/Dockerfile`)
- Deno (Supabase Edge Functions)

**Package Manager:**
- npm — root project uses `npm ci` in Vercel build (`vercel.json`) and CI
- Lockfile: `package-lock.json` present (~15k lines)
- pip — analytics service (`analytics-service/requirements.txt`, pinned exact versions)

## Frameworks

**Core:**
- Next.js `^16.2.3` — App Router (`src/app/`), API routes, Server Components, `instrumentation.ts` for telemetry registration, `src/proxy.ts` for middleware (Next 16 rename from `middleware`). See `AGENTS.md` warning about Next 16 breaking changes.
- React `19.2.4` — paired with `react-dom@19.2.4`
- FastAPI `0.115.12` — analytics service (`analytics-service/main.py`), served with uvicorn `0.34.2[standard]`
- Supabase — Postgres + Auth + Storage + Edge Functions + pg_cron + pg_net

**Testing:**
- Vitest `^4.1.2` — Next.js unit tests, config at `vitest.config.ts` (environment `jsdom`, setup `src/test-setup.ts`)
- @testing-library/react `^16.3.2` + @testing-library/jest-dom `^6.9.1`
- Playwright `^1.59.1` — E2E tests in `e2e/`, config at `playwright.config.ts` (Chromium only, webServer auto-starts `npm run dev`)
- jsdom `^29.0.1` — DOM shim for Vitest
- pytest + pytest-cov + pytest-asyncio + pytest-mock — Python tests under `analytics-service/tests/`, config `analytics-service/pytest.ini`, CI enforces `--cov-fail-under=80`

**Build/Dev:**
- TypeScript `^5` — `tsconfig.json` targets ES2017 with `moduleResolution: bundler`, `@/*` path alias to `./src/*`, `strict: true`
- Tailwind CSS `^4` via `@tailwindcss/postcss` (see `postcss.config.mjs`, `src/app/globals.css` uses `@import "tailwindcss"` and CSS-first `@theme inline`)
- ESLint `^9` with `eslint-config-next@16.2.2`, config `eslint.config.mjs`
- tsx `^4.21.0` — used by CI scripts (`npx tsx scripts/check-gdpr-export-coverage.ts`)
- knip `^6.3.1` — dead code detection (dev dep)

## Key Dependencies

**Critical:**
- `@supabase/ssr` `^0.10.0` — cookie-based server/browser clients (`src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`)
- `@supabase/supabase-js` `^2.101.1` — service-role admin client (`src/lib/supabase/admin.ts`) and Python service (`supabase==2.15.1`)
- `zod` `^4.3.6` — runtime schema validation (`src/lib/analytics-schemas.ts`, route body validation)
- `posthog-node` `^5.29.2` + `posthog-js` `^1.367.0` — product analytics
- `@sentry/nextjs` `^10.48.0` — error tracking, initialized lazily in `src/instrumentation.ts`
- `resend` `^6.10.0` — transactional email (`src/lib/email.ts`)
- `puppeteer-core` `^24.40.0` + `@sparticuz/chromium` `^133.0.0` — serverless PDF generation (`src/lib/puppeteer.ts`)
- `@upstash/ratelimit` `^2.0.8` + `@upstash/redis` `^1.37.0` — distributed rate limiting (`src/lib/ratelimit.ts`)

**Infrastructure:**
- `server-only` `^0.0.1` — compile-time leak guard on admin/PostHog modules
- `@opentelemetry/otlp-transformer` `0.215.0` — pinned to satisfy `@sentry/nextjs` peer
- `lightweight-charts` `^5.1.0`, `recharts` `^3.8.1`, `@nivo/boxplot` `^0.99.0` — chart libraries
- `@tanstack/react-table` `^8.21.3` — data tables (admin panels)
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` — drag-and-drop in portfolio UI
- `react-grid-layout` `^2.2.3` — dashboard widget grid

**Python analytics (`analytics-service/requirements.txt`):**
- `fastapi==0.115.12`, `uvicorn[standard]==0.34.2`
- `quantstats==0.0.81` — risk/return metrics
- `ccxt>=4.0` — unified exchange SDK (used for Binance/OKX/Bybit in `analytics-service/services/exchange.py`)
- `pandas==2.2.3`, `numpy==2.2.4` — numerical computation
- `pydantic==2.11.3` — request/response models
- `httpx==0.28.1` — async HTTP client
- `slowapi==0.1.9` — per-route rate limiting
- `cryptography>=44.0` — `Fernet` for envelope encryption of exchange API keys (`analytics-service/services/encryption.py`)
- `python-dotenv==1.1.0` — local `.env` loading

## Configuration

**Environment:**
- Frontend env vars declared in `.env.example` (32 lines); loaded from Vercel env UI in production, `.env.local` in dev
- Analytics service env vars set in Railway env UI, documented at bottom of `.env.example`
- Postgres GUCs — `app.analytics_service_url`, `app.analytics_service_key`, `app.admin_email` set via `ALTER DATABASE postgres SET ...` so pg_cron jobs read secrets at execution without landing them in `cron.job.command` (see `supabase/migrations/015_schedule_match_cron_hourly.sql`)

**Required envs (Next.js):**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL` — gates `/admin/*` in `src/proxy.ts` via `src/lib/admin.ts`
- `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` — used by PDF routes, email links, CSRF allowlist (`src/lib/csrf.ts`)
- `ANALYTICS_SERVICE_URL`, `ANALYTICS_SERVICE_KEY` — Railway upstream (`src/lib/analytics-client.ts`)
- `CRON_SECRET` — Vercel Cron bearer-token gate (all handlers under `src/app/api/cron/*` and `src/app/api/alert-digest/route.ts`)
- `DEMO_PDF_SECRET` — HMAC signer for public demo PDF tokens (`src/lib/demo-pdf-token.ts`, reused by `src/lib/pdf-render-token.ts`)
- `PORTFOLIO_PDF_SECRET` — HMAC signer for portfolio PDFs
- `ALERT_ACK_SECRET` — HMAC signer for email-digest ack tokens (`src/lib/alert-ack-token.ts`)
- `PLATFORM_NAME`, `PLATFORM_EMAIL` — whitelabel branding
- `INTERNAL_API_TOKEN` — paired with Python `/internal/*` router token

**Optional envs:**
- `RESEND_API_KEY` — missing = emails silently skipped
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` — missing = PostHog events no-op
- `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` — server-side PostHog personal API key for `/admin/usage` funnel reads (`src/lib/admin/usage-metrics.ts`)
- `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` — Plausible analytics script in `src/app/layout.tsx`
- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` — frontend + analytics service error tracking
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — missing = rate limiting disabled, fails open
- `NEXT_PUBLIC_SCHEDULING_URL` — Calendly link for "Book Intro Call" button (`src/components/strategy/BookIntroCall.tsx`)
- `NEXT_PUBLIC_PLATFORM_NAME` — client-side branding override
- `NEXT_PUBLIC_VERCEL_URL` — picked up in `src/lib/csrf.ts` for preview deploys
- `PUPPETEER_EXECUTABLE_PATH` — local Chromium override (auto-detected on Vercel via `@sparticuz/chromium`)
- `USE_COMPUTE_JOBS_QUEUE` — feature flag routing sync through `compute_jobs` table

**Analytics service envs (set in Railway):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — Postgres access (`analytics-service/services/db.py`)
- `SERVICE_KEY` — inbound gate for `X-Service-Key` middleware (`analytics-service/main.py`)
- `KEK`, `KEK_VERSION` — Fernet key encryption key for exchange credentials (`analytics-service/services/encryption.py`)
- `ALLOWED_ORIGINS` — CORS whitelist, comma-separated
- `SENTRY_DSN` — optional, lazy-imports `sentry_sdk`
- `INTERNAL_API_TOKEN` — paired gate on `/internal/*` routes (`analytics-service/routers/internal.py`)
- `KEY_PERMISSION_CACHE_TTL` — seconds, defaults 900 (`analytics-service/services/key_permissions.py`)
- `PORT` — uvicorn bind port

**Build:**
- `next.config.ts` — rewrites `/security.txt` → `/.well-known/security.txt`, sets CSP + security headers on all responses, CDN-caches `/demo/:path*` with `s-maxage=60, stale-while-revalidate=300`
- `vercel.json` — `framework: "nextjs"`, `buildCommand: "npm run build"`, `installCommand: "npm ci"`, 2 crons (see below)
- `postcss.config.mjs` — single `@tailwindcss/postcss` plugin
- `analytics-service/Dockerfile` — python:3.12-slim base, creates non-root `app` user, default CMD `uvicorn main:app`; worker service overrides CMD to `python -m main_worker`
- `analytics-service/railway.toml` — Dockerfile builder, `/health` healthcheck, 120s timeout, `restartPolicyType = "ON_FAILURE"` with 3 retries

## Platform Requirements

**Development:**
- Node 20.9+, npm
- Python 3.12+ (virtualenv recommended)
- Supabase project (self-run migrations in `supabase/migrations/` in numeric order)
- Optional: Upstash Redis for rate limiting, Resend account for email

**Production:**
- Vercel — Next.js frontend, App Router + serverless functions + Vercel Cron
- Railway — FastAPI analytics service + durable worker (`python -m main_worker`) as a second Railway service reusing the same image
- Supabase — Postgres + Auth + Storage + Edge Functions + pg_cron + pg_net
- Node 24 LTS (Vercel default, supersedes CI's pinned 20)
- See `docs/architecture/adr-0017-deployment-topology.md` for the full three-provider diagram and failure-mode table

---

*Stack analysis: 2026-04-17*
