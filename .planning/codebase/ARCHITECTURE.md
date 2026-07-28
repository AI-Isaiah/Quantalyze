# Architecture

**Analysis Date:** 2026-04-17

## Pattern Overview

**Overall:** Three-tier split-stack SaaS — Next.js 16 App Router frontend (Vercel) + FastAPI Python analytics service (Railway) + Supabase (Postgres with RLS + Auth + Storage + Edge Functions + pg_cron). Authoritative authorization lives in Postgres RLS; the TypeScript and Python layers are thin orchestrators.

**Key Characteristics:**
- **Server-first rendering** — Every layout and page under `src/app/` is a React Server Component that calls Supabase directly. Zero `"use server"` directives — mutations are REST-ish POST/PUT/DELETE handlers under `src/app/api/**/route.ts`.
- **RLS as primary authorization** — `supabase/migrations/002_rls_policies.sql` and follow-ups (007, 011, 020, 054) enforce ownership at the database. App code rarely re-checks ownership; cross-tenant reads via the admin client are audited exceptions per ADR-0003.
- **Two-layer auth gate** — `src/proxy.ts` does an optimistic cookie-only `getSession()` check for UX routing. Every Server Component and route handler additionally calls `supabase.auth.getUser()` (the authoritative network-verified check) — see ADR-0022.
- **Three-client Supabase split** — browser (`src/lib/supabase/client.ts`), server-per-request (`src/lib/supabase/server.ts`), and service-role admin (`src/lib/supabase/admin.ts`). Admin-client call sites must fit one of four categories in ADR-0003.
- **Compute externalized to Python** — All analytics (returns, risk, optimizer, match engine, simulator, verify) lives behind a FastAPI service. Next.js talks to it via a single typed client `src/lib/analytics-client.ts` with `X-Service-Key` auth (ADR-0006).
- **Durable job queue** — `compute_jobs` table (migration 032/033) is claimed by `analytics-service/main_worker.py` running on Railway; per-kind timeouts, watchdog reclaim, circuit breakers, and deferred retries.
- **Envelope encryption for exchange keys** — DEK per row, KEK in Supabase Vault. Only the Python service holds the KEK; Next.js never decrypts.

## Layers

```
+-------------------------------------------------------------+
|                          Browser                             |
|  React Client Components ('use client') — forms, charts,     |
|  modals, wizard step UI. Calls Next.js /api/** routes only.  |
+-----------------------------|-------------------------------+
                              | HTTPS (same-origin)
+-----------------------------v-------------------------------+
|                 Next.js 16 App Router (Vercel)               |
|                                                              |
|  src/proxy.ts (Layer-1 optimistic auth gate, route grouping) |
|                                                              |
|  +---- Server Components ----+   +---- Route Handlers ----+  |
|  | src/app/**/page.tsx        |   | src/app/api/**/       |  |
|  | src/app/**/layout.tsx      |   |   route.ts            |  |
|  | - DAL: createClient()      |   | - withAuth /          |  |
|  | - supabase.auth.getUser()  |   |   withAdminAuth /     |  |
|  | - Supabase reads under RLS |   |   withRole wrappers    |  |
|  +----------------------------+   | - CSRF (origin)        |  |
|                                   | - Rate limit (Upstash) |  |
|                                   +------------------------+  |
|                                                              |
|  src/lib/ (shared DAL: queries.ts, auth.ts, audit.ts,        |
|             analytics-client.ts, csrf.ts, ratelimit.ts)      |
+---------+-----------------------------------+---------------+
          |                                   |
          | @supabase/ssr cookie JWT          | X-Service-Key
          |                                   |
+---------v---------+   +-----------------+   +---------------v---+
| Supabase          |   | Supabase        |   | FastAPI Analytics |
| Postgres (RLS)    |<--+ pg_cron + pg_net|   | Service (Railway) |
| - 58 migrations   |   | (match cron,    |   | - main.py (HTTP)  |
| - SECURITY DEFINER|   |  warmup)        |   | - main_worker.py  |
|   RPCs            |   +-----------------+   |   (queue)         |
| - RLS policies    |                         | - routers/        |
| - user_app_roles  |   +-----------------+   | - services/       |
| - audit_log       |   | Edge Functions  |   | - service-role    |
| - compute_jobs    |<--+ (Deno)          |   |   Supabase client |
+---------+---------+   | compute-trigger |   +---------+---------+
          |             | notify-admin    |             |
          |             +-----------------+             |
          |                                             |
          +---------- Supabase Storage -----------------+
                      (portfolio_documents)
```

**Browser / Client Layer:**
- Purpose: Interactive UI, form state, chart rendering, wizard flows
- Location: `'use client'` components under `src/components/**` and colocated under `src/app/(dashboard)/allocations/components/`, `src/app/(dashboard)/strategies/new/wizard/`
- Contains: React components, client-side hooks (`src/hooks/`), Recharts/Lightweight-Charts/Nivo visualizations
- Depends on: Browser Supabase client (`src/lib/supabase/client.ts`) for realtime reads; Next `/api/**` endpoints for mutations
- Used by: Nothing — leaf layer

**Proxy / Middleware Layer:**
- Purpose: Optimistic route protection + group-level redirects before a page renders
- Location: `src/proxy.ts`
- Contains: Public/admin route allowlists, `getSession()` cookie check, `isAdmin(email)` fast-path, matcher config
- Depends on: `@supabase/ssr`, `src/lib/admin.ts`
- Used by: Every HTTP request to the Vercel deployment (Next 16 middleware rename)

**Server Component / Page Layer (DAL):**
- Purpose: Authoritative data reads and HTML rendering under the caller's JWT
- Location: `src/app/**/page.tsx`, `src/app/**/layout.tsx` (52 page files total)
- Contains: `await createClient()` + `supabase.auth.getUser()` as the first operation, then RLS-scoped reads
- Depends on: `src/lib/supabase/server.ts`, `src/lib/queries.ts`, `src/lib/admin.ts`
- Used by: The Next.js router (entry per route segment)

**Route Handler Layer:**
- Purpose: Mutations and JSON APIs for client components + external callers (crons, Supabase triggers)
- Location: `src/app/api/**/route.ts` (56 route files)
- Contains: `withAuth` / `withAdminAuth` / `withRole` wrappers, `assertSameOrigin` CSRF check, `checkLimit` rate limit, handler body
- Depends on: `src/lib/api/withAuth.ts`, `src/lib/api/withAdminAuth.ts`, `src/lib/auth.ts`, `src/lib/csrf.ts`, `src/lib/ratelimit.ts`
- Used by: Client components (fetch), Vercel Cron (bearer token), Supabase database triggers (service-role JWT)

**Shared Library (`src/lib/`):**
- Purpose: DAL helpers, type definitions, cross-cutting utilities, client factories
- Location: `src/lib/*.ts` (100+ files including tests) + subdirs `supabase/`, `api/`, `admin/`, `analytics/`, `intro/`, `wizard/`, `test-helpers/`
- Contains:
  - `supabase/{client,server,admin,cast,mock,admin-users}.ts` — three-client split
  - `api/{withAuth,withAdminAuth,withRole (in auth.ts),simulatorSchema}.ts` — route wrappers
  - `analytics-client.ts`, `analytics-schemas.ts` — canonical FastAPI client
  - `queries.ts` — shared read functions with React `cache()` memoization
  - `audit.ts` — fire-and-forget `logAuditEvent()` via `after()` / `waitUntil`
  - `auth.ts`, `auth-types.ts`, `admin.ts` — RBAC primitives
  - `types.ts`, `constants.ts` — shared types and enumerations
  - `utils.ts`, `freshness.ts`, `sanitize-filename.ts`, etc. — leaf helpers
- Depends on: `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `@upstash/ratelimit`
- Used by: Server Components, Route Handlers, tests

**Analytics Service (FastAPI, Railway):**
- Purpose: All CPU-heavy compute — returns/risk/portfolio metrics, exchange trade fetch, key validation + envelope encryption, match engine, simulator, verify, optimizer
- Location: `analytics-service/` (Python 3.14+, ~7235 LOC)
- Contains:
  - `main.py` — FastAPI entrypoint with `X-Service-Key` middleware and CORS
  - `main_worker.py` — standalone asyncio worker running 3 interleaved loops (dispatch, watchdog, daily-enqueue) + 3 ex-Vercel cron ticks
  - `routers/{analytics,cron,exchange,internal,match,portfolio,simulator}.py` — HTTP endpoints
  - `services/{analytics_runner,job_worker,portfolio_metrics,portfolio_risk,portfolio_optimizer,match_engine,match_eval,exchange,encryption,db,audit,...}.py`
  - `models/schemas.py` — Pydantic request/response contracts
- Depends on: `supabase-py` (service-role), `ccxt`, `pandas`, `numpy`, `quantstats`, `cryptography` (Fernet for KEK/DEK)
- Used by: `src/lib/analytics-client.ts` (Next), Supabase pg_cron (direct via `pg_net`), `compute-trigger` Edge Function (Deno), `main_worker.py` itself for queue-dispatched jobs

**Postgres / RLS Layer (Supabase):**
- Purpose: Single source of truth for rows, authorization, scheduling, auditing
- Location: `supabase/migrations/001_*.sql` through `058_*.sql` (58 numbered migrations)
- Contains: Table DDL, RLS policies (table-level `FOR ALL USING (user_id = auth.uid())`), column-level REVOKE/GRANT for PII (migration 020 pattern), SECURITY DEFINER RPCs (`log_audit_event`, `claim_compute_jobs`, `mark_compute_job_done/failed`, `enqueue_poll_positions_for_all_strategies`, `current_user_has_app_role`), pg_cron schedules, pg_net HTTP calls into the FastAPI service
- Depends on: Supabase Vault (KEK storage), `pg_cron`, `pg_net` extensions
- Used by: All three other layers

**Edge Function Layer (Supabase, Deno):**
- Purpose: Post-insert event dispatch
- Location: `supabase/functions/{compute-trigger,notify-admin}/index.ts`
- Contains:
  - `compute-trigger` — fires on strategy/trade inserts, calls FastAPI `/api/compute-analytics` with `X-Service-Key`
  - `notify-admin` — sends Resend-powered email on new intro/submission, escapes HTML to prevent injection
- Depends on: Deno runtime, Supabase service-role JWT validation
- Used by: Postgres triggers

## Data Flow

**Authenticated page render (e.g. `/portfolios/[id]`):**

1. Browser sends request with `sb-*-auth-token` cookie
2. `src/proxy.ts` runs — calls `supabase.auth.getSession()` (cookie-only, no network); if no session and route is non-public, 302 to `/login`; if admin route, also checks `isAdmin(email)`
3. Next router matches `src/app/(dashboard)/portfolios/[id]/page.tsx`
4. `src/app/(dashboard)/layout.tsx` runs as Server Component — calls `createClient()` then `supabase.auth.getUser()` (authoritative, verifies JWT against Supabase Auth), loads `isAdminUser()` + allocator role flag, passes to `DashboardChrome`
5. Page component runs — queries Postgres under caller's JWT; RLS restricts rows to owner
6. For strategy analytics that need column-level PII: page calls `createAdminClient()` after an ownership assertion (ADR-0001)
7. HTML streams to browser; client components hydrate and may call `/api/**` for additional data

**Mutation (e.g. POST `/api/trades/upload`):**

1. Client fetches with `credentials: 'include'` — cookie JWT flows through
2. `src/proxy.ts` runs optimistic check (for `/api/*` routes the redirect branch is skipped — API returns JSON 401 via the wrapper)
3. Route handler wrapped in `withAuth(handler)` from `src/lib/api/withAuth.ts`:
   - CSRF: `assertSameOrigin(req)` — matches `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_VERCEL_URL`, localhost in dev
   - Auth: `createClient()` + `supabase.auth.getUser()` — 401 if null
   - Rate limit: `checkLimit(userActionLimiter, userId)` — 429 with `Retry-After` header
4. Handler body executes with user-scoped Supabase client; RLS constrains writes
5. `logAuditEvent(supabase, { action, entity_type, entity_id, metadata })` scheduled via `after()` for fire-and-forget audit emission
6. NextResponse returned; audit RPC completes in background via Vercel `waitUntil`

**Analytics compute (e.g. strategy analytics refresh):**

1. Trigger source — one of:
   - Wizard finalize: `POST /api/strategies/finalize-wizard` → enqueues `compute_jobs` row with `kind='compute_analytics'`
   - pg_cron: `supabase/migrations/013_cron_heartbeat.sql` schedule calls FastAPI via `pg_net` hourly
   - Post-insert trigger: `compute-trigger` Edge Function calls FastAPI `/api/compute-analytics`
2. `main_worker.py` dispatch loop (every 30s) calls `claim_compute_jobs(batch=5, worker_id)` RPC
3. `services/job_worker.py` routes by `kind` to `run_compute_analytics_job` / `run_sync_trades_job` / `run_poll_positions_job` / `run_compute_portfolio_job` / `run_sync_funding_job` / `run_reconcile_strategy_job` / `run_compute_intro_snapshot_job`
4. Handler decrypts exchange credentials (`services/encryption.py` — Fernet DEK unwrap using KEK from Supabase Vault)
5. CCXT fetches trades or positions; `services/transforms.py` converts to daily returns; `services/analytics_runner.py` computes metrics
6. Handler writes to `strategies_analytics` / `positions` / `trades` with service-role client
7. Outcome marked via `mark_compute_job_done` / `mark_compute_job_failed` / `defer_compute_job` RPC — latter two feed the circuit breaker (per-exchange cooldown on 429)
8. `sync_strategy_analytics_status` updates the UI status bridge so dashboards see `computation_status = 'complete'`

**Cron dispatch:**

- **Vercel Cron** — `vercel.json` declares two Hobby-plan paths: `GET /api/cron/warm-analytics` (daily 00:00 UTC) and `GET /api/alert-digest` (daily 09:00 UTC). Auth: `Authorization: Bearer ${CRON_SECRET}` constant-time-compared via `src/lib/timing-safe-compare.ts`.
- **Supabase pg_cron** — runs inside Postgres. Calls FastAPI `/api/match/cron-recompute` via `pg_net` with `X-Service-Key` from `current_setting('app.analytics_service_key')`. See ADR-0008.
- **Python worker cron ticks** — ex-Vercel crons moved inside `main_worker.py` while on Hobby plan: `enqueue_sync_funding_tick`, `enqueue_reconcile_strategies_tick`, `cleanup_ack_tokens_tick`. Each runs once every 86400s inside an asyncio loop.

**State Management:**
- **Server state:** Fetched by Server Components from Supabase; cached per-request via React `cache()` in `src/lib/queries.ts`. No React Query / SWR.
- **Client state:** Local component state (`useState`) and URL search params (`useSearchParams`). One persistent preference surface uses `localStorage` via `src/lib/wizard/localStorage.ts` for wizard resume.
- **Cache:** Vercel Edge CDN caches `/demo/*` for 60s with `stale-while-revalidate=300` (see `next.config.ts`). No `'use cache'` / `cacheTag` / PPR — explicitly rejected in ADR-0002.

## Key Abstractions

**Route Wrappers (`src/lib/api/`):**
- Purpose: Consolidate auth + CSRF + rate-limit onto a single boundary. Mandatory for all mutation handlers per ADR-0004.
- Examples:
  - `src/lib/api/withAuth.ts` — user-scoped handler `(req, user) => NextResponse`
  - `src/lib/api/withAdminAuth.ts` — wraps `isAdminUser` check + body parsing + admin client injection
  - `withRole` in `src/lib/auth.ts` — RBAC wrapper for `admin | allocator | quant_manager | analyst` roles, threads Next-16 dynamic params `{ params }` generically
- Pattern: Higher-order function that returns a typed `(req, ctx) => Promise<NextResponse>`; handler sees only the authenticated surface.

**Three-client Supabase split:**
- Purpose: Make RLS bypass paths explicit and reviewable (ADR-0003)
- Examples:
  - `src/lib/supabase/client.ts` — `createBrowserClient` for client components
  - `src/lib/supabase/server.ts` — `createServerClient` with cookie bridge for SSR
  - `src/lib/supabase/admin.ts` — `createClient` with `SUPABASE_SERVICE_ROLE_KEY`; import guarded by `"server-only"`
- Pattern: Admin client callers must fit one of four categories (service-to-service, column-level PII read, cross-tenant admin tool, audit writes) per ADR-0003.

**Analytics Client Contract:**
- Purpose: Single typed frontend→FastAPI call site (ADR-0006)
- Examples:
  - `src/lib/analytics-client.ts` — `validateKey`, `encryptKey`, `fetchTrades`, `computeAnalytics`, `portfolioAnalytics`, `portfolioOptimizer`, `verifyStrategy`, `recomputeMatch`, `bridge`, `simulator`
  - `src/lib/analytics-schemas.ts` — Zod response schemas gated against runtime contract drift
- Pattern: 30s timeout via `AbortSignal.timeout`, `X-Api-Version: "1"` header, `AnalyticsTimeoutError` / `AnalyticsUpstreamError` preserving upstream status.

**Durable Compute Jobs:**
- Purpose: Exactly-once-ish execution of long-running compute with retry classification
- Examples:
  - `supabase/migrations/032_compute_jobs_queue.sql` — `compute_jobs` table + `claim_compute_jobs` / `mark_compute_job_*` / `defer_compute_job` / `reset_stalled_compute_jobs` RPCs
  - `analytics-service/main_worker.py` — dispatch/watchdog/daily-enqueue loops
  - `analytics-service/services/job_worker.py` — per-kind handler registry, error classification (`transient` vs `permanent` vs `unknown`), circuit breakers
- Pattern: Worker ID `worker-{hostname}-{pid}`; watchdog threshold per-kind exceeds handler timeout; 429 stamps `api_keys.last_429_at` feeding per-exchange cooldown (Binance 120s, OKX 300s, Bybit 600s).

**Envelope Encryption:**
- Purpose: Protect exchange API credentials at rest
- Examples:
  - `analytics-service/services/encryption.py` — `encrypt_credentials`, `decrypt_credentials`, `validate_kek_on_startup`
  - `supabase/migrations/004_kek_version.sql` — KEK versioning columns
- Pattern: Fernet DEK per `api_keys` row, wrapped by KEK in Supabase Vault; Python service is the only holder of the KEK. Next.js route `POST /api/keys/validate-and-encrypt` proxies to FastAPI — cleartext credentials never persist in Next.

**Disclosure Tiers:**
- Purpose: Gate manager identity PII based on strategy tier
- Examples:
  - `src/lib/queries.ts` — `loadManagerIdentity()` wrapper with tier gate
  - `src/lib/manager-identity.ts` — raw SELECT via admin client
  - `supabase/migrations/012_disclosure_and_tenancy.sql`, `020_profile_pii_revoke_hardened.sql`
- Pattern: Two defense layers — column-level REVOKE on `profiles.bio`/`years_trading`/`aum_range` against `anon` + `authenticated`, AND a server-side tier predicate before admin-client read.

## Entry Points

**Next.js proxy / middleware:**
- Location: `src/proxy.ts`
- Triggers: Every HTTP request (matcher excludes `_next/static`, images, `.well-known/*`, `security.txt`, `robots.txt`)
- Responsibilities: Optimistic session check, redirect unauthenticated users to `/login`, redirect authenticated users away from public auth routes (with demo/for-quants/security exemptions), block non-admin from `/admin` and `/api/admin`

**Root layout / Home page:**
- Location: `src/app/layout.tsx`, `src/app/page.tsx`
- Triggers: Every HTML page render
- Responsibilities: Load Google Fonts (DM Sans, Instrument Serif, Geist Mono), inject Plausible analytics script if `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` set, render `<html><body>`. Home `page.tsx` redirects authenticated users to `/discovery/crypto-sma`.

**Error boundaries:**
- Location: `src/app/error.tsx` (nested), `src/app/global-error.tsx` (root layout replacement), `src/app/not-found.tsx`
- Triggers: Thrown errors from Server Components and Route Handlers
- Responsibilities: Render fallback UI with `unstable_retry` button; `console.error` with stable prefix (Sentry wiring noted as TODO)

**Instrumentation:**
- Location: `src/instrumentation.ts`
- Triggers: Next.js boot (if `SENTRY_DSN` env var set) and per-request errors via `onRequestError`
- Responsibilities: Lazy-import `@sentry/nextjs`, init with `tracesSampleRate: 0.1`, capture route context (routerKind, routePath, routeType) on thrown errors

**FastAPI HTTP app:**
- Location: `analytics-service/main.py`
- Triggers: HTTP requests from Next.js (`analytics-client.ts`), Supabase pg_cron (`pg_net`), Edge Functions (Deno fetch)
- Responsibilities: CORS allowlist via `ALLOWED_ORIGINS`, `X-Service-Key` middleware (skipped for `/health` and `/internal/*` which use per-router `X-Internal-Token`), SlowAPI rate limiting, KEK validation on startup

**FastAPI worker:**
- Location: `analytics-service/main_worker.py`
- Triggers: Railway CMD override `python -m main_worker`
- Responsibilities: Three interleaved asyncio loops (30s dispatch, 60s watchdog, 24h daily enqueue) plus three ex-Vercel cron loops (sync_funding, reconcile_strategies, cleanup_ack_tokens). Signal handlers for SIGTERM/SIGINT call `SHUTDOWN.set()`. Healthz HTTP server on side port.

**Vercel Cron routes:**
- Location:
  - `src/app/api/cron/warm-analytics/route.ts` — daily ping to FastAPI `/health`
  - `src/app/api/alert-digest/route.ts` — daily email digest
  - `src/app/api/cron/cleanup-ack-tokens/route.ts`, `src/app/api/cron/reconcile-strategies/route.ts`, `src/app/api/cron/sync-funding/route.ts` — present but currently driven from `main_worker.py` due to Hobby-plan 2-cron cap (see `docs/runbooks/vercel-cron-upgrade.md`)
- Triggers: `vercel.json` `crons` array
- Responsibilities: `Bearer ${CRON_SECRET}` check via `safeCompare` (constant-time), single-shot work then 200/500

**Supabase Edge Functions:**
- Location: `supabase/functions/{compute-trigger,notify-admin}/index.ts`
- Triggers: Database triggers fire `POST` with service-role JWT via `supabase.functions.invoke()`
- Responsibilities: Fan out to FastAPI (`compute-trigger`) or Resend (`notify-admin`)

**Supabase pg_cron:**
- Location: `supabase/migrations/013_cron_heartbeat.sql`, `supabase/migrations/015_schedule_match_cron_hourly.sql`
- Triggers: In-database `cron.schedule()` at specified intervals
- Responsibilities: Use `pg_net.http_post` to reach FastAPI with the service key stored in `app.analytics_service_key` GUC

## Error Handling

**Strategy:** Structured error codes over free-text messages at route boundaries; typed error classes at service boundaries; never leak raw upstream messages to clients.

**Patterns:**
- **Route-level:** Return `NextResponse.json({ code: "KEY_INVALID_FORMAT", error: "..." }, { status: 400 })` with stable codes from `src/lib/wizard/wizardErrors.ts`. The client maps codes to user copy.
- **Analytics service calls:** Distinguish `AnalyticsTimeoutError` from `AnalyticsUpstreamError`. Timeout → 504 to client; upstream error preserves status so 404 "not found" stays 404 (see `src/lib/analytics-client.ts`).
- **Job worker:** Classify exceptions into `transient | permanent | unknown` via type check (`ccxt.NetworkError` → transient, `ccxt.AuthenticationError` → permanent, `InvalidToken` → permanent+sanitized, `asyncio.TimeoutError` → transient). `mark_compute_job_failed` uses the classification to decide retry vs terminal.
- **Error boundaries:** `src/app/error.tsx` for nested route errors, `src/app/global-error.tsx` replaces root layout on root errors, `src/app/not-found.tsx` for `notFound()` calls.
- **Audit emission:** `src/lib/audit.ts` catches all failures and logs `[audit]` prefix to stderr; never propagates to caller. Uses Next 16 `after()` with `queueMicrotask` fallback for non-request contexts.
- **Fire-and-forget:** Audit and metric emissions must not gate responses. `after(promise)` keeps the Vercel function instance alive until promise settles.

## Cross-Cutting Concerns

**Logging:**
- Server: `console.log/warn/error` with stable prefixes (`[audit]`, `[csrf]`, `[error-boundary]`, `[global-error]`). No logger framework.
- Python: `logging.getLogger("quantalyze.analytics")` with module suffixes (`...worker`, `...job_worker`). Basic format `%(asctime)s %(name)s %(levelname)s %(message)s`.
- Error tracking: Sentry via `@sentry/nextjs` (Node) and `sentry-sdk` (Python), both gated on `SENTRY_DSN` env var.
- Product analytics: Plausible (script tag), PostHog (`posthog-js` + `posthog-node`).

**Validation:**
- Route handlers use raw `req.json()` + manual type guards + stable error codes (e.g. `src/app/api/strategies/create-with-key/route.ts`).
- Zod schemas live in `src/lib/analytics-schemas.ts` (response validation) and `src/lib/api/simulatorSchema.ts`.
- Python boundary uses Pydantic (`analytics-service/models/schemas.py`) on every request model.

**Authentication:**
- Supabase Auth (email/password) issues a JWT cookie (`sb-*-auth-token`) via `@supabase/ssr`.
- Proxy reads it optimistically; Server Components/Route Handlers verify via `auth.getUser()`.
- Admin gate: `isAdmin(email)` fast-path (email env match) OR `profiles.is_admin=true` DB flag (`isAdminUser()`).
- RBAC layer: `user_app_roles` join table (`admin`, `allocator`, `quant_manager`, `analyst`) with `withRole` wrapper (migration 054, ADR-0005).
- Service-to-service: `X-Service-Key` header for FastAPI, `X-Internal-Token` for `/internal/*`, Postgres GUC for pg_cron.

**Authorization:**
- Primary: Postgres RLS on every table (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) — see `supabase/migrations/002_rls_policies.sql`.
- Column-level: REVOKE-all-then-GRANT-back pattern (migration 020) for PII on `profiles`.
- Secondary: App-level ownership assertions (`assertPortfolioOwnership` in `src/lib/queries.ts`) ONLY when admin client bypasses RLS.
- SECURITY DEFINER RPCs for privileged ops (`log_audit_event`, `claim_compute_jobs`, `current_user_has_app_role`).

**Rate limiting:**
- Upstash Redis via `@upstash/ratelimit` in `src/lib/ratelimit.ts`.
- Three tiers: `userActionLimiter` (sensitive writes), `publicIpLimiter` (PDF/demo endpoints), `adminActionLimiter` (admin).
- Graceful degradation: If Upstash env vars unset, limiter returns `success: true` (fail-open) with log warning.
- Python: SlowAPI `@limiter.limit("10/hour")` decorators per endpoint.

**CSRF:**
- Primary defense: Supabase SameSite=Lax cookies.
- Defense-in-depth: `assertSameOrigin(req)` in `src/lib/csrf.ts` checks `Origin` or `Referer` against `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_VERCEL_URL` + localhost. Called by `withAuth`/`withAdminAuth`/`withRole` on non-GET methods.

**Observability / health:**
- `/health` endpoint on FastAPI (bypasses service-key middleware).
- `cron_runs` table (migration 013) logs pg_cron → FastAPI calls.
- `compute_jobs` table exposes queue state to admin dashboard at `/admin/compute-jobs`.
- `audit_log` table (migration 049 hardened) captured by `logAuditEvent` across TS and Python.

---

*Architecture analysis: 2026-04-17*
