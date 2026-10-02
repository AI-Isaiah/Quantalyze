# Project Research Summary

**Project:** Quantalyze v0.17.0.0 — Sprint 12: KPI Parity & Discovery v2
**Domain:** Allocator-facing strategy surfaces (Discovery list + Single-Strategy detail) + backend metric extensions
**Researched:** 2026-04-26
**Confidence:** HIGH on backend gap and Discovery-already-shipped audit; MEDIUM on Quants.Space-specific UI affordances (auth-walled, user directive is authoritative)

## Executive Summary

v0.17 is a **parity-and-polish milestone, not greenfield**. All four researchers independently verified that the plan-as-drafted (`~/.claude/plans/strategy-teams-kpi-parity.md`) materially overstates the schema work: `strategies.is_example` (migration 001:64), `strategies.organization_id` (migration 006:30), `user_favorites` watchlist table (migration 024), and `strategy_analytics.daily_returns` JSONB column (migration 001:92) are all already declared. The real cost is **backend metric extensions in `metrics.py`** (rolling Sortino/Vol series, daily returns grid, exposure/turnover series, trade-table aggregations) plus **a 7-panel UI rewrite** that consumes mostly already-rendered chart components. Discovery v2 is ~70% built; only Watchlist UI wire-up, localStorage persistence, and Customize-drawer polish are net-new.

Recommended approach: **wave structure** — T8a backend contracts and T7 Discovery v2 ship in parallel (independent dependencies), then T8b Single-Strategy v2 UI consumes T8a's new metrics. Net session estimate: **~5 sessions** (T8a ~3.0, T8b ~1.5, T7 ~0.5). Zero new top-level dependencies; one optional cleanup (`@nivo/boxplot` removal, ~80KB). Net-new migrations: **0–1** (data backfill only — no DDL needed).

Three risks that will actually bite:
1. **WCAG color regression** if axis labels adopt the plan's `#718096` token (3.94:1 — fails AA) instead of the existing `chart-tokens.ts` `#64748B` (4.85:1 — passes)
2. **JSONB row bloat** as `metrics_json` approaches the 1MB TOAST threshold once daily_returns_grid + 3 rolling series + exposure/turnover land for 5-year strategies — needs path-extraction or a sibling series table
3. **Backfill saturation** of the Railway worker if all strategies recompute simultaneously after T8a deploy — needs throttled enqueue or lazy-on-first-view migration

## Key Findings

### Recommended Stack

**No new top-level dependencies.** Every chart need v0.17 introduces is solvable inside libraries already bundled. Backend metric extensions are pure additions on top of `pandas + quantstats + numpy` already pinned in `analytics-service/requirements.txt`. See [STACK.md](./STACK.md) for the full decision matrix.

**Core technologies (all already installed):**
- `recharts@^3.8.1` — 7 of 12 chart components (rolling series, histograms, bar charts, exposure/turnover lines)
- `lightweight-charts@^5.1.0` — Equity curve + BTC overlay only (Panel 2)
- Hand-rolled SVG / CSS Grid — Daily heatmap (~90 LoC), Monthly heatmap, Sparkline, Return quantiles
- `quantstats@0.0.81` + `pandas@2.2.3` + `numpy@2.2.4` — every T8a metric is a one-liner on top of these

**Optional cleanup:** `npm uninstall @nivo/boxplot` (installed but unused; `ReturnQuantiles.tsx` is hand-rolled SVG). Saves ~80KB gzipped.

**Anti-recommendations:** Reject `plotly.js` (defeats design goal of replacing qstats's Plotly chrome), `chart.js`, `apexcharts`, `echarts` (~800KB+ for one chart), `react-calendar-heatmap` (wrong layout), and any new Python deps (`scipy`, `statsmodels`, `pyfolio`).

### Expected Features

The plan-as-drafted's "Discovery v2" feature list refutes itself against the codebase: most of it is already shipped. Real net-new work concentrates in T8a backend metrics + Panel 4/5/6/7 chart wiring on T8b. See [FEATURES.md](./FEATURES.md) for the full qstats-parity catalogue.

**Must-have (table stakes):**
- TS-01 Watchlist UI (star toggle + sub-tab) — schema exists at `user_favorites`, just needs UI
- TS-02 localStorage persistence for Customize prefs (per-user-keyed, not per-slug)
- TS-04…TS-09 Single-Strategy v2 7-panel layout — most components exist, mostly layout work
- TS-10 DailyHeatmap chart (NEW backend `daily_returns_grid` + new `<DailyHeatmap>` component)
- TS-11/12/13 Rolling Sharpe relabel + new Sortino + new Volatility series (3M/6M/12M)
- TS-15 Trade-table new metrics (Expectancy, R:R, SQN, Long/Short PF — most are 1-line derivations)
- TS-17 Cross-runtime parity tests (golden 252-day fixture; Python ↔ JS byte-identical)
- TS-18/19 DESIGN.md identity translation + tabular-nums everywhere
- TS-20 Partial-data state per panel (graceful degradation for <30/<90/<365 day histories)

**Differentiators (Quantalyze edge):**
- DIFF-02 WCAG-AA verified contrast (axe-core in CI; close out the open debt)
- DIFF-03 BTC overlay default-ON in Equity chart (not behind a toggle)
- DIFF-05 Single-accent sparkline (NOT split green/red by daily return — Quants.Space does this; we don't)
- DIFF-10 7-panel single-page layout vs tabs (UC#7 ratifies the DESIGN.md density-rule deviation)

**Anti-features (must NOT ship — 14 enumerated):**
- Dark theme / Plotly modebar / yellow-lime accent / glassy chrome
- Sparkline split coloring / mobile-responsive polish / multi-benchmark (ETH/SOL)
- LLM commentary / decorative animations / Monte Carlo
- Manager Workspace, Inbox, Threads, Mandate doc, Activity log (deferred to v0.18)
- Per-deck multi-strategy bundle editor / new benchmark ingestion pipelines

**Defer (v0.17.1 or later if mid-sprint cuts needed):**
- Daily heatmap (Monthly heatmap covers Panel 4 minimum)
- Rolling Vol/Sortino series (keep Sharpe relabel only)
- Trade Mix maker/taker (verify `is_maker` flag in raw fills first; HIGH-complexity)
- Cross-runtime parity tests (manual snapshot diff acceptable for first ship)
- "Customize Table columns" tab (default columns are fine)

### Architecture Approach

The architecture is **additive on top of existing infrastructure** — no new compute paths, no new top-level columns. Every metric T8a produces packs into already-declared JSONB columns (`metrics_json`, `rolling_metrics`, `daily_returns`, `trade_metrics`, `exposure_metrics`, `volume_metrics`). The compute queue (`compute_jobs`, kind=`compute_analytics`) already routes correctly via `job_worker.py:1436`. UI replaces the current 5-tab `PerformanceReport.tsx` with a 7-panel scrollable `PerformanceReportV2.tsx` behind a localStorage flag mirroring the production-validated `allocations.ui_v2` pattern at `AllocationsTabs.tsx:111`. See [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major components:**
1. **`metrics.py` extensions (T8a)** — adds `_rolling_sortino`, `_rolling_volatility`, `daily_returns_grid`, `exposure_series`, `turnover_series`, plus 5 derived trade metrics. Mirrors existing `_rolling_sharpe` pattern at `metrics.py:374`. Position-reconstruction infrastructure at `position_reconstruction.py:435` already collects per-date arrays — currently discards them; T8a refactors to persist alongside aggregates.
2. **Discovery v2 polish (T7)** — `StrategyCard.tsx` (NEW grid renderer), `CustomizeDrawer.tsx` (NEW right slide-out), Watchlist tab + star icon column (reuse `user_favorites` schema), localStorage `discovery_view_preferences:{auth.uid}:{slug}` (per-user keyed). Filter-by-team gated on `organization_id` backfill audit.
3. **Single-Strategy v2 UI (T8b)** — new route `/strategy/[id]/v2` (or flag-gated swap in `discovery/[slug]/[strategyId]/page.tsx:117`), `PerformanceReportV2.tsx` orchestrator with 7 sub-panel components. Lazy-mount panels 4–7 via IntersectionObserver to keep TTI under budget.

### Critical Pitfalls

Five risks rated CRITICAL/HIGH that the plan does not adequately address. See [PITFALLS.md](./PITFALLS.md) for the full 23-item registry.

1. **WCAG-AA contrast regression on axis labels** — Plan specifies `#718096` (text-muted) for 11px ticks; this fails WCAG-AA on white (3.94:1, needs 4.5:1). Existing `chart-tokens.ts:CHART_AXIS_TICK = "#64748B"` already passes (4.85:1). **Mitigation:** never use `#94A3B8` or `#718096` for chart text; reserve `#94A3B8` for BTC benchmark *strokes* only. Add `tests/a11y/chart-contrast.test.ts` to gate future palette swaps.
2. **`metrics_json` JSONB row bloat** — A 5-year strategy with daily_returns_grid + 3 rolling series + exposure + turnover + 30 scalars approaches 1–3MB serialized JSON, near the 1MB TOAST decompression threshold. **Mitigation:** path-extract via `metrics_json -> 'daily_returns_grid'` syntax in `getStrategyDetail()`, OR split heavy series to `strategy_analytics_series (strategy_id, kind, payload)` sibling table. Eager-fetch panels 1–3 (above-the-fold), lazy panels 4–7.
3. **Backfill saturation on T8a deploy** — Naïve enqueue of `compute_analytics` for all ~20 published strategies after T8a deploy saturates the Railway worker; live `sync_trades` queues behind it. **Mitigation:** either throttled backfill (5 jobs/min, priority enum on `compute_jobs` with backfill=`low`, sync=`normal`), OR lazy-on-first-view via `metrics_json_version INT` column — page checks version, kicks off recompute in background, renders with "computing… ETA 2 minutes" placeholders. Pick one before milestone closes.
4. **Daily heatmap 1825-cell render perf** — Naïve port of `MonthlyHeatmap` (CSS grid + div-per-cell, fine at 120 cells) to daily resolution mounts 1825+ DOM nodes per render; ResponsiveContainer re-runs colorizer 1825× on every resize. **Mitigation:** decision rule baked into component — `cellCount > 365` → Canvas API single draw via `useEffect` + IntersectionObserver-deferred paint; otherwise SVG. ~60 LoC each path.
5. **`organization_id` populated to NULL universally** — Migration 006 added `strategies.organization_id` FK, indexed it, but no consumer in `queries.ts` and no writer in the wizard. Every published strategy has `organization_id IS NULL` and the existing public-read RLS predicate is `organization_id IS NULL AND status = 'published'`. **Mitigation:** Phase 0 audit must count non-NULL orgs; if 0, **defer "Filter-by-team" to v0.18** (when Manager Workspace lands and managers actually pick an org during edit). Auto-creating orgs to populate the column would break the public-read fallback and silently hide strategies from anonymous discovery.

## Implications for Roadmap

Based on combined research, the v0.17 milestone decomposes into **three phases that compress to two via parallel waves**.

### Phase 12.01 — T8a Backend Contracts (foundational, ~3.0 sessions)

**Rationale:** T8b UI consumes T8a's new JSONB keys (`rolling_sortino_*`, `vol_*`, `daily_returns_grid`, `exposure_series`, `turnover_series`, expanded `volume_metrics`/`trade_metrics`). Ships invisible value but unblocks Phase 12.03.
**Delivers:** `metrics.py` extended (5 helper functions; mirrors `_rolling_sharpe` pattern), `position_reconstruction.compute_exposure_metrics` refactored to persist series alongside aggregates, `_compute_volume_metrics` extended for Trade Mix maker/taker (verify `is_maker` flag on raw fills first), pytest fixtures + cross-runtime parity check, throttled-or-lazy backfill mechanism.
**Addresses:** TS-10/11/12/13/15/17 backend half.
**Avoids:** Pitfall 2 (JSONB bloat — design path-extraction up front), Pitfall 5 (selective extraction), Pitfall 10 (backfill saturation), Pitfall 11 (Sortino MAR consistency — module-level `MAR = 0.0` constant), Pitfall 19 (turnover-series contract — explicit docstring).
**Migrations:** 0 net-new (all extensions to existing JSONB columns).

### Phase 12.02 — T7 Discovery v2 Polish (parallel-safe, ~0.5 sessions)

**Rationale:** Independent of T8a/b. Schema is mostly already-shipped (`is_example`, `user_favorites`, `organization_id`). Real work is UI wire-up and localStorage persistence. Ships allocator-visible value early.
**Delivers:** `StrategyCard.tsx` for grid view, `CustomizeDrawer.tsx` slide-out, Watchlist tab + star icon column (proxy to `user_favorites`), per-user-keyed localStorage persistence, optional team filter (gated on Phase 0 audit of `organization_id` population — see Pitfall 5).
**Addresses:** TS-01, TS-02, TS-03 (gated), DIFF-05 (sparkline color rule).
**Avoids:** Pitfall 1 (`is_example` duplicate column — DON'T write the migration), Pitfall 5 (`organization_id` backfill audit before exposing filter UI), Pitfall 7 (cross-account localStorage leak — key by `auth.uid`), Pitfall 8 (watchlist race conditions — idempotent PUT endpoint + `useOptimistic` + 300ms debounce), Pitfall 9 (CASCADE on strategy archive), Pitfall 16 (sparkline color decision rule — single accent based on final-value sign).
**Migrations:** 0 net-new (data-only `UPDATE strategies SET is_example=true WHERE id IN (<seed UUIDs>)` — no DDL).

### Phase 12.03 — T8b Single-Strategy v2 UI (DEPENDS ON 12.01, ~1.5 sessions)

**Rationale:** Consumes Phase 12.01's new JSONB keys. Replaces the 5-tab `PerformanceReport` with a 7-panel scrollable `PerformanceReportV2`. Uses the production-validated `allocations.ui_v2` localStorage flag pattern.
**Delivers:** New route `/strategy/[id]/v2` (or flag-gated swap), `PerformanceReportV2.tsx` orchestrator + 7 sub-panel components, new chart components (`DailyHeatmap`, `ExposureSeries`, `TurnoverSeries`, `BenchmarkGreeksPanel`, `UnderwaterToggle`), recolored existing charts to DESIGN.md identity, partial-data states per panel, lazy-mount panels 4–7, vitest panel-count gate.
**Addresses:** TS-04 through TS-09, TS-10 (frontend half), TS-14, TS-16, TS-18, TS-19, TS-20, DIFF-02 (axe-core), DIFF-03 (BTC default-ON), DIFF-10 (7-panel layout).
**Avoids:** Pitfall 3 (axis contrast — use `CHART_AXIS_TICK`), Pitfall 4 (daily heatmap canvas fallback at >365 cells), Pitfall 6 (lazy-mount + hoist single ResizeObserver + reuse lightweight-charts instance on toggle), Pitfall 12 (per-strategy-type exposure-data check — hide Panel 7 exposure for spot-only/LP strategies), Pitfall 13 (per-chart identity checklist in PR template), Pitfall 14 (`CHART_TICK_STYLE` token with `fontVariantNumeric: "tabular-nums"`), Pitfall 17 (per-panel partial-data matrix — "Awaiting more data" copy not hidden panels), Pitfall 20 (vitest panel-count = 7 gate), Pitfall 23 (BTC-only correlation — render as "Correlation with BTC" not a one-row "matrix").
**Migrations:** 0.

### Phase Ordering Rationale

- **Phase 12.01 + 12.02 ship in parallel** — independent dependencies, separate code surfaces (Python/analytics vs TypeScript/Discovery). Compresses sprint to ~2 phase-cycles instead of 3 sequential.
- **Phase 12.03 sequential after 12.01** — UI consumes new JSONB keys; can't render rolling Sortino series before metrics.py writes it.
- **Schema work is near-zero** — the leanest milestone since v0.13.x. Migrations 059–065 + 070–083 front-loaded the schema; v0.17 cashes in JSONB headroom.
- **Visual contract is unforgiving** — DESIGN.md identity drift is the largest design risk; per-chart checklist + visual snapshot CI gate is non-negotiable for Phase 12.03.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 12.01 (T8a):** Trade Mix maker/taker breakdown (TS-15 partial) requires verifying `is_maker` flag exists on raw_fills across all exchange ingestion paths (Binance/OKX/Bybit/Deribit) before committing to the panel. If absent, descope Trade Mix to v0.17.1.
- **Phase 12.02 (T7):** `organization_id` population audit (Pitfall 5). If 0 strategies have a non-NULL org, defer filter-by-team UI entirely to v0.18.
- **Phase 12.03 (T8b):** Per-strategy-type exposure-data matrix (Pitfall 12) — enumerate which `strategy_types` have insufficient fills/positions to render Panel 7's exposure subsection (spot_arb, lp_yield, market_make_neutral are likely candidates). Document in DESIGN.md decisions log.

**Phases with standard patterns (skip research-phase):**
- **Phase 12.01 (most of T8a):** `_rolling_sortino`, `_rolling_volatility`, `daily_returns_grid` are all direct mirrors of the existing `_rolling_sharpe` (`metrics.py:374`) and `_monthly_returns_grid_from_series` (`metrics.py:351`) patterns. No research needed; pattern is established.
- **Phase 12.03 (most of T8b):** localStorage flag pattern is verified production-live at `AllocationsTabs.tsx:111`. JSONB additive shape pattern is verified at `analytics_runner.py:189-211`. Lazy-mount via IntersectionObserver is established Sprint-9.1 pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All claims grounded in `package.json`, `requirements.txt`, and `npm view` (2026-04-26). Zero new top-level deps; one optional cleanup. |
| Features | HIGH on backend gap; LOW on Quants.Space-specific UI affordances | qstats catalogue from authoritative GitHub source. Codebase grep verified 70% of T7 already shipped. Quants.Space is auth-walled at `platform.quants.space`. |
| Architecture | HIGH | Every claim grounded in verified file:line evidence. Zero new compute paths needed. |
| Pitfalls | HIGH on critical/high; MEDIUM on perf budgets | WCAG ratios manually computed. Daily-heatmap 1825-cell threshold is conservative. |

**Overall confidence:** HIGH for the work that matters (T8a backend, schema audit, architecture, top 5 pitfalls). LOW only on whether specific Quants.Space UI affordances we've never seen in the auth-walled platform should be cloned literally — defer to DESIGN.md identity rules and skip features rather than guess.

### Gaps to Address

- **Quants.Space platform UI (auth-walled):** Plan's "match Quants.Space IA" claims rely on user directive interpretation. Default to DESIGN.md when uncertain.
- **`organization_id` population status:** Phase 0 audit (one SQL query). If 0 non-NULL, drop filter-by-team from T7 scope.
- **`is_maker` flag availability on raw_fills:** Trade Mix panel depends on this. Phase 12.01 audit before committing.
- **Daily heatmap perf threshold:** Phase 12.03 adds Playwright `performance.measure()` budget assertion.
- **`metrics_json` row size growth:** Path-extraction is the cheap default; sibling-table refactor is v0.18 if `pg_column_size(metrics_json)` p99 exceeds 800kB.

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/metrics.py` (411 lines, read fully) — current compute path
- `analytics-service/services/position_reconstruction.py:435-495` — exposure aggregate-only emission
- `analytics-service/services/analytics_runner.py:189-275` — additive upsert pattern
- `analytics-service/services/job_worker.py:1434-1460` — queue dispatch by `kind`
- `src/components/charts/chart-tokens.ts` — `CHART_AXIS_TICK = "#64748B"` (the WCAG-safe value)
- `src/components/charts/*.tsx` (12 files inspected) — existing renderer inventory
- `src/components/strategy/{PerformanceReport,StrategyTable,StrategyFilters,StrategyGrid,VolumeExposureTab}.tsx`
- `src/lib/types.ts:52, 88-117` — `Strategy.is_example` + `StrategyAnalytics.daily_returns` declared
- `src/lib/queries.ts:166, 213, 274` — server-fetch DAL
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:105-121` — `ui_v2` flag pattern to mirror
- `supabase/migrations/001_initial_schema.sql:64,92` — `is_example` + `daily_returns JSONB` already shipped
- `supabase/migrations/006_organizations.sql:30` — `strategies.organization_id` FK already shipped
- `supabase/migrations/024_user_favorites.sql:29-105` — watchlist-shaped table already exists with full RLS
- `supabase/migrations/026_fix_organization_rls_recursion.sql:97-99` — `is_org_member()` SECURITY DEFINER helper
- `package.json` (v0.15.13.0) + `analytics-service/requirements.txt`
- `https://raw.githubusercontent.com/ranaroussi/quantstats/main/quantstats/{stats,reports,_plotting/wrappers}.py` — qstats catalogue
- `~/.claude/plans/strategy-teams-kpi-parity.md` — master plan (S6, S7, T8a, T8b sections); partially refuted by codebase grep
- `.planning/PROJECT.md` (lines 50-95) — milestone scope
- `DESIGN.md` — chart identity rules, UC#7 density-rule deviation
- WCAG 2 contrast manual calc (`#94A3B8` ≈ 2.85:1, `#718096` ≈ 3.94:1, `#64748B` ≈ 4.85:1 on white)

### Secondary (MEDIUM confidence)
- `npm view recharts lightweight-charts @nivo/boxplot` — current versions verified 2026-04-26
- `.planning/codebase/CONCERNS.md` — Vercel tier, hand-maintained types, ops context
- `.planning/codebase/ARCHITECTURE.md:1-120` — server-first RSC + RLS-as-authz + FastAPI compute split

### Tertiary (LOW confidence — needs validation)
- [Quants.Space marketing](https://quants.space/#features) — platform is auth-walled at `platform.quants.space`; only marketing copy accessible. **Plan's "Quants.Space mirror" feature list is user directive interpretation, not independently verifiable.**

---
*Research completed: 2026-04-26*
*Ready for roadmap: yes*
