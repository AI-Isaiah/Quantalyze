# System-design audit — round 1
Date: 2026-04-10
Scope: gap analysis of live system architecture, reliability, scale, boundaries.

## Summary

Quantalyze is a two-tier system: a Next.js 16 / Vercel frontend fronting Supabase (Postgres + Auth + RLS + Storage) and a separate Python/FastAPI analytics service on Railway, with Upstash rate limiting, Resend email and Puppeteer/@sparticuz/chromium PDF generation layered on top. The recent hardening sprints have produced genuinely senior-grade work on the **edges that were looked at**: self-verifying PII revoke migrations (020), SECURITY DEFINER RPC lockdown (021), CSRF defense-in-depth on two POST routes, per-lambda Puppeteer semaphore + launch timeout, Upstash rate limiters on public PDF routes, a constant-time cron auth, and a warmup probe with swallowed rejections. The system is early-stage and low-volume, so most of this audit is about latent risks that will bite well before "institutional scale" arrives.

The **biggest weaknesses**, in order of severity:

1. The seam to the Python analytics service (`src/lib/analytics-client.ts`) has **no fetch timeout, no retries, no circuit breaker, and no contract versioning**. A single hung Railway request will hold a Vercel lambda open until the platform kills it, and the `/api/keys/sync`, `/api/admin/match/*`, and `/api/verify-strategy` routes will cascade-500 on any Railway hiccup.
2. The `warm-analytics` Vercel Cron was **removed from `vercel.json` on 2026-04-09** ("drop */5 warm-analytics cron to unblock Hobby-tier deploy") but the route, the runbook, the README and the warmup helper all still assume it exists — every forwarded demo URL is now exposed to Railway cold starts and there is no Vercel Cron at all registered (`crons` is absent from `vercel.json`).
3. Rate limiting is present as infrastructure but **only applied to 6 routes** — attestation, deletion-request, and the four PDF routes. The authenticated routes that call the Python service (`verify-strategy`, `keys/sync`, `keys/validate`, `keys/encrypt`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro`) are unlimited and can burn arbitrary Vercel + Railway + Supabase quota.
4. **There is no production error telemetry** — no Sentry, no OpenTelemetry, no logging sink. `.env.example` has a `NEXT_PUBLIC_SENTRY_DSN` slot but nothing in `src/` references it; `analytics-service/main.py` conditionally imports `sentry_sdk` but the package is not in `requirements.txt` so the import branch silently no-ops. Every production error falls into `console.error` on Vercel logs with no alerting.
5. **Auth is RLS-only** on several sensitive write paths. `/api/intro` inserts a `contact_request` via the user-scoped client and relies entirely on RLS for ownership enforcement. `/api/preferences` upsert on `allocator_preferences` relies on RLS alone. A single broken policy rewrites the security boundary.
6. The **`alert-digest` route has no Vercel Cron** entry either, despite being authenticated by `CRON_SECRET`. It is effectively a dead endpoint unless manually triggered.
7. **E2E coverage in CI is limited to 4 specs** (auth, smoke, demo-public, demo-founder-view). `match-queue.spec.ts`, `sync-analytics-flow.spec.ts`, `api-key-flow.spec.ts`, and `full-flow.spec.ts` are excluded because CI has no seeded Supabase. All critical business paths are untested end-to-end in CI.
8. The **match engine cron runs inside Supabase Postgres via `pg_cron` + `pg_net.http_post`** (migration 013/015) which makes the Railway URL + service key part of DB state, is invisible in the Vercel or Railway dashboards, and makes the `cron_runs` heartbeat + `latest_cron_success()` the only visibility surface.

## Current architecture snapshot

```
                             ┌───────────────────────────┐
                             │   Browser (allocator or   │
                             │   manager or founder)     │
                             └──────────────┬────────────┘
                                            │ HTTPS + Supabase
                                            │ SSR cookies
                                            ▼
           ┌──────────────────────────────────────────────────────┐
           │               Next.js 16 (Vercel)                    │
           │                                                      │
           │  ┌────────────────┐     ┌─────────────────────────┐  │
           │  │  src/proxy.ts  │────▶│ route handlers + server │  │
           │  │  (middleware)  │     │ components              │  │
           │  └────────────────┘     └─────────────────────────┘  │
           │           │                     │                    │
           │           │ Supabase            │ analyticsRequest() │
           │           │ cookie + JWT        │ (no timeout)       │
           │           │ session check       │                    │
           └───────────┼─────────────────────┼────────────────────┘
                       │                     │
                       │                     │ X-Service-Key
                       │                     │ HTTPS
                       │                     ▼
                       │       ┌──────────────────────────────┐
                       │       │  Python FastAPI (Railway)    │
                       │       │                              │
                       │       │  routers/analytics           │
                       │       │  routers/portfolio           │
                       │       │  routers/exchange (CCXT)     │
                       │       │  routers/match               │
                       │       │  routers/cron                │
                       │       │  services/encryption (KEK)   │
                       │       └────────┬─────────────────────┘
                       │                │ supabase-py (service role)
                       │                │ + CCXT → exchanges
                       ▼                ▼
           ┌──────────────────────────────────────────────────────┐
           │    Supabase (Postgres + Auth + RLS + Storage)        │
           │                                                      │
           │  migrations 001 … 026                                │
           │  pg_cron schedule ──┐                                │
           │  pg_net http_post ──┼──▶ Railway /api/match/cron-    │
           │  cron_runs heartbt  │    recompute  (01:00 UTC,      │
           │                     │    hourly since mig 015)       │
           │  auth.users + profiles.is_admin                      │
           │  RLS on every surface                                │
           └──────────────────────────────────────────────────────┘

  Side paths:
    ─ Upstash Redis (@upstash/ratelimit)      — 6 routes only
    ─ Resend (email)                          — fire-and-forget, no retry/DLQ
    ─ @sparticuz/chromium + puppeteer-core    — per-lambda semaphore of 2
    ─ Plausible (analytics, optional)         — src/app/layout.tsx
```

**Data flow: exchange → analytics → UI**
1. Allocator uploads a read-only exchange API key via `/api/keys/validate-and-encrypt`. The Next.js route fetches the Python service twice (validate, then encrypt), no timeout.
2. The Python service (`services/exchange.py` + CCXT) validates permissions and encrypts the secret with a KEK (`KEK`, `KEK_VERSION` env on Railway).
3. The encrypted blob is persisted back to `api_keys` via service role.
4. Daily (or ad-hoc) `/api/cron-sync` on Railway decrypts + pulls trades via CCXT in batches of 5 per exchange, writes to `trades`, recomputes analytics, and cascades to affected portfolios.
5. Reads flow: UI → Next.js server component → Supabase direct for most tables; `strategy_analytics.daily_returns` is admin-client only (column-level revoked in migration 010); `portfolio_analytics` is user-scoped through the `portfolios.user_id` RLS chain.

**Match engine path**
- Cron runs from inside Postgres (migration 013 → 015 hourly) via `pg_net.http_post` to `$analytics_service_url/api/match/cron-recompute` with `X-Service-Key`.
- Next.js `/api/admin/match/*` routes are thin admin-gated proxies over the same Python endpoints.
- `/api/demo/match/[allocator_id]` is a parallel public lane hard-locked to one seed UUID, sharing `src/lib/admin/match.ts::getAllocatorMatchPayload`.

**PDF pipeline**
- Four routes (`/api/factsheet/[id]/pdf`, `/api/factsheet/[id]/tearsheet.pdf`, `/api/portfolio-pdf/[id]`, `/api/demo/portfolio-pdf/[id]`).
- Each acquires an in-lambda semaphore slot (`MAX_CONCURRENT_PDFS = 2`, 15s queue timeout), launches Chromium with a 10s launch timeout, navigates to a Next.js printable page (25s), and returns the PDF with differing cache policies.
- Upstream IP rate limit via Upstash before anything expensive runs.
- Demo PDF route adds HMAC token verification + portfolio allowlist.

## Findings

### [SD-CRITICAL-01] analytics-client has no timeout, retry, or circuit breaker
- **Priority**: Critical
- **Category**: reliability / boundaries
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/analytics-client.ts`
- **What's wrong**: `analyticsRequest()` calls `fetch()` with **no AbortSignal**. The function catches only synchronous network errors (`try/catch` around the `fetch` call) and re-throws a generic "Analytics service is not reachable" message. There is no timeout, no retry, no backoff, no circuit breaker, no contract versioning in URL or header. Callers in `src/app/api/keys/sync/route.ts`, `src/app/api/keys/validate-and-encrypt/route.ts`, `src/app/api/keys/encrypt/route.ts`, `src/app/api/keys/validate/route.ts`, `src/app/api/admin/match/recompute/route.ts`, and `src/app/api/verify-strategy/route.ts` all `await` through this helper. The one route that DID add timeout handling (`src/app/api/portfolio-optimizer/route.ts`) copy-pasted its own `fetch` with `signal: AbortSignal.timeout(60000)` instead of going through the helper — evidence that the helper's lack of a timeout was felt but never fixed at the source.
- **What could break**: if Railway cold-starts or any request takes >10s to return headers, the Vercel lambda blocks until platform timeout (10s default, up to 60s paid tier) and returns 504. The surface of ANY UI that calls `keys/sync`, the match admin queue recompute, or the allocator "validate and encrypt" flow all hang. On a Railway partial outage (e.g., 20s tail latency) the entire admin match workflow becomes unusable and the UI shows a generic "Sync failed". A single misbehaved Railway worker can cause cascade failures across all these routes.
- **Proposed fix**: add `AbortSignal.timeout(8_000)` (or a per-operation override) inside `analyticsRequest()`, standardize the error shape so callers can distinguish timeout / 5xx / 4xx / unreachable, add a simple retry (1 retry with 500ms jitter backoff) for idempotent GET-equivalent ops, and add an `X-Client-Version` header so the analytics service can fail fast on contract drift. Remove the duplicated fetch in `portfolio-optimizer/route.ts` once the helper has first-class timeout support. Consider a lightweight circuit breaker (open after 5 consecutive failures, close after 30s success) but that can come in a follow-up.
- **Effort**: small
- **Scope-excluded?**: no

### [SD-CRITICAL-02] Vercel Cron warm-analytics was silently dropped; there are NO Vercel Crons registered
- **Priority**: Critical
- **Category**: reliability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/vercel.json`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/cron/warm-analytics/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/alert-digest/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/README.md` (line 57: `cron/ # Vercel Cron handlers (warm-analytics)`), `/Users/helios-mammut/claude-projects/quantalyze/docs/runbooks/match-engine.md`
- **What's wrong**: `vercel.json` contains only `framework`, `buildCommand`, and `installCommand` — no `crons` array. Git history shows commit `81493af chore(vercel): drop */5 warm-analytics cron to unblock Hobby-tier deploy` landed before the hardening sprints. The warm-analytics route still exists and documents itself as a Vercel Cron target ("Vercel Cron — pings the Python analytics service /health every 5 minutes"), and `src/lib/warmup-analytics.ts` is invoked from pages on the assumption that the cron is the belt and the per-request warmup is the suspenders. With no cron registered, the per-request warmup is the ONLY warmup path, and it's fire-and-forget with a 2s timeout. That is not a warmup — that's a loud 2s "I hope you were already warm."
- Additionally: `/api/alert-digest` is gated by `CRON_SECRET` and is clearly designed to be called by a cron, but it is neither in `vercel.json` nor in any `pg_cron` schedule. The route will ONLY run if manually curled with the bearer token. Operators would have no idea.
- **What could break**:
  - The forwarded demo URL (the entire cap-intro go-to-market) hits a cold Railway worker every time, and the per-request warmup cannot close a 5–15s cold-start gap within its 2s budget.
  - The portfolio alert digest never fires. Portfolio alerts accumulate with `emailed_at IS NULL` forever.
  - The `match_engine_cron` in `pg_cron` may or may not be running depending on whether `app.analytics_service_url` + `app.analytics_service_key` were set in the production DB — an auditor can't tell from `vercel.json`.
- **Proposed fix**: either re-add the warm-analytics cron to `vercel.json` (upgrade to Pro plan as planned or use a less aggressive schedule like */15 min) AND add the alert-digest cron, OR remove the route + its runbook entries entirely. The current state — route exists, runbook references it, README documents it, no schedule — is the worst of both worlds. Verify via Supabase `SELECT jobname, schedule FROM cron.job` whether `match_engine_cron` is actually scheduled in prod. Document the status of every cron surface in one place (e.g., `docs/runbooks/crons.md`).
- **Effort**: small
- **Scope-excluded?**: no

### [SD-CRITICAL-03] No production error telemetry (Sentry / OTel / anything)
- **Priority**: Critical
- **Category**: observability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src` (no Sentry import found), `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/main.py` (lines 15–26: conditional `sentry_sdk` import), `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/requirements.txt` (no sentry-sdk entry), `/Users/helios-mammut/claude-projects/quantalyze/.env.example` (has `NEXT_PUBLIC_SENTRY_DSN` slot that nothing consumes)
- **What's wrong**: The Next.js app has `NEXT_PUBLIC_SENTRY_DSN` in `.env.example` but no Sentry SDK anywhere in `src/`. The analytics service imports `sentry_sdk` inside an `if SENTRY_DSN:` block but the package is not in `requirements.txt`, so `except ImportError` swallows it silently and production has zero Python traces. Every production exception falls into `console.error` on Vercel logs (retained for days on Hobby plan, not indexed) and the FastAPI equivalent on Railway. No alerting means the founder finds out about outages from users.
- **What could break**: a 500 on `/api/intro`, `/api/factsheet/.../pdf`, or the match engine recompute is invisible until a user complains. The PII revoke migrations were self-verifying precisely because nobody would catch a silent regression — that pattern needs to extend to runtime. The whole audit trail in `notification_dispatches` (migration 018) is also a "grep for stuck rows" monitoring surface, which means nobody is monitoring it.
- **Proposed fix**: add `@sentry/nextjs` (or equivalent) and initialize in a `sentry.client.config.ts` + `sentry.server.config.ts`. Add `sentry-sdk[fastapi]` to `requirements.txt`. Wire the DSN in Vercel + Railway env. Set up Slack alerts on anything at severity = error. At minimum, if Sentry is out of budget, use Vercel's built-in log drains to Datadog or Axiom, and add a Supabase scheduled query + webhook that alerts on `notification_dispatches.status = 'failed'` > 0 in the last hour.
- **Effort**: small–medium
- **Scope-excluded?**: no

### [SD-HIGH-01] Rate limiting is infrastructure-only on most routes
- **Priority**: High
- **Category**: reliability / security
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/ratelimit.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/keys/*`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/verify-strategy/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/admin/match/recompute/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/admin/partner-import/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/trades/upload/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/intro/route.ts`
- **What's wrong**: `checkLimit` is only called from `attestation`, `account/deletion-request`, and the four PDF routes. Every other POST — including authenticated ones that proxy to Railway, accept 50,000-row trade uploads, or trigger emails — has no rate limit. `verify-strategy` has its own in-route 24h-per-email limit via `verification_requests` but ALSO calls Railway (which is an expensive CCXT validation path) with no per-IP rate limit. `/api/admin/partner-import` can import 100+ rows and calls GoTrue `admin.createUser` with a concurrency cap of 5 — a mistyped admin can lock the whole auth server if they paste the wrong CSV twice. `/api/intro` inserts a row AND fires four emails per call with no rate limit beyond the unique constraint.
- **What could break**: the `keys/validate` and `keys/encrypt` routes accept authenticated requests and proxy to Railway — an attacker with a stolen session cookie (or a runaway client with a bug) can burn Railway compute unbounded and drive Vercel function invocation costs up. The `trades/upload` route validates a 50k-row cap but a single bad actor can upload 50k trades repeatedly. The `intro` route can spam the founder's inbox by iterating strategy IDs (one per unique (allocator,strategy) pair).
- **Proposed fix**: wrap every `withAuth` route with `checkLimit(userActionLimiter, ...)` and every admin action with `checkLimit(adminActionLimiter, ...)` (already defined as "Reserved for future use"). For `verify-strategy`, add `publicIpLimiter` BEFORE the 24h-per-email DB query. For `keys/*`, use a stricter limiter (e.g., 3/min per user) because each call crosses the Railway boundary. Add a top-level `beforeAll` hook pattern or a shared `withRateLimit` wrapper next to `withAuth` so the coverage is enforced structurally, not per-file.
- **Effort**: small
- **Scope-excluded?**: no

### [SD-HIGH-02] Auth is RLS-only on several write paths; no API-layer authorization defense-in-depth
- **Priority**: High
- **Category**: security / correctness
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/intro/route.ts` (inserts `contact_requests` via user client, RLS-only), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/preferences/route.ts` (upserts `allocator_preferences` via user client, RLS-only), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/portfolio-strategies/alias/route.ts` (explicit ownership check BEFORE the update — this is the correct pattern), `/Users/helios-mammut/claude-projects/quantalyze/src/lib/api/withAuth.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/lib/api/withAdminAuth.ts`
- **What's wrong**: the repo has recently hardened RLS (migrations 020/021/022/026 fix a recursion loop and a real PII leak) which proves the RLS surface is non-trivial and hard to get right. Yet several POST handlers treat RLS as the ONLY authorization boundary. `/api/intro` does `supabase.from("contact_requests").insert(...)` with the user client and no prior ownership check — it relies on the `contact_requests` RLS `WITH CHECK` + the `(allocator_id, strategy_id)` unique constraint. `/api/preferences` upserts `allocator_preferences` the same way. If any of those policies breaks (as happened with the `profiles` PII revoke), the API layer won't catch it.
- **What could break**: a bad RLS migration (or a policy that silently gets dropped — migration 026 just fixed an RLS recursion loop) can expose write access to attacker input. The PII migrations 012 and 017 were SILENT NO-OPS for two months before migration 020 caught them. The same pattern applied to a `contact_requests` policy would let any logged-in user insert rows as any allocator.
- **Proposed fix**: treat RLS as the DB-layer defense and add a matching check at the API layer. The `portfolio-strategies/alias` route (lines 71–85) is the reference implementation — ownership check first, then update. Apply the same pattern to `/api/intro` (verify the user is an allocator or 'both'), `/api/preferences` (the ownership is implicit in `user.id`, but add an explicit self-check comment), and `/api/portfolio-alerts` PATCH handler. Audit every `supabase.from(...).insert|update|delete` call against the checklist: (a) does withAuth gate entry? (b) is there a server-side ownership check OR a DB constraint that cannot be bypassed? (c) is the client a user-scoped client (RLS active) or admin (RLS bypassed)? Rows 1+2 must both be true OR row 3 must be "user-scoped AND ownership check done server-side".
- **Effort**: medium (audit + per-route fix)
- **Scope-excluded?**: no (no DB migrations required; API-layer checks only)

### [SD-HIGH-03] Analytics service seam has no contract versioning or schema validation
- **Priority**: High
- **Category**: correctness / boundaries
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/analytics-client.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/lib/portfolio-analytics-adapter.ts`, `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/routers/*`
- **What's wrong**: the TypeScript caller and the FastAPI receiver are in the same repo but there is no shared IDL (OpenAPI, protobuf, Zod schema). The response shapes are matched by `any`/`Record<string, unknown>` and a hand-rolled adapter (`portfolio-analytics-adapter.ts`). There is no versioned API path (`/api/compute-analytics` is unversioned — no `/v1/`), and no schema validation on the Next.js side after the fetch. The CHANGELOG explicitly notes "PortfolioAnalytics TypeScript types corrected to match what analytics-service/routers/portfolio.py actually persists" — evidence that contract drift has happened at least once and was caught only by runtime UI breakage.
- **What could break**: a field rename or removal on the Python side (e.g., renaming `attribution_breakdown` → `attribution`) ships cleanly on Railway but the Next.js dashboard silently renders wrong numbers or blanks. Institutional allocators will not notice a wrong number until well after the demo. Wrong performance numbers from an "exchange-verified" platform is a brand-killing trust event.
- **Proposed fix**: pick ONE of (a) generate TS types from the Python router's Pydantic models via `datamodel-code-generator` in CI, (b) hand-write Zod schemas for every analytics-client response and `z.parse()` at the boundary, (c) add OpenAPI auto-gen from FastAPI. (b) is the lowest-lift win and catches drift at runtime with a loud error, which is the right failure mode. Version every Python route (`/api/v1/compute-analytics`) so a breaking change bumps the path. Add an `X-Client-Version` header the Python side can reject on mismatch.
- **Effort**: medium
- **Scope-excluded?**: no (Python internals are out of scope but adding a path prefix is trivial; hand-written Zod is all TS side)

### [SD-HIGH-04] Match engine cron lives in `pg_cron` and is invisible to ops
- **Priority**: High
- **Category**: reliability / observability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/supabase/migrations/013_cron_heartbeat.sql`, `/Users/helios-mammut/claude-projects/quantalyze/supabase/migrations/015_schedule_match_cron_hourly.sql`, `/Users/helios-mammut/claude-projects/quantalyze/docs/runbooks/match-engine.md`, `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/routers/match.py` (`cron-recompute` handler starting line 449)
- **What's wrong**: the match engine's `cron-recompute` is triggered by a `pg_net.http_post` inside a `pg_cron` job (migration 013 → 015 reschedules hourly). This means:
  1. The Railway URL + `X-Service-Key` live in Postgres GUC settings (`app.analytics_service_url`, `app.analytics_service_key`).
  2. Rotating the service key requires `ALTER DATABASE postgres SET app.analytics_service_key = '...'` — zero indication in the Vercel or Railway dashboards.
  3. Cron health is visible only via `cron_runs` heartbeat table + `latest_cron_success()` RPC, which no dashboard currently reads.
  4. The migrations explicitly skip scheduling if the extensions or GUCs are missing and fall back to a `cron_runs` row with `status='error'` — which is fail-loud ON the DB but silent to anything else.
  5. The cron concurrency in `routers/match.py` uses a process-local `asyncio.Semaphore(3)` with an "in-flight marker pattern from portfolio cron" comment, i.e., multi-worker Railway deploys rely on a convention that isn't visible in the match router itself.
- **What could break**: a service key rotation that changes the Railway secret without `ALTER DATABASE` silently breaks the nightly match recompute — `cron_runs` will show `error` but nobody is alerted. Railway scaling to 2+ workers re-introduces the race that the "in-flight marker pattern" was supposed to prevent if the pattern is actually only in the portfolio router and not the match router.
- **Proposed fix**:
  - Add a Vercel Cron that calls a new `/api/admin/cron-health` Next.js route (admin-gated via `CRON_SECRET`) that reads `latest_cron_success('match_engine_cron')` via the admin client and returns 500 if the last success is > 2 hours ago. This gives Vercel Cron's built-in failure alerts a signal.
  - Document the GUC-based secret rotation in a `docs/runbooks/secrets.md` so it's not tribal knowledge.
  - Verify the in-flight marker pattern is present in `routers/match.py` or add it (out of scope per the brief — flag it for the Python team).
  - Consider moving the schedule to Vercel Cron or a Railway-native scheduler so ops can see it in one place. Accept the trade-off that Vercel Cron on Hobby is limited.
- **Effort**: medium
- **Scope-excluded?**: partially (Python internals out of scope)

### [SD-HIGH-05] Email delivery has no retry, no DLQ, and fire-and-forget dispatch at call sites
- **Priority**: High
- **Category**: reliability / correctness
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/email.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/admin/match/send-intro/route.ts` (`void dispatchAdminIntroEmails(...)`), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/intro/route.ts` (`Promise.resolve().then(async () => {...}).catch(() => {})`)
- **What's wrong**: the `send()` primitive writes an audit row to `notification_dispatches` (migration 018, good), attempts a single Resend call, and marks the row `sent` / `failed`. There is **no retry** on 5xx from Resend, **no dead-letter queue**, and rows that silently stay in `queued` are documented as "operators can spot stuck rows via the queued + age > threshold query" — which nobody is running. Call sites use `void ...` or `Promise.resolve(...).catch(() => {})` to make email failures non-blocking for the API, which is the right decision for the synchronous request path but means a transient Resend outage = silent lost email with no recovery surface.
- **What could break**: a 60-second Resend outage silently drops every intro email. The allocator thinks they received an intro, the manager thinks they got a new lead, neither actually gets anything. `notification_dispatches.status = 'failed'` rows accumulate with no alert.
- **Proposed fix**:
  - Short-term: add a Vercel Cron (or the pg_cron surface) that selects `notification_dispatches WHERE status IN ('queued','failed') AND age > 5 minutes` and retries them up to 3x with backoff before marking `dead`. Mark `failed` rows with `retry_count` and `next_retry_at`.
  - Add an alert hook: if the cron finds >10 failed rows in one pass, fire a founder notification.
  - Medium-term: use Resend's webhook endpoint to update `notification_dispatches.status` with the real Resend delivery state (delivered / bounced / complained) instead of the current "accepted by API" marker.
- **Effort**: medium
- **Scope-excluded?**: no

### [SD-HIGH-06] E2E coverage in CI misses every business-critical path
- **Priority**: High
- **Category**: correctness
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/.github/workflows/ci.yml` (lines 47–93), `/Users/helios-mammut/claude-projects/quantalyze/e2e/*.spec.ts`, `/Users/helios-mammut/claude-projects/quantalyze/e2e/match-queue.spec.ts`, `/Users/helios-mammut/claude-projects/quantalyze/e2e/sync-analytics-flow.spec.ts`, `/Users/helios-mammut/claude-projects/quantalyze/e2e/api-key-flow.spec.ts`, `/Users/helios-mammut/claude-projects/quantalyze/e2e/full-flow.spec.ts`
- **What's wrong**: CI runs only `auth.spec.ts`, `smoke.spec.ts`, `demo-public.spec.ts`, `demo-founder-view.spec.ts` against a placeholder `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`. The comment in `ci.yml` explains why: `"full match-queue.spec.ts requires a seeded staging Supabase"`. `sync-analytics-flow.spec.ts` (API key → trade sync → analytics), `api-key-flow.spec.ts`, and `full-flow.spec.ts` are ALL excluded for the same reason. Unit tests cover library helpers but not the end-to-end flow across Next.js → Railway → Supabase.
- **What could break**: a regression in `/api/keys/sync` or the match queue recompute flow ships unnoticed. The most expensive and user-facing flows (exchange key upload, match intro send, portfolio analytics compute) have NO automated end-to-end coverage in CI. Manual QA via `/qa` is the only safety net, and it runs post-ship.
- **Proposed fix**: set up a **dedicated test Supabase project** (free tier, isolated DB) + a **dedicated test Railway deployment** (analytics-service with seed data). Wire secrets into GitHub Actions. Extend the E2E spec list to include match-queue and sync-analytics. Seed deterministically at test start, tear down at test end. Alternatively: add a lighter-weight integration test layer that mocks Railway with nock-style fixtures and hits a local ephemeral Postgres — still better than nothing and doesn't need cloud infrastructure.
- **Effort**: large (requires infra setup)
- **Scope-excluded?**: no (test infra is in scope)

### [SD-MEDIUM-01] PDF pipeline: no global rate limit, cache policies drift across routes
- **Priority**: Medium
- **Category**: scale / cost
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/puppeteer.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/factsheet/[id]/pdf/route.ts` (`Cache-Control: private, max-age=86400`), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` (`s-maxage=3600, stale-while-revalidate=86400`), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/portfolio-pdf/[id]/route.ts` (`s-maxage=3600, stale-while-revalidate=86400`), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/demo/portfolio-pdf/[id]/route.ts` (`no-store, no-cache`)
- **What's wrong**: the Puppeteer semaphore caps per-lambda concurrency at 2 (good), but Vercel can spin up N lambdas, so the cross-lambda ceiling is `N × 2` and relies on the IP-based Upstash limiter (10 req/min per IP, `pdf:` prefix) to cap total. Four PDF routes each have SUBTLY DIFFERENT cache policies:
  - `factsheet/[id]/pdf` → `private, max-age=86400` (browser only)
  - `factsheet/[id]/tearsheet.pdf` → `s-maxage=3600, stale-while-revalidate=86400` (shared CDN)
  - `portfolio-pdf/[id]` → `s-maxage=3600, stale-while-revalidate=86400` (shared CDN, but auth-gated!)
  - `demo/portfolio-pdf/[id]` → `no-store, no-cache` (signed token, correct)
  - The `portfolio-pdf/[id]` route is auth-gated AND returns `s-maxage` cache — that's a cache-poisoning risk if Vercel keys on URL alone (it does), meaning one user's PDF could be served to another user if they share the URL and their browser or a shared proxy caches the first response at the shared CDN layer. The code comment even admits "portfolio contents can drift under the owner's feet" — that's the SMALLER problem. The BIGGER problem is the auth-gated content being shared-CDN cached.
- **What could break**: under load a scraper or a bot hitting the public tearsheet can serve cached PDFs past their intended TTL via `stale-while-revalidate`. Auth-gated portfolio PDFs may be served to the wrong user if a shared CDN holds onto the response. At the PDF cost level: a single viral tearsheet link (a tweet referencing the URL) can cost tens of dollars in Chromium launches because the per-lambda semaphore resets on every cold start.
- **Proposed fix**:
  - Change `portfolio-pdf/[id]` Cache-Control to `private, no-store` — authenticated responses should never be shared-cached.
  - Add a global Upstash rate limit keyed on the route prefix (not just `pdf:<ip>`) so all PDFs share a pool.
  - Consider moving PDF generation to a dedicated queue (Upstash QStash or a simple Railway worker) so a viral link backs up in a queue instead of hammering Vercel lambdas. Not urgent at current scale.
  - Verify that `networkidle0` + the 25s navigation timeout doesn't hold the Vercel function open longer than the platform-imposed max duration (default 10s on Hobby — this is worth checking in vercel.json `functions` config if it exists).
- **Effort**: small (cache policy fix) to medium (queue)
- **Scope-excluded?**: no

### [SD-MEDIUM-02] Admin auth via email-based proxy gate + DB lookup is a 2-place source of truth
- **Priority**: Medium
- **Category**: security / boundaries
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/proxy.ts` (lines 63–82), `/Users/helios-mammut/claude-projects/quantalyze/src/lib/admin.ts` (`isAdminUser`), `/Users/helios-mammut/claude-projects/quantalyze/src/lib/api/withAdminAuth.ts`
- **What's wrong**: admin gating happens in TWO places with DIFFERENT logic:
  1. `src/proxy.ts` cheap-checks `process.env.ADMIN_EMAIL` against `session.user.email` to bounce non-admins at the middleware layer.
  2. `src/lib/admin.ts::isAdminUser()` does an OR check — email match OR `profiles.is_admin = true`.
  - The code comment explicitly notes: "When a 2nd admin is added with is_admin = true but a different email, this proxy check needs a JWT custom claim or a session cache. Tracked in TODOS.md (P2: drop email-based gate)." This is a known latent bug waiting for a second admin.
- **What could break**: adding a second admin by setting `profiles.is_admin = true` works at the API layer but proxy-level redirects send them back to `/discovery/crypto-sma`. The founder workflow silently breaks for the new admin. Worse: if `ADMIN_EMAIL` env var is blank or mistyped in production, EVERY admin route redirects to discovery even for the real admin, and the only fix is a redeploy.
- **Proposed fix**: move admin check to a JWT custom claim (`app_metadata.is_admin`) set by a Supabase Auth hook on user row change, cached on the session, and read in `src/proxy.ts` without a DB round-trip. Remove the email-based branch. Short-term: make the proxy check fail OPEN to the admin-auth API layer (i.e., let the request through and let `withAdminAuth` be the real gate). The proxy becomes a UX optimization, not a security boundary.
- **Effort**: medium
- **Scope-excluded?**: no

### [SD-MEDIUM-03] `api_keys` reads use admin client — RLS bypassed for a PII-adjacent table
- **Priority**: Medium
- **Category**: security / boundaries
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/queries.ts` (lines 546–624: `getMyAllocationDashboard` uses `admin.from("api_keys")`), `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/routers/cron.py`
- **What's wrong**: `getMyAllocationDashboard` reads `api_keys` through `createAdminClient()` — not because of column-level revoke, but because the comment claims "strategy_analytics daily_returns are only exposed to service role". That's true for strategy_analytics, but the code then uses `admin` for ALL fan-out queries including `api_keys`, `portfolio_strategies`, and `portfolio_analytics`. This bypasses RLS on every query in the fan-out. The ownership gate is `portfolio.user_id === userId` done ONCE at step 1 (`getRealPortfolio`), then everything downstream implicitly trusts that passed.
- **What could break**: a bug that forgets to pass `userId` OR a typo that uses another user's `userId` reads all their `api_keys` metadata and portfolio analytics because RLS is disengaged. The bug's radius is widened from "one row" (with RLS) to "any row" (admin bypass). `api_keys` has encrypted credentials; the `is_active`, `sync_status`, and `account_balance_usdt` columns are metadata but still sensitive.
- **Proposed fix**: the query helper should use the user-scoped client where possible and fall back to admin ONLY for the strategy_analytics JSONB columns that are column-revoked. Rewrite `getMyAllocationDashboard` to fan out with the user client for `api_keys`, `portfolio_strategies`, `portfolio_analytics` (all already gated by `portfolio.user_id` via RLS), and only use admin for the analytics embed inside the strategies join. Alternatively, wrap the whole fan-out in a helper that takes `userId` and asserts every result row's ownership post-fetch — defense in depth against the "forgot to pass userId" bug.
- **Effort**: small
- **Scope-excluded?**: no

### [SD-MEDIUM-04] Puppeteer lambda `max_duration` not configured in vercel.json
- **Priority**: Medium
- **Category**: reliability / scale
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/vercel.json`, `/Users/helios-mammut/claude-projects/quantalyze/src/lib/puppeteer.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/factsheet/[id]/pdf/route.ts` (25_000 ms navigation timeout)
- **What's wrong**: `vercel.json` has no `functions` block, which means PDF routes run under the Vercel default max duration — 10s on Hobby, 60s on Pro. The route's own timeouts are 10s launch + 25s navigation + 15s page default = potentially 50s of wall clock. If Hobby is still the plan (implied by the warm-analytics cron dropping), a legitimate cold-start PDF will hit the platform timeout before its own timeouts trigger, and the function will be killed mid-render with a generic 504, leaving an open Chromium that the `finally` block never reaches.
- **What could break**: the nightly PDF cold-start probe (`.github/workflows/nightly.yml`) has been catching something since it exists at all — worth checking the Vercel dashboard for its pass/fail history. A PDF that would have succeeded in 12s is killed at 10s by the platform. The `browser.close()` in `finally` never runs, leaking Chromium processes per lambda until the lambda is recycled.
- **Proposed fix**: add a `functions` block to `vercel.json` that sets `maxDuration: 30` (Pro) or explicitly documents that PDF routes are "Pro-only" if Hobby is permanent. Trim the in-route timeouts so max_lambda_duration > sum(route_timeouts) + 2s safety margin. Add a `beforeExit` hook that nukes any straggling Chromium on lambda cold-start.
- **Effort**: trivial (config) to small (handler cleanup)
- **Scope-excluded?**: no

### [SD-MEDIUM-05] `notification_dispatches` audit trail has no retention policy
- **Priority**: Medium
- **Category**: scale
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/supabase/migrations/018_notification_dispatches.sql`, `/Users/helios-mammut/claude-projects/quantalyze/src/lib/email.ts`
- **What's wrong**: every email send writes a row to `notification_dispatches`. There's no TTL, no partition, no cleanup cron. At institutional scale this table grows unbounded. It also has no index on `(status, created_at)` per the inline comment ("operators can spot stuck rows via the queued + age > threshold query") — so the "find stuck rows" query does a full table scan.
- **What could break**: over 12 months of production the table accumulates hundreds of thousands of rows. Queries for "find stuck" slow from 20ms to 2s. Supabase storage costs rise.
- **Proposed fix**: add a retention cron (Supabase pg_cron) that deletes rows older than 90 days with `status = 'sent'`. Keep `failed` and `queued` indefinitely. Add a composite index `(status, created_at)`.
- **Effort**: small
- **Scope-excluded?**: partially (DB migration needed — can be flagged for the DB pass)

### [SD-MEDIUM-06] Warmup helper's 2s timeout can't close a 5-15s Railway cold-start gap
- **Priority**: Medium
- **Category**: reliability / UX
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/warmup-analytics.ts` (`WARMUP_TIMEOUT_MS = 2000`)
- **What's wrong**: `warmupAnalytics()` fires a fire-and-forget HEAD to `/health` with a 2-second timeout. This is documented as "suspenders" for the missing cron belt. But a Railway cold start is typically 5-15s — the 2s `AbortController` cancels the warmup BEFORE Railway has finished cold-starting, meaning the warmup never actually warms anything. The comment claims "the page can still render from persisted data" (it can — Supabase reads work fine), but the first actual Railway call on the page will still hit a cold worker, defeating the purpose.
- **What could break**: demo pages hitting a cold Railway worker return data from Supabase but any interaction that calls a Python endpoint (match recompute, optimizer, analytics compute) has a multi-second first-touch latency. The friend's demo experience is degraded on the forwarded URL's first view.
- **Proposed fix**: either extend the warmup timeout to 10s AND `await` it (accepting the 10s SSR cost on cold) or accept that warmup is best-effort and document explicitly that demo URLs are expected to be cold. Better: re-enable the Vercel Cron warmer (SD-CRITICAL-02 fix) so the cold start doesn't land on demo users at all.
- **Effort**: trivial (config change) once SD-CRITICAL-02 is resolved
- **Scope-excluded?**: no

### [SD-MEDIUM-07] Trade upload has no streaming + 50k-row cap can OOM the lambda
- **Priority**: Medium
- **Category**: scale / reliability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/trades/upload/route.ts`
- **What's wrong**: the route accepts up to 50k trades in a single JSON body, inserts them in batches of 500 via the admin client. The `req.json()` call buffers the entire payload in memory before validation — a 50k-trade JSON is 10-30MB and consumes lambda memory. Vercel's default lambda has 1024MB but Node + Next runtime + Supabase client is already ~200MB, leaving little headroom. A malicious or malformed 50k-trade upload with nested fields can push past the limit.
- **What could break**: OOM crashes the lambda mid-insert, leaving `trades` in a partial state. The route returns on error with `inserted` count, but the caller has no way to retry cleanly (is row 1501 duplicated or skipped?).
- **Proposed fix**: move trade upload to CSV streaming with `ReadableStream` + a server action that processes the file in chunks of 500 without buffering the whole file. Or: cap at a much lower row count (5k) and require the client to chunk itself. Add idempotency via a client-supplied batch ID so retry is safe.
- **Effort**: medium
- **Scope-excluded?**: no

### [SD-LOW-01] `getClientIp` uses x-forwarded-for[0] which is spoofable outside Vercel
- **Priority**: Low
- **Category**: security
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/ratelimit.ts` (lines 91–101)
- **What's wrong**: `getClientIp` returns the first comma-separated IP from `x-forwarded-for`. Vercel's edge writes this correctly, but if the app is ever run behind another proxy (or in local dev with a different setup) an attacker can set their own `x-forwarded-for` header and bypass the IP rate limit. Low priority because Vercel is the only production target.
- **What could break**: cross-deploy (e.g., Railway or bare metal) the rate limit is trivially bypassed.
- **Proposed fix**: trust `x-forwarded-for` ONLY when a known signing header is present (Vercel sets `x-vercel-ip`). Prefer `x-vercel-forwarded-for` on Vercel. Document the trust model in the helper.
- **Effort**: trivial
- **Scope-excluded?**: no

### [SD-LOW-02] Demo route `src/proxy.ts` uses `getSession()` not `getUser()`
- **Priority**: Low
- **Category**: security
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/proxy.ts` (lines 31–33)
- **What's wrong**: the proxy uses `supabase.auth.getSession()` for speed ("Optimistic session check (cookie-only, no network call)") and relies on server components / DAL to call `getUser()` for authoritative checks. Documented practice and the comment is correct — BUT any page that renders admin-only content without calling `isAdminUser()` first has only the cookie check between it and unauthorized access. The admin branch in the proxy does check `session.user.email` against `ADMIN_EMAIL`, which is a JWT claim read (not a real auth check), so a stale cookie with a rolled session could theoretically slip through until the cookie is rechecked.
- **What could break**: if Supabase JWT rotation ever has a race condition, a revoked token could be trusted by the proxy for the cookie's TTL. The comment correctly flags this as an issue to be fixed with a JWT custom claim.
- **Proposed fix**: accept that this is the standard Supabase SSR pattern. Long-term: move admin to a JWT custom claim as in SD-MEDIUM-02.
- **Effort**: trivial (documentation only)
- **Scope-excluded?**: no

### [SD-LOW-03] `next.config.ts` has no `experimental.serverActions.bodySizeLimit`
- **Priority**: Low
- **Category**: reliability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/next.config.ts`
- **What's wrong**: server action bodies default to 1MB in Next 16. Trade upload routes go through API routes (not server actions) so this specific limit doesn't bite, but future server action conversions will hit a silent 1MB wall.
- **Proposed fix**: explicitly set the server action body size limit even if it matches the default, so the intent is visible.
- **Effort**: trivial
- **Scope-excluded?**: no

### [SD-LOW-04] `ANALYTICS_SERVICE_URL` default is `http://localhost:8002`
- **Priority**: Low
- **Category**: reliability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/lib/analytics-client.ts` (line 1), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/portfolio-optimizer/route.ts` (line 5), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/admin/match/eval/route.ts` (line 5)
- **What's wrong**: production routes default to `localhost:8002` if the env var is unset. In production this is a guaranteed misconfiguration that produces a confusing `ECONNREFUSED` error message instead of a loud startup fail. The cron route correctly returns a 500 with "ANALYTICS_SERVICE_URL not set" — that pattern should be everywhere.
- **Proposed fix**: remove the fallback in `src/lib/analytics-client.ts` and add a module-load-time assertion that `ANALYTICS_SERVICE_URL` is set. Let the app crash loud on boot if it isn't (Vercel will surface this in build logs). Local dev can continue to set it in `.env.local`.
- **Effort**: trivial
- **Scope-excluded?**: no

### [SD-LOW-05] `portfolio-optimizer` handler re-implements the analytics-client contract
- **Priority**: Low
- **Category**: boundaries
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/portfolio-optimizer/route.ts` (lines 36–46)
- **What's wrong**: this route duplicates `fetch` + header construction + error handling that belongs in `src/lib/analytics-client.ts`. The reason is that the shared helper has no timeout (SD-CRITICAL-01) and this route needed 60s — so the author copy-pasted. A fix to SD-CRITICAL-01 should also consolidate this route to use the shared helper.
- **What could break**: divergence between the two fetch call sites. If the X-Service-Key header name changes, only one gets updated.
- **Proposed fix**: fold this into the analytics-client refactor.
- **Effort**: trivial after SD-CRITICAL-01
- **Scope-excluded?**: no

### [SD-LOW-06] Vercel Cron bearer compare in `alert-digest` is non-constant-time
- **Priority**: Low
- **Category**: security
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/alert-digest/route.ts` (lines 22–25)
- **What's wrong**: `if (!process.env.CRON_SECRET || auth !== expected)` uses JS `!==` which short-circuits on first byte difference. This leaks length + prefix information. The warm-analytics route got this right with `safeCompare`; alert-digest never got the treatment.
- **What could break**: theoretically an attacker can probe `CRON_SECRET` via timing attacks. In practice this is a Vercel Cron endpoint with no public hostname advertised. Low severity but trivial to fix.
- **Proposed fix**: copy the `safeCompare` from `warm-analytics/route.ts` into a shared helper (`src/lib/cron-auth.ts`) and use it from both.
- **Effort**: trivial
- **Scope-excluded?**: no

### [SD-LOW-07] Puppeteer `release` happens BEFORE `browser.close()` await
- **Priority**: Low
- **Category**: reliability
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/factsheet/[id]/pdf/route.ts` (lines 105–112), `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/portfolio-pdf/[id]/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/factsheet/[id]/tearsheet.pdf/route.ts`, `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/demo/portfolio-pdf/[id]/route.ts`
- **What's wrong**: the `finally` block does `if (browser) await browser.close().catch(...); if (release) release();`. `browser.close()` is awaited, `release()` is not. This is CORRECT per the semaphore design (release as soon as the browser is closed), but the sequential pattern means a slow `browser.close()` holds the slot for the full close duration. At 2 slots and ~2s close time per PDF, throughput is bottlenecked. Acceptable at current scale.
- **What could break**: throughput cliff at ~30 PDFs/min per lambda.
- **Proposed fix**: fire `browser.close()` and `release()` in parallel via `Promise.allSettled` — release the semaphore as soon as the PDF buffer is returned, let close happen in background. Add a safety net that kills the browser on lambda shutdown.
- **Effort**: small
- **Scope-excluded?**: no

### [SD-LOW-08] No `strictTransportSecurity`, `X-Frame-Options`, or CSP headers
- **Priority**: Low
- **Category**: security
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/next.config.ts`
- **What's wrong**: `next.config.ts` has a single `headers()` block that only sets Cache-Control for `/demo/*`. No HSTS, no X-Frame-Options / frame-ancestors, no CSP. Vercel sets some defaults but not HSTS. Missing CSP means an XSS anywhere in the app is not mitigated.
- **What could break**: framing attacks, protocol downgrades, and missing XSS mitigation.
- **Proposed fix**: add a global `headers()` entry that sets `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY` (or a narrow CSP `frame-ancestors`), and a starter CSP. The email HTML uses inline styles so `'unsafe-inline'` for `style-src` is unavoidable in the marketing paths — scope per-route.
- **Effort**: small
- **Scope-excluded?**: no

### [SD-LOW-09] Missing index on `notification_dispatches (status, created_at)` & partition story
- **Priority**: Low
- **Category**: scale
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/supabase/migrations/018_notification_dispatches.sql`
- **What's wrong**: as above, the "find stuck rows" query is unindexed.
- **Proposed fix**: DB migration (out of scope for this pass — flag for DB pass).
- **Effort**: trivial
- **Scope-excluded?**: YES (DB migration)

### [SD-LOW-10] `.env.example` references `DEMO_PDF_SECRET` but it's not documented as REQUIRED
- **Priority**: Low
- **Category**: observability / ops
- **Files/paths**: `/Users/helios-mammut/claude-projects/quantalyze/.env.example`, `/Users/helios-mammut/claude-projects/quantalyze/src/lib/demo-pdf-token.ts`
- **What's wrong**: `.env.example` has Supabase, Admin, Scheduling, Observability, Upstash, Analytics. It does NOT list `DEMO_PDF_SECRET`, `CRON_SECRET`, `PLATFORM_NAME`, `PLATFORM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`. A new developer copying `.env.example` will hit runtime errors because these are consumed throughout the code.
- **What could break**: onboarding friction; partial configs in deploys.
- **Proposed fix**: audit `process.env.*` across the entire codebase, add every referenced variable to `.env.example` with a comment describing required/optional status and who sets it (Vercel env / local / Railway).
- **Effort**: small
- **Scope-excluded?**: no
