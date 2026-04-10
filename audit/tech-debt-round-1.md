# Tech-debt audit — round 1
Date: 2026-04-10
Scope: quantalyze src/ and project-root config. Excludes DB/RLS, API contracts, design system.

## Summary
- Total findings: 32
- Critical: 2, High: 9, Medium: 13, Low: 8

Headline items:

1. **`/portfolio-pdf/[id]` HTML rendering route is a public IDOR** — the Puppeteer source page reads ANY portfolio via the admin client with no auth/token gate and the route is in `PUBLIC_ROUTES`. Anyone who learns or guesses a portfolio UUID can exfiltrate full portfolio contents, strategies, narrative, correlations. (CRITICAL-01)
2. **`VERSION` file and `package.json` have drifted** — `0.4.0.0` vs `0.2.0`. `/ship` is supposed to bump both; the divergence breaks release cadence assumptions. (CRITICAL-02)
3. **CSRF Origin/Referer check only protects 2 routes** (`attestation`, `deletion-request`). Every other mutating API (intro, keys, trades/upload, preferences, portfolio-strategies/alias, admin/match/*) relies only on SameSite=Lax cookies. (HIGH-01)
4. **Zero `error.tsx` boundaries anywhere** — not at the root, route group, or dashboard level. Any server-component throw that escapes the try/catch renders the framework default, and `global-error.tsx` is also missing. (HIGH-02)
5. **`.env.example` is drifted from reality** — ~10 env vars are used in code but not listed; `ANALYTICS_SERVICE_URL` example port is wrong; `NEXT_PUBLIC_SENTRY_DSN` is listed but never wired. (HIGH-06)
6. **Analytics-service call plumbing is duplicated in 3 files** with different timeout handling and a type-drift risk. (MEDIUM-02)
7. **`src/lib/supabase/admin.ts` has no `import 'server-only'` guard** — any client component could import it and the service-role key would appear in the browser bundle at the first mistake. (HIGH-03)

---

## Findings

### [CRITICAL-01] `/portfolio-pdf/[id]` HTML page is a public IDOR via admin client
- **Category**: code
- **Priority**: Critical
- **Impact (1-5)**: 5
- **Risk (1-5)**: 5
- **Effort (1-5)**: 2
- **Score**: (5 + 5) × (6 − 2) = 40
- **Files**: src/app/portfolio-pdf/[id]/page.tsx:1-294, src/proxy.ts:4, src/app/api/portfolio-pdf/[id]/route.ts (caller), src/app/api/demo/portfolio-pdf/[id]/route.ts (caller)
- **What's wrong**: The HTML page that the PDF Puppeteer lambdas fetch is a server component that calls `createAdminClient()` (service-role, bypasses RLS) and reads `portfolios`, `portfolio_analytics`, `portfolio_strategies` for any `[id]` — with no auth check, no ownership check, and no token check. The route is in `PUBLIC_ROUTES` in `src/proxy.ts` so the proxy does not block unauthenticated access. The only protection is the UUIDv4 being unguessable, which is security-through-obscurity: UUIDs leak through logs, Referer headers, Plausible analytics, the URL bar, and shared screenshots. The auth-gated `/api/portfolio-pdf/[id]/route.ts` (which DOES check ownership) calls `${APP_URL}/portfolio-pdf/${id}` — so the public HTML page bypasses the very guard the API route enforces. An unauthenticated visitor hitting `https://quantalyze.com/portfolio-pdf/<any-uuid>` gets back the rendered portfolio HTML including name, AUM, total TWR, Sharpe, volatility, correlation matrix, optimizer suggestions, and narrative summary. The `/api/demo/portfolio-pdf/[id]` route solves the exact same problem with `verifyDemoPdfToken` — the same HMAC pattern should gate this page too.
- **Why it matters**: This is a direct data-exfiltration vulnerability on any real allocator portfolio. GDPR-sensitive; privacy-policy-breaking; institutional-grade reputational risk if a partner portfolio ID leaks. The fact that `createAdminClient()` is used here makes the breach wider than RLS would permit — even if RLS on `portfolio_analytics` were hardened, this page steps around it.
- **Proposed fix**: Gate `src/app/portfolio-pdf/[id]/page.tsx` with an HMAC token mirroring `src/lib/demo-pdf-token.ts`. Add a new secret env (e.g., `PORTFOLIO_PDF_SECRET`), write a `signPortfolioPdfToken(portfolioId, userId)` helper, have `/api/portfolio-pdf/[id]/route.ts` generate the token after its existing auth+ownership check, append `?token=...` to the internal `page.goto()` URL, and have `src/app/portfolio-pdf/[id]/page.tsx` call `verifyPortfolioPdfToken(id, token)` at the top and return 404/404-equivalent on failure. The allocator user cannot reach `/portfolio-pdf/[id]` directly; only the Puppeteer lambda carrying a signed token can render it. Keep `/portfolio-pdf` in `PUBLIC_ROUTES` since the token is the gate. Add a vitest test pinning that a token-less request returns 404.
- **Next.js 16 doc-check required?**: no

### [CRITICAL-02] Version drift: VERSION=0.4.0.0 but package.json=0.2.0
- **Category**: dependency
- **Priority**: Critical
- **Impact (1-5)**: 3
- **Risk (1-5)**: 4
- **Effort (1-5)**: 1
- **Score**: (3 + 4) × (6 − 1) = 35
- **Files**: VERSION:1, package.json:3
- **What's wrong**: `/VERSION` says `0.4.0.0` (matching CHANGELOG.md latest `[0.4.0.0]` entry). `/package.json` says `"version": "0.2.0"`. These are supposed to move together per the README's release doc and `/ship` workflow. The drift means `npm pkg get version` returns stale data, any deploy dashboards keyed to `package.json` are wrong, and any tool reading either source gets inconsistent values. It also implies `/ship` has been bypassing `package.json` at least since 0.2.0 → 0.4.0.0, so CI cannot rely on the package version as a source of truth.
- **Why it matters**: Release cadence, rollback accuracy, Vercel build labels, error-reporting tags that read `npm_package_version`, and any future dependency that exposes a `--version` flag all break silently. Tracking whether production is running 0.2 or 0.4 becomes manual.
- **Proposed fix**: Update `package.json` `"version"` to `"0.4.0.0"` so both files match. Then fix `/ship` (or wherever the version bump lives) so both files are bumped in the same commit — grep for `VERSION` writes in any ship/bump script and add `npm pkg set version=...` alongside. Add a Vitest or CI assertion that `VERSION` matches `package.json.version` to prevent future drift.
- **Next.js 16 doc-check required?**: no

### [HIGH-01] CSRF Origin/Referer check applied to only 2 of ~25 mutating routes
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 4
- **Risk (1-5)**: 4
- **Effort (1-5)**: 2
- **Score**: (4 + 4) × (6 − 2) = 32
- **Files**: src/lib/csrf.ts, src/app/api/attestation/route.ts:18-19 (has it), src/app/api/account/deletion-request/route.ts:20-21 (has it); MISSING on: src/app/api/intro/route.ts, src/app/api/preferences/route.ts, src/app/api/portfolio-alerts/route.ts, src/app/api/portfolio-documents/route.ts, src/app/api/portfolio-optimizer/route.ts, src/app/api/portfolio-strategies/alias/route.ts, src/app/api/keys/encrypt/route.ts, src/app/api/keys/validate/route.ts, src/app/api/keys/validate-and-encrypt/route.ts, src/app/api/keys/sync/route.ts, src/app/api/trades/upload/route.ts, src/app/api/verify-strategy/route.ts, src/app/api/admin/allocator-approve/route.ts, src/app/api/admin/intro-request/route.ts, src/app/api/admin/notify-submission/route.ts, src/app/api/admin/partner-import/route.ts, src/app/api/admin/strategy-review/route.ts, src/app/api/admin/match/decisions/route.ts, src/app/api/admin/match/kill-switch/route.ts (POST), src/app/api/admin/match/preferences/[allocator_id]/route.ts, src/app/api/admin/match/recompute/route.ts, src/app/api/admin/match/send-intro/route.ts
- **What's wrong**: `src/lib/csrf.ts` provides `assertSameOrigin(req)` as a defense-in-depth layer on top of Supabase's SameSite=Lax cookie. It's currently called from only `attestation` and `deletion-request`. Every other mutating route (POST/PUT/PATCH/DELETE) skips the check. SameSite=Lax blocks most cross-site POSTs but NOT top-level GETs-turned-forms, subdomain attacks, and some cross-origin patterns that exploit opaque CORS. The comment in `assertSameOrigin` literally calls it "defense-in-depth" and the two routes that use it demonstrate the pattern; the rest of the codebase just didn't get the retrofit.
- **Why it matters**: An attacker who gets a logged-in user to open a malicious page can trigger state changes on the allocator's behalf — sending intros, changing preferences, uploading trades, renaming investments, recomputing matches, toggling the match kill-switch. Admin routes are particularly nasty because they use the service-role client downstream.
- **Proposed fix**: Create a `withCsrf(handler)` wrapper in `src/lib/api/withCsrf.ts` that composes `assertSameOrigin` with an existing handler, then apply it to every route in the list above. Alternatively, thread a `csrfError = assertSameOrigin(req); if (csrfError) return csrfError;` line after the request parse and before any DB work in each route. Add a CI-time check (grep) that fails if any file under `src/app/api/**/route.ts` with a non-GET export doesn't reference `assertSameOrigin` — this keeps new routes from silently skipping the check. The two existing tests demonstrating the pattern (`deletion-request/route.test.ts`) are reusable as a template.
- **Next.js 16 doc-check required?**: no

### [HIGH-02] Zero error boundaries — no `error.tsx`, no `global-error.tsx`
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 4
- **Risk (1-5)**: 4
- **Effort (1-5)**: 2
- **Score**: (4 + 4) × (6 − 2) = 32
- **Files**: src/app/ (entire tree)
- **What's wrong**: `find src/app -name 'error.tsx' -o -name 'global-error.tsx'` returns zero results. Next.js App Router uses `error.tsx` at each segment to recover from server-component throws that escape try/catch, and `global-error.tsx` at the root for layout-level crashes. Without either, a single uncaught rejection in any server component drops the user onto Next's default error page with no branding, no action to recover, and no clean handoff to the user. Several server components (e.g., `src/app/(dashboard)/layout.tsx`, `src/lib/queries.ts`) wrap critical calls in try/catch, but downstream routes like `/portfolios/[id]/page.tsx`, `/demo/page.tsx`, `/strategies/page.tsx` have throwing paths (Supabase errors, JSON.parse, adapter failures) that bubble up untouched.
- **Why it matters**: Any transient Supabase blip becomes a full-page crash with no recovery UX. For an "institutional" audience this is a trust-killing moment. Also prevents feeding the error into observability (a `global-error.tsx` is the canonical place to wire Sentry).
- **Proposed fix**: Add `src/app/global-error.tsx` (Client Component, must render its own `<html>` and `<body>`) with a minimal brand shell, a Reset button, and — when wired — a Sentry capture. Add `src/app/(dashboard)/error.tsx` with a Reset button and a link back to `/discovery/crypto-sma`. Add `src/app/(auth)/error.tsx` redirecting to `/login`. Keep them minimal — one per route group. Ship without Sentry integration first, add a TODO for the observability wiring. Doc-check: Next.js 16 error.tsx file convention + behavior (was stable in 13, but the `global-error.tsx` rules about owning `<html>` are easy to get wrong).
- **Next.js 16 doc-check required?**: yes

### [HIGH-03] `src/lib/supabase/admin.ts` lacks `import 'server-only'` protection
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 5
- **Risk (1-5)**: 4
- **Effort (1-5)**: 1
- **Score**: (5 + 4) × (6 − 1) = 45
- **Files**: src/lib/supabase/admin.ts:1-12
- **What's wrong**: `createAdminClient` reads `SUPABASE_SERVICE_ROLE_KEY` and returns a root-privileged Supabase client. It's imported from 18+ files, all of them server-only today. There is no `import 'server-only';` at the top of `src/lib/supabase/admin.ts`, so nothing in the type system or build stops a "use client" file from importing it. The moment that happens, the bundler pulls the service-role key into the client bundle — because `SUPABASE_SERVICE_ROLE_KEY` is a non-`NEXT_PUBLIC_` env var, Next will throw at build time IF the import chain is static, but any dynamic-import or re-export path can defeat that. Even without leaking the key, a broken build is a P0 incident.
- **Why it matters**: Defense-in-depth against the most dangerous accidental refactor in the codebase — moving server data-fetching into a client component for perceived simplicity. The `server-only` package has existed since Next 13 specifically for this. Same concern applies less critically to `src/lib/api/withAdminAuth.ts` and `src/lib/admin/match.ts`.
- **Proposed fix**: Add `import 'server-only';` as the first line of `src/lib/supabase/admin.ts`. Also add it to `src/lib/api/withAdminAuth.ts` and `src/lib/admin/match.ts`. Run typecheck + build to confirm no client-component import chain exists today (if one does, fix it). Add a CI grep that fails if any file containing `SUPABASE_SERVICE_ROLE_KEY` doesn't also include `server-only`.
- **Next.js 16 doc-check required?**: no

### [HIGH-04] Duplicated PDF route boilerplate across 4 files (~400 LoC copied)
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 3
- **Score**: (3 + 3) × (6 − 3) = 18
- **Files**: src/app/api/portfolio-pdf/[id]/route.ts:1-106, src/app/api/demo/portfolio-pdf/[id]/route.ts:1-143, src/app/api/factsheet/[id]/pdf/route.ts:1-114, src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:1-118
- **What's wrong**: All four PDF routes repeat the same 40-60 line Puppeteer scaffold: rate-limit check → acquirePdfSlot → launchBrowser → newPage → setViewport → setDefaultTimeout → goto → pdf → close in finally → release. They differ only in URL template, filename, Cache-Control header, and the pre-PDF validation query. When `/demo/portfolio-pdf` needed RFC-2183 filename sanitization, only that one file got it; the other three are still vulnerable to header-injection via a future `portfolio.name` that contains CR/LF. When `/demo/portfolio-pdf` needed no-store caching, the lesson didn't propagate. Any future fix (e.g., adding page.waitForTimeout, or a retry on networkidle0 timeout) has to be made in four places.
- **Why it matters**: Bug-drift over time. Also mild inconsistency risk: `/api/factsheet/[id]/pdf` uses `private, max-age=86400` (no shared-CDN), `/api/portfolio-pdf/[id]` uses `s-maxage=3600, stale-while-revalidate=86400` (public shared CDN — WRONG for owner-gated data, can cache across viewers on shared edges), `/api/factsheet/[id]/tearsheet.pdf` uses `s-maxage=3600, stale-while-revalidate=86400`, and `/api/demo/portfolio-pdf` uses `private, no-store`. The `/api/portfolio-pdf` route is owner-gated but gives the shared CDN permission to hold a rendered PDF — that's the same leak shape as the IDOR in CRITICAL-01, just via cache.
- **Proposed fix**: Extract `src/lib/pdf-route.ts` with a `renderPdfRoute({ urlPath, filename, cacheControl, validate, viewport, format, margin, rateLimitKey })` helper that wraps the rate-limit → semaphore → launchBrowser → goto → pdf → close cycle. Each route becomes ~15 lines. While you're in there, fix the `/api/portfolio-pdf/[id]` Cache-Control to `private, max-age=60` (or `no-store`) and move the filename sanitizer into the shared helper. Add a Vitest test that the helper sanitizes `\r`, `\n`, `"` from filenames.
- **Next.js 16 doc-check required?**: no

### [HIGH-05] `trades/upload` accepts arbitrary objects with no schema validation
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 4
- **Risk (1-5)**: 4
- **Effort (1-5)**: 2
- **Score**: (4 + 4) × (6 − 2) = 32
- **Files**: src/app/api/trades/upload/route.ts:1-48
- **What's wrong**: The route pulls `trades` straight out of `req.json()` as `Array<any>` and feeds it to `admin.from("trades").insert(batch)` using the service-role client. There is no per-row schema validation — any columns a caller sends (including `user_id`, `strategy_id`, `id`, `computed_at`, `created_at`) will be inserted verbatim. The only guards are "must be an array", "at most 50000 rows", and an ownership check on the parent strategy. The CSV-upload client generates well-formed rows, but a malicious authenticated caller can POST `{strategy_id: owned_id, trades: [{strategy_id: other_id, ...}]}` and insert rows against a strategy they do NOT own — because only the top-level `strategy_id` is verified, not each row's `strategy_id`. That's a cross-user write primitive.
- **Why it matters**: Authenticated cross-user data corruption. Also a foot-gun for future column additions — any PII or sensitive column added to `trades` becomes directly settable from the client.
- **Proposed fix**: Define a strict `TradeUploadRow` type in `src/lib/types.ts`. Write a `validateTradeRow(row, strategyId, userId): TradeUploadRow | null` helper that whitelists exactly the columns the route is allowed to insert (timestamp, symbol, side, price, quantity, fee, order_type, exchange) and REJECTS any row whose client-supplied `strategy_id` doesn't match the verified `strategy_id`. Strip `id` and `user_id` fields. Fail fast on any unknown key. Apply per-row inside the batch loop. Add a vitest test that a mixed-strategy payload is rejected.
- **Next.js 16 doc-check required?**: no

### [HIGH-06] `.env.example` drifted from actual env usage — ~10 vars missing, 2 stale
- **Category**: documentation / infrastructure
- **Priority**: High
- **Impact (1-5)**: 3
- **Risk (1-5)**: 4
- **Effort (1-5)**: 1
- **Score**: (3 + 4) × (6 − 1) = 35
- **Files**: .env.example:1-33
- **What's wrong**: Comparing `.env.example` to grep `process.env` in `src/`:
  - Missing entirely: `NEXT_PUBLIC_APP_URL` (used in all 4 PDF routes + email helpers), `NEXT_PUBLIC_SITE_URL` (used in csrf.ts for allowlist), `NEXT_PUBLIC_PLATFORM_NAME` (used in legal pages + Disclaimer + footer), `PLATFORM_NAME`, `PLATFORM_EMAIL` (email.ts), `CRON_SECRET` (alert-digest + warm-analytics), `DEMO_PDF_SECRET` (demo-pdf-token.ts), `RESEND_API_KEY` (email.ts — listed as analytics-service concern only, but the Next app also uses it), `PUPPETEER_EXECUTABLE_PATH` (puppeteer.ts for local dev overrides), `PORTFOLIO_PDF_SECRET` (will be added for CRITICAL-01)
  - Drifted value: `.env.example` says `ANALYTICS_SERVICE_URL=http://localhost:8000` but every in-code default is `http://localhost:8002` (src/lib/analytics-client.ts:1, src/app/api/portfolio-optimizer/route.ts:5, src/app/api/admin/match/eval/route.ts:5). A new dev copying `.env.example` verbatim hits a connection error immediately.
  - Dead var: `NEXT_PUBLIC_SENTRY_DSN` is in `.env.example` but grep for `Sentry|sentry` in `src/` returns zero — there is no Sentry wiring. The variable is vestigial.
  - `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` IS wired (in `src/app/layout.tsx`) so that one is fine.
- **Why it matters**: Onboarding friction — a new developer can't tell which env vars are actually needed, and the one they do paste in has the wrong port. Operators re-configuring production miss vars that are critical (`CRON_SECRET` gate failure → cron returns 500, looks like an outage). Dead `NEXT_PUBLIC_SENTRY_DSN` is a credibility hit in the .env review — implies observability that doesn't exist.
- **Proposed fix**: Rewrite `.env.example` to match `src/` exactly. Group vars by required/optional. Fix the `ANALYTICS_SERVICE_URL` port to `8002`. Remove `NEXT_PUBLIC_SENTRY_DSN` (or wire Sentry). Add all missing vars with a one-line comment each explaining their effect when missing (fail-closed vs fail-open). Add a vitest test that parses `.env.example` and asserts every `process.env.X` reference in `src/` is either in `.env.example` or in an explicit "internal only" allowlist (e.g., `VERCEL`, `NODE_ENV`, `AWS_LAMBDA_FUNCTION_NAME`, `CI`).
- **Next.js 16 doc-check required?**: no

### [HIGH-07] `verify-strategy/[id]/status` uses non-constant-time token comparison
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 1
- **Score**: (3 + 3) × (6 − 1) = 30
- **Files**: src/app/api/verify-strategy/[id]/status/route.ts:28
- **What's wrong**: `if (verification.public_token !== token)` compares a 64-char HMAC token via JS `!==`, which short-circuits at the first differing byte. That leaks timing. `src/lib/demo-pdf-token.ts` already solves this with `timingSafeEqual`, and `src/app/api/cron/warm-analytics/route.ts` has a `safeCompare` helper for the cron secret. The same primitive is needed here.
- **Why it matters**: A remote attacker can probe one byte at a time to reconstruct a verification token via timing. The token gates strategy verification results which include exchange balances and P&L — valuable to exfiltrate.
- **Proposed fix**: Import `timingSafeEqual` from `crypto`, buffer both strings, length-check first, then compare. The `safeCompare` helper in `src/app/api/cron/warm-analytics/route.ts:30-35` is lift-and-shiftable — extract it into `src/lib/timing-safe-compare.ts` and reuse in both places. Add a regression test.
- **Next.js 16 doc-check required?**: no

### [HIGH-08] Analytics service fetch client duplicated 3× with drift
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 2
- **Score**: (3 + 3) × (6 − 2) = 24
- **Files**: src/lib/analytics-client.ts:1-88, src/app/api/portfolio-optimizer/route.ts:5-101, src/app/api/admin/match/eval/route.ts:5-47
- **What's wrong**: `src/lib/analytics-client.ts` exists as the single-source fetch wrapper for the Python analytics service (it handles JSON content-type negotiation, non-JSON error responses, connection errors, and has 8 typed entrypoints). But two routes bypass it and reinvent the wheel:
  - `src/app/api/portfolio-optimizer/route.ts` reads `ANALYTICS_SERVICE_URL` + `ANALYTICS_SERVICE_KEY` directly, fetches with a 60s `AbortSignal.timeout`, has its own error handling.
  - `src/app/api/admin/match/eval/route.ts` does the same with no timeout at all.
  - `src/lib/warmup-analytics.ts` does a third pattern (2s AbortController).
  - `src/app/api/cron/warm-analytics/route.ts` does a fourth pattern (5s AbortController).
  The client has NO timeout, the optimizer has 60s, the eval has none (infinite), the warmup has 2s. Any future change to the contract (headers, auth scheme, retry policy) has to touch five places and is guaranteed to drift.
- **Why it matters**: Future incidents where the analytics service misbehaves will hit four different code paths with four different resilience profiles. A 60s timeout on the optimizer keeps a Vercel lambda blocked for a full minute on a hang, which is a lambda-exhaustion vector.
- **Proposed fix**: Extend `src/lib/analytics-client.ts` with:
  1. A configurable timeout on `analyticsRequest` (default 10s).
  2. Two new functions: `evalMatch(params)` for the match-eval endpoint and re-expose `runPortfolioOptimizer` (which already exists!) with a timeout option.
  The `runPortfolioOptimizer` function ALREADY EXISTS in analytics-client.ts at line 68 — `src/app/api/portfolio-optimizer/route.ts` just doesn't use it. Wire that route through the client instead. Same for the eval route. Delete the in-route env reads. Doc the timeout semantics.
- **Next.js 16 doc-check required?**: no

### [HIGH-09] `AllocatorExchangeManager.handleSync` is placeholder code that lies to users
- **Category**: code
- **Priority**: High
- **Impact (1-5)**: 4
- **Risk (1-5)**: 3
- **Effort (1-5)**: 2
- **Score**: (4 + 3) × (6 − 2) = 28
- **Files**: src/components/exchanges/AllocatorExchangeManager.tsx:165-190
- **What's wrong**: The "Sync now" button on the exchange connections page updates `api_keys.last_sync_at = now()` via the browser Supabase client, waits 800ms with `setTimeout`, and shows "just now" in the relative-time column. No actual sync happens — the comment in `handleSync` acknowledges this: "for the seeded demo this is a no-op... in production this would fire a backend endpoint that queues a trade pull." There IS a real sync route (`/api/keys/sync/route.ts`) used by the strategy-side flow, but the allocator-side flow wires to `supabase.from("api_keys").update(...)` instead of calling it. A real allocator clicking "Sync now" sees the timestamp jump to "just now" but no trades were actually fetched and no analytics were recomputed. Worse: the browser client writes `last_sync_at` directly, so the user can fake their sync state trivially.
- **Why it matters**: The whole product story is "exchange-verified data" — a sync button that only updates a timestamp is the exact anti-feature. This will break the first real customer on first contact. It's also a data-integrity problem: `last_sync_at` no longer reflects actual last sync. Any downstream staleness logic keyed on `last_sync_at` is now lying.
- **Proposed fix**: Replace the fake `handleSync` with a `fetch("/api/keys/sync", { method: "POST", body: JSON.stringify({ strategy_id: ... }) })` call. If the allocator flow doesn't have a `strategy_id` because it's account-level, add a new `/api/exchanges/sync` route that takes `{ api_key_id }`, does ownership check, then calls the analytics service to pull fresh trades. Remove the browser-client direct UPDATE on `api_keys`. Until a real backend exists, hide the "Sync now" button entirely or label it "Refresh last-seen" so the UX doesn't misrepresent the state. Add a comment at the top of the component explaining the contract.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-01] `MyAllocationClient.tsx` is 1218 lines — single file hosting ~7 components
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 3
- **Risk (1-5)**: 2
- **Effort (1-5)**: 3
- **Score**: (3 + 2) × (6 − 3) = 15
- **Files**: src/app/(dashboard)/allocations/MyAllocationClient.tsx:1-1218
- **What's wrong**: The file holds `TimeframeSelector`, `MultiLineEquityChart`, `StrategyLegend`, `AllocationPie`, `MetricCard`, `AliasEditor`, and the main `MyAllocationClient` — all inline. It also has `normalizeDailyReturns`, `displayName`, `getTimeframeStart`, `isoDate` utility functions. Editing it requires loading 1218 lines into memory every time. The scrollbar overshoots happen reliably during code review. Shares the MetricCard pattern with `ScenarioBuilder.tsx` (duplicated) — both define a `MetricCard` component inline that's byte-identical apart from styling knobs.
- **Why it matters**: Review burden, merge conflicts, cognitive load, reuse friction. The inline `MetricCard` dup is now visible in two places and will drift.
- **Proposed fix**: Extract the chart into `src/components/scenarios/MultiLineEquityChart.tsx` (reusable from ScenarioBuilder), `src/components/portfolio/AllocationPie.tsx`, `src/components/ui/TimeframeSelector.tsx`, `src/components/ui/MetricCard.tsx` (shared with ScenarioBuilder), `src/components/portfolio/AliasEditor.tsx`. Move `normalizeDailyReturns` + `getTimeframeStart` to `src/lib/scenario.ts` (next to the rest of the scenario math). Keep `MyAllocationClient` as orchestration only. Target < 400 LoC for `MyAllocationClient.tsx`. No behavior change; pure mechanical extract with the existing tests covering scenario math.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-02] `AllocatorMatchQueue.tsx` is 1028 lines with inline sub-components and useEffect
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 3
- **Risk (1-5)**: 2
- **Effort (1-5)**: 4
- **Score**: (3 + 2) × (6 − 4) = 10
- **Files**: src/components/admin/AllocatorMatchQueue.tsx:1-1028
- **What's wrong**: 1028 lines with the `MatchQueueSkeleton`, `ModeBadge`, `ShortlistCard`, header, filter bar, two-pane layout, keyboard help modal, etc. all inline. Has `// eslint-disable-next-line react-hooks/exhaustive-deps` on line 243 (the comment explains why but the lint suppression is a smell). The fetch-store-loader pattern is custom (loadIdRef pattern for race condition handling) — this is exactly what React Query or SWR would handle out of the box, but those are not dep-upgradeable in scope. At minimum the inline sub-components can be extracted.
- **Why it matters**: Same as MEDIUM-01 — cognitive load, review burden. Also, the homegrown race-handling logic is easy to break in the next PR that touches this file.
- **Proposed fix**: Extract `ModeBadge`, `ShortlistCard`, `MatchQueueSkeleton`, `ShortcutHelpModal` into standalone files under `src/components/admin/match/`. Extract the fetch+state logic into a `useMatchQueueData(allocatorId, sourceApiPath)` hook in `src/hooks/`. Keep the main component as layout orchestration. Document the loadIdRef pattern prominently in the extracted hook. No dep upgrades.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-03] 34 `as unknown as` type assertions — especially in lib/queries.ts, lib/admin/match.ts
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 2
- **Risk (1-5)**: 3
- **Effort (1-5)**: 4
- **Score**: (2 + 3) × (6 − 4) = 10
- **Files**: src/lib/queries.ts:112,632,636,645; src/lib/admin/match.ts:141-224 (7 sites); src/components/org/OrganizationTab.tsx:41,50; src/components/strategy/CompareTable.tsx:33; src/app/api/alert-digest/route.ts:44; src/app/api/demo/portfolio-pdf/[id]/route.ts:110 (pdfBuffer as BodyInit); src/app/api/portfolio-pdf/[id]/route.ts:75; src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:87; src/app/api/factsheet/[id]/pdf/route.ts:84; others
- **What's wrong**: The `as unknown as` double-cast is the TypeScript equivalent of "I give up." Several of the casts in `src/lib/admin/match.ts` are load-bearing (Supabase's generated types for embedded joins don't flatten cleanly) but that's precisely the argument for a single `type SupabaseEmbedRow<T>` helper and a `castEmbedRow` function — right now each site reinvents the cast, often with slightly different shapes. In `src/lib/queries.ts:632-645` the casts are reaching into raw responses to pull fields; a single typed `rawRow` helper would make the intent obvious and the cast surface shrink. The `Buffer.from(pdfBuffer) as unknown as BodyInit` is repeated 4x across PDF routes and should be extracted alongside the pdf-route helper in HIGH-04.
- **Why it matters**: Each `as unknown as` is a future bug — the type checker has been told "trust me" about a shape that isn't actually verified. When the DB column renames, TypeScript won't catch it, and the bug appears at runtime. Also spreads the `as unknown as` pattern as "acceptable" to the next engineer who encounters an inconvenient type.
- **Proposed fix**: Create `src/lib/supabase/types.ts` with:
  1. `castEmbedRow<T>(raw: unknown): T` — validates `typeof raw === "object"` and returns a typed row, throws on null to make the call site explicit.
  2. `castEmbedArray<T>(raw: unknown): T[]` — same for array shapes.
  3. `toBodyInit(buffer: Buffer): BodyInit` — typed helper for the pdfBuffer cast.
  Replace the 30+ `as unknown as` sites incrementally (start with `lib/admin/match.ts` since it has the most). No behavior change.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-04] `/api/keys/encrypt` and `/api/keys/validate` are now dead code superseded by `/api/keys/validate-and-encrypt`
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 2
- **Risk (1-5)**: 3
- **Effort (1-5)**: 1
- **Score**: (2 + 3) × (6 − 1) = 25
- **Files**: src/app/api/keys/encrypt/route.ts:1-21, src/app/api/keys/validate/route.ts:1-21, src/app/api/keys/validate-and-encrypt/route.ts:1-29
- **What's wrong**: `/api/keys/encrypt` and `/api/keys/validate` are simple wrappers around `encryptKey`/`validateKey` in `analytics-client.ts`. `/api/keys/validate-and-encrypt` was added to "validate and encrypt atomically to prevent TOCTOU race" (per the comment on line 14 of validate-and-encrypt/route.ts). Grepping for callers: the only consumers of `/api/keys/encrypt` and `/api/keys/validate` are... nothing in src/. `ApiKeyManager.tsx`, `StrategyForm.tsx`, `AllocatorExchangeManager.tsx` all call `/api/keys/validate-and-encrypt`. The two older routes are now an attack surface that exposes the non-TOCTOU-safe variants — and they're still `withAuth`-gated, so an authenticated caller can explicitly choose the TOCTOU-vulnerable path.
- **Why it matters**: Dead code becomes an attack vector. Specifically: the older routes skip the "validation must happen IN THE SAME CALL as encryption" invariant. A malicious (authenticated) caller could validate a read-only key, then between validation and encryption swap it for a trading key. The whole point of the combined endpoint was to close that gap.
- **Proposed fix**: Delete `src/app/api/keys/encrypt/route.ts` and `src/app/api/keys/validate/route.ts` in a standalone PR. Grep the E2E and tests one more time to confirm no caller. Add a note in CHANGELOG.md.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-05] Only 4 of ~25 API routes have vitest route.test.ts files
- **Category**: test
- **Priority**: Medium
- **Impact (1-5)**: 4
- **Risk (1-5)**: 3
- **Effort (1-5)**: 4
- **Score**: (4 + 3) × (6 − 4) = 14
- **Files**: src/app/api/account/deletion-request/route.test.ts, src/app/api/attestation/ (test exists per grep), src/app/api/cron/warm-analytics/route.test.ts, src/app/api/keys/validate-and-encrypt/ (test exists)
- **What's wrong**: Context said 466 unit tests pass — but those are almost entirely in `src/lib/*.test.ts`. API routes are the boundary between untrusted input and the DB, yet only 4 route handlers have tests. Untested critical paths: `intro`, `keys/sync`, `trades/upload`, `verify-strategy`, `preferences` (GET + PUT), `portfolio-alerts` (GET + PATCH), `portfolio-documents` (GET + POST), `portfolio-optimizer`, `portfolio-strategies/alias`, every admin route, `portfolio-pdf`, `factsheet/*/pdf`. Any bug in any of these ships to prod with zero automated verification.
- **Why it matters**: The CSRF retrofit (HIGH-01) needs test coverage. HIGH-05 (`trades/upload` schema validation) needs regression tests. Every future refactor is rolling the dice.
- **Proposed fix**: Use `src/app/api/account/deletion-request/route.test.ts` as the template (it's the most complete route test in the repo). Prioritize the routes with cross-user write primitives first: `trades/upload`, `portfolio-strategies/alias`, `portfolio-documents`, `portfolio-optimizer`, `intro`, `admin/match/decisions`, `admin/match/send-intro`, `admin/match/preferences/[allocator_id]`. Aim for one test per route that exercises the auth-deny path + one happy path + one validation-reject path. Write them as the CSRF retrofit from HIGH-01 lands, not before, so the tests pin the new behavior.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-06] README documents migrations up to 014 but we're on 026
- **Category**: documentation
- **Priority**: Medium
- **Impact (1-5)**: 2
- **Risk (1-5)**: 2
- **Effort (1-5)**: 1
- **Score**: (2 + 2) × (6 − 1) = 20
- **Files**: README.md:23-36
- **What's wrong**: README.md line 27 says "run all files in order: 001 ... 014" and line 34 references "Migration 014 adds the nullable strategies.codename column." We're on 026 (as of the current commit — `supabase/migrations/` contains 26 files through 026). The Quick Start instructions will only carry a new developer through 014; they'll miss partner_tag, PII hardening, notification dispatches, portfolios.is_test, user_favorites, portfolio_strategies.alias, and the organization RLS fix. Also references hardcoded CLAUDE.md `Project Structure` stale paths (`(dashboard)/portfolios/`).
- **Why it matters**: Onboarding breaks. New dev hits 014, tries to log in, and half the app throws PGRST205 errors because migration 011 was "the last one" per README, and the app assumes 026-level schema.
- **Proposed fix**: Rewrite the README "Run database migrations" section to just say "run all files in `supabase/migrations/` in numeric order." Drop the hardcoded migration-by-number callouts entirely — keep the `ALTER DATABASE postgres SET app.admin_email = ...` pre-migration step since it genuinely needs to happen BEFORE migration 011 runs. Add a line near the top pointing new devs to CHANGELOG.md for latest changes.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-07] `allocations/page.tsx` double-fetches `api_keys` in the empty-state path
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 2
- **Risk (1-5)**: 2
- **Effort (1-5)**: 2
- **Score**: (2 + 2) × (6 − 2) = 16
- **Files**: src/app/(dashboard)/allocations/page.tsx:31-57, src/lib/queries.ts:555-568 (inside getMyAllocationDashboard)
- **What's wrong**: `getMyAllocationDashboard` already fetches `api_keys` via the admin client in the no-portfolio branch (lines 555-568 of queries.ts). Then `allocations/page.tsx:56` passes `apiKeys` to `<AllocatorExchangeManager initialKeys={apiKeys} />` in the empty state. But `<AllocatorExchangeManager>` reads the api_keys state as `initialKeys` without re-verifying against the DB, then when the user clicks "Add key" it does another round of Supabase writes via the browser client — all good. The issue is actually reversed: `getMyAllocationDashboard` when `portfolio == null` fetches api_keys using the ADMIN client but filters by `userId` manually, while the exchange-only path `src/app/(dashboard)/exchanges/page.tsx` ALSO fetches api_keys using the admin client with manual user_id filter. Two separate implementations of "give me this user's api_keys" instead of a single `getUserApiKeys(userId)` helper in queries.ts. Low urgency but obvious tech debt.
- **Why it matters**: Two copies of the same query with slightly different column projections. If the api_keys schema gets a new column, both call sites have to be updated.
- **Proposed fix**: Extract `getUserApiKeys(userId: string): Promise<ApiKeyRow[]>` into `src/lib/queries.ts`, use it from both `allocations/page.tsx` empty-state branch and `exchanges/page.tsx`. Single column list.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-08] Legacy admin-gate `isAdmin(email)` still coexists with `isAdminUser(supabase, user)` in proxy.ts
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 3
- **Score**: (3 + 3) × (6 − 3) = 18
- **Files**: src/lib/admin.ts:13-16, src/proxy.ts:71-82, src/lib/admin/match.ts (uses the column is_admin in SQL RPCs)
- **What's wrong**: `src/lib/admin.ts` comment block documents: "As of migration 011, we check BOTH the legacy email-based gate AND the new profiles.is_admin column. This OR pattern allows zero-downtime rollout — once is_admin is fully populated and verified across all admin pages, the email check can be dropped. See TODOS.md (P2)." The `isAdminUser` function uses the OR pattern correctly. The PROXY middleware (src/proxy.ts:71-82), however, only checks the email. That comment acknowledges it: "this proxy check needs a JWT custom claim or a session cache. Tracked in TODOS.md (P2: drop email-based gate)." The hybrid state is now the status quo. A second admin (added via `profiles.is_admin = true` with a different email) would pass `withAdminAuth` at the API layer but be bounced by the proxy before they even reach the admin page — and the bounce is a redirect with no explanation. Support load in disguise.
- **Why it matters**: It's not a correctness bug today because there's only one admin (the founder). The moment a second admin is added, it becomes an incident. Also represents accumulated design debt that makes future auth work harder to reason about.
- **Proposed fix**: Two options:
  1. Add a JWT custom claim via Supabase Auth hook that mirrors `profiles.is_admin`, read it in the proxy. Requires a DB function + custom auth hook — not trivial but clean.
  2. Cache `is_admin` in a cookie on successful isAdminUser call, read in the proxy. Simpler, requires a small cache-miss fall-through path.
  Pick one and track the migration. Not urgent until there are 2+ admins. Low effort to at least add an ADR.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-09] `src/app/api/portfolio-optimizer/route.ts` hard-codes a 60s timeout inside the serverless lambda
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 1
- **Score**: (3 + 3) × (6 − 1) = 30
- **Files**: src/app/api/portfolio-optimizer/route.ts:45
- **What's wrong**: `AbortSignal.timeout(60000)` sets a 60-second limit. Vercel Hobby-plan function timeout is 10 seconds, Pro is 60 seconds — so this route can blow the lambda budget on a slow optimizer call. Combined with HIGH-08 (bypasses the analytics-client helper which has no timeout), any hang on the analytics service holds the function open for a full minute of billable time. No retry, no half-open circuit breaker, no timeout-short-circuit after the 1st failure within a window.
- **Why it matters**: Lambda cost blowup + customer-facing latency ceiling of 60s. Also blocks the user's lambda from handling other requests during the hang.
- **Proposed fix**: Roll this into the HIGH-08 fix — move the call through `analytics-client.ts` with an explicit 15-second timeout. Optimizer routinely takes 3-8s on normal portfolios; 15s is already generous. Add a 504 fast-fail path distinct from the 503 unreachable path so the client can show different messaging.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-10] Signup form allows 6-char passwords with no server-side enforcement
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 1
- **Score**: (3 + 3) × (6 − 1) = 30
- **Files**: src/components/auth/SignupForm.tsx:73
- **What's wrong**: `<Input minLength={6} />` on the signup form. HTML `minLength` is a client-only hint — an attacker can POST directly to Supabase Auth with a 1-char password. Supabase has its own password policy (configurable server-side) but nothing in the repo verifies or documents what it's set to. The `/login` form has no length hint at all. For an "institutional" audience, a 6-char minimum is well below any modern recommendation (NIST 800-63b says 8+ min, 64+ allowed).
- **Why it matters**: Weak credentials = credential-stuffing vector + first-to-get-popped when a list leaks. Also a credibility issue during any security questionnaire from a partner allocator.
- **Proposed fix**: Bump client minLength to 12. In a separate doc task, enable a strong password policy in the Supabase dashboard (Settings → Authentication → Password Policy: minimum 12, require mixed case + number). Add a bit of client-side feedback ("at least 12 characters"). This is a one-line fix on the client + a Supabase dashboard setting (out of scope for code).
- **Next.js 16 doc-check required?**: no

### [MEDIUM-11] `CsvUpload.tsx` reads the uploaded file twice (FileReader + file.text())
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 2
- **Risk (1-5)**: 2
- **Effort (1-5)**: 1
- **Score**: (2 + 2) × (6 − 1) = 20
- **Files**: src/components/strategy/CsvUpload.tsx:75-103, 111-114
- **What's wrong**: `handleFileSelect` constructs a `FileReader` and reads the file to get the preview. Then `handleUpload` calls `await file.text()` again on the same File reference to re-parse before upload. The whole file is read into memory twice. For a 10 MB CSV (the enforced upload cap) that's 20 MB of transient string memory. Worse, `handleUpload` never double-checks that the file the user just uploaded actually matches the preview they saw — if the user clicks upload twice with different files selected, the preview shown can drift from the parsed result.
- **Why it matters**: Minor performance footgun, but also a potential correctness gap (preview/submit drift).
- **Proposed fix**: Store the parsed rows from the FileReader `onload` into component state, reuse in `handleUpload` instead of re-reading. Drop the `file.text()` call entirely. Keep `file` around only for the filename. Add a vitest test that parse-then-upload uses a single parse pass.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-12] `health-score.ts` has a typo — `freshnesScore` (missing 's')
- **Category**: code
- **Priority**: Medium
- **Impact (1-5)**: 1
- **Risk (1-5)**: 2
- **Effort (1-5)**: 1
- **Score**: (1 + 2) × (6 − 1) = 15
- **Files**: src/lib/health-score.ts:26, 80
- **What's wrong**: Function is named `freshnesScore` instead of `freshnessScore`. Called once internally in `computeHealthScore`. Typo in an exported-adjacent symbol (it's file-local) is low impact, but it's a smell — usually indicates the file hasn't been carefully read in months, which predicts other bugs lurking.
- **Why it matters**: Greppability and reviewer embarrassment. If someone greps `freshnessScore` to find all scoring logic, this doesn't show up.
- **Proposed fix**: `s/freshnesScore/freshnessScore/g` in that file. One edit.
- **Next.js 16 doc-check required?**: no

### [MEDIUM-13] `npm audit --audit-level=high || true` never fails CI
- **Category**: dependency / infrastructure
- **Priority**: Medium
- **Impact (1-5)**: 3
- **Risk (1-5)**: 3
- **Effort (1-5)**: 1
- **Score**: (3 + 3) × (6 − 1) = 30
- **Files**: .github/workflows/ci.yml:22
- **What's wrong**: `run: npm audit --audit-level=high || true`. The `|| true` swallows any audit failure. The audit always passes green regardless of reality. That's not "security audit in CI", that's "security-audit-shaped noise in CI". Also, given the `CLAUDE.md` banned-packages list (axios compromise, etc.), a real audit gate is more relevant than most projects.
- **Why it matters**: An actually exploited dep sneaks in and CI is green. Banned-packages list assumes an audit gate that doesn't exist.
- **Proposed fix**: Drop the `|| true` so audit failures fail CI. Use `--audit-level=critical` if too much high-sev noise; the higher bar still catches the axios/banned-packages class of issue. Add a weekly Renovate or Dependabot run if not already present. Also consider adding a grep gate in CI that fails if `package.json` mentions any of the banned packages from `CLAUDE.md`.
- **Next.js 16 doc-check required?**: no

### [LOW-01] `src/lib/queries.ts` `getPercentiles` is O(metrics × n²) — quadratic over strategies
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 2
- **Risk (1-5)**: 1
- **Effort (1-5)**: 1
- **Score**: (2 + 1) × (6 − 1) = 15
- **Files**: src/lib/queries.ts:119-144
- **What's wrong**: For each metric (7 metrics), for each strategy value, it runs `values.filter((x) => x.val <= entry.val).length` — that's an O(n²) pass × 7 metrics = 7n². At 15 strategies this is fine. At 200 strategies (a year from now) it's 280k comparisons per render. The cheap fix is sort once per metric and assign percentile by index.
- **Why it matters**: Will become a real perf issue as the marketplace grows. Cheap to fix now.
- **Proposed fix**: Sort `values` by `val` ascending, assign percentile = `((i + 1) / n) * 100`. Flip the sign for `LOWER_IS_BETTER` metrics before sorting instead of after. Pure algorithmic cleanup.
- **Next.js 16 doc-check required?**: no

### [LOW-02] `lib/utils.ts` `formatCurrency` loses precision below $1
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 1
- **Score**: (1 + 1) × (6 − 1) = 10
- **Files**: src/lib/utils.ts:27-32
- **What's wrong**: `formatCurrency(0.5)` returns `$1` because `value.toFixed(0)` rounds to 0 decimals for sub-$1000 values. The unit tests don't cover this. In practice, all caller values are big enough that it doesn't matter, but the formatter's contract is "format any dollar amount" so the edge case is wrong.
- **Why it matters**: Correctness nit; future bug when a fee/cost display starts using the helper.
- **Proposed fix**: `if (value < 100) return \`$\${value.toFixed(2)}\`;` as a new clause. Add a vitest case for `0.5 → "$0.50"`.
- **Next.js 16 doc-check required?**: no

### [LOW-03] `AllocatorMatchQueue.tsx:260,265,288` uses native `alert()` for error UX
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 2
- **Score**: (1 + 1) × (6 − 2) = 8
- **Files**: src/components/admin/AllocatorMatchQueue.tsx:260, 265, 288
- **What's wrong**: `alert()` blocks the event loop and looks like a 1995 error page. This is the admin UI, so the bar is lower, but it's inconsistent with the rest of the app which has toast/inline error patterns.
- **Why it matters**: Inconsistent UX; minor.
- **Proposed fix**: Replace with existing toast/banner primitive (if any) or add an inline error state to the component. Skip if no toast helper exists — not worth adding a new dep.
- **Next.js 16 doc-check required?**: no

### [LOW-04] `PreferencesPanel.tsx:136` uses `confirm()` and wraps it in a 100ms setTimeout
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 2
- **Score**: (1 + 1) × (6 − 2) = 8
- **Files**: src/components/admin/PreferencesPanel.tsx:64-72, 134-145
- **What's wrong**: The 100ms setTimeout + confirm() is a workaround for "give the user a moment to see the success state." The unmount-cleanup ref dance is solving a problem that the confirm() introduces in the first place — a real in-app modal confirm would avoid the ref machinery entirely.
- **Why it matters**: Another inconsistent UX spot; trivial fix with the existing `Modal` component.
- **Proposed fix**: Replace `confirm()` with the existing `Modal` component, drop the successTimerRef, drop the useEffect cleanup.
- **Next.js 16 doc-check required?**: no

### [LOW-05] `MatchQueueIndex.tsx:211` uses `confirm()` for a destructive action
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 2
- **Score**: (1 + 1) × (6 − 2) = 8
- **Files**: src/components/admin/MatchQueueIndex.tsx:211
- **What's wrong**: Same pattern as LOW-04. Native `confirm()` for kill-switch flip (enabling/disabling the match engine across the platform).
- **Why it matters**: Kill-switch is a P0 admin action; it deserves a proper confirm modal with the current state rendered. But the bar for "this is acceptable UX" is low for an admin surface, so this stays Low.
- **Proposed fix**: Replace with existing `Modal` component when addressing LOW-04.
- **Next.js 16 doc-check required?**: no

### [LOW-06] `src/lib/utils.ts` re-exports `extractAnalytics` and `EMPTY_ANALYTICS` already exported from queries.ts
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 1
- **Score**: (1 + 1) × (6 − 1) = 10
- **Files**: src/lib/queries.ts:151 (re-export), src/lib/utils.ts:73-106
- **What's wrong**: `extractAnalytics` and `EMPTY_ANALYTICS` live in `src/lib/utils.ts`. `src/lib/queries.ts:151` re-exports them with a comment "Convenience re-export so callers that already pull from `@/lib/queries` for server-side reads don't need a second import line just for these helpers." That convenience is fine, but grep shows mixed imports — some files pull from `utils`, some from `queries`. Two import paths for the same symbol makes refactors harder (rename must be done in both places).
- **Why it matters**: Minor, but a `/simplify` pass would catch it.
- **Proposed fix**: Pick one canonical location (I'd leave them in `lib/utils.ts` since they're pure). Delete the re-export from `queries.ts`. Update all `queries` importers to import from `utils`. Mechanical.
- **Next.js 16 doc-check required?**: no

### [LOW-07] Inline SVG icons scattered across pages instead of shared component library
- **Category**: code
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 3
- **Score**: (1 + 1) × (6 − 3) = 6
- **Files**: src/app/page.tsx:74-130 (3 inline SVGs), src/app/(dashboard)/portfolios/[id]/page.tsx:115-135, src/components/admin/AllocatorMatchQueue.tsx (several), src/app/(dashboard)/allocations/MyAllocationClient.tsx:715-727
- **What's wrong**: Same inline `<svg>` patterns (checkmark, spinner, alert icon, pencil icon) scattered across a dozen files with slightly different path data. No `src/components/ui/icons/` directory or similar. Each redraw is hand-coded.
- **Why it matters**: Inconsistent visual language; maintenance friction. Not urgent.
- **Proposed fix**: Create `src/components/ui/icons/` with `CheckCircle`, `Spinner`, `Pencil`, `Warning`, `Info` as small typed React components. Replace inline usages incrementally during unrelated PRs. Don't batch into a single PR.
- **Next.js 16 doc-check required?**: no

### [LOW-08] Strategy-palette + colorblind audit deferred from My Allocation restructure
- **Category**: code / documentation
- **Priority**: Low
- **Impact (1-5)**: 1
- **Risk (1-5)**: 1
- **Effort (1-5)**: 2
- **Score**: (1 + 1) × (6 − 2) = 8
- **Files**: src/lib/utils.ts:45-48 (STRATEGY_PALETTE), TODOS.md:28-33
- **What's wrong**: `STRATEGY_PALETTE` is an 8-color hardcoded array. TODOS.md explicitly flags "STRATEGY_PALETTE colorblind + WCAG AA audit" as a follow-up from v0.4.0. Palette quality is a design-system concern (caught by the separate design-review phase per the audit scope), but the code shape — a literal `as const` with no documentation about colorblind-safety or contrast ratios — is a code concern. The palette should live with a test that asserts each pair is AA-contrast against white.
- **Why it matters**: Accessibility / design-system rigor. Minor because the design-review phase is expected to catch the visual side.
- **Proposed fix**: Add a comment to `STRATEGY_PALETTE` documenting which palette family it's drawn from (if any) and whether it's been colorblind-audited. Add a vitest test asserting minimum contrast against `#FFFFFF` using a small pure-JS WCAG helper. Leave any swap to the design-review phase.
- **Next.js 16 doc-check required?**: no

---

## Patterns to call out

- **Defense-in-depth patterns exist in the codebase but are unevenly applied.** CSRF (HIGH-01), rate-limiting (only 5 routes), server-only guards (HIGH-03). The *pattern* is good — these aren't missing because nobody thought of them, they're missing because each was retrofitted to one or two routes and the follow-up never landed. This is a process-level concern: any new security helper added to `src/lib/` should be immediately applied to EVERY route that qualifies, or a CI grep gate should enforce the rule.
- **Route boilerplate duplication is the #1 refactor opportunity.** PDF routes (HIGH-04), analytics-service calls (HIGH-08), admin auth wrapper is already extracted but not used everywhere (`withAdminAuth` is applied to 2 routes; most admin routes inline their own `isAdminUser` check). A single pass to push existing helpers to every route that should use them would cut ~300-500 LoC of duplicated boilerplate and close several of the High findings simultaneously.
- **Tests are concentrated in `src/lib/`** (the pure-logic helpers) and absent from `src/app/api/` (the boundary layer). The closest thing to a route test is `deletion-request/route.test.ts` which is excellent — use it as the template when lands.
- **Dead code and drift are creeping in.** `/api/keys/encrypt` and `/api/keys/validate` are superseded by `validate-and-encrypt`, the `NEXT_PUBLIC_SENTRY_DSN` var has never been wired, VERSION / package.json have drifted, README is stale at 014 migrations out of 026, `handleSync` in the exchange manager is fake. None are individually critical (except the version drift) but together they indicate the `/ship` → `/document-release` loop has been skipping steps.
- **Three God Files** above 1000 LoC (MyAllocationClient, AllocatorMatchQueue, StrategyFilters at 684). Acceptable short-term, but the 1218-line MyAllocationClient is new as of v0.4.0 and represents a regression in file-size discipline compared to the ScenarioBuilder it was built from (472 LoC, also a god file but visibly smaller).

## Phased remediation plan (alongside feature work)

### Phase 1 — safety + correctness (this sprint)
Priority: stop the bleeding.
- CRITICAL-01 — portfolio-pdf IDOR, ~2 hours
- CRITICAL-02 — version drift, ~15 minutes
- HIGH-03 — server-only guard, ~10 minutes
- HIGH-05 — trades/upload schema validation, ~1 hour + test
- HIGH-07 — verify-strategy timing-safe compare, ~15 minutes
- MEDIUM-13 — drop `|| true` from CI audit, ~5 minutes

### Phase 2 — hardening rollout (next sprint)
- HIGH-01 — CSRF retrofit on ~22 routes (use `withCsrf(withAuth(...))` composition), ~3 hours + tests
- HIGH-02 — error boundaries at root + dashboard + auth, ~1 hour
- HIGH-06 — .env.example rewrite + CI parse-check, ~1 hour
- HIGH-08 — analytics-client consolidation (5 call-site fan-in), ~2 hours
- HIGH-09 — fix or hide fake sync button, ~1 hour
- MEDIUM-04 — delete dead keys routes, ~15 minutes
- MEDIUM-05 — write ~8 route tests targeting cross-user write primitives first, ~1 day

### Phase 3 — structural cleanup (following sprint)
- HIGH-04 — pdf-route helper extraction, ~3 hours
- MEDIUM-01 — MyAllocationClient breakup, ~3 hours
- MEDIUM-02 — AllocatorMatchQueue breakup, ~4 hours
- MEDIUM-03 — `as unknown as` cast helper, incremental
- MEDIUM-06 — README migrations rewrite, ~15 minutes
- MEDIUM-07 — `getUserApiKeys` extraction, ~30 minutes
- MEDIUM-08 — ADR on admin-gate future (no code change yet)
- MEDIUM-09 — rolled into HIGH-08
- MEDIUM-10 — password minimum bump, ~5 minutes + Supabase dashboard
- MEDIUM-11 — CsvUpload double-read, ~30 minutes
- MEDIUM-12 — freshnesScore typo, ~1 minute

### Phase 4 — nits (ambient, not dedicated PRs)
Low items listed for completeness. User said SKIP Low; leave in the backlog. Apply opportunistically during unrelated PRs.
