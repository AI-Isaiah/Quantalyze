# Codebase Structure

**Analysis Date:** 2026-04-17

## Directory Layout

```
quantalyze/
├── src/                              # Next.js 16 application root
│   ├── app/                          # App Router — pages + API routes
│   │   ├── layout.tsx                # Root layout: fonts + Plausible injection
│   │   ├── page.tsx                  # Home / marketing landing
│   │   ├── error.tsx                 # Nested-route error boundary
│   │   ├── global-error.tsx          # Root-layout error boundary
│   │   ├── not-found.tsx             # 404 page
│   │   ├── globals.css               # Tailwind v4 globals
│   │   ├── (auth)/                   # Route group — unauthenticated
│   │   │   ├── layout.tsx            # Centered card shell
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── onboarding/page.tsx
│   │   ├── (dashboard)/              # Route group — authenticated shell
│   │   │   ├── layout.tsx            # DashboardChrome + admin/allocator flag lookup
│   │   │   ├── error.tsx
│   │   │   ├── admin/                # Admin-only pages
│   │   │   │   ├── page.tsx          # Admin landing (tabbed triage)
│   │   │   │   ├── compute-jobs/
│   │   │   │   ├── deletion-requests/
│   │   │   │   ├── for-quants-leads/
│   │   │   │   ├── intros/
│   │   │   │   ├── match/            # Match queue: list, detail, eval
│   │   │   │   ├── partner-import/
│   │   │   │   ├── partner-pilot/
│   │   │   │   ├── partner-roi/
│   │   │   │   ├── usage/
│   │   │   │   └── users/[id]/       # RBAC edit panel
│   │   │   ├── allocations/          # Allocator "my allocations" dashboard
│   │   │   │   ├── AllocationDashboard.tsx
│   │   │   │   ├── MyAllocationClient.tsx
│   │   │   │   ├── components/       # Colocated UI pieces
│   │   │   │   ├── hooks/            # Colocated hooks (useDashboardConfig, useTimeframe)
│   │   │   │   ├── lib/              # Colocated helpers (widget-registry, types)
│   │   │   │   └── widgets/          # 7 widget categories (allocation, attribution, ...)
│   │   │   ├── compare/, connections/, decks/, discovery/,
│   │   │   │   exchanges/, portfolios/, preferences/, profile/,
│   │   │   │   recommendations/, referral/, scenarios/, strategies/
│   │   ├── api/                      # Route handlers (56 route.ts files)
│   │   │   ├── account/              # GDPR export + deletion-request
│   │   │   ├── activity/portfolio/
│   │   │   ├── admin/                # Admin-only mutations (withAdminAuth)
│   │   │   ├── alert-digest/         # Vercel Cron (daily)
│   │   │   ├── alerts/               # Portfolio alert ack
│   │   │   ├── attestation/
│   │   │   ├── bridge/               # Portfolio impact / bridge analytics proxy
│   │   │   ├── cron/                 # Vercel Cron handlers
│   │   │   ├── demo/                 # Public demo endpoints (signed tokens)
│   │   │   ├── factsheet/[id]/pdf/   # Puppeteer PDF generation
│   │   │   ├── for-quants-lead/      # Public marketing lead capture
│   │   │   ├── intro/                # Allocator → manager intros
│   │   │   ├── keys/                 # Exchange API key CRUD + sync + permissions
│   │   │   ├── notes/                # User-authored notes
│   │   │   ├── portfolio-alerts/
│   │   │   ├── portfolio-documents/
│   │   │   ├── portfolio-optimizer/  # Inline FastAPI call (ADR-0006 TODO)
│   │   │   ├── portfolio-pdf/[id]/
│   │   │   ├── portfolio-strategies/alias/
│   │   │   ├── preferences/
│   │   │   ├── simulator/
│   │   │   ├── strategies/           # Draft, create-with-key, finalize-wizard
│   │   │   ├── trades/upload/
│   │   │   ├── usage/session-start/
│   │   │   ├── verify-strategy/
│   │   ├── browse/                   # Public strategy browse
│   │   ├── demo/                     # Public editorial demo (3 personas)
│   │   ├── factsheet/[id]/           # Public PDF source
│   │   ├── for-quants/               # Manager marketing landing
│   │   ├── legal/                    # Terms + privacy
│   │   ├── portfolio-pdf/[id]/       # Puppeteer render target
│   │   ├── security/                 # /security public page + security.txt redirect
│   │   └── strategy/                 # Public strategy detail pages
│   ├── components/                   # 18 subdirs, ~150 components
│   │   ├── admin/                    # AdminTabs, MatchQueueIndex, UserRolesPanel, ...
│   │   ├── auth/                     # LoginForm, SignupForm, OnboardingWizard, ...
│   │   ├── charts/                   # Recharts / Lightweight-Charts wrappers
│   │   ├── connect/                  # Exchange connection wizard pieces
│   │   ├── deck/                     # Deck upload UI
│   │   ├── discovery/                # Discovery page components
│   │   ├── exchanges/                # AllocatorExchangeManager
│   │   ├── landing/                  # Marketing page components (VerificationSection, ...)
│   │   ├── layout/                   # DashboardChrome, Sidebar, PageHeader, MobileNav
│   │   ├── legal/                    # Terms + privacy renderers
│   │   ├── org/                      # Organization / tenancy
│   │   ├── portfolio/                # Portfolio widgets + optimizer UI
│   │   ├── preferences/              # User preferences forms
│   │   ├── scenarios/                # Scenario simulator UI
│   │   ├── strategy/                 # Strategy detail tabs + compare UI
│   │   └── ui/                       # Generic primitives (Button, Card, Modal, Badge)
│   ├── hooks/                        # useKeyboardShortcuts, useMediaQuery
│   ├── lib/                          # Shared DAL + utilities
│   │   ├── supabase/                 # Three-client split (ADR-0003)
│   │   │   ├── client.ts             # Browser client
│   │   │   ├── server.ts             # Per-request server client
│   │   │   ├── admin.ts              # service_role admin client (server-only)
│   │   │   ├── admin-users.ts        # Admin-UI user lookups
│   │   │   ├── cast.ts               # Row-type cast helpers
│   │   │   └── mock.ts               # Test mocks
│   │   ├── api/                      # Route wrappers
│   │   │   ├── withAuth.ts           # User auth wrapper
│   │   │   ├── withAdminAuth.ts      # Admin auth wrapper
│   │   │   └── simulatorSchema.ts    # Zod schemas for simulator
│   │   ├── admin/                    # Admin-specific helpers
│   │   │   ├── match.ts              # Match-queue helpers
│   │   │   ├── pii-scrub.ts          # PII redaction
│   │   │   └── usage-metrics.ts
│   │   ├── analytics/                # Product-analytics event schemas
│   │   │   ├── usage-events.ts       # Node emitter
│   │   │   ├── usage-events-client.ts
│   │   │   └── usage-events-types.ts
│   │   ├── intro/                    # Intro snapshot helpers
│   │   ├── wizard/                   # Wizard localStorage + error codes
│   │   ├── test-helpers/             # Live-DB test harness
│   │   ├── analytics-client.ts       # Canonical FastAPI client (ADR-0006)
│   │   ├── analytics-schemas.ts      # Zod response contracts
│   │   ├── auth.ts                   # withRole + getUserRoles + requireRole
│   │   ├── auth-types.ts             # AppRole union (client-safe)
│   │   ├── admin.ts                  # isAdmin + isAdminUser
│   │   ├── audit.ts                  # logAuditEvent (fire-and-forget via after)
│   │   ├── constants.ts              # STRATEGY_NAMES, EXCHANGES, API_KEY_USER_COLUMNS
│   │   ├── csrf.ts                   # assertSameOrigin
│   │   ├── csv.ts, email.ts, freshness.ts, health-score.ts, ...
│   │   ├── manager-identity.ts       # Raw profile SELECT (used by queries.ts)
│   │   ├── queries.ts                # Cached read functions (React cache())
│   │   ├── ratelimit.ts              # Upstash wrappers (3 tiers)
│   │   ├── timing-safe-compare.ts    # safeCompare for CRON_SECRET
│   │   ├── types.ts                  # Core TS types (Profile, Strategy, Portfolio, ...)
│   │   └── utils.ts                  # Leaf helpers (isUuid, formatters, ...)
│   ├── __tests__/                    # Cross-cutting/integration vitest specs
│   ├── proxy.ts                      # Next 16 middleware (renamed from middleware.ts)
│   ├── proxy.test.ts
│   ├── instrumentation.ts            # Sentry init + onRequestError
│   └── test-setup.ts                 # jsdom + testing-library bootstrap
│
├── analytics-service/                # FastAPI / Python 3.14+ (Railway)
│   ├── main.py                       # HTTP app with X-Service-Key middleware
│   ├── main_worker.py                # Compute-jobs worker (dispatch + watchdog + cron)
│   ├── main_worker_healthz.py        # Worker healthz side server
│   ├── Dockerfile                    # Container build
│   ├── railway.toml                  # Railway deploy config
│   ├── requirements.txt              # fastapi, uvicorn, ccxt, pandas, quantstats, ...
│   ├── pytest.ini                    # pytest config
│   ├── routers/                      # HTTP endpoints per domain
│   │   ├── analytics.py              # POST /api/compute-analytics
│   │   ├── cron.py                   # Cron-driven sync routes
│   │   ├── exchange.py               # Key validate + trade fetch
│   │   ├── internal.py               # /internal/* with X-Internal-Token
│   │   ├── match.py                  # Match engine recompute
│   │   ├── portfolio.py              # Portfolio analytics + optimizer + bridge
│   │   └── simulator.py              # Impact simulator
│   ├── services/                     # Pure logic (~25 modules)
│   │   ├── analytics_runner.py       # Strategy analytics orchestration
│   │   ├── analytics_status.py       # UI bridge status sync
│   │   ├── audit.py                  # log_audit_event* (Python parallel)
│   │   ├── benchmark.py              # Benchmark returns
│   │   ├── bridge_scoring.py
│   │   ├── db.py                     # get_supabase() LRU singleton + db_execute helper
│   │   ├── encryption.py             # KEK/DEK + Fernet envelope
│   │   ├── exchange.py               # CCXT wrappers
│   │   ├── funding_fetch.py
│   │   ├── job_worker.py             # Per-kind handler dispatch + error classification
│   │   ├── key_permissions.py
│   │   ├── match_defaults.py, match_engine.py, match_eval.py
│   │   ├── metrics.py                # quantstats wrappers + sanitization
│   │   ├── portfolio_metrics.py, portfolio_optimizer.py, portfolio_risk.py
│   │   ├── position_reconstruction.py, positions.py
│   │   ├── reconciliation.py
│   │   ├── scheduled_tasks.py        # Ex-Vercel cron ticks for the worker
│   │   ├── simulator_scoring.py
│   │   └── transforms.py             # trades_to_daily_returns
│   ├── models/schemas.py             # Pydantic request/response models
│   ├── scripts/                      # Ops scripts (reset_stuck_computing_rows.py)
│   ├── supabase/                     # Python-side supabase helpers (if present)
│   └── tests/                        # ~40 pytest files mirroring services/ + routers/
│
├── supabase/
│   ├── migrations/                   # 58 numbered SQL files (001 → 058)
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_rls_policies.sql
│   │   ├── ...
│   │   ├── 032_compute_jobs_queue.sql
│   │   ├── 054_user_app_roles.sql    # RBAC join table
│   │   └── 058_log_audit_event_service.sql
│   └── functions/                    # Deno Edge Functions
│       ├── compute-trigger/index.ts  # Post-insert → FastAPI
│       └── notify-admin/index.ts     # Resend email dispatch
│
├── e2e/                              # Playwright specs (~20 files)
│   ├── auth.spec.ts, discovery.spec.ts, match-queue.spec.ts,
│   ├── wizard-sync-regression.spec.ts, strategy-detail-tabs.spec.ts,
│   └── ...
│
├── scripts/                          # Ops / seed / CI scripts
│   ├── seed-demo-data.ts
│   ├── seed-full-app-demo.ts
│   ├── backfill_funding.py
│   ├── build-security-packet.mjs     # Security packet PDF build
│   ├── check-banned-packages.mjs     # Supply-chain guard
│   └── check-gdpr-export-coverage.ts
│
├── docs/                             # Architecture + runbooks
│   ├── architecture/                 # ADR-0001 through ADR-0024
│   ├── runbooks/                     # compute-queue, vercel-cron-upgrade, soc2-readiness
│   ├── demos/                        # Demo scripts
│   ├── pitch/                        # Fundraise materials
│   ├── notes/
│   └── superpowers/{specs,plans}/
│
├── .github/workflows/
│   ├── ci.yml                        # Lint + typecheck + unit + e2e
│   └── nightly.yml                   # Demo PDF cold-start probe
│
├── public/                           # Static assets (.well-known, images, PDFs)
│
├── .planning/codebase/               # These docs (generated)
├── AGENTS.md                         # AI-agent conventions
├── CLAUDE.md                         # Claude-specific routing + skills
├── DESIGN.md                         # Design system tokens (brand, fonts, colors)
├── README.md
├── CHANGELOG.md
├── VERSION                           # Plain-text version (matches package.json)
├── TODOS.md
├── next.config.ts                    # Headers + rewrites (no experimental flags)
├── tsconfig.json                     # Strict, paths: "@/*" → "./src/*"
├── package.json                      # Next 16.2.3, React 19.2.4, Vitest, Playwright
├── eslint.config.mjs                 # eslint-config-next
├── vitest.config.ts                  # jsdom environment, src/**/*.test.{ts,tsx}
├── playwright.config.ts              # Chromium only, e2e/ testDir
├── postcss.config.mjs                # Tailwind v4
└── vercel.json                       # framework=nextjs + 2 crons
```

## Directory Purposes

**`src/app/`:**
- Purpose: Every URL the Next.js server responds to
- Contains: Server Components (`page.tsx`, `layout.tsx`), error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`), Route Handlers (`api/**/route.ts`)
- Key files: `src/app/layout.tsx` (root), `src/app/page.tsx` (home), `src/app/(dashboard)/layout.tsx` (authenticated chrome), `src/app/(auth)/layout.tsx` (login/signup shell)

**`src/app/(auth)/`:**
- Purpose: Unauthenticated shell (centered card layout) for login, signup, onboarding
- Contains: Three pages; no nested routes
- Key files: `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/onboarding/page.tsx`

**`src/app/(dashboard)/`:**
- Purpose: Authenticated surface — discovery, strategies, portfolios, allocations, admin, preferences, profile
- Contains: 17 top-level route segments; `admin/` sub-segment is RBAC-gated
- Key files: `src/app/(dashboard)/layout.tsx` (calls `isAdminUser` + allocator lookup, passes to `DashboardChrome`), `src/app/(dashboard)/admin/page.tsx` (admin landing)

**`src/app/api/`:**
- Purpose: JSON route handlers for client mutations, crons, and Supabase triggers
- Contains: 56 `route.ts` files organized by domain (strategies/, keys/, trades/, portfolio-*, admin/, cron/, alerts/, intro/, account/)
- Key files: `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/trades/upload/route.ts`, `src/app/api/admin/users/[id]/roles/route.ts`, `src/app/api/cron/warm-analytics/route.ts`

**`src/components/`:**
- Purpose: Reusable React components split by domain
- Contains: 18 subdirectories (`ui/` for primitives, `layout/` for chrome, plus domain buckets `admin/`, `portfolio/`, `strategy/`, `auth/`, etc.)
- Key files: `src/components/layout/DashboardChrome.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx`

**`src/lib/`:**
- Purpose: DAL, shared types, client factories, validation schemas, cross-cutting utilities
- Contains: Flat `.ts` files plus subdirs (`supabase/`, `api/`, `admin/`, `analytics/`, `intro/`, `wizard/`, `test-helpers/`)
- Key files: `src/lib/supabase/server.ts`, `src/lib/analytics-client.ts`, `src/lib/queries.ts`, `src/lib/auth.ts`, `src/lib/audit.ts`, `src/lib/types.ts`, `src/lib/csrf.ts`

**`src/hooks/`:**
- Purpose: Reusable client-side React hooks
- Contains: `useKeyboardShortcuts.ts`, `useMediaQuery.ts`
- Note: Feature-specific hooks are colocated (e.g. `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts`)

**`src/__tests__/`:**
- Purpose: Cross-cutting integration/regression tests that don't belong to a single module
- Contains: Audit coverage, RBAC matrix, GDPR export, banned-packages guard, critical regressions, seed integrity, Vercel cron limits
- Key files: `src/__tests__/rbac-matrix.test.ts`, `src/__tests__/critical-regressions.test.ts`, `src/__tests__/gdpr-export.test.ts`, `src/__tests__/vercel-cron-limits.test.ts`

**`analytics-service/`:**
- Purpose: Python FastAPI compute service deployed separately on Railway
- Contains: `main.py` (HTTP app), `main_worker.py` (queue worker), `routers/`, `services/`, `models/`, `tests/`, `scripts/`
- Key files: `analytics-service/main.py`, `analytics-service/main_worker.py`, `analytics-service/services/job_worker.py`, `analytics-service/services/encryption.py`, `analytics-service/models/schemas.py`

**`analytics-service/routers/`:**
- Purpose: FastAPI router per domain (one `APIRouter(prefix="/api")` each, plus `/internal`)
- Contains: `analytics.py`, `cron.py`, `exchange.py`, `internal.py`, `match.py`, `portfolio.py`, `simulator.py`
- Key files: Each router includes SlowAPI rate limits + Pydantic request validation

**`analytics-service/services/`:**
- Purpose: Pure business logic — no FastAPI deps, reusable from router + worker
- Contains: ~25 modules covering analytics, portfolio risk, match engine, exchange I/O, encryption, DB, audit
- Key files: `analytics-service/services/db.py`, `analytics-service/services/job_worker.py`, `analytics-service/services/analytics_runner.py`

**`analytics-service/tests/`:**
- Purpose: pytest specs mirroring `services/` + `routers/`
- Contains: ~40 test files (`test_analytics_runner.py`, `test_job_worker.py`, `test_encryption.py`, ...)
- Key files: `analytics-service/tests/conftest.py`, `analytics-service/pytest.ini`

**`supabase/migrations/`:**
- Purpose: Ordered SQL change log — single source of truth for schema + RLS + RPCs + pg_cron
- Contains: 58 numbered `.sql` files, each named `NNN_descriptive_name.sql`
- Key files:
  - `001_initial_schema.sql` — core tables
  - `002_rls_policies.sql` — RLS enablement
  - `020_profile_pii_revoke_hardened.sql` — REVOKE-then-GRANT PII pattern
  - `032_compute_jobs_queue.sql` — durable queue table + RPCs
  - `054_user_app_roles.sql` — RBAC join table
  - `058_log_audit_event_service.sql` — service-role audit RPC

**`supabase/functions/`:**
- Purpose: Deno Edge Functions for event-triggered work
- Contains: `compute-trigger/` (fires FastAPI on insert), `notify-admin/` (Resend email)
- Key files: `supabase/functions/compute-trigger/index.ts`

**`e2e/`:**
- Purpose: Playwright end-to-end specs (Chromium only)
- Contains: ~20 `.spec.ts` files per user journey
- Key files: `e2e/auth.spec.ts`, `e2e/wizard-sync-regression.spec.ts`, `e2e/match-queue.spec.ts`, `e2e/demo-public.spec.ts`

**`scripts/`:**
- Purpose: One-off ops + CI helpers (seed, backfill, security packet build, banned-package scan)
- Contains: 7 files (`.ts`, `.mjs`, `.py`)
- Key files: `scripts/seed-demo-data.ts`, `scripts/check-banned-packages.mjs`

**`docs/architecture/`:**
- Purpose: ADRs — retroactive and proposed architecture decisions
- Contains: 15 ADRs (`adr-0001-rls-primary-authorization.md` through `adr-0024-data-retention.md`, non-contiguous)
- Key files: `docs/architecture/adr-0003-three-client-supabase.md`, `docs/architecture/adr-0006-analytics-service-boundary.md`, `docs/architecture/adr-0017-deployment-topology.md`, `docs/architecture/adr-0022-two-layer-auth-gate.md`

**`docs/runbooks/`:**
- Purpose: Ops playbooks
- Contains: `compute-queue.md`, `vercel-cron-upgrade.md`, `security-packet-update.md`, `soc2-readiness.md`

**`.github/workflows/`:**
- Purpose: CI + scheduled probes
- Contains: `ci.yml` (lint + typecheck + unit + e2e), `nightly.yml` (demo PDF cold-start probe)

**`public/`:**
- Purpose: Static assets served at root
- Contains: Images, security.txt (via `.well-known/`), PDFs
- Generated: No
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/proxy.ts` — Next 16 middleware (renamed from `middleware.ts`)
- `src/instrumentation.ts` — Sentry init + `onRequestError` hook
- `src/app/layout.tsx` — Root HTML shell
- `src/app/page.tsx` — Marketing / home (redirects authed users)
- `analytics-service/main.py` — FastAPI HTTP entrypoint
- `analytics-service/main_worker.py` — Railway worker entrypoint (`python -m main_worker`)

**Configuration:**
- `next.config.ts` — Security headers (CSP, X-Frame-Options, Referrer-Policy), CDN cache rules, rewrites
- `vercel.json` — Framework stub + 2 cron schedules (Hobby-plan cap)
- `tsconfig.json` — Strict mode, `@/*` → `./src/*` path alias
- `vitest.config.ts` — jsdom environment, `src/**/*.test.{ts,tsx}` include
- `playwright.config.ts` — Chromium only, `e2e/` testDir, `webServer: npm run dev` local
- `eslint.config.mjs` — `eslint-config-next`
- `postcss.config.mjs` — Tailwind v4
- `analytics-service/railway.toml` — Railway deploy config
- `analytics-service/Dockerfile` — Container build
- `analytics-service/pytest.ini` — pytest config
- `.env.example` — Required env vars (not committed with values)

**Core Logic:**
- `src/lib/supabase/{client,server,admin}.ts` — Three Supabase client factories (ADR-0003)
- `src/lib/api/{withAuth,withAdminAuth}.ts` — Route wrappers
- `src/lib/auth.ts` — `withRole` RBAC wrapper + `getUserRoles` + `requireRole`
- `src/lib/analytics-client.ts` — Canonical FastAPI client
- `src/lib/queries.ts` — Cached read DAL (React `cache()` memoization)
- `src/lib/audit.ts` — Fire-and-forget audit emission
- `src/lib/csrf.ts` — `assertSameOrigin` defense
- `src/lib/ratelimit.ts` — Upstash rate limit tiers
- `src/lib/types.ts` — Core TS types (Profile, Strategy, Portfolio, DisclosureTier)
- `analytics-service/services/db.py` — Supabase service-role singleton
- `analytics-service/services/job_worker.py` — Per-kind dispatch + error classification
- `analytics-service/services/encryption.py` — KEK/DEK Fernet envelope

**Testing:**
- `src/test-setup.ts` — Vitest bootstrap (jsdom + `@testing-library/jest-dom`)
- `src/__tests__/` — Cross-cutting integration tests
- `analytics-service/tests/conftest.py` — pytest fixtures
- `src/lib/test-helpers/live-db.ts` — Live-DB test harness
- `e2e/` — Playwright specs
- Colocated: `src/**/*.test.{ts,tsx}` (e.g. `src/lib/auth.test.ts`, `src/lib/supabase/admin-users.test.ts`)

**Generated / Build artifacts (not committed):**
- `.next/` — Next build cache
- `node_modules/` — npm install
- `tsconfig.tsbuildinfo` — TS incremental build cache
- `playwright-report/`, `test-results/` — Playwright output
- `analytics-service/__pycache__/` — Python bytecode

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g. `DashboardChrome.tsx`, `PortfolioKPIRow.tsx`)
- Non-component TS modules: `kebab-case.ts` (e.g. `analytics-client.ts`, `timing-safe-compare.ts`)
- Page / layout / error / route: Next-mandated lowercase (`page.tsx`, `layout.tsx`, `error.tsx`, `route.ts`, `not-found.tsx`)
- Tests: colocated `<module>.test.ts[x]` for unit, `src/__tests__/*.test.ts` for integration, `e2e/*.spec.ts` for Playwright
- Python modules: `snake_case.py` (e.g. `job_worker.py`, `portfolio_risk.py`)
- SQL migrations: `NNN_snake_case_description.sql` (e.g. `054_user_app_roles.sql`); pad to 3 digits; rarely suffixed with letters (`047b_used_ack_tokens.sql`, `047c_severity_critical.sql`) when inserted between numbered migrations

**Directories:**
- Route groups (non-URL-affecting): `(lowercase-with-parens)` — e.g. `(auth)`, `(dashboard)`
- Dynamic segments: `[param]` or `[id]` (e.g. `portfolios/[id]`, `admin/users/[id]`)
- Feature directories: `kebab-case/` or single-word (`admin/`, `portfolios/`, `for-quants-leads/`)
- Component subdirectories: single noun plural (`components/portfolio/`, `components/strategy/`)
- Colocated app feature dirs: `components/`, `hooks/`, `lib/`, `widgets/` inside the route segment (e.g. `src/app/(dashboard)/allocations/components/`)

**Environment variables:**
- Public: `NEXT_PUBLIC_*` prefix (exposed to browser)
- Server-only: no prefix (e.g. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANALYTICS_SERVICE_KEY`, `SERVICE_KEY`, `INTERNAL_API_TOKEN`)

## Where to Add New Code

**New authenticated page:**
- Location: `src/app/(dashboard)/<feature>/page.tsx` (+ `layout.tsx` if section-specific chrome)
- Pattern: Async Server Component. First call: `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();` — redirect if null. Then RLS-scoped reads.
- If page needs admin-only access: add path under `/admin/**` and let `proxy.ts` email allowlist + `isAdminUser()` gate it.

**New client-side interactive UI:**
- Location: Either `src/components/<domain>/<PascalName>.tsx` (reused) or colocated next to the page (feature-owned)
- Pattern: Start file with `'use client'`. Fetch data via the parent Server Component's props, not inside the client.

**New API endpoint:**
- Location: `src/app/api/<domain>/[<optional-dynamic>/]route.ts`
- Pattern:
  ```ts
  export const POST = withAuth(async (req, user) => {
    const rl = await checkLimit(userActionLimiter, `key:${user.id}`);
    if (!rl.success) return NextResponse.json({...}, { status: 429 });
    // ... handler
    logAuditEvent(supabase, { action: "x.verb", entity_type: "x", entity_id, metadata });
    return NextResponse.json({ ok: true });
  });
  ```
- For admin routes: wrap with `withAdminAuth` instead; handler receives `(body, admin)`.
- For RBAC routes: wrap with `withRole("admin", ...)` from `src/lib/auth.ts`; handler receives `(req, { user, roles, supabase, params })`.

**New mutation that calls the analytics service:**
- Call via `src/lib/analytics-client.ts` — never inline `fetch(ANALYTICS_URL)`. If a new endpoint is needed, add a function there and a Zod schema in `src/lib/analytics-schemas.ts`.

**New background compute job:**
- Add table + RPCs via a new migration `supabase/migrations/NNN_description.sql`.
- Add a handler to `analytics-service/services/job_worker.py` keyed by a new `kind` string.
- Set a timeout in `TIMEOUT_PER_KIND`; add matching `WATCHDOG_PER_KIND_OVERRIDES` entry in `analytics-service/main_worker.py`.
- Enqueue by writing a `compute_jobs` row from a route handler or RPC.

**New Supabase migration:**
- Location: `supabase/migrations/NNN_description.sql` where `NNN` = next integer (currently 059)
- Template: `BEGIN; ... COMMIT;` transaction. Always `ENABLE ROW LEVEL SECURITY` on new tables + add explicit policies. Use REVOKE-ALL-then-GRANT-BACK pattern (migration 020) for column-level PII.
- Reference: Check `CHANGELOG.md` for the expected format to document the migration.

**New React component / design-system primitive:**
- Generic primitive: `src/components/ui/<PascalName>.tsx`
- Domain component: `src/components/<domain>/<PascalName>.tsx`
- Always read `DESIGN.md` before introducing visual choices.

**Shared DAL helper:**
- Location: `src/lib/<kebab-name>.ts`
- If the helper reads DB data that other Server Components also need, add it to `src/lib/queries.ts` and wrap with `cache()`.
- Mark with `import "server-only";` if it uses admin client or `next/headers`.

**Shared TS types:**
- Location: `src/lib/types.ts` for cross-cutting domain types; feature-scoped types colocated with the feature (e.g. `src/app/(dashboard)/allocations/lib/types.ts`).

**Cron job:**
- Time-based Next cron: add `src/app/api/cron/<name>/route.ts` + entry in `vercel.json` `crons`. Cap = 2 on Hobby plan; additional cron work lives in `analytics-service/main_worker.py` as a `_scheduled_daily_loop` tick.
- Cross-service orchestration: use Supabase `pg_cron` via a migration calling FastAPI with `pg_net` (see `supabase/migrations/013_cron_heartbeat.sql` for the pattern).

**Test file placement:**
- Unit tests for `src/lib/x.ts` → `src/lib/x.test.ts` (colocated)
- Unit tests for a route → `src/app/api/.../route.test.ts` (colocated)
- Integration tests that span modules → `src/__tests__/<name>.test.ts`
- Python tests → `analytics-service/tests/test_<module>.py` (mirrors `services/<module>.py`)
- E2E tests → `e2e/<journey>.spec.ts`

## Special Directories

**`.planning/` and `.claude/`:**
- Purpose: Local tooling scratch space (GSD planning, Claude skill caches)
- Generated: Yes (gitignored)
- Committed: No

**`node_modules/`:**
- Purpose: npm dependency tree
- Generated: Yes (`npm install`)
- Committed: No

**`public/`:**
- Purpose: Static assets served at Next.js root
- Generated: No (hand-authored — images, PDFs, `.well-known/security.txt`)
- Committed: Yes

**`.next/`, `tsconfig.tsbuildinfo`, `playwright-report/`, `test-results/`:**
- Purpose: Build artifacts + test output
- Generated: Yes
- Committed: No

**`audit/`:**
- Purpose: Audit + security review notes
- Generated: No
- Committed: Yes

**Root PNG files (`fxblue-*.png`, `tradelink-*.png`):**
- Purpose: Competitor reference screenshots captured during design work
- Generated: No (design-review artifacts)
- Committed: Yes

---

*Structure analysis: 2026-04-17*
