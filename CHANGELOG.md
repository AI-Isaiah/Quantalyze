# Changelog

All notable changes to Quantalyze will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a 4-digit MAJOR.MINOR.PATCH.MICRO scheme so `/ship`
can bump without ambiguity.

## [0.4.0.0] - 2026-04-09

### Added
- **My Allocation page** — `/allocations` is now a single-real-portfolio multi-strategy dashboard. The allocator lands here every morning and sees their invested book at a glance: Fund KPI strip (AUM, 24h / MTD / YTD return) in a shared-panel layout with hairline dividers, a YTD PnL chart that overlays the portfolio composite + one line per strategy + an optional dashed "+ Favorites" curve, an MTD return bar strip sorted winner-to-loser, and a strategy breakdown table with allocation weights and key metrics. Data-density posture throughout, FactSet / Stripe Dashboard form factor, zero drop-shadowed card mosaic. The chart composite and the Favorites overlay share the exact same math via `computeCompositeCurve` in the new `src/lib/scenario.ts`.
- **Favorites watchlist** — new `user_favorites` table (migration 024) lets allocators star strategies they're considering but haven't allocated to. The new `FavoriteStar` component drives it. The Favorites panel on My Allocation shows the watchlist, lets the allocator toggle any subset on, and overlays a dashed "+ Favorites" curve on the YTD chart backfilled from portfolio inception. Sleeve sizing is 10% of the book by default, split equally across active favorites. A favorite with a start date later than the allocator's portfolio inception is clamped to its own launch date — no time travel.
- **Save as Test Portfolio flow** — the Favorites panel's primary action. Click "Save as Test Portfolio", an inline modal appears with an auto-filled name ("Active Allocation + Orion + Helios"), optional notes, one click to save. Creates a new `portfolios` row with `is_test = true` via `/api/test-portfolios` and attaches the real portfolio's strategies plus the active favorites at equal weight. Toggles persist behind the modal so the allocator can keep exploring after saving.
- **Connections page** at `/connections` — the allocator's intro relationships with strategy managers, promoted from the old cross-portfolio `/allocations` section into its own route with its own sidebar entry. Same contact-request data on a dedicated page so My Allocation stays focused on the single-book multi-strategy view.
- **Scenario math library** at `src/lib/scenario.ts` — extracted the 250-line `computeScenario` function out of `ScenarioBuilder.tsx` so it can power both `/scenarios` (unchanged) and the new My Allocation chart + Favorites overlay. Adds `computeStrategyCurve`, `computeCompositeCurve`, and `computeFavoritesOverlayCurve` wrappers. All three regression-critical behaviors from the original lift are preserved and pinned by unit tests: per-strategy staggered-start weight renormalization, absolute-value average pairwise correlation, and Sortino dividing the downside RMS by total observations (not by the count of negative days).
- **Partial unique index** on `portfolios (user_id) WHERE is_test = false` (migration 023) enforces the one-real-portfolio-per-allocator invariant at the database level. A second real-portfolio insert for the same user hits a 23505 unique violation instead of silently corrupting the mental model.
- **79 new tests across 10 new test files** — scenario math (including all three regression pins), query helpers (`getRealPortfolio`, `getTestPortfolios`, `getUserFavorites`, `getMyAllocationDashboard`), new components (`FundKPIStrip` "one shared panel not four cards" regression, `StrategyMtdBars` sort order, `FavoritesPanel` toggle flow, `SaveAsTestModal` save + error, `FavoriteStar` optimistic toggle), new API routes (auth, validation, user-id spoof protection, 23505 idempotency, portfolio insert rollback on strategies failure), and the Sidebar label + ordering regression. Test count: 432 → 511 (+79 new).

### Changed
- **Sidebar labels** — "Allocations" renamed to "My Allocation" (first entry in MY WORKSPACE for allocators), "Portfolios" renamed to "Test Portfolios", and a new "Connections" entry between them. Non-allocator views keep the slimmer workspace list.
- **Test Portfolios page** (`/portfolios`) filters to `is_test = true` rows only. Real portfolios never appear here. Empty state nudges the allocator toward My Allocation → toggle favorites → save.
- **`PortfolioEquityCurve`** — extended with optional `overlayCurve` and `overlayLabel` props for the dashed "+ Favorites" line. Default is null (regression-safe: every existing caller that omits the new props renders identically to before).
- **Full-app demo seed** — marks "Active Allocation" as `is_test = false`, both "What-if" portfolios as `is_test = true`, and seeds four `user_favorites` (Polaris Arb, Redline Momentum, Kepler Mean Reversion, Drift On-Chain) for the demo allocator pointing at strategies NOT already in the real book, so the Favorites panel has diverse archetypes to toggle right out of the box.

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
