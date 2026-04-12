# Changelog

All notable changes to Quantalyze will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a 4-digit MAJOR.MINOR.PATCH.MICRO scheme so `/ship`
can bump without ambiguity.

## [0.11.0.0] - 2026-04-12

Sprint 4: Intelligence Layer + Bridge V1. Allocators now see what they didn't know
about their portfolio (insights, health score, monthly commentary) AND can act on it
(find a replacement strategy, see portfolio impact, request an intro). The Bridge is
the feature neither quants.space nor 1token can build.

### Added
- **InsightStrip above dashboard** on My Allocation. Four insight rules (biggest risk, correlation regime shift, underperformance, concentration creep) run on every page load, always visible. No "add widget" needed. Underperformance insights include a "Find Replacement" link that opens the Bridge.
- **Portfolio health score** (0-100) in the KPI strip. Composite of Sharpe quality, drawdown recovery, correlation spread, and capacity utilization. Color-banded: green >= 70, yellow >= 40, red < 40.
- **Accessible KPI tooltips.** 2-sentence narrative on every KPI cell, keyboard-navigable (Radix-style `useId` tooltips replacing native `title` attrs).
- **Monthly performance commentary** in the MorningBriefing widget. Per-month returns with top contributor attribution. Optimizer recommendation sentence when suggestions are available.
- **3 new alert types** (`regime_shift`, `underperformance`, `concentration_creep`) in `portfolio_alerts` with deduplication via partial unique index (migration 042). Cooldown prevents noisy duplicate alerts.
- **Bridge V1 backend** (`analytics-service/services/bridge_scoring.py`). REPLACE scoring: removes incumbent, redistributes weight, scores each published candidate by portfolio impact (Sharpe delta, MaxDD delta, correlation delta). Composite score with fit labels (Strong/Good/Moderate/Weak).
- **`POST /api/portfolio-bridge`** endpoint. Authenticated, rate-limited (10/hr), user-ownership verified in both Next.js and Python layers (defense-in-depth).
- **`POST /api/bridge`** Next.js route proxying to Python service with CSRF protection and 15s timeout.
- **BridgeTrigger** client component. Renders "Find Replacement" link on underperformance insights, opens the ReplacementPanel slide-out.
- **ReplacementPanel** slide-out. Right-edge panel with loading skeletons, error state, empty state, and 3-5 replacement cards. AbortController cancels in-flight requests on close. Focus management + Escape key close.
- **ReplacementCard** with fit label badge, 3 metric deltas (green for improvements, red for regressions), and "Request Intro" button. Uses existing `/api/intro` with `source: "bridge"` metadata. 409 dedup handled as success.
- **Zod `BridgeResponseSchema`** validating the bridge response contract. `findReplacementCandidates` now uses `parseResponse()` like every other analytics client function.
- **`BridgeCandidate` + `BridgeFitLabel` types** in `src/lib/types.ts`.
- **8 Python tests** for REPLACE scoring (sorted output, excludes portfolio members, max 5, empty cases, 2-strategy edge, result fields, insufficient data).
- **E2E bridge-flow spec** (Playwright) covering InsightStrip render, Bridge trigger, panel open/close.
- **Vercel preview CSRF fix.** `NEXT_PUBLIC_VERCEL_URL` added to CSRF allowlist so preview deployments don't 403 on POST requests.
- **`computePortfolioHealthScore()`** in `src/lib/health-score.ts` with exported threshold constants.

### Changed
- **`PortfolioInsight` type** now carries optional `strategy_id` and `strategy_name` for Bridge trigger binding. `computeUnderperformance` and `computeConcentrationCreep` populate them.
- **`_generate_alerts()`** in Python uses select-then-insert per alert type (replaces broken upsert on partial unique index). Each alert checks for existing unacknowledged instance before inserting.
- **`generate_narrative()`** enriched with per-month breakdown and optimizer recommendation sentence. Invariant computation hoisted out of monthly loop.
- **`bridge_scoring.py`** imports shared `_compute_sharpe`, `_avg_corr`, `_max_drawdown` from `portfolio_optimizer.py` instead of duplicating them.
- **Alert type union** in `PortfolioAlert` TypeScript type expanded with 3 new types.
- **`InsightStrip`** React list key uses composite `${key}:${strategy_id}` to prevent silent dedup.

### Fixed
- **Pre-existing VERSION/package.json drift** (0.10.0.0 vs 0.9.0.0). Synced.
- **Pre-existing activity route test mock** missing `.eq("is_fill")` chain from Sprint 4 raw fills feature.
- **Alert generation test mocks** updated for select-then-insert pattern.

## [0.10.0.0] - 2026-04-12

Sprint 4: Raw trade ingestion, position reconstruction, and strategy detail depth.
Allocators can now see how strategies actually trade, not just daily P&L summaries.

### Added
- Raw trade fill ingestion from Binance (per-symbol), OKX (cursor pagination), and Bybit (cursor pagination) via `fetch_raw_trades()` in exchange.py
- FIFO position reconstruction from individual fills with entry/exit prices, ROI, duration, fees, and position lifecycle tracking
- Volume & Exposure tab on strategy detail page: buy/sell split, long/short bars, turnover chart, net exposure chart, gross exposure stats
- Positions tab: top 5 best/worst trades tables, win rate, duration stats, ROI metrics with "Price ROI excl. funding" tooltip
- Dedicated `positions` table (migration 040) for reconstructed position lifecycles
- `volume_metrics` and `exposure_metrics` JSONB columns on strategy_analytics (migration 041)
- Fill pipeline health monitoring on admin compute-jobs page
- Empty state, error state, and loading state for all new tab components
- E2E Playwright spec for 5-tab strategy detail page
- 22 new Python tests: position reconstruction FIFO edge cases, raw fill ingestion per exchange, feature flag integration, is_fill regression

### Changed
- Strategy detail page from 3 tabs to 5 tabs (Overview, Returns, Risk, Volume & Exposure, Positions)
- `sync_trades` job timeout from 5 to 15 minutes (supports 90-day backfill)
- `trades` table extended with `is_fill`, `exchange_fill_id`, `exchange_order_id`, `is_maker`, `cost`, `raw_data` columns (migration 039)
- Widgets #26 (TradingActivityLog) and #27 (TradeVolume) now prefer real fill data over daily P&L summaries when available
- Analytics runner filters `WHERE is_fill = false` to prevent double-counting when both data types exist
- Position reconstruction runs with graceful degradation inside compute_analytics (failure sets data_quality_flag, doesn't crash the job)
- Raw fill persistence uses direct upsert with dedup index instead of sync_trades RPC (prevents Phase 1 data destruction)
- Incremental sync uses 1-hour overlap window for late-arriving fills

## [0.9.0.0] - 2026-04-12

Sprint 3 combined: data pipeline + async jobs wiring + worker dyno + 6 widgets +
/compare depth + notes widget + admin compute-jobs table. Single branch, 5 bisectable
commits. Three-model review (Claude + Codex + Grok) on the plan; 30+ fixes applied
before implementation.

### Added
- **Compute queue wiring (2.9 R2).** `/api/keys/sync` now routes through the
  `compute_jobs` durable queue when `USE_COMPUTE_JOBS_QUEUE=true`. Worker is the
  sole writer of `strategy_analytics.computation_status` on the new path; the
  legacy `after()` fire-and-forget is preserved when the flag is OFF (default).
  Response shape unchanged — callers (ApiKeyManager, SyncPreviewStep, wizard) need
  zero changes.
- **Dedicated Railway worker service** (`main_worker.py`). Three asyncio loops:
  dispatch (30s), watchdog (60s), daily position-polling enqueue (24h). Each tick
  factored into a testable async function. Signal-based graceful shutdown. Calls
  `validate_kek_on_startup()` at boot. Health server on separate port.
- **Job dispatcher** (`services/job_worker.py`). Per-kind handlers with timeouts
  (sync_trades 5m, compute_analytics 15m, compute_portfolio 10m, poll_positions 3m).
  CCXT error classification table (transient/permanent/unknown). Circuit breaker
  per api_key via `last_429_at` + `defer_compute_job` (defers without burning retries).
  Decrypt credentials via KEK/DEK envelope before exchange calls.
- **Position polling pipeline** (`services/positions.py`). `fetch_positions()` per
  exchange (Binance unified, OKX hedge mode, Bybit CCXT + raw V5 fallback).
  `persist_position_snapshots()` idempotent upserts via partial unique index.
  Bybit schema drift test fixture.
- **Atomic UI status bridge** (`services/analytics_status.py` + migration 038 RPC).
  Maps compute_jobs aggregate state to `strategy_analytics.computation_status` in
  a single SQL statement. Eliminates the read-then-write race from Eng review
  Finding 2-B.
- **Migrations 033-038.** Admin view + defer RPC + per-kind watchdog + position/weight
  snapshot tables + poll_positions kind + user_notes table + sync_status RPC. All
  self-verifying with DO blocks.
- **Admin compute-jobs table.** `/api/admin/compute-jobs` route gated by
  `isAdminUser`. `ComputeJobsTable.tsx` Variant C dense table with colored status
  badges, status/kind/exchange filters, 50-row pagination, auto-refresh toggle.
  New "Compute Jobs" tab in AdminTabs.
- **6 widget wirings** (all flipped `status: "todo"` → `"ready"`):
  - AllocationOverTime: stacked AreaChart of weight_snapshots
  - TradingActivityLog: dense table of daily PnL + info footnote
  - TradeVolume: BarChart with positive/negative coloring + info footnote
  - ExposureByAsset: horizontal BarChart by |size_usd|
  - NetExposure: LineChart of net USD exposure over time
  - NotesWidget: `/api/notes`-backed textarea with 1s debounce + save indicator
- **/compare enhancements.** `CompareEquityOverlay`: 2-4 equity curves overlaid
  (Recharts LineChart, 320px). `CompareCorrelationMatrix`: NxN table with Pearson
  correlation + color coding at extremes.
- **API routes.** `/api/activity/portfolio` (daily PnL aggregation across portfolio
  strategies). `/api/notes` (GET + PATCH with 100KB cap, portfolio ownership check).
- **One-time deploy script** (`scripts/reset_stuck_computing_rows.py`). Cleans up
  `computation_status='computing'` rows stranded by the legacy `after()` path.
- **Dashboard defaults.** net-exposure, trade-volume, exposure-by-asset added to
  `DEFAULT_LAYOUT` for first-time allocators.

### Changed
- **`routers/analytics.py`** refactored to thin wrapper calling
  `services/analytics_runner.py` for reuse by both the HTTP endpoint and the worker.
- **Dockerfile** documented Railway CMD override for worker service (`python -m
  main_worker`). Default CMD remains uvicorn for FastAPI.

## [0.8.1.0] - 2026-04-11

Second design-review pass on `/allocations`: the four deferred findings from the
v0.8.0.1 audit all land. Ships the allocator workspace on mobile for the first
time (hamburger drawer), makes the widget resize indicators actually work, adds
a scroll affordance to the KPI strip, and fixes the default Positions Table
half-width layout bug. Post-fix Design Score: ~9.8/10.

### Added
- **Mobile sidebar drawer** (`MobileSidebarDrawer.tsx` + `MobileTopBar.tsx`, both new).
  Allocators on mobile can now reach My Allocation, Connections, Scenarios, and
  Recommendations via a hamburger button in a new sticky mobile-only top bar. The
  drawer mounts the existing `<Sidebar>` component unchanged via a new `variant`
  prop, so desktop/drawer rendering never diverges. Closes on backdrop tap, Escape
  key, or route change. Locks body scroll while open and restores focus to the
  hamburger button on close. `role="dialog" aria-modal="true"`, 44×44 hit area on
  the trigger. The 3-tab bottom `MobileNav` is untouched. Closes FINDING-002 —
  the biggest remaining gap from the v0.8.0.1 audit.
- **Functional widget resize indicators** (`TileWrapper.tsx` + `DashboardGrid.tsx`).
  The 1/4, 1/3, 1/2, Full pills in the tile header were visual-only `<span>`
  elements — users tapped them and nothing happened. Now they're `<button>` elements
  that call an `onResize(tileId, cols)` prop. `DashboardGrid` provides the handler,
  which folds the new column width into the next `onLayoutChange` call (same
  pathway react-grid-layout uses when the user drags the resize handle). Width is
  clamped to the 3-12 column range. `aria-label` includes the widget name so screen
  readers announce "Resize Equity Curve to 1/2 width (6 columns)". Closes FINDING-006.
- **KPI strip right-edge gradient fade on mobile** (`KpiStrip.tsx`). The row already
  had `overflow-x-auto`, so horizontal scroll worked — the affordance was missing.
  New `pointer-events-none` linear-gradient pseudo-element fades the right 48px
  on mobile viewports so users understand more content sits off-screen. Always
  on (mobile only); zero JS state. Closes FINDING-008.

### Changed
- **Default dashboard layout: Positions Table full-width** (`dashboard-defaults.ts`
  and `widget-registry.ts`). Previously `w: 6` / `defaultW: 6`, which left the
  Positions Table alone in a half-width row with 40% empty whitespace to its
  right. Now `w: 12` / `defaultW: 12` so fresh-load dashboards render the table
  across the full row. Users with saved custom layouts keep their existing widths.
  Closes FINDING-009.
- **`Sidebar` accepts a `variant` prop** (`Sidebar.tsx`). Default `"desktop"`
  preserves the existing `fixed inset-y-0 left-0 z-30` positioning. New `"drawer"`
  variant drops the fixed class so the same component mounts cleanly inside the
  mobile drawer overlay. Every existing desktop caller (there's one) is unaffected.
- **`DashboardChrome` owns the drawer state** — `useState(menuOpen)` + `useRef`
  for the hamburger trigger. Both the full-bleed (admin match queue) and standard
  dashboard layouts mount `MobileTopBar` + `MobileSidebarDrawer`, so the entire
  dashboard segment gains mobile navigation — not just `/allocations`.

## [0.8.0.1] - 2026-04-11

Design-review pass on `/allocations` (My Allocation dashboard). Five quick-win
fixes from a structured audit against DESIGN.md, all CSS/markup-only. Post-fix
scores: Design Score B+ (8.8/10) → A- (~9.3/10); AI Slop Score stayed A
(zero slop patterns on this screen).

### Fixed
- **Timeframe tabs no longer read "1M" as "IM"** (`TimeframeSelector.tsx`). DM Sans
  kerned the `1` and `M` tight enough at 12px that the pair visually merged. Numeric
  tokens use Geist Mono (`font-metric`) per DESIGN.md Typography, which spaces them
  correctly. Applied to 1D / 1W / 1M / 1Q / YTD / 3Y / All.
- **Timeframe tab touch target now 44×44 on mobile** (`TimeframeSelector.tsx`).
  Previously 24px tall on every viewport, failing WCAG AA. `min-h-11` on touch,
  `md:min-h-0 md:py-1` keeps the dense 24px institutional look for mouse users.
- **Widget close button now 32×32 desktop / 44×44 mobile** (`TileWrapper.tsx`).
  Previously a 12×28 px hit area (`p-0.5` around a 14px × glyph) — WCAG fail.
  Glyph stays 14px for visual density; the hit area is explicit via inline-flex
  + min-h / min-w.
- **Widget titles are now semantic `<h2>`, not `<span>`** (`TileWrapper.tsx`). Runtime
  DOM audit found exactly one heading on the entire dashboard (`<h1>My Allocation</h1>`).
  Screen readers navigating by heading level now see all 6 widget titles (Equity Curve,
  Drawdown Chart, Allocation Donut, Correlation Matrix, Monthly Returns, Positions Table).
  Visual rendering unchanged (same `text-[13px] font-semibold`).
- **"+ Add Widget" button no longer wraps to two lines on mobile** (`AllocationDashboard.tsx`).
  `whitespace-nowrap` keeps "+ Add Widget" on one line even when the header's flex-wrap
  parent narrows on 375px viewports.

### Deferred (flagged in audit, not in this PR)
- Mobile navigation drops the allocator workspace entirely — `MobileNav.tsx` only
  exposes Discovery / Strategies / Profile, losing My Allocation / Connections /
  Scenarios / Recommendations. Needs an IA decision: add a hamburger overlay or
  restructure the bottom nav.
- Widget "resize indicators" (1/4, 1/3, 1/2, Full) look interactive but are
  visual-only — wire them up or remove them.
- KPI row clips on mobile with no scroll affordance.
- Default dashboard layout leaves Positions Table alone in a half-width row.

Full audit + before/after screenshots at
`~/.gstack/projects/AI-Isaiah-Quantalyze/designs/design-audit-20260411-allocations/design-audit-allocations.md`.

## [0.8.0.0] - 2026-04-11

Sprint 2 Strategy Detail Depth — allocators now see drawdown event history and
a strategy-vs-BTC correlation chart on every strategy detail page. Three of the
four original sprint tasks (2.1, 2.5, 2.7) shipped; 2.6 was a no-op (Yearly
Returns was already live).

### Added
- **Worst Drawdowns table** on the Overview tab of every strategy detail page. Top 5 historical drawdowns rendered as a dense Variant C table (peak · trough · recovery · depth · days) with an `ongoing` state for strategies currently underwater. Computed server-side via `qs.stats.drawdown_details` and persisted as `metrics_json.drawdown_episodes`, so the same data also flows into factsheet + tear-sheet PDFs for institutional distribution. A client-side `segmentDrawdowns()` fallback in `src/lib/drawdown-math.ts` keeps freshly-computed strategies rendering correctly before the next compute tick. (Task 2.1)
- **Correlation with BTC chart** on the Risk tab. Single-line rolling 90-day Pearson correlation vs the benchmark, clamped to [-1, 1] with a zero reference line. Primary source is server-side `metrics_json.btc_rolling_correlation_90d` (added to `analytics-service/services/metrics.py` via a new vectorized `_rolling_correlation` helper); fallback computes client-side from the existing cumulative `returns_series` + `benchmark_returns` using the shared `pearson` + `rollingCorrelation` helpers in `src/lib/correlation-math.ts`. Handles <90-day histories and missing benchmarks with explicit empty-state copy. (Task 2.5)
- **Average Sharpe reference line** on the Rolling Sharpe chart in the Risk tab. A dashed horizontal line at the strategy's overall Sharpe gives allocators immediate context for "is this recent dip below average for this strategy?" Powered by a new optional `overallSharpe` prop on `RollingMetrics`. (Task 2.7)
- **`src/components/charts/chart-tokens.ts`** — single source of truth for Recharts stroke/fill/font literals that mirror DESIGN.md. Replaces copy-pasted `#0D9488`/`#1B6B5A`/`'JetBrains Mono'` literals in the three chart files touched by this sprint. Future chart palette drift gets fixed in one file, not N.
- **`_finalize_rolling` Python helper** (`analytics-service/services/metrics.py`) factoring out the shared post-processing tail (`dropna` → inf cleanup → `{date, value}` format → `cap_data_points`) that `_rolling_sharpe` and `_rolling_correlation` both need. New rolling metrics pipe through this one helper.
- **`src/lib/drawdown-math.ts`** and **`src/lib/correlation-math.ts`** — new pure math libraries with 23 vitest cases between them. The `pearson()` helper was extracted from `CorrelationOverTime.tsx` (same behavior, zero drift risk) so the portfolio widget and the new strategy panel now share one implementation.
- **44 new unit + integration tests.** `WorstDrawdowns` (10 cases including the silent-drop fallback regression), `CorrelationWithBenchmark` (11 cases including the cumulative→daily conversion correctness test), `RollingMetrics` (7 cases pinning the `overallSharpe` edge cases — 0, null, NaN, Infinity, undefined), `drawdown-math` (13 cases), `correlation-math` (10 cases), plus 4 new `test_metrics.py` cases for the Python-side rolling correlation + drawdown episodes.

### Changed
- **`src/components/charts/DrawdownChart.tsx`**, **`RollingMetrics.tsx`**, and **`CorrelationWithBenchmark.tsx`** all now import from `chart-tokens.ts` instead of hardcoding color / font literals. The old bright `#0D9488` teal is replaced by DESIGN.md's institutional `#1B6B5A` accent on the Overview-tab drawdown curve. Axis labels use Geist Mono via `var(--font-mono)`. Chart drift across the 9 untouched chart files is flagged as a separate cleanup PR.
- **`src/app/(dashboard)/allocations/widgets/risk/CorrelationOverTime.tsx`** — DRY cleanup. The inline `pearson()` function is removed in favor of importing from `@/lib/correlation-math`. Behavior unchanged.
- **`RollingMetrics.tsx`** merge-by-date step is now wrapped in `useMemo` so it runs once per `data` reference change instead of on every parent re-render. Same for the new WorstDrawdowns and CorrelationWithBenchmark client-side fallbacks.

## [0.7.0.0] - 2026-04-11

Start of Sprint 2. Round 1 of Task 2.9 (Ingestion Control Plane) ships the
durable compute-queue substrate: PostgreSQL schema, RPCs, runbook, types,
and strict-versioned Zod contracts. The queue is flag-gated dormant until
Round 2 lands the Python worker and the Next.js enqueue path.

### Added
- **`compute_jobs` durable queue table + `compute_job_kinds` registry** (migration 032). Service-role-only Postgres-backed queue for async `sync_trades`, `compute_analytics`, and `compute_portfolio` jobs. Supports fan-out / fan-in via `parent_job_ids UUID[]` so a multi-exchange strategy can run N parallel `sync_trades` parents before a single `compute_analytics` child. Status state machine: `pending` → `running` → `done | failed_retry | failed_final`, plus `done_pending_children` for fan-in waits. Kind is enforced via FK to `compute_job_kinds` so future kinds are one INSERT, not an ALTER TABLE lock.
- **Nine SECURITY DEFINER RPCs** behind `compute_jobs`. `enqueue_compute_job` / `enqueue_compute_portfolio_job` do an idempotent upsert via `ON CONFLICT DO NOTHING RETURNING id` (matches migration 011's canonical shape) and delegate to a shared `_enqueue_compute_job_internal` helper. Both run a defense-in-depth `auth.uid()` ownership check via a shared `_assert_owner(regclass, uuid, text)` helper — a belt-and-suspenders over the REVOKE declarations, so a future accidental GRANT to `authenticated` can never leak cross-tenant writes. `claim_compute_jobs` uses `SELECT FOR UPDATE SKIP LOCKED` with a 1000-row cap, `mark_compute_job_done` advances any children waiting in `done_pending_children` via `check_fan_in_ready`, and `mark_compute_job_failed` owns the backoff schedule (attempt 1 → +30s, 2 → +2min, else `failed_final`) in one place. `reclaim_stuck_compute_jobs` resets rows stuck in `running` for more than 10 minutes. `update_api_key_rate_limit` stamps `api_keys.last_429_at` for the per-exchange circuit breaker. `get_user_compute_jobs` is the only function GRANTed to `authenticated`; it redacts `last_error` to `NULL` and caps results at 1000 rows so raw exception text from the Python runner never reaches strategy owners even if Python-side sanitization slips.
- **`api_keys.last_429_at` column** for the per-exchange circuit breaker the Python runner will use in Round 2 (windows: Bybit 10min, Binance 2min, OKX 5min).
- **6 query-specific indexes**: partial unique indexes per target type enforcing "one in-flight per (target, kind)", a pending-claim index, a stuck-running watchdog index, a GIN index on `parent_job_ids` for fan-in lookups, and an exchange+status index for observability.
- **`docs/runbooks/compute-queue.md`** — operational runbook matching the `posthog-wizard-funnel.md` setup-recipe format. Contains the three observability SQL queries (current state, recent failures, stuck jobs), rollback procedure, circuit-breaker reference, Sentry alert routing, and a DO-NOT-FLIP-THE-FLAG banner for Round 1 (the queue's double-execution guard ships in Round 2's Python runner).
- **`ComputeJob` / `JobKind` / `ComputeJobStatus` / `ErrorKind` types** (`src/lib/types.ts`) mirroring the migration 032 schema.
- **Strict-versioned Zod contracts** (`src/lib/analytics-schemas.ts`). `TickJobsResponseSchema` is the first analytics-service response schema to use `.strict()` + `contract_version: z.literal(1)` — parse failures throw instead of warning. New object-shape endpoints should follow this style; existing endpoints continue using the legacy loose `.passthrough()` shape until they're migrated. Accompanied by `EnqueueComputeJobResponseSchema = z.string().uuid()`.
- **26 Zod schema unit tests** (`src/lib/analytics-schemas.test.ts`) locking in the strict-contract guarantee. Covers happy path, contract version drift (both `contract_version=2` drift-up and `contract_version=0` literal-binding), missing fields, negative counters, non-integers, empty strings, and — critically — rejection of unknown extra fields so a future Python-side drift can't silently slip through.
- **`warning` amber color (#D97706)** added to `DESIGN.md` as a fourth semantic color alongside positive/negative/accent. Reserved for transient recoverable states (e.g. `failed_retry` pills in the Round 2 admin UI). Palette intentionally relaxed from "1 accent + neutrals" to "1 accent + 3 semantic + neutrals". Decision logged in DESIGN.md.

### Changed
- **`prefers-reduced-motion` now targets Tailwind's built-in `animate-pulse` class** (`src/app/globals.css`). Previously there was no reduced-motion handling at all; this adds it and the override applies to the 5 existing `animate-pulse` consumers across `ComputeStatus`, `SyncPreviewStep`, `Skeleton`, `MatchQueueSkeleton`, and `DashboardGrid` as a free accessibility improvement. The `Negative` color description in `DESIGN.md` was also tightened from "losses, errors, warnings" to "losses, errors, permanent failures" now that `warning` is its own semantic color.

### Deferred to Round 2+
- Python job worker (`analytics-service/routers/jobs.py` + `services/jobs.py`) with `pg_try_advisory_xact_lock` double-execution guard, per-exchange circuit breaker, exception classifier, dispatch table, integration tests against a real Postgres.
- Next.js enqueue path (`src/lib/compute-queue.ts`), `/api/keys/sync` rewrite, Vercel fallback cron with HMAC nonce, admin `/admin/compute-jobs` UI with retry button, `SyncPreviewStep` Realtime refactor, Sentry integration, Python CI workflow, end-to-end tests.

## [0.6.1.0] - 2026-04-11

### Added
- **`/admin/for-quants-leads` Request-a-Call CRM view.** Founder can now triage public `/for-quants` leads from a real admin page instead of scrolling the Supabase dashboard. Default view lists unprocessed leads newest-first with no cap so nothing falls off the screen; "Show all" exposes up to 500 recent rows and surfaces a truncation note when the cap is hit. Each card shows name, firm, relative timestamp (SSR-safe — no hydration mismatches), mailto link, preferred-time, notes, a "from wizard · {step}" pill when the lead came from inside the wizard flow, and a "Mark processed" / "Unmark" toggle that hits `POST /api/admin/for-quants-leads/process`. The API atomically flips `processed_at` using `.is()` / `.not()` filters so double-clicks are idempotent and the server can distinguish real toggles from no-ops with a 404 response. New "For-quants leads" entry in the admin sidebar nav with a mail icon.
- **Shared `UUID_RE` + `isUuid` type guard** (`src/lib/utils.ts`) replacing three verbatim copies scattered across `finalize-wizard`, `create-with-key`, and the new `for-quants-leads/process` route.
- **Shared `formatRelativeTime` / `formatAbsoluteDate` / `minuteBucket`** time helpers (`src/lib/utils.ts`). `AdminTabs.formatRecency` and the wizard CRM table now both delegate to the same implementation — no more drift between two near-identical minute/hour/day ladders. Unit-tested across all bucket boundaries and the 30-day absolute-date fallback.
- **Shared `resolveManagerName(admin, user)` helper** (`src/lib/email.ts`). Both `/api/strategies/finalize-wizard` and the legacy `/api/admin/notify-submission` route now use the same display_name → company → email → "Unknown" fallback ladder, eliminating the copy-paste that the F9 refactor introduced.
- **Hand-rolled Supabase mock** (`src/lib/supabase/mock.ts`). Chainable fake client matching the subset of the query builder the admin helpers use (`.from().select().eq().is().not().order().limit().single()`, `.update().eq().is().not().select().single()`, `.insert().select().single()`), with per-table error-once injection, strict `.not(col, "is", null)` semantics (throws on unsupported ops so future tests can't silently get wrong data), Promise-spec-compliant thenables, and no runtime dependencies. Enables unit-testing the for-quants-leads admin helpers, `resolveManagerName`, and `withAdminAuth` without hitting a live DB.
- **40 new unit tests** across `src/lib/utils.test.ts`, `src/lib/for-quants-leads-admin.test.ts`, `src/lib/email.test.ts`, and `src/lib/api/withAdminAuth.test.ts`. Covers every pure helper added in this branch plus happy / empty / idempotent / DB-error / 404 paths for the Supabase wrappers, the full admin-auth wrapper (CSRF rejection, non-admin rejection, body guard for null/array/string/number/invalid JSON, handler dispatch), and the `.not("is", null)` NULL-safe filter semantics.
- **`docs/runbooks/security-contact.md`** documenting the DNS / alias / SPF / DKIM / DMARC setup for `security@quantalyze.com`. The /security page, /for-quants, wizard ConnectKeyStep, wizardErrors, and `/api/for-quants-lead` all reference this alias; the runbook is the one place that spells out what "done" looks like and how to smoke-test it before the Month 2 security conversation.
- **`docs/runbooks/posthog-wizard-funnel.md`** with the step-by-step dashboard setup for the 16 wizard funnel events Task 1.2 shipped. Defines five insights (completion funnel, step-drop-off breakdown, top error codes, time-to-submit histogram, conversion by exchange), the dashboard layout, and the SQL one-liner that cross-checks PostHog against the `strategies` table for the ship metric.
- **`FOR_QUANTS_LEADS_FULL_VIEW_CAP` + typed return shape.** `listForQuantsLeads` returns `{ rows, hitCap }` instead of leaking the cap constant through three layers of props. The cap lives in the helper that owns the query; the page and component just read the flag.
- **`withAdminAuth` body type guard.** Rejects non-object JSON payloads (null, arrays, primitives) with a clean 400 before the handler destructures, preventing `TypeError: Cannot destructure property` crashes on malformed admin API calls.

### Changed
- **F1: `AdminTabs.tsx` uses the shared `extractAnalytics` / `formatPercent` / `formatNumber`** from `@/lib/utils` instead of local copies. `formatPercent` widened to accept an optional `decimals` arg (default 2) so CAGR and Max DD can render with 1-decimal precision without each call site re-implementing `.toFixed(1)`.
- **F9: `/api/strategies/finalize-wizard` calls `notifyFounderNewStrategy` directly** inside its `after()` block instead of POSTing to `/api/admin/notify-submission`. Removes the in-process HTTP round-trip and the origin-header juggling. The two independent side effects (founder notification + `api_keys.last_sync_at` touch) now run concurrently via `Promise.allSettled` instead of serially, and failures are logged in a single rejection-handling loop instead of three nested try/catch blocks.
- **`ForQuantsLeadsTable.tsx` uses a single shared minute clock** — one `setInterval` for the whole table with a `minuteBucket`-gated updater that skips re-renders when the displayed minute hasn't actually changed. Previously each row had its own interval + unconditional state update, which meant 500 commits per minute on the "Show all" view even when none of the displayed strings changed. Clock is lifted into `useSharedMinuteClock` so future admin tables can reuse the pattern.
- **`for-quants-leads-admin.ts` helpers accept an optional injected client.** Production callers omit the argument; tests pass in `createMockSupabaseClient()`. Zero impact on existing call sites, enables unit coverage without module-level `vi.mock()`.
- **`markLeadProcessed` / `unmarkLeadProcessed` split** — replaces the boolean-flag `setLeadProcessed({id, markProcessed})` with two dedicated helpers. Each has a linear body (no ternary on `update`, no ternary on `filter`), and the process route handler branches once at the top instead of computing an inverted boolean.
- **Admin sidebar adds a "For-quants leads" nav entry** under the existing ADMIN section, alongside "Dashboard" and "Match queue".
- **PositionsTable TanStack Table hook** now carries the `"use no memo"` React Compiler directive plus an inline `eslint-disable react-hooks/incompatible-library` on the `useReactTable` call. Silences the long-standing lint warning that the React Compiler cannot safely memoize non-stable function references returned by the library. `bun run lint` is now clean across the entire repo.
- **Docblock cleanup across the touched files.** `page.tsx`, `process/route.ts`, `ForQuantsLeadsTable.tsx`, `for-quants-leads-admin.ts` all had 14+ line narration headers from the /review cycle — trimmed to their load-bearing WHY lines. The rest lives in this CHANGELOG and the runbook files.

### Fixed
- **`for-quants-leads-projection.test.ts` static projection test now passes for the new admin CRM page.** Service-role access to `for_quants_leads` is encapsulated in the new `for-quants-leads-admin.ts` module so `page.tsx` and `process/route.ts` satisfy the migration 030 projection rule (no file may import both the user-scoped `createClient` and touch `for_quants_leads` directly).

## [0.6.0.0] - 2026-04-11

### Added
- **"Connect Your Strategy" wizard** (Sprint 1 Task 1.2) at `/strategies/new/wizard`. A 4-step onboarding flow for quant teams: connect a read-only exchange API key first, watch the factsheet compute from real trades, fill in metadata, submit for admin review. Replaces the inverted legacy `/strategies/new` form (which now redirects). The wizard fails fast on trading/withdrawal keys, validates on the exchange side before any data lands, and never renders raw server errors — every failure maps to a stable code in `src/lib/wizardErrors.ts` with institutional copy, a docs link, and concrete fix steps.
- **Visible inline permission block on ConnectKeyStep** (4 trust atoms: what we store, what we reject, who can decrypt, security contact) and 3 exchange cards (Binance, OKX, Bybit) with per-exchange captions and automatic OKX passphrase disclosure. Key nickname is optional. API secret has a show/hide toggle so mis-pastes are visually verifiable.
- **SyncPreviewStep with fire-and-forget sync** (`src/app/api/keys/sync/route.ts` refactored to Next.js `after()` + 202 pattern). The client polls `strategy_analytics` every 3 seconds using a lightweight status query, then pulls the full analytics row + trade count + symbol sample + exchange name in one `Promise.all` once computation completes. Slow-sync hint at 15 s, warning at 60 s, expandable status log at 60 s+. Runs `checkStrategyGate` against live data and renders the scripted wizardErrors copy for `<5 trades` / `<7 days` / analytics-failed rejections.
- **FactsheetPreview `verificationState` prop** (`draft` | `pending` | `verified`, default `verified`). The wizard renders the preview as `draft` ("Draft preview · pending review") so the "Verified by Quantalyze" accent badge only appears after the admin approves the listing. `/for-quants` and `/factsheet/[id]` continue to render the verified variant unchanged.
- **MetadataStep with detected-market pre-fill** — reuses the legacy StrategyForm field set (description, category, strategy types, subtypes, markets, supported exchanges, leverage range, AUM, max capacity) but renders inline chips instead of extracting a shared ChipGroup component. Markets and supported exchanges are pre-filled from the Step 2 sync sample + Step 1 exchange selection.
- **SubmitStep** renders a read-only summary card plus the draft-variant FactsheetPreview and calls `POST /api/strategies/finalize-wizard`. The endpoint invokes the `finalize_wizard_strategy` SECURITY DEFINER RPC, then kicks off both the founder-notification email and the `api_keys.last_sync_at` recency touch inside a single `after()` callback so the client never waits on SMTP.
- **WizardClient state machine + WizardChrome shell** with a 4-column hairline progress rail, `01 / 04` tabular counter, persistent "Delete draft" ghost link (hits the new `DELETE /api/strategies/draft/[id]` endpoint), persistent "Request a Call" ghost link (opens the existing `/for-quants` RequestCallModal with a `wizard_context` payload), ephemeral "Progress saved" toast on each step transition, and `supabase.auth.onAuthStateChange` listener that surfaces a non-blocking session-expired banner without losing the draft.
- **Server-side draft persistence** (`/api/strategies/draft` GET + `/api/strategies/draft/[id]` GET/DELETE). The wizard source of truth is the server `strategies` row; `src/lib/wizard/localStorage.ts` only stores a pointer so a closed-tab reopen can resume. Secrets are never persisted to the browser — resume requires re-pasting the secret.
- **DesktopGate at 640 px** (`src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx`). Narrow viewports see a save-my-progress email form that writes to `for_quants_leads` with a wizard context blob. Uses `matchMedia("change")` so state only updates when the breakpoint crosses, not on every resize pixel.
- **Migration 031** introduces `strategies.source` (`legacy` | `wizard` | `admin_import`) to cleanly discriminate wizard in-progress drafts from existing legacy and partner-import drafts, plus two SECURITY DEFINER RPCs (`create_wizard_strategy`, `finalize_wizard_strategy`) that encapsulate the wizard's atomic multi-row writes with explicit `auth.uid()` ownership checks. A `guard_wizard_draft_updates` BEFORE UPDATE trigger blocks any direct `authenticated`-role mutation that would flip a wizard draft out of `(source=wizard, status=draft)` — only the finalize RPC (running as the table owner) can promote to `pending_review`. Migration also adds `for_quants_leads.wizard_context JSONB` so Request-a-Call leads captured inside the wizard carry step context for founder triage. Self-verifying DO block asserts the column, CHECK constraint, index, RPCs, and guard trigger all exist before commit.
- **Atomic server endpoint `POST /api/strategies/create-with-key`** — replaces the legacy client-side `api_keys` insert after `validate-and-encrypt`. Validates, encrypts, and inserts both the `api_keys` row and the wizard draft `strategies` row via one RPC transaction, returning `{ strategy_id, api_key_id }`. Rate limited per user with length caps on key, secret, passphrase, label, and a strict UUID regex on `wizard_session_id`.
- **`src/lib/strategyGate.ts`** — pure function extracted from the admin strategy-review route. Both the admin approval gate and the wizard SyncPreviewStep now call the same `checkStrategyGate({ apiKeyId, tradeCount, earliest/latest, computationStatus, computationError })` so the 5-trades / 7-days / complete thresholds have a single source of truth. Boundary case preserved: exactly 7.0 days span passes. 13 unit tests cover every branch.
- **`src/lib/wizardErrors.ts`** — 16-code `formatKeyError(code, context)` table. Every error code (trading/withdraw perms, invalid secret, IP allowlist, rate limit, network timeout, draft already exists, sync timeout, sync failed, 4 gate failures, session expired, submit notify failed, unknown) has a stable identifier, institutional title, cause, numbered fix steps, `/security` docs anchor, and UI action list (`try_another_key`, `clear_and_retry`, `expand_log`, `resume_draft`, `start_fresh`, `request_call`, `leave_and_return`). No raw server strings reach the UI. 18 unit tests pin the contract.
- **Admin review card enhancement** (Task 1.3 rolled into the same PR) — `StrategyReviewTab` at `src/components/admin/AdminTabs.tsx` now shows a source badge (wizard / legacy / admin_import), CAGR + Sharpe + Max DD from the joined `strategy_analytics` row, computed-at recency ("just now" → "2d ago"), and a "View factsheet" link that opens `/factsheet/{id}` in a new tab. The admin query joins analytics in one PostgREST nested select so there's no N+1 and pulls only the columns the card actually renders.
- **16 PostHog wizard funnel events** — `wizard_start`, `wizard_step_view_{1-4}`, `wizard_step_complete_{1-4}`, `wizard_submit_success`, `wizard_error` (with stable code), `wizard_abandon`, `wizard_resume`, `wizard_delete_draft`, `wizard_try_different_key`, `wizard_request_call_click`. All events carry `wizard_session_id` so the funnel can correlate a single user across the /for-quants landing → CTA click → wizard start → submit success arc.
- **`/security` setup walkthroughs** at new anchors `#readonly-key`, `#binance-readonly`, `#okx-readonly`, `#bybit-readonly`, `#thresholds`, `#regenerate-key`, `#sync-timing`, `#draft-resume`. Each exchange gets a numbered step-by-step for creating a read-only key; thresholds explain the 5 trades / 7 days rationale; sync-timing explains first-sync-of-the-day cold starts; draft-resume explains the save-my-progress flow.
- **`e2e/for-quants-onboarding.spec.ts`** — wizard shell render, CTA swap assertion, exchange card rendering, inline permission block, scripted error copy regression (never leaks raw server strings), desktop gate at `<640 px`, **FactsheetPreview badge regression** (asserts `/for-quants` shows "Verified by Quantalyze" while the wizard draft variant never does), and `/security` anchor existence for all three exchange setup guides.

### Changed
- **`/for-quants` primary CTA routes logged-in managers to the wizard** — `ForQuantsCtas.tsx` swaps `LOGGED_IN_CTA_HREF` from `/strategies/new` to `/strategies/new/wizard` and relabels the button "Connect your strategy".
- **Legacy `/strategies/new` redirects to the wizard** — bookmarks, email CTAs, and any code link still works. `StrategyForm.tsx` is kept in place for `/strategies/[id]/edit` and will be removed in Sprint 3.
- **`/api/keys/sync` is fire-and-forget** — marks `strategy_analytics.computation_status='computing'` via the service-role client and returns 202 Accepted in milliseconds. The long-running `fetchTrades` + `computeAnalytics` work runs inside Next.js `after()` so the HTTP connection doesn't sit open through Railway cold starts. Failure path upserts `status='failed'` with the error message so the client poller can render a scripted retry. `maxDuration = 300` on Fluid Compute.
- **`ApiKeyManager.tsx` retry closure bug fix** — added a `lastAttemptedKeyId` state that survives the catch block clearing `syncingKeyId`, so the `SyncProgress` retry button now actually targets the attempted key instead of silently no-oping (pre-existing bug caught during Phase 3 engineering review).
- **`admin/strategy-review/route.ts` refactored to call `checkStrategyGate`** — replaces 38 lines of inline threshold logic with a single function call. Future threshold changes happen in one place.
- **`/api/admin/partner-import/route.ts`** sets `source: 'admin_import'` on inserted strategies so the Sprint 2 wizard cleanup cron never touches partner-seeded drafts.
- **`RequestCallModal` accepts an optional `wizardContext`** (`{ draft_strategy_id, step, wizard_session_id }`) and forwards it to `/api/for-quants-lead`. The `for_quants_leads.wizard_context` column (migration 031) lets the founder triage in-wizard leads separately from cold landing-page leads.
- **`FactsheetPreview` header badge is derived from `verificationState`** — the hardcoded "Verified by Quantalyze" string is gone. /for-quants still sees the default verified variant; everything else now has to opt-in.

### Security
- **Migration 031 guard trigger** closes the hole that `finalize_wizard_strategy` alone could not — the SECURITY DEFINER RPC was advertised as "the single choke point for wizard draft promotion" but the existing `strategies_update` RLS policy previously let any owner UPDATE `status='pending_review'` directly from the client. The new `guard_wizard_draft_updates` BEFORE UPDATE trigger blocks `authenticated`-role writes that would flip a wizard draft out of `(source=wizard, status=draft)`, while allowing the SECURITY DEFINER RPC (running as the table owner) through via a `current_user` check.
- **All new wizard draft routes are rate-limited** — `create-with-key`, `finalize-wizard`, `/api/strategies/draft` GET, and `/api/strategies/draft/[id]` GET/DELETE each check `userActionLimiter` under a dedicated bucket so a runaway client cannot spam the database.
- **Input validation tightened on both wizard RPCs** — strict UUID regex on `strategy_id`, `category_id`, and `wizard_session_id`; bounded lengths on key / secret / passphrase (512 chars), label (100 chars), description (10-5000 chars); AUM and max capacity capped at $1T so the admin card can't be spoofed with garbage numbers.
- **`/api/strategies/draft/[id] DELETE` re-applies the source+status filter on the DELETE itself** (not just the preflight) so a TOCTOU race cannot silently clobber a just-promoted strategy. Also checks whether any other strategy references the same `api_key_id` before hard-deleting the key — prevents a silent `SET NULL` cascade onto another strategy that happened to share the key.

### Review trail
- Passed full `/autoplan` pipeline with 12 adversarial voices across CEO / Design / Eng / DX phases (Claude subagent + Codex medium + Grok multi-agent per phase). Premise gate resolved 3 user decisions (hold wizard, separate draft storage → later pivoted to `source` discriminator mid-implementation after tracing Railway Python, two-metric ship gate). Final gate resolved 4 taste decisions (desktop-only 640 px, visible inline trust block + live scope viewer, 5-6 session effort budget, Task 1.3 rolled in).
- `/review` pipeline caught and fixed 8 issues pre-ship including 3 CRITICAL ship blockers: (a) `/api/keys/sync` was writing an invalid `'syncing'` value that would have violated the `strategy_analytics.computation_status` CHECK constraint on first call, (b) `finalize_wizard_strategy` was not actually a chokepoint because the trigger from migration 028 only fires on `api_key_id` changes — added `guard_wizard_draft_updates` trigger, (c) `/strategies` page was listing wizard drafts with clickable "edit" links to the legacy form — added source filter.
- `/simplify` removed dead code (`deriveMarketsFromDetected`, `detectedScopes`, `stepEnterTimes`, `wizardStartFired` state, `handleDeleteClick`/`handleRequestCallClick` no-op wrappers), consolidated two step-index tables into one, collapsed three localStorage reads on WizardClient mount into one ref, shrank the SyncPreviewStep poll payload to 2 columns per tick, folded 5 post-completion queries into one `Promise.all`, trimmed 4 unused columns from the admin strategies query, and deleted plan-narration comments from WizardClient, ConnectKeyStep, SyncPreviewStep, MetadataStep, create-with-key, finalize-wizard, sync route, AdminTabs, FactsheetPreview, strategyGate, wizardErrors, and localStorage.
- Test coverage: 727 unit tests pass (up from 689 pre-branch). 2 new test suites: `strategyGate.test.ts` (13 cases including the 7.0-day boundary) and `wizardErrors.test.ts` (18 cases covering all 16 codes + the fallback). 1 new e2e spec: `for-quants-onboarding.spec.ts`. 5 new FactsheetPreview component tests pin the verificationState prop contract.

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
