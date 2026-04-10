# Architecture audit — round 1
Date: 2026-04-10
Scope: identify implicit architectural decisions and ADR gaps.

## Summary
- ADRs to document (existing decisions): 17
- ADRs to make (open questions): 5
- Priority breakdown: Critical 4 / High 9 / Medium 7 / Low 2

quantalyze has no `docs/architecture/` directory yet. Every decision below is
implicit in the code — discoverable only by reading files. Several decisions are
actively inconsistent (multiple auth wrappers, multiple cron mechanisms, multiple
admin checks) and the team will continue to drift without codification.

Priority rubric:
- **Critical** — inconsistency is already producing security/correctness risk.
- **High** — debt is compounding with every new PR.
- **Medium** — needed for onboarding + plan reviews.
- **Low** — minor convention.

---

## ADR candidates

### [ADR-0001] Supabase RLS is the primary authorization layer
- **Status**: Accepted-retroactively
- **Priority**: Critical
- **Evidence in code**:
  - RLS policies: `supabase/migrations/002_rls_policies.sql` lines 1-69 enable
    RLS on 9 tables and define owner-scoped policies.
  - Hardened variants: `supabase/migrations/007_security_hardening.sql`,
    `011_perfect_match.sql`, `020_profile_pii_revoke_hardened.sql`,
    `021_function_execute_hardening.sql`, `022_public_profiles_view_security_invoker.sql`.
  - Every server component reads via `createClient()` in
    `src/lib/supabase/server.ts:4-27` (runs under the caller's JWT so RLS applies).
  - Route handlers repeat the pattern: see
    `src/app/api/preferences/route.ts:10-11`, `src/app/api/attestation/route.ts:21-28`,
    `src/app/(dashboard)/discovery/layout.tsx:31-55`.
  - Admin-client escape hatches live in `src/lib/supabase/admin.ts` and are
    used for cross-tenant reads, e.g. `src/lib/queries.ts:547-624`,
    `src/app/(dashboard)/scenarios/page.tsx:40-80`.
- **Context**: The team chose "RLS-first authorization" early. Most tables have
  `FOR ALL USING (user_id = auth.uid())` policies. API handlers are thin — they
  delegate row-level trust to Postgres. But the pattern is inconsistent: some
  routes run under the user JWT (trusting RLS), others use the admin client
  and reimplement ownership checks in app code (e.g. `assertPortfolioOwnership`
  in `src/lib/queries.ts:347-359`, `src/app/api/portfolio-pdf/[id]/route.ts:42`).
  Migrations 012/017/020 also document a class of bugs where column-level
  REVOKEs were silent no-ops against table-level grants — a direct consequence
  of the team not having written down "how column-level PII hiding interacts
  with table-level grants" as a decision.
- **Decision**: RLS is the primary authorization layer. API handlers are NOT
  expected to re-check ownership except in the two narrow cases (a) where the
  admin client is deliberately used for a cross-tenant read, (b) where a
  specific column is hidden by grants (profiles PII). Every API handler must
  document which path it takes. An "authorization model" section in the ADR
  must include: the table-level grant baseline (`GRANT ALL … TO authenticated`
  is currently allowed), the column-level REVOKE/GRANT allowlist pattern
  (migration 020's template), and the admin-client-only paths.
- **Consequences**:
  - (+) Database becomes the single source of truth; a new table automatically
    gets RLS treatment.
  - (+) Multi-tenant safety is DB-enforced; API bugs can't open cross-tenant
    leaks.
  - (−) Any `createAdminClient()` use is a potential footgun — must carry a
    manual ownership check.
  - (−) Column-level REVOKE footguns (migrations 012, 017 were silent no-ops)
    until pattern is codified.
- **Action**: Write ADR file as `docs/architecture/adr-0001-rls-primary-authorization.md`.
  Enumerate the RLS/non-RLS paths and mandate the table-REVOKE-then-GRANT-back
  pattern from migration 020 for any new PII.
- **Fix effort**: small (the pattern is already proven in migration 020)

---

### [ADR-0002] Next.js 16 conventions: App Router, proxy.ts, no Server Actions, Server Components for all data reads
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `src/proxy.ts` (not `middleware.ts`) — using the Next 16 rename.
    Lines 1-91 show session check + route protection.
  - All route segments live under `src/app/` (App Router); zero `pages/`.
  - Root layout is a Server Component: `src/app/layout.tsx:29-52`.
  - Dashboard layout is a Server Component doing DB reads:
    `src/app/(dashboard)/layout.tsx:6-46`.
  - Route groups `(auth)` and `(dashboard)` for layout scoping.
  - No `'use server'` Server Actions: grep for `'use server'` or `"use server"`
    across `src/` returns zero files. Mutations go through route handlers in
    `src/app/api/**/route.ts`.
  - `next.config.ts:1-26` only sets CDN headers — no experimental flags.
  - `vercel.json:1-7` is a bare framework stub.
- **Context**: Next.js 16 is a fresh release with several breaking changes
  (middleware → proxy, async params/cookies, Cache Components). The team has
  committed to specific patterns but none are written down. AGENTS.md literally
  warns "This is NOT the Next.js you know" but doesn't list the actual
  conventions. New contributors (human or AI) have no reference.
- **Decision**: Codify (a) App Router only, (b) `proxy.ts` (Next 16 rename),
  (c) Server Components for all read paths, (d) route handlers — not Server
  Actions — for all mutations, (e) no Edge runtime unless explicitly opted in
  (current default: Node). Document why Server Actions were NOT adopted (team
  preference for explicit handlers + CSRF gating, see ADR-0004).
- **Consequences**:
  - (+) Consistent pattern across the codebase; predictable for newcomers.
  - (−) Any AI agent / LLM will default to Server Actions unless told
    otherwise — "not using Server Actions" is the kind of default that needs
    an ADR to survive.
- **Action**: Write ADR file as `docs/architecture/adr-0002-nextjs-16-conventions.md`.
  Cross-link from AGENTS.md.
- **Fix effort**: trivial (pure documentation)

---

### [ADR-0003] Three-client Supabase pattern (browser / server / admin)
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `src/lib/supabase/client.ts:1-8` — `createBrowserClient` for client components.
  - `src/lib/supabase/server.ts:1-27` — `createServerClient` with cookie bridge,
    called per-request from Server Components + route handlers.
  - `src/lib/supabase/admin.ts:1-12` — direct `createClient` with
    `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS.
  - Admin client is imported 87 times across the codebase, including on
    publicly-reachable surfaces (`src/app/(dashboard)/scenarios/page.tsx:40`,
    `src/app/api/admin/notify-submission/route.ts`, `src/lib/email.ts:2`,
    `src/app/api/verify-strategy/route.ts:3`).
- **Context**: Three authorization surfaces exist, each with different trust
  properties. The cookie-based server client is RLS-bound; the admin client
  is full-power; the browser client has the anon key. There's no guidance on
  "when to reach for the admin client" and the decision is made ad-hoc per PR.
  Every admin-client call site is effectively an RLS bypass and must carry
  its own authorization check — this is where bugs are most likely to land.
- **Decision**: Document the three-client pattern. State explicitly: "Admin
  client is only for (a) service-to-service operations, (b) column-level PII
  reads gated at the grant level, (c) cross-tenant seeds/admin tools, (d) audit
  tables. Every admin-client call site MUST be preceded by an app-level
  authorization check." Add a lint rule or a code comment convention so new
  `createAdminClient()` uses are easy to spot in review.
- **Consequences**:
  - (+) Makes the RLS bypass paths explicitly inventoried.
  - (+) Review becomes mechanical: any new `createAdminClient()` is an
    immediate discussion point.
  - (−) Some reads on `strategy_analytics.daily_returns` legitimately need
    admin access because of column-level revokes — the ADR must enumerate
    these and create guidance for future cases.
- **Action**: Write ADR file as `docs/architecture/adr-0003-three-client-supabase.md`.
  Inventory the ~20 current admin-client call sites and classify each by
  category (a/b/c/d) for provenance.
- **Fix effort**: medium (requires an audit pass to classify existing call sites)

---

### [ADR-0004] Mutation model: REST-ish route handlers, not Server Actions; CSRF via Origin check; rate limits via Upstash
- **Status**: Accepted-retroactively
- **Priority**: Critical
- **Evidence in code**:
  - All mutations are HTTP POST/PUT/PATCH to `src/app/api/**/route.ts`. No
    `'use server'` directives anywhere.
  - CSRF defense: `src/lib/csrf.ts:38-68` — Origin/Referer allowlist check.
    Called from `src/app/api/attestation/route.ts:18`,
    `src/app/api/account/deletion-request/route.ts`, both PDF routes — but
    NOT from the other mutation routes.
  - Rate limits: `src/lib/ratelimit.ts:1-101`. Only used in 5 routes
    (`attestation`, `deletion-request`, both portfolio-pdf routes, both
    factsheet PDF routes). Not used in `/api/preferences`, `/api/admin/*`,
    `/api/keys/*`, `/api/portfolio-optimizer`, `/api/verify-strategy`.
  - Auth wrappers: `src/lib/api/withAuth.ts` (10 routes) and
    `src/lib/api/withAdminAuth.ts` (3 routes). Other routes inline the
    `createClient() + getUser()` pattern instead of using the wrapper.
- **Context**: The team chose route handlers over Server Actions. The reason
  is presumably to make CSRF, rate limiting, and Origin checks first-class —
  but the coverage is incomplete. Mutations like `/api/preferences`,
  `/api/portfolio-optimizer`, and most `/api/admin/match/*` routes have no
  CSRF check and no rate limit. The reliance on Supabase cookies (SameSite=Lax)
  as primary CSRF defense is workable but fragile under cross-site embedding.
  Also: there are THREE distinct patterns for "is the caller authenticated":
  `withAuth` wrapper, inline `createClient()+getUser()`, and proxy pre-check.
- **Decision**: Codify (a) route handlers over Server Actions, (b) mandatory
  `withAuth`/`withAdminAuth` usage for all mutations, (c) mandatory
  `assertSameOrigin` for all mutations, (d) which routes require rate limiting
  (sensitive writes, public-IP reads). Add a request-lifecycle diagram showing
  proxy → CSRF → auth → rate-limit → handler.
- **Consequences**:
  - (+) Uniform contract for new mutations; missing a CSRF check becomes a
    review-visible omission.
  - (+) Makes it easier to add observability (e.g. Sentry, see ADR-0010)
    at a single layer.
  - (−) Migration cost: ~15 existing routes need retrofitting to the pattern.
- **Action**: Write ADR file as `docs/architecture/adr-0004-mutation-api-contract.md`.
  Follow up with an inventory PR that lists every mutation route and its current
  coverage against the contract.
- **Fix effort**: small to author; medium to retrofit existing routes

---

### [ADR-0005] Admin authorization has THREE coexisting implementations
- **Status**: Open question (critical)
- **Priority**: Critical
- **Evidence in code**:
  - Pattern A — email match in proxy: `src/proxy.ts:71-82` compares
    `session.user.email` against `ADMIN_EMAIL` for `/admin`, `/api/admin`.
  - Pattern B — `isAdmin(email)` pure helper:
    `src/lib/admin.ts:13-16`. Callers have email but no Supabase client.
  - Pattern C — `isAdminUser(supabase, user)`: `src/lib/admin.ts:25-43`,
    reads `profiles.is_admin` from DB. Used by `withAdminAuth`:
    `src/lib/api/withAdminAuth.ts:17`.
  - Inconsistent adoption: `src/app/api/admin/match/kill-switch/route.ts:8-14`
    uses inline `isAdminUser`, NOT `withAdminAuth`. Same for
    `src/app/api/admin/match/recompute/route.ts:10`. But
    `/api/admin/allocator-approve`, `/api/admin/intro-request`,
    `/api/admin/strategy-review` use `withAdminAuth`.
  - The `proxy.ts` file has a comment (lines 64-70) explicitly flagging that
    the email-based gate is a stopgap until a 2nd admin is added.
- **Context**: During migration 011, `profiles.is_admin` was added and
  backfilled from `ADMIN_EMAIL`, but the email-based gate was kept "for
  zero-downtime rollout." It never got removed. Now any new admin route has
  to choose between three conventions. A code review can miss the fact that
  a given admin endpoint uses pattern B when it should use pattern C.
- **Decision**: Pick one. Recommendation: `isAdminUser` (pattern C) with the
  `withAdminAuth` wrapper — this is already the most-adopted and is the only
  pattern that doesn't require `ADMIN_EMAIL` to be present in prod. Deprecate
  patterns A and B, remove `isAdmin(email)`, replace the proxy check with a
  JWT custom claim OR accept that proxy is best-effort and the DAL is
  authoritative (document that clearly).
- **Consequences**:
  - (+) New admin endpoints get mechanical review.
  - (−) The proxy check becomes a DB query (expensive per request) OR a
    soft gate (clearly labeled) — both are tradeoffs that need writing down.
- **Action**: Write ADR as `docs/architecture/adr-0005-admin-authorization.md`.
  The ADR makes the decision and files a tech-debt ticket to remove the
  deprecated paths.
- **Fix effort**: small (ADR + deprecation); medium if JWT custom claim is
  introduced.

---

### [ADR-0006] Service boundary to the Python analytics service
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - Client: `src/lib/analytics-client.ts:1-88`. POSTs JSON to FastAPI with
    `X-Service-Key`. Has wrappers for `computeAnalytics`, `fetchTrades`,
    `validateKey`, `encryptKey`, `computePortfolioAnalytics`,
    `runPortfolioOptimizer`, `verifyStrategy`, `recomputeMatch`.
  - Service auth: `analytics-service/main.py:51-66` — hard `SERVICE_KEY`
    check on every request except `/health`.
  - Frontend URL config: `ANALYTICS_SERVICE_URL` env var.
  - Bypass 1: `src/app/api/portfolio-optimizer/route.ts:36-46` inlines its
    own fetch with the same headers instead of using `analytics-client`.
    Divergent error handling (lines 47-90) and no shared contract.
  - Bypass 2: `src/app/api/cron/warm-analytics/route.ts:60-64` does its own
    `/health` fetch.
  - Warmup: `src/lib/warmup-analytics.ts:27-55` — separate fire-and-forget
    warmup module.
  - Cron from Supabase pg_cron directly to Railway:
    `supabase/migrations/013_cron_heartbeat.sql:162-176` and
    `supabase/migrations/015_schedule_match_cron_hourly.sql:65-79`.
    Calls `POST /api/match/cron-recompute` with `X-Service-Key`.
  - Supabase Edge Function invoking analytics:
    `supabase/functions/compute-trigger/index.ts:43-72` — yet another path.
- **Context**: The frontend talks to the analytics service from FOUR
  different places with TWO different client abstractions. No contract is
  documented. TypeScript types are not generated from the FastAPI OpenAPI
  schema. A field-rename in Python can silently break the frontend until
  a server component throws. The `ANALYTICS_SERVICE_KEY` plaintext secret
  is in every caller's env surface.
- **Decision**: `src/lib/analytics-client.ts` is the single callsite for
  the frontend → analytics service. No handler may inline its own fetch.
  Add explicit types to every function. Document the auth mechanism
  (`X-Service-Key`), the timeouts, the retry policy (currently none), and
  the cold-start behavior (see ADR-0007). Document that pg_cron also calls
  the service directly and uses the same key via a Postgres GUC (a separate
  path that the JS client doesn't mediate).
- **Consequences**:
  - (+) Single migration point for typed clients or OpenAPI-driven generation
    later.
  - (+) Observability gets a single pinch point.
  - (−) The Supabase Edge Function + pg_cron bypasses remain — must be
    called out explicitly as the non-JS paths.
- **Action**: Write ADR as `docs/architecture/adr-0006-analytics-service-boundary.md`.
  Retrofit `portfolio-optimizer` route to use `analytics-client`. File a
  follow-up to generate TS types from the FastAPI OpenAPI schema.
- **Fix effort**: medium (ADR + refactor of 1-2 routes + OpenAPI wiring optional)

---

### [ADR-0007] Cold-start warmup strategy for the Railway analytics service
- **Status**: Accepted-retroactively
- **Priority**: Medium
- **Evidence in code**:
  - Vercel Cron route: `src/app/api/cron/warm-analytics/route.ts:37-91` —
    every 5 min `/health` ping, propagates upstream status.
  - Per-request warmup: `src/lib/warmup-analytics.ts:27-55` — fire-and-forget
    on page load.
  - CHANGELOG.md:68 explicitly frames this as belt + suspenders.
- **Context**: Railway serverless-ish behavior means cold starts on the
  Python service are common. Two mechanisms exist (cron + per-request). The
  per-request mechanism is unobservable and cheap but only matters when the
  cron is lagging or disabled. Neither path is documented.
- **Decision**: Accept the dual-warmup pattern. Codify the 5-minute cadence
  and the p99 cold-start budget the warmup is protecting. Document that
  disabling Vercel Cron (e.g. hobby tier limits) leaves only the per-request
  fallback and this should trigger a canary.
- **Consequences**:
  - (+) Operational clarity for the next person who touches either warmup.
  - (−) Future readers may be tempted to remove one layer — the ADR
    explains why both exist.
- **Action**: Write ADR as `docs/architecture/adr-0007-analytics-warmup.md`.
- **Fix effort**: trivial

---

### [ADR-0008] Background job / cron architecture: FOUR mechanisms coexist
- **Status**: Open question (high)
- **Priority**: High
- **Evidence in code**:
  - Mechanism 1 — Vercel Cron calling Next route handler:
    `src/app/api/cron/warm-analytics/route.ts`. But NO `crons:` block in
    `vercel.json:1-7`; the schedule must be registered via Vercel dashboard
    externally. Auth via Bearer `CRON_SECRET`, constant-time compare at
    line 30-35.
  - Mechanism 2 — `/api/alert-digest` cron handler at
    `src/app/api/alert-digest/route.ts:19-24` uses `!==` (NOT constant-time)
    for the CRON_SECRET compare. Divergent from Mechanism 1.
  - Mechanism 3 — Supabase pg_cron calling the FastAPI service:
    `supabase/migrations/013_cron_heartbeat.sql:162-176` (daily,
    superseded by 015's hourly). Uses `pg_net` + `current_setting()` for
    secret hygiene.
  - Mechanism 4 — Supabase Edge Functions (Deno) triggered by DB:
    `supabase/functions/compute-trigger/index.ts`,
    `supabase/functions/notify-admin/index.ts`.
  - Mechanism 5 — pure server-side `cron_sync` on the Python side:
    `analytics-service/routers/cron.py:148-281`, triggered by Mechanism 3.
  - `cron_runs` heartbeat table (migration 013) is only written by Mechanism 3.
- **Context**: Five places to schedule work, three different auth patterns
  (Bearer timing-safe, Bearer unsafe `!==`, `X-Service-Key`, and Supabase
  service-role JWT). No central registry of "what runs on what schedule and
  where." `vercel.json` doesn't even have a `crons:` block — the Vercel Cron
  is registered out of band, so a fresh deploy can lose the schedule. The
  team will not remember this architecture in 3 months.
- **Decision**: Pick a primary mechanism per workload class and document.
  Recommendation:
  1. **Infra health pings** (analytics warmup) → Vercel Cron, `vercel.json`
     must declare the schedule.
  2. **Cross-service orchestration** (match engine recompute, sync) →
     Supabase pg_cron calling FastAPI directly (already done, keeps secrets
     in DB GUCs).
  3. **Event-triggered compute** (post-insert triggers) → Supabase Edge
     Functions (already done).
  4. **Time-based Next.js work** (alert digests) → Vercel Cron.
  5. All paths log to a single observability table (extend `cron_runs`).
- **Consequences**:
  - (+) Operators can answer "where does job X run?" in one place.
  - (+) Fixes the non-constant-time compare in alert-digest.
  - (−) Requires moving the Vercel Cron schedule into `vercel.json`.
- **Action**: Write ADR as `docs/architecture/adr-0008-cron-architecture.md`
  with an inventory of every scheduled job and its mechanism. Move Vercel
  Cron registration into `vercel.json`.
- **Fix effort**: small (ADR + `vercel.json` edit)

---

### [ADR-0009] Caching strategy: Next CDN + per-request `React.cache`; no Cache Components
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `next.config.ts:4-23` sets CDN `Cache-Control: s-maxage=60, swr=300`
    on `/demo/*` only.
  - `src/app/(dashboard)/scenarios/page.tsx:7` and
    `src/app/(dashboard)/discovery/layout.tsx:9` and
    `src/app/(dashboard)/exchanges/page.tsx:9` and
    `src/app/(dashboard)/recommendations/page.tsx:13` and
    `src/app/demo/page.tsx:38` and
    `src/app/demo/founder-view/page.tsx:8` and
    `src/app/api/cron/warm-analytics/route.ts:23` all export
    `dynamic = "force-dynamic"` with a comment about why caching would be
    dangerous (attestation gate, auth, stale data).
  - `src/lib/queries.ts:488-500` uses `React.cache` for
    `getRealPortfolio` — request-scoped dedupe, not a cross-request cache.
  - Grep for `'use cache'` / `unstable_cache` / `cacheLife` / `cacheTag`
    returns zero matches. Next.js 16 Cache Components are NOT used.
- **Context**: The app has made a deliberate choice to not use Next.js
  caching above the React-render level. Every dashboard route is dynamic,
  every query is per-request. The only CDN cache is on the `/demo/*` public
  surface. This is a safe default — but it's also a rejection of the entire
  Next.js 16 Cache Components feature, and nowhere is that written down.
  A future contributor will almost certainly "improve performance" by
  adding `'use cache'` to a route and accidentally cache an auth-sensitive
  page (the discovery layout comment on lines 4-8 explicitly warns about
  this).
- **Decision**: Codify "force-dynamic by default for authenticated routes,
  CDN cache only for the public demo page, `React.cache` for per-request
  dedupe." Explicitly document that Cache Components (PPR, `'use cache'`,
  `cacheLife`, `cacheTag`) are NOT adopted — and require an ADR to adopt.
  Attestation-gated routes (`/discovery/*`, `/recommendations`) are
  especially dangerous and need force-dynamic enshrined.
- **Consequences**:
  - (+) Prevents the most likely security regression in this codebase.
  - (−) Leaves performance on the table. Acceptable for v1 traffic.
- **Action**: Write ADR as `docs/architecture/adr-0009-caching-strategy.md`.
- **Fix effort**: trivial

---

### [ADR-0010] Observability: no Sentry, console-only logging, Plausible for client analytics
- **Status**: Open question (critical)
- **Priority**: Critical
- **Evidence in code**:
  - `package.json` (Next.js side) does NOT depend on `@sentry/nextjs` or
    any `@sentry/*` package.
  - `.env.example:14` declares `NEXT_PUBLIC_SENTRY_DSN` — but no code
    reads it.
  - `analytics-service/main.py:14-26` has CONDITIONAL Sentry support in
    the Python service only.
  - `src/app/layout.tsx:27-48` embeds Plausible via `next/script` if
    `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is set.
  - Error handling is 100% `console.error` / `console.warn`:
    56 occurrences across 30 files per grep.
  - Zero `error.tsx` / `global-error.tsx` files in `src/app/` — no React
    error boundaries exist at the route level. Only `loading.tsx`
    files (3) exist.
  - Docs reference Sentry aspirationally: `docs/pitch/`,
    `docs/demos/pre-flight-checklist.md`, `docs/superpowers/plans/2026-04-07-perfect-match-engine.md`.
- **Context**: The team has a stated intent to use Sentry but has not
  wired it. All errors fall to `console.error` which on Vercel goes to
  runtime logs. There are no error boundaries, so a Server Component
  throw cascades to Next's default error surface. There is no centralized
  error tracking, no alerting, no PII scrubbing policy — and the product
  handles exchange API keys.
- **Decision**: (Open question — the ADR is to make the decision, not
  document it.) Options:
  - **Option A**: Adopt `@sentry/nextjs` + source maps + PII scrubbing.
  - **Option B**: Adopt Vercel Log Drains to an external observability
    provider (e.g. BetterStack, Axiom).
  - **Option C**: Explicit "console + Vercel logs only for v1; revisit
    at 10 pilot allocators" with a tripwire.
  - Also decide: (i) do we need route-level `error.tsx` boundaries;
    (ii) do we need a single `logger` abstraction to replace `console.*`;
    (iii) PII-scrubbing policy for logs (email, IP, exchange key IDs).
- **Consequences**:
  - Every option needs an explicit PII scrubbing policy — the app logs
    emails, user IDs, and IP addresses in many places.
- **Action**: Make this decision now. ADR at
  `docs/architecture/adr-0010-observability.md` records it.
- **Fix effort**: small to author; small-to-large to implement depending
  on chosen option.

---

### [ADR-0011] Rate limiting: Upstash sliding window with graceful degradation
- **Status**: Accepted-retroactively
- **Priority**: Medium
- **Evidence in code**:
  - `src/lib/ratelimit.ts:1-101` — three limiter tiers
    (`userActionLimiter` 5/min, `publicIpLimiter` 10/min, `adminActionLimiter`
    20/min unused).
  - Fails open when Upstash env vars are absent (lines 27-33 module-level
    warning + lines 72-74 per-request skip).
  - Only 5 route handlers use it: attestation, deletion-request, both
    portfolio-pdf routes, both factsheet PDF routes. Every other mutation
    is unrate-limited.
  - Ratelimit module has its own `getClientIp` helper that's also imported
    by some routes for audit-row IP extraction.
- **Context**: Upstash is integrated and the graceful-degradation story
  is explicit, but the coverage is arbitrary. There's no rule for "which
  routes must be rate-limited." `verify-strategy` and `/api/preferences`
  and the admin match routes have no rate limit. The FastAPI side has
  its own `slowapi` limiter keyed on remote address — which is useless
  because every request comes from Next, not the real client.
- **Decision**: Pick a coverage rule and codify:
  - All public unauth'd endpoints → `publicIpLimiter`.
  - All auth'd mutation endpoints → `userActionLimiter`.
  - All admin endpoints → `adminActionLimiter`.
  - Fail-open is acceptable in dev, must alert in prod (canary).
  - FastAPI-side rate limit either honors the forwarded IP or is removed.
- **Consequences**:
  - Retrofit cost: ~20 handlers.
- **Action**: Write ADR as `docs/architecture/adr-0011-rate-limiting.md`.
  File follow-up ticket for route retrofit.
- **Fix effort**: small ADR; medium retrofit.

---

### [ADR-0012] PDF generation via Puppeteer + @sparticuz/chromium, in-memory semaphore
- **Status**: Accepted-retroactively
- **Priority**: Medium
- **Evidence in code**:
  - `src/lib/puppeteer.ts:1-154` — full launcher with a per-lambda
    semaphore (`MAX_CONCURRENT_PDFS = 2`, `QUEUE_TIMEOUT_MS = 15000`).
  - Dual runtime: local dev Chrome at macOS/Linux paths (lines 112-122)
    vs `@sparticuz/chromium` on Vercel (lines 102-110).
  - 10-second launch-timeout race in `launchBrowser` (lines 124-139).
  - Consumers: `src/app/api/portfolio-pdf/[id]/route.ts`,
    `src/app/api/demo/portfolio-pdf/[id]/route.ts`,
    `src/app/api/factsheet/[id]/pdf/route.ts`,
    `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts`.
  - Printable page `src/app/portfolio-pdf/[id]/page.tsx` is rendered by
    Puppeteer navigating to `${APP_URL}/portfolio-pdf/${id}` — same-app
    loopback pattern.
- **Context**: The decision to do PDF generation in the Next.js lambda
  rather than a dedicated service is implicit. The semaphore is a single
  point of failure — each lambda instance is independent so "2 concurrent"
  really means 2 × fleet size. The loopback fetch pattern (Puppeteer
  navigating to a same-app route) creates a recursion hazard if the target
  route is not lightweight. Memory pressure is real (@sparticuz/chromium
  is ~50MB gzipped, ~150MB unpacked).
- **Decision**: Document the pattern as chosen. Explicit non-goals:
  background job queue, dedicated browser service, queue-based batch
  rendering. Tripwire: if concurrent PDF generation across the fleet
  exceeds N/minute sustained, revisit. Document the loopback route
  (`/portfolio-pdf/[id]/page.tsx`) must never call back into itself.
- **Consequences**:
  - (+) Simple; no extra infra.
  - (−) Lambda cold-start impact on every PDF.
- **Action**: Write ADR as `docs/architecture/adr-0012-pdf-generation.md`.
- **Fix effort**: trivial

---

### [ADR-0013] Email delivery: Resend + notification_dispatches audit
- **Status**: Accepted-retroactively
- **Priority**: Medium
- **Evidence in code**:
  - `src/lib/email.ts:1-80` — Resend client, lazy singleton admin client
    for audit writes, whitelabel env vars (`PLATFORM_NAME`, `PLATFORM_EMAIL`).
  - `NotificationType` union at `src/lib/email.ts:13-23` — 10 literal
    types, explicitly not `string`.
  - Audit table: `notification_dispatches` (migration 018).
  - Second email path exists in Deno: `supabase/functions/notify-admin/index.ts`
    — direct Resend call, bypasses the audit table.
- **Context**: Two email paths, one audited, one not. Whitelabel vars are
  supported but undocumented. The `NotificationType` literal union requires
  a CHECK constraint mirror in the DB (migration 018 doesn't have it —
  the code comment at `src/lib/email.ts:11` flags this).
- **Decision**: Consolidate: all email goes through `src/lib/email.ts`.
  Retire or move the Supabase Edge Function to call the Next route. Add
  the CHECK constraint to migration 018's audit table (new migration).
  Whitelabel contract stays env-driven and is documented in the ADR.
- **Consequences**:
  - (+) Single audit trail.
  - (−) Supabase DB triggers lose the ability to notify synchronously.
- **Action**: Write ADR as `docs/architecture/adr-0013-email-architecture.md`.
- **Fix effort**: small

---

### [ADR-0014] Secret handling: .env vars everywhere; no runtime secret manager; KEK encryption for exchange keys
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `.env.example:1-33` — 15+ secrets listed.
  - Supabase service-role key in `src/lib/supabase/admin.ts:5`.
  - `CRON_SECRET` in `src/app/api/cron/warm-analytics/route.ts:39`
    and `src/app/api/alert-digest/route.ts:22` (divergent compare styles).
  - `HMAC_SECRET` for demo PDF tokens: `src/lib/demo-pdf-token.ts`.
  - Database-layer secret (cleanest pattern):
    `supabase/migrations/013_cron_heartbeat.sql:144-151` uses
    `current_setting('app.analytics_service_url', true)` — Postgres GUCs
    as secret storage, rotated via `ALTER DATABASE postgres SET`.
  - Envelope encryption for exchange API keys: `analytics-service/services/encryption.py`
    (documented at `supabase/migrations/001_initial_schema.sql:19`).
    Per-row DEK, KEK in env (plan was Vault, shipped as env).
  - GUC pattern for pg_cron is strong; env-var pattern for Next/Python
    is weaker (secret appears in shell history on any developer who
    exports it).
- **Context**: Secrets are managed via a mix of Vercel env UI + Railway
  env UI + Postgres GUCs + HMAC-at-rest for payload tokens. The KEK
  encryption story is sophisticated but only documented in plan files.
  There's no runbook for key rotation.
- **Decision**: Codify three secret classes: (1) platform secrets
  (Supabase, Resend, Upstash) — env vars, rotate via provider dashboards;
  (2) service-to-service secrets (`ANALYTICS_SERVICE_KEY`, `CRON_SECRET`) —
  env vars, rotate via provider + short cron grace period; (3) data
  protection secrets (`KEK`) — Railway env, rotate via `KEK_VERSION`
  column pattern. Document the pg_cron GUC pattern as an ADR-approved
  alternative for DB-originated calls.
- **Consequences**:
  - (+) Rotation runbook becomes possible.
  - (+) Surfaces the `KEK` rotation as an open question.
- **Action**: Write ADR as `docs/architecture/adr-0014-secret-handling.md`.
  Cross-link to rotation runbooks.
- **Fix effort**: small

---

### [ADR-0015] Client state: React local state + router refresh; no global store, no server-state lib
- **Status**: Accepted-retroactively
- **Priority**: Medium
- **Evidence in code**:
  - Grep for `useQuery`, `SWR`, `react-query`: zero matches.
  - Grep for `createContext`, `Provider`: 164 occurrences across 30
    components, mostly local `useState`/`useEffect`/`useTransition`.
    No app-wide providers.
  - `useRouter().refresh()` pattern for post-mutation revalidation:
    89 matches across 24 files (e.g. `AllocatorExchangeManager.tsx:21`).
  - No app-wide Context. URL state via `searchParams` only
    (`src/app/demo/page.tsx:84`, `src/app/(dashboard)/compare/page.tsx:12`).
  - No Supabase realtime subscriptions (grep for `supabase.channel`,
    `postgres_changes` returns nothing).
- **Context**: The team chose server-rendered-first: data arrives in
  props from Server Components, mutations POST to route handlers, then
  call `router.refresh()` to re-render the Server Component subtree
  with fresh data. No SWR/React-Query, no Zustand, no Redux. This is
  good — but it's an unwritten rule. A new dev will reach for
  React Query on day one.
- **Decision**: Codify "Server Components + `router.refresh()` after
  mutations. Optimistic updates live in local `useState`. URL is the
  primary cross-component state channel. No global stores, no server-state
  libraries, no realtime subscriptions." Document the escape hatches
  (e.g. when optimistic UX is worth the code).
- **Consequences**:
  - (+) Keeps bundle size small.
  - (−) Long-lived interactive UIs (Scenario Builder, etc.) may
    legitimately need more client state; the ADR has to allow explicit
    opt-outs.
- **Action**: Write ADR as `docs/architecture/adr-0015-client-state.md`.
- **Fix effort**: trivial

---

### [ADR-0016] Testing strategy: Vitest unit + Playwright E2E; jsdom; no MSW; no DB integration tests
- **Status**: Accepted-retroactively
- **Priority**: Medium
- **Evidence in code**:
  - `vitest.config.ts:1-17` — jsdom env, `src/test-setup.ts` for
    `ResizeObserver` stub.
  - `playwright.config.ts:1-29` — Chromium-only, webServer starts `npm
    run dev`, `trace: on-first-retry`.
  - `package.json:10-13` — `test: vitest run`, `test:e2e: playwright test`.
  - `src/**/*.test.ts(x)` — ~25 unit test files co-located with source.
    Examples: `src/lib/scenario.test.ts`, `src/lib/queries.test.ts`,
    `src/app/api/attestation/route.test.ts`.
  - `e2e/*.spec.ts` — 13 Playwright specs.
  - No MSW, no test containers for Supabase, no DB-level integration
    tests. `TODOS.md:52-63` explicitly flags "Partial unique index
    integration test (real Postgres)" as a gap.
  - `src/lib/playwright-console-filter.ts` + test pair — the team has
    extracted and unit-tested its own Playwright helpers (pattern from
    the lessons file).
  - Co-located tests use the same tsconfig as source
    (`tsconfig.json` — not checked but implied by `npm run typecheck`).
- **Context**: Current pyramid is heavy on unit + E2E and thin in the
  middle. Supabase reads/writes are mocked at the module level, which
  lets tests run fast but also lets RLS bugs slip through (you can mock
  `.select().eq()` to return whatever you want; that doesn't prove the
  actual policy works). The team knows this — migration 023's self-verifying
  DO block is essentially a DB-level unit test inline with the migration.
- **Decision**: Codify (a) Vitest for unit, (b) Playwright for E2E,
  (c) self-verifying DO blocks for migration-critical invariants,
  (d) an explicit non-goal of mocked DB integration tests, (e) when to
  write a test-containers-style Supabase integration test (the ADR
  should pick a specific category, e.g. RLS policies, migrations,
  and SECURITY DEFINER RPCs). This ADR is adjacent to the tech-debt
  agent's work — keep it focused on the *decision*, not coverage gaps.
- **Consequences**:
  - (+) Review gate: any new RLS-critical change needs a self-verifying
    migration or a DB integration test.
- **Action**: Write ADR as `docs/architecture/adr-0016-testing-strategy.md`.
- **Fix effort**: trivial

---

### [ADR-0017] Deployment topology: Vercel (Next) + Railway (FastAPI) + Supabase (Postgres/Auth/Storage)
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `vercel.json:1-7` — framework stub, Vercel hosts Next.js.
  - `analytics-service/railway.toml` — Railway hosts FastAPI.
  - `supabase/migrations/**` — Supabase hosts Postgres + Auth + Storage
    + pg_cron + pg_net + Edge Functions.
  - `README.md:78-88` tech-stack table ("Deploy: Vercel (frontend),
    Railway (analytics)").
  - `.github/workflows` contains CI (not fully audited here — flag for
    ADR-0018 which will cover CI/CD specifically).
  - Three hostnames in the trust boundary: the Vercel URL, the Railway
    URL, and the Supabase URL. All wired via env vars.
- **Context**: Three-provider topology is common but implicit. Failure
  modes are asymmetric (Supabase down → everything fails; Railway down
  → match engine + sync + warmup fail but read paths keep working;
  Vercel down → site down but pg_cron still runs). No diagram.
- **Decision**: Draw the diagram and capture the failure modes. State
  explicit non-goals: no self-hosting, no Kubernetes, no moving the
  FastAPI into Next.js route handlers. Document the single-region
  assumption (Vercel default, Railway default).
- **Consequences**:
  - (+) Incident response has a diagram.
  - (+) New contributors understand "what runs where" in one page.
- **Action**: Write ADR as `docs/architecture/adr-0017-deployment-topology.md`
  with a simple deployment diagram + failure-mode table.
- **Fix effort**: small

---

### [ADR-0018] Error handling: no error boundaries, exceptions bubble to Next default
- **Status**: Open question (high)
- **Priority**: High
- **Evidence in code**:
  - No `src/app/**/error.tsx` — zero matches.
  - No `src/app/**/global-error.tsx` — zero matches.
  - No `unstable_rethrow` calls.
  - Try/catch patterns vary:
    - Pattern A — fail-closed in layout:
      `src/app/(dashboard)/discovery/layout.tsx:41-55` wraps DB read
      in try/catch and renders the gate on failure.
    - Pattern B — silent fallback:
      `src/app/page.tsx:7-24` returns zeros on social-proof failure.
    - Pattern C — route handlers log + 500:
      `src/app/api/preferences/route.ts:19-22`.
    - Pattern D — server-component throws propagate:
      `src/lib/warmup-analytics.ts:11-17` warns "never throw — Server
      Components abort render on unhandled rejection in Next 16."
  - No "an error occurred" fallback UI at any route level.
- **Context**: Five+ different patterns for handling errors. No route
  has an `error.tsx`, so a Server Component throw renders Next's
  default error page in prod and crashes development in dev. The code
  comment at `warmup-analytics.ts:11-17` confirms the team knows this
  is dangerous; they just haven't built the fallback layer.
- **Decision**: Open question. Pick from:
  - (a) Add `error.tsx` at `(dashboard)/` and `(auth)/` segments with
    branded error UI.
  - (b) Add a global `src/app/global-error.tsx`.
  - (c) Establish a logger abstraction (ties into ADR-0010) + Sentry
    boundary.
  Also decide the policy for "when should a server read fail-closed vs
  fail-open" — migration 012/017 are a cautionary tale (silent no-ops).
- **Consequences**:
  - Today's state is that a single analytics DB hiccup during a
    dashboard page render crashes the route.
- **Action**: Make decision, write ADR as
  `docs/architecture/adr-0018-error-handling.md`.
- **Fix effort**: small (ADR); small-to-medium implementation

---

### [ADR-0019] Feature flags: single `system_flags` table row (match engine kill switch)
- **Status**: Accepted-retroactively
- **Priority**: Low
- **Evidence in code**:
  - `supabase/migrations/011_perfect_match.sql:44-52` creates
    `system_flags(key, enabled)` with a single seeded row
    `match_engine_enabled = true`.
  - `src/app/api/admin/match/kill-switch/route.ts:1-73` is the entire
    UI. No other flag exists.
  - No abstraction — every flag read is a direct SQL query.
- **Context**: The team has a single-flag pattern. There's no generic
  flag system (e.g. launchdarkly, unleash, or a `feature_flags` table
  with typed contexts). Adding a second flag would likely copy this
  pattern and end up with N ad-hoc tables.
- **Decision**: Choose: (a) accept `system_flags` as the canonical
  pattern and document how to add a new key; (b) adopt a proper
  feature-flag library when the N reaches 3. The ADR decides the
  tipping point.
- **Consequences**:
  - Low for now — single flag works. But the ADR prevents future
    drift.
- **Action**: Write ADR as `docs/architecture/adr-0019-feature-flags.md`.
- **Fix effort**: trivial

---

### [ADR-0020] Multi-tenancy + disclosure tier: per-row `tenant_id` + per-strategy `disclosure_tier`
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `supabase/migrations/012_disclosure_and_tenancy.sql:1-50` creates
    the disclosure-tier CHECK column on strategies, the tenant_id
    nullable column ("single-tenant in v1, partner becomes config
    change not schema migration"), and adds bio/years_trading/aum_range
    to profiles.
  - `src/lib/queries.ts:41-50` wraps manager-identity reads in a
    disclosure-tier gate ("only fetch for institutional-tier
    strategies"). Uses the admin client because column-level REVOKE
    forces service-role reads.
  - `src/lib/types.ts:31` — `DisclosureTier = "institutional" | "exploratory"`.
- **Context**: The team has made two big structural decisions: (1)
  multi-tenancy is per-row (nullable `tenant_id`), not multi-schema or
  multi-DB; (2) manager identity is gated in application code, not at
  the RLS level. Both are reasonable for v1 but invisible to anyone
  not reading migration 012's preamble.
- **Decision**: Document both. Nullable `tenant_id` is the partner-pilot
  model. Disclosure-tier gating lives in the `loadManagerIdentity`
  helper and must be the ONLY read path for bio/years_trading/aum_range.
  State explicitly that flipping a strategy to institutional tier is
  an allocator-visible disclosure event and must be audited.
- **Consequences**:
  - (+) Future partners plug in without a schema change.
  - (−) Partner isolation is soft (RLS must always filter by
    `tenant_id`) — the ADR must list which tables have `tenant_id`
    and which don't.
- **Action**: Write ADR as `docs/architecture/adr-0020-multitenancy-disclosure.md`.
- **Fix effort**: small

---

### [ADR-0021] CI/CD gates and the missing `crons:` block
- **Status**: Open question (high)
- **Priority**: High
- **Evidence in code**:
  - `.github/workflows/` directory exists but was NOT audited in full —
    flagging anyway because the topology decision depends on it.
  - `vercel.json:1-7` lacks a `crons:` key. Any Vercel Cron (e.g.
    warm-analytics) must be configured via the Vercel dashboard and
    is NOT version-controlled.
  - `package.json:5-14` has lint, typecheck, test, test:e2e — but
    no script that runs them all in order.
  - No `preview` environment variable documentation in `.env.example`.
- **Context**: The deployment topology (ADR-0017) exists but the
  "how does a change reach production" story is implicit. Without
  `crons:` in `vercel.json`, a redeploy can lose the schedule. Without
  a pinned CI gate, a PR can land with a failing typecheck.
- **Decision**: (Open.) (a) Move cron schedules into `vercel.json`
  (Vercel supports this); (b) enshrine the CI gates (typecheck + lint
  + test) in a workflow reference from this ADR; (c) document which
  envs get which secrets.
- **Consequences**:
  - (+) Everything is version-controlled.
- **Action**: Make decision, write ADR as
  `docs/architecture/adr-0021-cicd-and-schedules.md`.
- **Fix effort**: small

---

### [ADR-0022] Route-level auth gating: proxy optimistic → DAL authoritative
- **Status**: Accepted-retroactively
- **Priority**: High
- **Evidence in code**:
  - `src/proxy.ts:31-33` uses `supabase.auth.getSession()` — cookie-only,
    NOT a network call. Comment explicitly marks this as optimistic
    and says "authoritative getUser() should be called in server
    components/DAL."
  - Every Server Component then calls `supabase.auth.getUser()` —
    examples: `src/app/(dashboard)/layout.tsx:22`,
    `src/app/(dashboard)/allocations/page.tsx:27`,
    `src/app/(dashboard)/discovery/layout.tsx:32`. That's the
    authoritative check.
  - This is a proper DAL pattern, but it's only documented in the
    proxy.ts comment (lines 30-32). A new contributor may assume the
    proxy auth check is authoritative and skip the `getUser()` call in
    a new route.
- **Context**: The decision is sound (Supabase recommends this pattern)
  but invisible. Every new page or route handler must repeat the
  `getUser()` call. There's no enforcement — a missing call causes a
  silent authorization bypass on that specific route.
- **Decision**: Document the two-layer auth gate:
  - Layer 1: proxy optimistic session check (network-free, fast-path
    redirect to /login).
  - Layer 2: Server Component / route handler `supabase.auth.getUser()`
    as the authoritative check.
  - Mandate that every non-public route includes a Layer 2 call.
- **Consequences**:
  - (+) Surfaces the invariant so reviews can enforce it.
- **Action**: Write ADR as
  `docs/architecture/adr-0022-two-layer-auth-gate.md`.
- **Fix effort**: trivial

---

## Omitted / out of scope

These came up but belong in other audits:
- **Unused `adminActionLimiter`** in `src/lib/ratelimit.ts:58` — tech-debt.
- **Dead `useTransition` imports** / unused state — tech-debt.
- **DB schema design evolution** (normalization, indexes, constraints) —
  the migration plan is stable; this would be a future audit.
- **Python analytics service internals** (match engine design, portfolio
  optimizer algorithm, CCXT usage) — system-design.
- **Visual design / DESIGN.md compliance** — separate phase.
- **Dep version upgrades (Next 16.2.2 → latest, React 19.2.4 → latest)** —
  not architectural.
- **CI workflow file contents** — flagged in ADR-0021 but not reviewed in
  full.

---

## Recommended author order

1. **ADR-0005** (admin authorization) + **ADR-0001** (RLS primacy) — security-critical.
2. **ADR-0010** (observability) + **ADR-0018** (error handling) — must be
   decided before shipping to real pilot allocators.
3. **ADR-0004** (mutation API contract) — unblocks mechanical review of
   every new handler.
4. **ADR-0003** (three-client Supabase) — closes the admin-client footgun.
5. **ADR-0008** (cron architecture) + **ADR-0021** (CI/CD) — together fix
   the "crons aren't version-controlled" gap.
6. **ADR-0002, -0006, -0009, -0013, -0014, -0015, -0017, -0022** — the rest
   are mostly documentation passes.
7. **ADR-0007, -0011, -0012, -0016, -0019, -0020** — last; no behavior change.
