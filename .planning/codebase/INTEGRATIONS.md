# External Integrations

**Analysis Date:** 2026-04-17

## APIs & External Services

**Crypto exchanges (read-only trade/balance fetch):**
- Binance, OKX, Bybit — the supported set is the literal map `EXCHANGE_CLASSES` in `analytics-service/services/exchange.py`, mirrored as `SUPPORTED_EXCHANGES` in `src/lib/utils.ts`
  - SDK: `ccxt>=4.0` async (`import ccxt.async_support as ccxt`)
  - Credentials: per-user `api_keys` row, envelope-encrypted at rest with Fernet (KEK+DEK). Passphrase is OKX-only.
  - Enforced read-only at ingestion — see `validate_key_permissions` + `services/key_permissions.py`

**Transactional email:**
- Resend — `src/lib/email.ts` constructs a `new Resend(process.env.RESEND_API_KEY)` singleton; fallback to `null` when env missing so sends silently no-op.
  - Retry ladder: 3 attempts with 500ms/1000ms/2000ms exponential backoff; every send writes an audit row to `notification_dispatches` (migration 018)
  - Supabase Edge Function `supabase/functions/notify-admin/index.ts` also calls the Resend REST API directly (`https://api.resend.com/emails`) for DB-trigger-originated admin notifications
  - Dispatch categories enumerated in `NotificationType` union (`src/lib/email.ts`): `manager_intro_request`, `manager_approved`, `allocator_intro_status`, `allocator_intro_request`, `allocator_admin_intro`, `manager_admin_intro`, `founder_new_strategy`, `founder_intro_request`, `founder_generic`, `alert_digest`

**Product analytics (dual-tier):**
- PostHog (capture path) — `posthog-js` on the client (`src/lib/analytics/usage-events-client.ts`, `src/lib/for-quants-analytics.ts`) and `posthog-node` on the server (`src/lib/analytics.ts`, `src/lib/analytics/usage-events.ts`), both gated on `NEXT_PUBLIC_POSTHOG_KEY`
  - Host: `NEXT_PUBLIC_POSTHOG_HOST` — defaults `https://us.i.posthog.com`
  - Server client uses `flushAt: 1, flushInterval: 0` so Vercel fluid-compute suspension doesn't drop events
- PostHog (query path) — `src/lib/admin/usage-metrics.ts` posts HogQL queries to `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/` using a separate `POSTHOG_API_KEY` personal-API-key; default host is `https://us.posthog.com` (note missing `i.`)
  - Resilience: 10s timeout per request, 1 retry on 5xx, 5-minute LRU last-known-good cache (`CACHE_MAX_ENTRIES = 50`)
- Plausible (lightweight pageview) — `src/app/layout.tsx` conditionally renders `<Script src="https://plausible.io/js/script.tagged-events.js">` when `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is set

**Error tracking:**
- Sentry (Next.js) — `@sentry/nextjs` initialized via `src/instrumentation.ts` (`register` hook) and `onRequestError` hook for Next 16 route errors. `tracesSampleRate: 0.1`, environment pulled from `VERCEL_ENV`.
- Sentry (Python) — optional lazy import in `analytics-service/main.py`: imports `sentry_sdk` only if `SENTRY_DSN` is set, logs a warning if the package is missing. Same `traces_sample_rate=0.1`, `send_default_pii=False`.

**Rate limiting:**
- Upstash Redis — `src/lib/ratelimit.ts` creates sliding-window limiters via `@upstash/ratelimit`. Uses `Ratelimit.slidingWindow` with prefix `"quantalyze"`. Named limiters: `userActionLimiter` (5/min), `publicIpLimiter` (10/min), `adminActionLimiter` (20/min), `simulatorLimiter` (20/hour), `exportLimiter` (1/day). Fails open when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` missing (dev-friendly, logs single startup warning).
- slowapi — Python-side per-route limiting in `analytics-service/main.py` (`Limiter(key_func=get_remote_address)`), attached via FastAPI `@limiter.limit("N/window")` decorators (e.g. `10/hour` on compute-analytics, `100/hour` on validate-key)

**PDF rendering (headless Chromium):**
- Puppeteer — `puppeteer-core` + `@sparticuz/chromium` (serverless Chrome build for Lambda/Vercel), local fallback to system Chrome. See `src/lib/puppeteer.ts` — 10s launch timeout, 15s per-page timeout, module-level semaphore caps in-flight lambdas at `MAX_CONCURRENT_PDFS = 2` with a 15s queue timeout.
- Token-gated render: public `/portfolio-pdf/[id]` Server Component verifies short-lived HMAC render token (`src/lib/pdf-render-token.ts`, 2-minute TTL) signed with `DEMO_PDF_SECRET`

**Scheduling link:**
- Calendly (or similar) — `src/components/strategy/BookIntroCall.tsx` reads `NEXT_PUBLIC_SCHEDULING_URL` and opens it as the primary "Book intro call" CTA; `.env.example` uses `https://calendly.com/your-team/intro-call` as the placeholder

**Analytics microservice (internal):**
- Railway-hosted FastAPI at `ANALYTICS_SERVICE_URL` — Next.js calls via `src/lib/analytics-client.ts` (30s default timeout, `X-Service-Key` auth, `X-Api-Version: 1` contract header). Endpoints: `/api/compute-analytics`, `/api/fetch-trades`, `/api/validate-key`, `/api/encrypt-key`, `/api/portfolio-analytics`, `/api/portfolio-optimizer`, `/api/portfolio-bridge`, `/api/simulator`, `/api/verify-strategy`, `/api/match/recompute`, `/api/match/eval`
- A second internal-only surface lives under `/internal/*` (gated by `X-Internal-Token` via `secrets.compare_digest`) — e.g. `POST /internal/keys/{key_id}/permissions` consumed by `src/app/api/keys/[id]/permissions/route.ts`

## Data Storage

**Databases:**
- Supabase Postgres (managed) — single project hosts all app data
  - Connection (Next.js): `@supabase/ssr` server client and browser client (`src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`) + service-role admin client (`src/lib/supabase/admin.ts`). See ADR-0003 (three-client pattern).
  - Connection (Python): `supabase-py==2.15.1` via `services/db.py` — `lru_cache(maxsize=1)` singleton, calls wrapped in `asyncio.to_thread` to keep the event loop free.
  - Schema: 58 sequential migrations in `supabase/migrations/` (001_initial_schema.sql through 058_log_audit_event_service.sql)
  - Extensions: `pg_cron`, `pg_net` — used for scheduled hourly match recompute calling Railway via HTTP
  - Primary authorization: Row-Level Security (ADR-0001). Column-level REVOKE on `api_keys` encrypted columns (migration 027).

**File storage:**
- Supabase Storage — used for `gdpr-exports` bucket (see `supabase/migrations/055_sanitize_user.sql` context); avatars and partner logos mentioned in type definitions

**Caching:**
- Upstash Redis — rate-limit counters only (no KV caching for data)
- Next.js `unstable_cache` — wraps upstream permission fetches (`src/app/api/keys/[id]/permissions/route.ts` with 60s revalidate, tagged `key-permissions:${keyId}`)
- In-memory per-lambda LRU (`src/lib/admin/usage-metrics.ts`) — 5-minute last-known-good PostHog responses
- Python in-memory TTL cache — key permissions cached 15min by default (`KEY_PERMISSION_CACHE_TTL`)

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (email+password based on `src/app/(auth)/` routes) — proxy middleware (`src/proxy.ts`) gates every non-public route
  - Session check uses `auth.getSession()` (cookie-only, optimistic); authoritative checks use `auth.getUser()` inside DAL/route handlers
  - Public routes whitelist: `["/login", "/signup", "/strategy", "/factsheet", "/api/factsheet", "/browse", "/api/keys", "/api/trades", "/api/verify-strategy", "/api/alert-digest", "/portfolio-pdf", "/legal", "/demo", "/api/demo", "/for-quants", "/api/for-quants-lead", "/security"]`
  - Admin gate: legacy email match via `ADMIN_EMAIL` OR `profiles.is_admin` DB column (`src/lib/admin.ts::isAdminUser`). New RBAC layer in `src/lib/auth.ts::withRole` reads from `user_app_roles` join table (migration 054) with roles `'admin' | 'allocator' | 'quant_manager' | 'analyst'`.
  - Route-handler wrappers: `withAuth` (`src/lib/api/withAuth.ts`), `withAdminAuth` (`src/lib/api/withAdminAuth.ts`), `withRole` (`src/lib/auth.ts`) — all apply CSRF origin check on mutating methods via `assertSameOrigin`

**Defense-in-depth:**
- CSRF Origin/Referer allowlist in `src/lib/csrf.ts`; hosts derived from `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_VERCEL_URL` (preview), plus localhost outside prod
- Supabase cookies default to `SameSite=Lax`

## Monitoring & Observability

**Error Tracking:**
- Sentry (Next.js + FastAPI) — see Integrations above

**Logs:**
- Console logs — structured at the call site, downstream captured by Vercel / Railway
- Python logger name: `"quantalyze.analytics"` (configured at module top of every router/service)
- Audit log — `audit_log` table (migration 010) with append-only RLS invariant (migration 049); 2y → cold archive → 7y purge via `audit_log_cold` table (migration 056)
- Notification dispatch audit — `notification_dispatches` table (migration 018); 180-day retention cron
- Cron heartbeat — `cron_runs` table (migration 013); `latest_cron_success()` function surfaces staleness

**Sentinels/probes:**
- `/api/cron/warm-analytics` proxies `/health` from Railway and returns 502/504 on upstream failure so Vercel Cron history turns red on outage
- `.github/workflows/nightly.yml` — runs Playwright `portfolio-pdf-demo.spec.ts @nightly` against staging and auto-files a GitHub issue (labels `nightly-probe`, `p0`) on failure

## CI/CD & Deployment

**Hosting:**
- Vercel — Next.js frontend. `vercel.json` declares framework, build command, and crons.
- Railway — FastAPI analytics service and durable worker (two services, same Docker image, different `CMD` overrides). `analytics-service/railway.toml` configures `/health` healthcheck.
- Supabase — database, auth, storage, edge functions.

**CI Pipeline:**
- GitHub Actions — `.github/workflows/ci.yml` runs on every push to `main` and every PR
  - `frontend` job: `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `scripts/check-banned-packages.mjs`, `npx tsx scripts/check-gdpr-export-coverage.ts`, `npm audit --audit-level=critical`, `npm run build` (with placeholder Supabase URL)
  - `secret-scan` job: `gitleaks/gitleaks-action@v2` with `.gitleaks.toml` extension
  - `docs-link-check` job: `lycheeverse/lychee-action@v2` `--offline` on `docs/runbooks/**/*.md`
  - `python` job: `pip install -r requirements.txt pytest pytest-cov pytest-asyncio pytest-mock cryptography`, then `pytest --cov=services --cov-report=term-missing --cov-fail-under=80`
  - `e2e` job: Chromium Playwright against a placeholder-env `npm run build && npm run start`, scope limited to `auth.spec.ts smoke.spec.ts demo-public.spec.ts demo-founder-view.spec.ts`
- `.github/workflows/nightly.yml` — daily 08:00 UTC demo-PDF cold-start probe

## Environment Configuration

**Required env vars:**
See STACK.md "Configuration → Required envs" for the full list. Canonical reference is `.env.example` (32 lines, committed, uses placeholders).

**Secrets location:**
- Vercel env UI (frontend + cron secrets)
- Railway env UI (analytics service, worker, KEK)
- Postgres GUCs (`app.analytics_service_url`, `app.analytics_service_key`, `app.admin_email`) for pg_cron-originated calls
- Local: `.env.local` (gitignored)
- See ADR-0014 (secret handling) for the three-class taxonomy: platform / service-to-service / data-protection

## Webhooks & Callbacks

**Incoming (inbound HTTP triggered externally):**
- Vercel Cron → `src/app/api/cron/warm-analytics/route.ts` (schedule `0 0 * * *`, registered in `vercel.json`) — analytics service health ping
- Vercel Cron → `src/app/api/alert-digest/route.ts` (schedule `0 9 * * *`, registered in `vercel.json`) — daily digest fan-out of unacked portfolio alerts
- Vercel Cron → `src/app/api/cron/sync-funding/route.ts` (every 4 hours, registered in Vercel dashboard — path referenced in code comment) — enqueue `sync_funding` compute_jobs for perp exchanges
- Vercel Cron → `src/app/api/cron/reconcile-strategies/route.ts` (`30 3 * * *`) — nightly two-sided reconciliation
- Vercel Cron → `src/app/api/cron/cleanup-ack-tokens/route.ts` (Sundays `0 3 * * 0`) — delete used_ack_tokens rows >30 days
- All Vercel Cron handlers gate on `Authorization: Bearer ${CRON_SECRET}` using `safeCompare` (timing-safe) from `src/lib/timing-safe-compare.ts`
- Note: `vercel.json` only declares 2 of the 5 crons above — the others are registered via the Vercel dashboard. Hobby-plan cron cap trim is noted in recent commit `786e6c7`.

**pg_cron jobs (registered in Postgres, not Vercel):**
- `match_engine_cron` — `0 * * * *` (hourly), calls `${app.analytics_service_url}/api/match/cron-recompute` via `net.http_post` with `X-Service-Key` from GUC (migration 015)
- `audit_log_hot_to_cold` — `0 3 * * *`, CTE DELETE+INSERT into `audit_log_cold` (migration 056)
- `audit_log_cold_purge` — `5 3 * * *`, DELETE rows >7y (migration 056)
- `retention_notification_dispatches` — `10 3 * * *`, 180-day purge (migration 056)
- `retention_compute_jobs_done` — `20 3 * * *`, 30-day purge (migration 056)
- `retention_compute_jobs_failed` — `30 3 * * *`, 90-day purge (migration 056)
- `api_key_rotation_reminder` — `0 4 * * *`, enqueue `notification_dispatches` for keys >90d old (migration 056)

**Supabase Edge Functions (Deno):**
- `supabase/functions/compute-trigger/index.ts` — invoked by Supabase database triggers; verifies bearer is `SUPABASE_SERVICE_ROLE_KEY`, then POSTs `${ANALYTICS_SERVICE_URL}/api/compute-analytics` with `X-Service-Key`
- `supabase/functions/notify-admin/index.ts` — POSTs to `https://api.resend.com/emails` directly with `RESEND_API_KEY` bearer; supports `type: "intro_request"` and `type: "strategy_review"` payloads with HTML-escape helper `esc()`

**Outgoing (our service calling external):**
- Resend REST API — `https://api.resend.com/emails` (via `resend` SDK from `src/lib/email.ts` and raw fetch from `supabase/functions/notify-admin/index.ts`)
- PostHog — capture (`https://us.i.posthog.com`) and query (`https://us.posthog.com/api/projects/*/query/`)
- Plausible — `https://plausible.io/js/script.tagged-events.js` (script-tag loaded, no server-side call)
- CCXT to Binance/OKX/Bybit — per-request during trade sync and key validation (Python service only; Next.js never holds exchange credentials in plaintext)
- Railway analytics service — `${ANALYTICS_SERVICE_URL}/api/*` and `/internal/*` from `src/lib/analytics-client.ts` and `src/app/api/keys/[id]/permissions/route.ts`
- Supabase database (REST / PostgREST) — via `@supabase/ssr` and `@supabase/supabase-js`

**No payments integration detected.** No Stripe, no PayPal, no AWS services — the "Book intro call" button links to an external scheduling URL.

---

*Integration audit: 2026-04-17*
