# Phase 14b: Single-Strategy v2 — Lazy Panels + Trade & Exposure - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Bodies for Panels 4–7 land inside the Phase 14a scrollable shell, lazy-mounted via the IntersectionObserver scaffold. Panel 4 = Returns Distribution (5 sub-charts). Panel 5 = Rolling Sharpe / Vol / Sortino / α-β with a single shared 3M/6M/12M window toggle. Panel 6 = Trade & Position metrics (4 row types incl. 2-bucket long/short Trade Mix — maker/taker 4-bucket descoped to v0.17.1 per the locked Phase 12 audit). Panel 7 = Exposure series + Turnover series + Correlation with BTC + Benchmark Greeks. axe-core CI (Playwright + @axe-core/playwright) covers `/discovery/[slug]` + the full 7-panel `/strategy/[id]/v2`. Full keyboard navigation across the 7-panel scroll. Automated chart-snapshot parity diff (Playwright `toHaveScreenshot` ±2%) gates regression. DailyHeatmap ships SVG/Canvas dual renderer for ≤365 vs >365 cells (Pitfall 4).

**Explicit non-goals (deferred to v0.17.1 or beyond):**
- Trade Mix 4-bucket maker/taker (KPI-17 partial) — descoped to v0.17.1 per Phase 12 audit lock (`TRADE_MIX_HAS_MAKER_TAKER=false`)
- Multi-benchmark ETH/SOL correlation matrix (UC#6) — Sprint 13+ when ingestion ships
- Panel 4 ReturnHistogram / ReturnQuantiles / YearlyReturns "layout-only" close-out per KPI-06: hand-rolled SVG existing components are reused as-is; if any need polish, that's a separate Sprint 13 item
- `/discovery/[slug]/[strategyId]` nested integration — punted (handled by Phase 14a deferred list)
- Mobile-responsive polish — desktop-only acceptable per PROJECT.md

</domain>

<decisions>
## Implementation Decisions

### Panel scope (KPI-06 / KPI-07 / KPI-08..21 / KPI-23b)

- **Panel 4 — Returns Distribution** mounts inside the existing `LazyPanelPlaceholder` slot via the `useLazyPanelMetrics` hook shipped by Phase 14a. Sub-charts:
  - **MonthlyHeatmap** — reuse existing `src/components/charts/MonthlyHeatmap.tsx` as-is
  - **DailyHeatmap** (NEW) — SVG renderer for ≤365 cells, Canvas API single-draw fallback above 365 (Pitfall 4 mitigation); ships at `src/components/charts/DailyHeatmap.tsx`. Threshold check at component level. Uses `daily_returns_grid` from `metrics_json` (Phase 12 METRICS-04 shipped this).
  - **ReturnHistogram** — reuse existing `src/components/charts/ReturnHistogram.tsx`; pass benchmark overlay prop if not already present
  - **ReturnQuantiles** — reuse existing hand-rolled `src/components/charts/ReturnQuantiles.tsx` (no boxplot dep — verified Phase 14a CLEANUP-01)
  - **YearlyReturns** — reuse existing `src/components/charts/YearlyReturns.tsx`
- **Panel 5 — Rolling**: single shared 3M/6M/12M window toggle drives all 4 sub-charts (Rolling Sharpe / Rolling Volatility / Rolling Sortino / Rolling Alpha+Beta). Toggle state lives in the panel component; sub-charts receive `window: 90 | 180 | 365` as a prop. Reuse existing `src/components/charts/RollingMetrics.tsx` for Sharpe; new wrappers for Vol / Sortino / α-β consume Phase 12 METRICS-02 / METRICS-03 / METRICS-12 series.
- **Panel 6 — Trade & Position**: 4 row types (Trade Main / Position Main / Risk-Reward / Volume) + Trade Mix sub-panel (2-bucket long/short only). New component `src/components/strategy-v2/TradeAndPositionPanel.tsx`. Trade Mix at `src/components/strategy-v2/TradeMixSubPanel.tsx`.
- **Panel 7 — Exposure & Greeks**: 4 sub-components — `NetGrossExposureChart` (NEW), `TurnoverChart` (NEW), reuse `src/components/charts/CorrelationWithBenchmark.tsx`, new `BenchmarkGreeksTable` (alpha / beta / IR / treynor — existing scalars from `metrics.py:255-267`).
- **Per-panel partial-data states (KPI-23b)**: panels 4–7 each render the documented "Awaiting more data (need ≥X days)" copy when relevant `metrics_json` keys are null OR series length is below threshold. Reuse the `PartialDataBanner` component shipped Phase 14a. Per-panel matrix documented in PR template (Pitfall 17).

### Lazy mount lifecycle

- Phase 14b activates the existing `useLazyPanelMetrics` hook for real fetches (Phase 14a shipped placeholder lifecycle only). When `IntersectionObserver` fires, the hook calls `fetchStrategyLazyMetrics(strategyId, panelId)` (consumer shipped Plan 12-08; uses `strategy_analytics_series` sibling table per METRICS-17).
- Each Panel 4/5/6/7 client component mounts a `LazyPanelBody` that wraps `useLazyPanelMetrics`; `data-panel-status` transitions `placeholder` → `loading` → `ready` (or `error`).
- `LazyPanelPlaceholder` shipped Phase 14a is removed/replaced by the real Panel 4-7 component implementations; the IntersectionObserver scaffold remains.

### KPI-17 Trade Mix scope (locked)

- Phase 12 audit returned `TRADE_MIX_HAS_MAKER_TAKER=false` (Plan 12-01 / Plan 12-05). 2-bucket fallback (long-entry / short-entry) is the production data shape today.
- Phase 14b ships ONLY the 2-bucket Trade Mix sub-panel. The 4-bucket maker/taker dimension (KPI-17 partial) is descoped to v0.17.1.
- TODOS entry stamped: "v0.17.1: KPI-17 Trade Mix maker/taker — gated on `is_maker` flag population on Binance + OKX + Bybit `raw_fills` ingestion." (Bybit/Binance/OKX is_maker fix ships v0.17.1 in `analytics-service/services/exchange.py`.)
- The phase success criterion #5 chooses path "B" (2-bucket only, panel-count gate adjusted accordingly); no ingestion-side work in 14b scope.

### axe-core CI integration (A11Y-02)

- Test runner: **Playwright + `@axe-core/playwright`**. Existing `e2e/` lane is the home; new package dependency `@axe-core/playwright` added to `devDependencies`.
- Coverage: `/discovery/[slug]` (full route — Phase 13 surface) AND `/strategy/[id]/v2` (full route — all 7 panels mounted via wait-for-`data-panel-status="ready"` on panels 1-7).
- New spec: `e2e/strategy-v2-axe.spec.ts` and `e2e/discovery-axe.spec.ts`.
- CI integration: existing Playwright CI lane already runs on every PR per `.github/workflows/`. Both new specs join that lane.
- Threshold: zero violations on `wcag2a`, `wcag2aa`, `best-practice` rule sets. Failures BLOCK merge.

### Keyboard navigation (A11Y-03)

- Verification mechanism: **Playwright tab-traversal spec** at `e2e/strategy-v2-keyboard.spec.ts`. Asserts focus order across:
  - Customize drawer trigger (Phase 13 component)
  - Watchlist tab toggle (Phase 13 component)
  - Full 7-panel scroll (asserts each `<section data-panel>` becomes focusable in order via `tabIndex={-1}` on the section + skip-link mechanism)
  - Panel 2 EquityCurve segmented control (4 buttons; disabled buttons remain in tab order via `aria-disabled="true"` per Phase 14a UI-SPEC)
  - Panel 5 shared 3M/6M/12M window toggle
- Focus order documented in a new `docs/A11Y.md` (or appended to existing if it exists).

### Chart-snapshot parity diff (Phase 14b SC#1)

- Mechanism: **Playwright `toHaveScreenshot()` with ±2% pixel-diff tolerance**. Goldens stored at `e2e/__snapshots__/strategy-v2/`.
- Spec: `e2e/strategy-v2-chart-parity.spec.ts`. Renders `/strategy/[id]/v2` with a fixed 252-day golden fixture (the `analytics-service/tests/fixtures/golden_252d` data already used Phase 12).
- Per-panel screenshots: 1 per panel × 7 panels = 7 goldens. Plus 1 full-page golden for the scroll layout.
- Structural assertions ALSO included: each chart has exactly 1 strategy series stroke, ≤1 BTC benchmark stroke (where applicable), CHART_TICK_STYLE applied (grep on rendered SVG `font-variant-numeric`).
- Tolerance: ±2% per panel, ±5% full-page (anti-aliasing slack).

### DailyHeatmap SVG/Canvas dual renderer (KPI-07 / Pitfall 4)

- Threshold: 365 cells (≤365 SVG, >365 Canvas). Threshold checked at component level via `if (cells.length <= 365) return <SvgRenderer />; else return <CanvasRenderer />;`.
- SVG renderer: standard React + chart-tokens (CHART_ACCENT for positive cells, --color-negative for negative; CHART_BORDER for grid lines).
- Canvas renderer: single `<canvas>` element with imperative `useEffect` paint; NO per-cell DOM elements (avoids 5y × 365 = ~1825-element render explosion).
- IntersectionObserver-deferred paint: Panel 4 mounts via `useLazyPanelMetrics` (lazy lifecycle from 14a) — Canvas paint only fires on first intersection.
- Performance budget: <300ms first paint on 5y fixture (asserted in Playwright spec via `performance.measure()`).

### Existing component reuse (NO v2 forks)

- `src/components/charts/MonthlyHeatmap.tsx` (existing) — reused as-is in Panel 4
- `src/components/charts/ReturnHistogram.tsx` (existing) — reused; benchmark overlay prop verified at plan-time
- `src/components/charts/ReturnQuantiles.tsx` (existing, hand-rolled SVG) — reused as-is in Panel 4
- `src/components/charts/YearlyReturns.tsx` (existing) — reused as-is in Panel 4
- `src/components/charts/RollingMetrics.tsx` (existing) — reused for Panel 5 Rolling Sharpe; verify it accepts `window` prop
- `src/components/charts/CorrelationWithBenchmark.tsx` (existing) — reused as-is in Panel 7
- All NEW Panel 4-7 wrappers live under `src/components/strategy-v2/` per the precedent established Phase 14a
- All charts honor the v2 4-size / 2-weight type contract (12 / 16 / 18 / 32 px; 400 / 600 weights only)
- All Recharts axis ticks spread `CHART_TICK_STYLE` (Pitfall 14)

### Test infrastructure (Phase 14b additions)

- `e2e/strategy-v2-axe.spec.ts` (NEW — A11Y-02)
- `e2e/discovery-axe.spec.ts` (NEW — A11Y-02)
- `e2e/strategy-v2-keyboard.spec.ts` (NEW — A11Y-03)
- `e2e/strategy-v2-chart-parity.spec.ts` (NEW — SC#1 chart-snapshot parity)
- `e2e/strategy-v2-partial-data.spec.ts` (EXTEND — Phase 14a authored skeleton; 14b extends to cover Panels 4-7 history bands per KPI-23b)
- Vitest co-located tests for new components (TradeAndPositionPanel, TradeMixSubPanel, DailyHeatmap canvas-fallback path, NetGrossExposureChart, TurnoverChart, BenchmarkGreeksTable)
- New devDependency: `@axe-core/playwright`

### Backend wiring

- `getStrategyDetailV2` (shipped Phase 14a) is REUSED — Panel 4-7 bodies still go through `fetchStrategyLazyMetrics(strategyId, panelId)` for heavy series (sibling table reads per METRICS-17).
- No new lib functions needed; `useLazyPanelMetrics` hook (shipped Phase 14a) is the unified entry point.
- The hook's placeholder lifecycle (Phase 14a) gets extended in Phase 14b to call the real fetch on intersection — single-line change inside the hook.

### Flag flip — `strategy.ui_v2` default ON

- Phase 14a shipped `strategy.ui_v2` localStorage flag default OFF.
- Phase 14b flips the default to **ON** as part of the final wave (after axe-core green + chart-snapshot goldens commit). This is a 1-line change in `src/lib/strategy-ui-v2-flag.ts`.

### PR template extension

- Phase 14b extends the existing `.github/PULL_REQUEST_TEMPLATE.md` (shipped Phase 14a) with the per-panel partial-data matrix (KPI-23b Pitfall 17 mitigation):
  - 7-day / 30-day / 90-day / 365-day rows × 7-panel columns checkbox grid
  - Each cell: "✓ banner copy" or "✓ full render" or "—"

### Claude's Discretion

- Component file layout under `src/components/strategy-v2/` is at Claude's discretion provided it follows the Phase 14a precedent and stays within `strategy-v2/` (no forks under `src/components/charts/`).
- Whether the Panel 5 toggle is implemented as a new `WindowToggle.tsx` component or reuses the existing `SegmentedControl.tsx` from Phase 14a is at Claude's discretion (recommend reusing SegmentedControl for visual consistency).
- DailyHeatmap Canvas implementation details (single full-redraw vs. cell-rect batching) are at Claude's discretion — only the <300ms budget matters.
- Whether `e2e/strategy-v2-axe.spec.ts` and `e2e/discovery-axe.spec.ts` share a helper module (`e2e/helpers/axe.ts`) or duplicate the boilerplate is at Claude's discretion.
- Whether Trade & Position cells share a `MetricCell` primitive or inline the structure is at Claude's discretion.
- Specific BenchmarkGreeksTable layout (vertical 4-row vs horizontal 4-cell strip) is at Claude's discretion provided DESIGN.md identity holds.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- All Phase 14a `src/components/strategy-v2/` components — Shell, OverviewPanel, HeadlineMetricsPanel, DrawdownPanel, LazyPanelPlaceholder, PartialDataBanner, SegmentedControl
- `src/hooks/useLazyPanelMetrics.ts` (Phase 14a) — IntersectionObserver hook; Panel 4-7 bodies activate the real-fetch path
- `src/components/charts/chart-tokens.ts` — `CHART_ACCENT`, `CHART_TEXT_MUTED`, `CHART_AXIS_TICK`, `CHART_TICK_STYLE`, `CHART_REFERENCE_DASH`, `CHART_TOOLTIP_STYLE`
- `src/components/charts/MonthlyHeatmap.tsx` — existing; Panel 4 reuses
- `src/components/charts/ReturnHistogram.tsx` — existing; Panel 4 reuses (verify benchmark prop)
- `src/components/charts/ReturnQuantiles.tsx` — existing hand-rolled SVG; Panel 4 reuses
- `src/components/charts/YearlyReturns.tsx` — existing; Panel 4 reuses
- `src/components/charts/RollingMetrics.tsx` — existing; Panel 5 reuses (verify window prop)
- `src/components/charts/CorrelationWithBenchmark.tsx` — existing; Panel 7 reuses
- `src/lib/queries.ts:fetchStrategyLazyMetrics` (Plan 12-08) — sibling-table fetch endpoint
- `src/lib/queries.ts:getStrategyDetailV2` (Phase 14a) — eager scalars; reused as-is

### Established Patterns
- Phase 14a precedent: every panel = white card (`bg-surface`), 24px padding (`p-6`), 1px borders (`border-border`), 8px radius (`rounded-lg`), 32px inter-panel gap (`mt-8` or `space-y-8`)
- Tabular-nums: `font-mono tabular-nums` Tailwind class on numeric cells; `CHART_TICK_STYLE` spread on Recharts axes
- BTC benchmark stroke: `CHART_TEXT_MUTED` + `strokeDasharray={CHART_REFERENCE_DASH}`
- `data-panel-status` attribute lifecycle: `placeholder` → `loading` → `ready` (or `error`)
- 2-weight type contract: `font-normal` (400) + `font-semibold` (600); NO `font-medium` / `font-light` / `font-bold`
- 4-size type contract: `text-xs` (12px) / `text-base` (16px) / `text-lg` (18px) / `text-[32px]`

### Integration Points
- `StrategyV2Shell.tsx` — Phase 14b replaces the Panel 4-7 `LazyPanelPlaceholder` slots with real `LazyPanelBody`-wrapped components
- `useLazyPanelMetrics` — Phase 14b extends to invoke `fetchStrategyLazyMetrics` on intersection
- `e2e/` directory — 4 new specs (axe x2, keyboard x1, parity x1) + extension of existing partial-data spec
- `tests/visual/` — type-scale grep test extends to cover Phase 14b's new src/components/strategy-v2 files (no config change; the glob already catches them)
- `.github/PULL_REQUEST_TEMPLATE.md` — extend with Pitfall 17 partial-data matrix
- `src/lib/strategy-ui-v2-flag.ts` — flip default OFF → ON in final commit

</code_context>

<specifics>
## Specific Ideas

- **DailyHeatmap perf budget**: <300ms first paint on 5y fixture — Playwright `performance.measure('paint-budget', 'panel-4-mount-start', 'panel-4-mount-end')` asserts threshold.
- **Cell threshold = 365**: SVG ≤365, Canvas >365. Hard-coded constant; no config.
- **Panel 6 Trade Main row**: total / long / short / wins / losses / win rate (existing `trade_count` extended with side segmentation per KPI-12).
- **Panel 6 Position Main row**: open / closed / long / short / win rate / avg duration (KPI-13 — surfaces `position_reconstruction.py` aggregates).
- **Panel 6 Risk-Reward row**: R:R / Weighted R:R / Profit Factor / Payoff Ratio / Long PF / Short PF / Expectancy (KPI-14 — Phase 12 METRICS-07 shipped these).
- **Panel 6 SQN**: Van Tharp `sqn = (mean(R)/std(R)) × sqrt(min(N,100))` (KPI-15 — Phase 12 METRICS-08).
- **Panel 6 Volume row**: gross volume / mean trade size / mean daily turnover / mean monthly turnover (KPI-16 — Phase 12 METRICS-09).
- **Panel 7 Net + Gross Exposure series**: per-date arrays from `position_reconstruction.compute_exposure_metrics()` (KPI-18 — Phase 12 METRICS-05 persists `exposure_series: [{date, gross, net}]`).
- **Panel 7 Turnover series**: daily `abs(Δposition × price) / NAV` (KPI-19 — Phase 12 METRICS-06 shipped).
- **Panel 7 Correlation with BTC**: scalar + rolling-90d via reusing `CorrelationWithBenchmark.tsx` (KPI-20). Multi-benchmark deferred per UC#6.
- **Panel 7 Greeks**: alpha / beta / IR / treynor — existing scalars from `metrics.py:255-267` (KPI-21).
- **`@axe-core/playwright`** is the new devDependency. No other new deps introduced in Phase 14b (all chart libs already in tree).
- **Flag flip is the LAST commit** of Phase 14b — happens only after axe-core green AND chart-snapshot goldens committed AND keyboard nav green.

</specifics>

<deferred>
## Deferred Ideas

- **Trade Mix 4-bucket maker/taker (KPI-17 partial)** — descoped to v0.17.1; gated on `is_maker` flag fix in Binance/OKX/Bybit ingestion handlers (`analytics-service/services/exchange.py`).
- **Multi-benchmark correlation (ETH/SOL)** — UC#6 descope to Sprint 13+; needs new `benchmarks_eth` / `benchmarks_sol` ingestion pipelines.
- **Panel 4 component polish (ReturnHistogram benchmark overlay variant, ReturnQuantiles styling refinement)** — if existing components need polish beyond the wrapper, that's a Sprint 13 item; KPI-06 says "layout-only for 4 of 5 components".
- **Mobile-responsive polish** for `/strategy/[id]/v2` — desktop-only acceptable per PROJECT.md.
- **Universal `getStrategyDetailV2` adoption (v1 → v2 cutover)** — happens AFTER Phase 14b is shipped + flag flipped to default ON. Cutover removes `/strategy/[id]/page.tsx` v1 path. Sprint 13 item.
- **PDF tear-sheet auto-generation** — Sprint 13+ deferred per PROJECT.md.
- **Manager Workspace** — v0.18.0.0 milestone (T0.5 / T1-T6 / T9 from strategy-teams-kpi-parity plan).

</deferred>
