# Changelog

All notable changes to Quantalyze will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a 4-digit MAJOR.MINOR.PATCH.MICRO scheme so `/ship`
can bump without ambiguity.

## [0.5.2.0] - 2026-04-10

### Added
- **`/for-quants` public landing page** (Sprint 1 Task 1.1). Quant-team-facing marketing surface with 5 sections: Hero → Trust → How It Works → Factsheet Sample → CTA. Copy rewritten verbatim from the Codex Design review: "List a verified track record without exposing trading permissions." The primary CTA routes to `/signup?role=manager` for cold visitors and `/strategies/new` for signed-in managers.
- **"Request a Call" modal + public lead endpoint** — `RequestCallModal` client component submits to `POST /api/for-quants-lead` (CSRF + IP rate limit + Zod validation), writing to a new `for_quants_leads` table via the service-role client and emailing the founder. Mailto fallback to `security@quantalyze.com` is always visible for users without JS.
- **Migration 030 — `for_quants_leads`** — service-role-only lead intake table. RLS enabled with zero policies; `REVOKE ALL FROM anon, authenticated`; self-verifying DO block using `has_table_privilege()` asserts no leakage to user-scoped clients before committing.
- **`FactsheetPreview` shared server component** (`src/components/strategy/FactsheetPreview.tsx`) — extracted from `factsheet/[id]/page.tsx` hero metrics. Takes preformatted metric items (not a full analytics row) so it can render both real analytics (Task 1.2 wizard preview) and seeded demo data (/for-quants Sample section). Renders as a single shared-axis row per design guardrails.
- **`/security` public page + `public/security.txt`** — explicit security practices page covering read-only key enforcement, envelope encryption, tenant isolation, codename anonymization, allocator gating, deletion, and a `security@quantalyze.com` contact. `security.txt` follows RFC 9116 and is served from both `/security.txt` and `/.well-known/security.txt`.
- **PostHog analytics** (`src/lib/analytics.ts`) — dual-layer wrapper. Server-side `trackForQuantsEventServer` fires `for_quants_view` from the Server Component so JS-disabled crawlers still land in the funnel; client-side `trackForQuantsEventClient` fires `for_quants_cta_click`, `for_quants_request_call_click`, and `for_quants_lead_submit`. Graceful degradation when `NEXT_PUBLIC_POSTHOG_KEY` is missing. Powers the Sprint 1 ship metric (QQAR 5% within 7 days + CTR 10% as leading indicator).
- **`/api/for-quants-lead` regression tests** — 14 unit tests covering CSRF enforcement, Zod validation (missing fields, invalid email, oversized notes, malformed JSON), happy-path insert, optional-field normalization, and service failure handling.
- **`FactsheetPreview` component tests** — 7 assertions covering metric rendering, optional sparkline, sample label opt-in, and computed timestamp.
- **Static projection test for `for_quants_leads`** (`src/lib/for-quants-leads-projection.test.ts`) — scans `src/**` for any file that touches the table and asserts it imports `createAdminClient`, not the user-scoped Supabase client. Prevents future regressions where RLS would silently block a user-scoped read.
- **E2E smoke test** — `e2e/for-quants-landing.spec.ts` covers page load, 5-section visibility, CTA destination, Request a Call modal open/close/Escape flow, and both security.txt paths.

### Changed
- **`src/proxy.ts`** — added `/for-quants`, `/api/for-quants-lead`, `/security` to `PUBLIC_ROUTES`. Extended the logged-in-redirect exemption (previously only `/demo`) to cover `/for-quants` and `/security` so signed-in managers can share the landing page with colleagues without being bounced to the dashboard.
- **`.env.example`** — added `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.

### Dependencies
- Added `posthog-js` (~6 KB gzipped, browser SDK) and `posthog-node` (server SDK). Both dynamically imported so neither ships to bundles that don't call the analytics helpers.

### Review trail
- Passed full `/autoplan` pipeline: 11 adversarial voices across 4 phases (Claude + Codex + Grok × CEO/Design/Eng, plus Claude + Grok DX). 5 critical findings surfaced and resolved: `getSocialProofStats()` not exported, `/strategies/new` auth-gated, `/api/intro` reuse mismatch, proxy logged-in redirect bug, no ship metric. 7 taste decisions resolved by user at the final gate.

## [0.5.1.0] - 2026-04-11

### Security
- **SEC-005 — `api_keys` encrypted columns locked down** (migration 027). Revokes SELECT on `api_key_encrypted`, `api_secret_encrypted`, `passphrase_encrypted`, `dek_encrypted`, and `nonce` from anon and authenticated roles at the table level, then grants back only the allowlisted non-sensitive columns. Self-verifying DO blocks assert the grant state before committing, no more silent no-ops like migrations 012 and 017.
- **Cross-tenant `api_key_id` linkage blocked** (migration 028). A new `BEFORE INSERT OR UPDATE OF api_key_id` trigger on `strategies` enforces `api_keys.user_id = strategies.user_id`. Previously a user could set their strategy's `api_key_id` to another user's key via client-side state manipulation and claim their verified track record. Found by 3 independent adversarial reviewers (Claude, Codex, Grok).
- **Follow-up hardening** (migration 029). Retro-scan verifies no existing cross-tenant rows (found and remediated 5 demo seed violations). Trigger function gains `FOR SHARE` row lock, short-circuit on no-op updates, schema-qualified `public.api_keys`, and tightened `search_path = pg_catalog, public`. `strategies_update` policy adds explicit `WITH CHECK`. Verification uses `has_column_privilege()` ground-truth API instead of `information_schema.column_privileges`.
- **App-layer audit** — every `from("api_keys")` call site projects the `API_KEY_USER_COLUMNS` allowlist. `ApiKeyManager.tsx:49` no longer uses `.select("*")` which would have silently returned NULL after migration 027. `AllocatorExchangeManager.tsx` uses the shared constant for consistency.

### Added
- **`API_KEY_USER_COLUMNS` + `API_KEY_ENCRYPTED_COLUMNS`** constants in `src/lib/constants.ts` as the single source of truth for the projection allowlist. Backed by `API_KEY_USER_COLUMNS_ARR` tuple for type safety.
- **SEC-005 regression tests** — `src/lib/sec-005-api-keys-projection.test.ts` scans `src/**` for `.from("api_keys").select("*")` and PostgREST `api_keys(*)` embed syntax. Fails loudly if any call site regresses.
- **Migration 028 integration tests** — `src/lib/migration-028-tenant-check.test.ts` simulates the cross-tenant attack end-to-end (INSERT, UPDATE, self-link, NULL) against a live DB.
- **SEC-005 live probe** — `src/lib/sec-005-live-probe.test.ts` signs in as an authenticated user and asserts encrypted columns return NULL, catching regressions the static regex scan can't see. Also cross-references `API_KEY_USER_COLUMNS_ARR` against the live GRANT to detect constant-vs-migration drift.
- **Shared test helpers** — `src/lib/test-helpers/live-db.ts` centralizes `HAS_LIVE_DB` gate, admin client factory, test user creation, and cleanup for live-DB integration tests.

### Fixed
- **Demo seed cross-tenant `api_key_id`** — `scripts/seed-full-app-demo.ts` no longer sets `strategies.api_key_id` to the allocator-owned key. Demo strategies rely on synthetic analytics; the field is now NULL, which matches the product model (the column is the manager's verification key, not a portfolio-tracking reference).
- **9 pre-existing TypeScript errors** in widget test files unblocked (`allocation.test.tsx`, `meta.test.tsx`, `positions.test.tsx`). Placeholder widgets now have zero-arg signatures; tests call them without spreading grid props.
- **`ApiKey` type extended** to match the full projection (`sync_status`, `account_balance_usdt`), removing the stale `as ApiKey[]` cast in `ApiKeyManager.tsx`.

## [0.4.1.0] - 2026-04-10

### Security
- **Portfolio-PDF IDOR closed** — the `/portfolio-pdf/[id]` page now requires a signed HMAC render token. Direct browser access without a valid token returns "Unauthorized". API routes pass a 2-minute token to Puppeteer.
- **CSRF retrofit** — Origin/Referer check applied to all ~25 mutating API routes (was only 2).
- **Rate limiting extended** — all mutating/sensitive routes now have Upstash rate limits.
- **Timing-safe token comparison** — `verify-strategy/[id]/status` uses `timingSafeEqual` instead of `!==`.
- **`import 'server-only'`** guard on admin client modules prevents accidental browser bundle leak.
- **Trade upload validation** — rows are schema-validated and `strategy_id` is forced server-side.
- **API-layer auth defense-in-depth** — `getUser()` checks added before DB operations on write paths.

### Added
- **Sentry instrumentation** — `@sentry/nextjs` installed, `src/instrumentation.ts` conditionally initializes when `SENTRY_DSN` is set. `onRequestError` captures unhandled server errors.
- **Error boundaries** at root (`global-error.tsx`), dashboard, and auth layout levels.
- **Zod contract validation** for all 8 analytics service response types.
- **Email retry with backoff** — Resend calls now retry 3x with exponential backoff.
- **Analytics API version header** — client sends `X-Api-Version: 1`, warns on mismatch.
- **Stuck-notification health check** — `src/lib/observability.ts` for monitoring `notification_dispatches`.
- **13 Architecture Decision Records** in `docs/architecture/` covering RLS, auth, cron, caching, deployment, and more.
- **7 regression tests** for critical findings (`critical-regressions.test.ts`).
- **5 route tests** for trades/upload cross-user write protection.
- **My Allocation dashboard redesign spec** at `docs/superpowers/specs/2026-04-10-my-allocation-dashboard.md`.
- **Round-1 and round-2 audit reports** in `audit/`.

### Changed
- **Analytics client timeout** — shared fetch wrapper now uses `AbortSignal.timeout(30s)` with configurable override.
- **Analytics client consolidated** — `portfolio-optimizer` and `admin/match/eval` routes now use the shared client.
- **Vercel Crons re-registered** — `warm-analytics` (every 5 min) and `alert-digest` (daily 9 AM) in `vercel.json`.
- **Warmup timeout bumped** from 2s to 10s.
- **PDF routes** — `maxDuration=30` set on all 4 handlers; auth'd route cache changed from `s-maxage=3600` to `private, no-store`.
- **Trade upload cap** lowered from 50k to 5k rows per request.
- **Admin auth consolidated** — proxy now uses canonical `isAdmin()` from `src/lib/admin.ts`.
- **`api_keys` reads** switched from admin client to user-scoped client (respects RLS).
- **MyAllocationClient** broken up from 1218 to 544 LoC (6 sub-components extracted).
- **AllocatorMatchQueue** broken up from 1028 to 754 LoC (4 sub-components extracted).
- **`as unknown as` casts** reduced from 34 to 9 via typed `castRow`/`castRows` helpers.
- **VERSION synced** — `package.json` version matches `VERSION` file.

### Fixed
- **`freshnesScore` typo** fixed to `freshnessScore` across all files.
- **CsvUpload double-read** eliminated by storing parsed rows in state.
- **Fake sync button** in AllocatorExchangeManager replaced with disabled "Auto-synced" indicator.
- **`.env.example`** rewritten: fixed analytics port (8000 → 8002), added 10 missing vars, removed stale entries.

### Removed
- **Dead API routes** — `/api/keys/encrypt` and `/api/keys/validate` deleted (superseded by `validate-and-encrypt`).
- **CI audit swallow** — removed `|| true` from `npm audit` in CI.

### Design
- **PageHeader** uses Instrument Serif per DESIGN.md (propagates to all dashboard pages).
- **Landing page** H2 headings normalized to Instrument Serif 32px.
- **"How It Works"** section rebuilt from 3-card slop to editorial hairline columns.
- **WCAG 2.5.5** 44px touch targets enforced across Input/Select/Button primitives.
- **404 page** and **legal pages** typography aligned with DESIGN.md.

## [0.4.0.0] - 2026-04-09

### Added
- **My Allocation page** — `/allocations` is now a Scenarios-style live view of the allocator's actual exchange-connected investments. Each row is a real investment the allocator made by giving a team a read-only API key on their exchange account. KPI strip (TWR / CAGR / Sharpe / Sortino / Max DD / Avg |corr|), SVG equity curve, and per-investment list — all driven by the scenario math library applied to real data. Inline **Exchange connections** section (powered by the existing `AllocatorExchangeManager`) so the allocator can connect another exchange without navigating away.
- **Allocator-editable investment aliases** — migration 025 adds `portfolio_strategies.alias TEXT NULL`. Each row on My Allocation has a pencil icon that flips into an inline editor; saving PATCHes `/api/portfolio-strategies/alias` and the UI refreshes. Falls back to the strategy's canonical display name when unset.
- **Connections page** at `/connections` — the allocator's intro relationships with strategy managers, promoted from the old cross-portfolio `/allocations` section into its own route. Now has a server-side allocator role guard so managers who hit the URL directly get redirected.
- **Scenario math library** at `src/lib/scenario.ts` — extracted the ~250-line `computeScenario` function out of `ScenarioBuilder.tsx` so it can power both `/scenarios` (unchanged) and the new `/allocations` view. All three regression-critical behaviors from the lift are preserved and pinned by 17 unit tests: per-strategy staggered-start weight renormalization, absolute-value avg pairwise correlation, and Sortino dividing the downside RMS by total observations (not by the count of negative days).
- **Partial unique index** on `portfolios (user_id) WHERE is_test = false` (migration 023) enforces the one-real-portfolio-per-allocator invariant at the database level. Kept across the pivot even though the Test Portfolios surface was dropped — the invariant is still valuable.
- **`user_favorites` table** (migration 024) — created for future watchlist features. No UI ships against it in v0.4.0 after the Scenarios-replaces-Test-Portfolios pivot; the table persists as infrastructure.
- **PATCH `/api/portfolio-strategies/alias`** — auth-gated endpoint that lets the allocator rename an investment row. Ownership check on the parent portfolio before the UPDATE, alias capped at 120 characters, empty string coerces to null.
- **34 new tests across 3 new test files** — `scenario.test.ts` (17 tests, including all 3 regression pins), `queries.my-allocation.test.ts` (7 tests for the query helpers + dashboard payload), `Sidebar.test.tsx` (10 tests for the allocator-vs-manager workspace split).

### Changed
- **Sidebar split** — allocators see **My Allocation → Connections → Scenarios → Recommendations**. Managers and crypto teams see **Strategies → Portfolios**. "Strategies" is no longer shown to allocators (that's the manager surface — crypto teams publishing strategies for allocators to discover via the Discovery group). The legacy "Exchanges" top-level entry is folded into My Allocation.
- **`/allocations` full rewrite** — the old cross-portfolio aggregate view (4 KPI cards, portfolio list, Active Alerts banner, Active Connections section) is gone. Connections moved to `/connections`, the single-real-portfolio view is now the dashboard, and exchange connections live inline below.
- **Migrations 023 + 024 are now idempotent** — every `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX`, and `CREATE POLICY` is guarded with `IF NOT EXISTS` or a `DO $$ EXCEPTION WHEN duplicate_object THEN NULL` block, matching the convention in migrations 009 / 012 / 014 / 016.
- **`getMyAllocationDashboard`** — parallel-fetches the real portfolio, analytics, `portfolio_strategies` (with `alias` from migration 025 + raw `daily_returns`), `api_keys`, and alerts in one round. No favorites, no test portfolios.
- **`/portfolios` page** — reverted to the old "Portfolios" title for the manager/crypto-team workspace. Allocators no longer link here.
- **Connections page** `avgSharpe` — separate `sharpeCount` accumulator (was incorrectly sharing the CAGR counter), dynamic category slug for detail links (was hardcoded to `/discovery/crypto-sma/`), server-side role guard redirecting non-allocators.

### Removed
- **Test Portfolios concept** entirely. No `/api/test-portfolios` route, no Save-as-Test modal, no renamed `/portfolios` page, no `getTestPortfolios` query helper. Scenarios is the what-if exploration surface.
- **Favorites panel** and **FavoriteStar** — watchlist UI dropped. The `user_favorites` table stays as future infrastructure.
- **`/api/favorites`** POST/DELETE route.
- **Custom dashboard components** — `FundKPIStrip`, `StrategyMtdBars` replaced by the reused ScenarioBuilder-style `MetricCard` grid and inline equity curve. `PortfolioEquityCurve` is no longer called from `/allocations` (the Scenarios-style SVG curve is inlined in `MyAllocationClient` instead).

## [0.3.0.0] - 2026-04-09

### Added
- **Scenario Builder** at `/scenarios` (allocator-only) — interactive toggle-based what-if tool. Pick a subset of the 15 strategies, set per-strategy weight and "include from" date, watch every metric recompute live client-side in ~5-15ms per toggle. Recomputes TWR, CAGR, volatility, Sharpe, Sortino, max drawdown + duration, pairwise Pearson correlation matrix, avg pairwise correlation. Reuses the existing `CorrelationHeatmap`. Custom SVG equity curve. Quick presets: All / None / Equal weight. This is the decision-support tool allocators use to test "should I divest from X" or "should I add Y in month Z" before touching the real book.
- **Allocator Exchange Manager** at `/exchanges` (allocator-only) — allocator-facing page for uploading read-only exchange API keys to auto-build the Active Allocation portfolio from exchange-derived positions and lifecycle events. Modal with the existing `ApiKeyForm`, posts to `/api/keys/validate-and-encrypt` (validated against exchange, encrypted with per-user KEK before storage, trading/withdrawal keys rejected). Lists connected exchanges with sync status, last-synced relative time, reported balance. "Sync now" per-key refreshes `last_sync_at`. Direct link to the derived Active Allocation portfolio as the canonical output. Plain-English explainer card covering the `source='auto'` allocation_events derivation pattern.
- **Full-app demo seed** (`scripts/seed-full-app-demo.ts`) — replaces the 3-persona /demo-page seed with a realistic full-dashboard allocator experience. 1 allocator (`demo-allocator@quantalyze.test` / `DemoAlpha2026!`, Atlas Family Office), 8 managers across institutional + exploratory tiers, 15 strategies covering the real crypto-quant archetype universe (cross-exchange arb, basis carry, funding capture, BTC trend, altcoin momentum, L/S pairs, stat arb, short vol, iron condor, mean reversion, DEX MM, on-chain alpha, liquidation fade, risk parity, ML factor). Each strategy has 2-4 years of deterministic daily returns with explicit regime hits for 2022-05 LUNA, 2022-11 FTX, and 2024-04 correction. Complete `strategy_analytics` rows (returns_series, drawdown_series, monthly_returns, daily_returns, rolling 30/90/180d Sharpe, return quantiles, sparklines, all scalar metrics). 3 portfolios (1 real Active Allocation + 2 what-if scenarios) with full `portfolio_analytics` JSONB. 28 `allocation_events` covering the add → top-up → drawdown trim → re-add lifecycle on the real book.
- **Sidebar navigation** adds "Scenarios" and "Exchanges" under `MY WORKSPACE` for allocators (hidden from managers and from admins who have the Match Queue instead).
- **Demo walkthrough doc** at `docs/demos/2026-04-09-full-app-walkthrough.md` — click-by-click demo script with login credentials, seed summary, 5-act flow, known limitations, and post-demo housekeeping.

### Changed
- `/demo` editorial page and its 3-persona seed are superseded by the full-dashboard experience. The old /demo page still loads but is no longer the canonical allocator view.
- `portfolio_strategies.status='published'` is now the canonical status for seeded strategies (previously `'verified'`, which doesn't match the table's CHECK constraint).

### Fixed
- Seed `allocation_events.source` uses the allowed `'auto'` / `'manual'` enum values. Prior drafts used `'exchange_sync'` which silently failed the CHECK constraint.
- Silent failures in seed upserts — every insert path now throws with the table name and the Supabase error message so drift can't hide.

### Security
- Migrations 020/021/022 (landed separately via Supabase MCP earlier in the day) are documented in their own branch, not this one. Highlighted here for the release notes: real PII revoke on `profiles` (the 012/017 column-level revoke was a silent no-op against the table-level grant), SECURITY DEFINER RPC lockdown on `send_intro_with_decision` / `sync_trades` / `latest_cron_success`, and `public_profiles` view switched to `security_invoker=on`.

### Highest-priority follow-up
- **Multistrategy Dashboard** (`/overview`) — top-level allocator overview showing all strategies across all portfolios overlaid on one YTD PnL chart, MTD PnL horizontal bars, and fund-level AUM/24h/MTD/YTD KPIs. Data layer ready via the seed above. See `TODOS.md` for the full spec. Estimated 45-90 min, all client-side.

## [0.2.0.0] - 2026-04-09

### Added
- Editorial hero for the public `/demo` page — one Instrument Serif headline, four Geist Mono numbers, one "Download IC Report" CTA. Verdict / Evidence / Action / Appendix layout replaces the old 9-card mosaic.
- Per-persona demo experience via `?persona=active|cold|stalled`, backed by a server-side enum lookup that rejects hostile input (including `__proto__`) and hardcodes allocator UUIDs.
- Insight strip: biggest-risk / regime-change / underperformance / concentration-creep sentences derived from `portfolio_analytics`. Never shows a composite score.
- Winners/losers strip: top 3 contributors and bottom 3 detractors from attribution, stable sort by strategy ID on ties.
- "What we'd do in your shoes" + "Where would the next $5M go?" recommendation narrative reading `optimizer_suggestions` directly.
- Counterfactual strip: "Had you allocated 12 months ago: portfolio +X% vs BTC +Y%".
- `/api/demo/portfolio-pdf/[id]` — new public PDF endpoint with HMAC-SHA256 signed tokens (30 min TTL), allowlist-gated to the 3 persona portfolios, shares the existing Puppeteer concurrency semaphore. The authenticated `/api/portfolio-pdf/[id]` is unchanged.
- `/api/cron/warm-analytics` — Vercel Cron handler (every 5 min) that pings the Python analytics service `/health` endpoint to keep cold-start latency off the forwarded-URL path. Accepts both GET (cron default) and POST (manual probe).
- `/portfolios/[id]` now wires 7 previously-orphaned chart components: `PortfolioEquityCurve`, `CorrelationHeatmap`, `AttributionBar`, `BenchmarkComparison`, `CompositionDonut`, `RiskAttribution`. Below-the-fold charts lazy-load via `next/dynamic`.
- Stale-fallback analytics: `getPortfolioAnalyticsWithFallback` fetches latest + latest-where-status=complete in parallel so a failed run renders last-good data with a stale badge instead of an error card.
- `<CardShell>` primitive with 4 states (loading / ready / stale / unavailable) for the authenticated dashboard. Cards never disappear — only their content does.
- `<MorningBriefing>` shared component between `/demo` (dek variant) and `/portfolios/[id]` (card variant).
- `portfolio-analytics-adapter`: strict typed adapter at the Supabase boundary. Defends against prototype-key poisoning from JSONB and rejects empty-string / boolean numeric coercion.
- `ResizeObserver` stub in `src/test-setup.ts` so chart components can render under vitest+jsdom.
- 4-digit VERSION file and CHANGELOG.md for clean version tracking.

### Changed
- `PortfolioAnalytics` TypeScript types corrected to match what `analytics-service/routers/portfolio.py` actually persists: `rolling_correlation` is now `Record<string, {date,value}[]>` (pair-keyed), `benchmark_comparison` is a single object (not a `Record`), `attribution_breakdown` and `risk_decomposition` use the real field names (`contribution` + `allocation_effect`; `marginal_risk_pct` + `standalone_vol` + `component_var` + `weight_pct`).
- `StrategyBreakdownTable` and the authenticated portfolio-pdf page drop dead reads on `attr.weight` / `attr.twr` — fields that never existed in the persisted payload. Weights now come from `portfolio_strategies.current_weight`, TWR from `strategy_analytics.cagr`.
- `/demo` rewrite preserves the existing two-batch match fallback chain (`batches[0] → batches[1]`) via an extracted, unit-tested `resolveDemoRecommendations` helper.
- Package version bumped from `0.1.0` to `0.2.0`.

### Fixed
- Pre-landing review catches (Codex adversarial + Claude checklist):
  - Cron route now exports GET + POST (was POST-only; Vercel Cron sends GET).
  - Demo PDF endpoint switched to `Cache-Control: no-store` so the CDN can't replay a response past the 30 min signed-token TTL.
  - Demo page now only signs a PDF token when the current persona has a seeded portfolio in the allowlist; no silent cross-wire to the active persona's report.
  - Warmup helper clears its timeout handle on the sync-throw path.

### Removed
- Portfolio Health Score card — killed before implementation per 4-signal cross-phase cross-model consensus (Claude + Codex, CEO + Design). Composite scores are a taste landmine for institutional LPs; the hero is now raw metrics with explicit provenance.
