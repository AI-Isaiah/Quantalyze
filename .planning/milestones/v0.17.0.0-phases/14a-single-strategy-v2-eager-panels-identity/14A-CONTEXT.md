# Phase 14a: Single-Strategy v2 — Eager Panels + Identity - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship `/strategy/[id]/v2` as the new public Single-Strategy v2 surface — a 7-panel scrollable shell with eager bodies for **Panels 1–3 only** (Overview cards / Headline + Equity-vs-BTC overlay / Drawdown + Worst 5) in DESIGN.md identity, plus the IntersectionObserver scaffold + "Loading…" placeholders for panels 4–7. Land the identity baseline so Phase 14b inherits a clean foundation: extend `chart-tokens.ts` with `CHART_TICK_STYLE` for tabular-nums, add the WCAG-AA chart-axis contrast test, remove `@nivo/boxplot` from `package.json` (~80KB gzipped), and stamp the UC#7 7-panel density-rule deviation in DESIGN.md decisions log. Wire the new `getStrategyDetailV2(strategyId)` data path (path-extraction over `metrics_json` + sibling-table reads via existing `fetchStrategyLazyMetrics` consumer shipped by Plan 12-08).

**Explicit non-goals (deferred to Phase 14b):**
- Panel 2 Rolling Sharpe + Log Returns toggle bodies (only Cum + Underwater eager in 14a)
- Bodies for panels 4–7 (Returns Distribution / Rolling / Trade & Exposure)
- Trade Mix maker/taker close-out (KPI-17 — gated on Phase 12 audit, deferred)
- DailyHeatmap SVG/Canvas fallback (Panel 4)
- axe-core CI integration on the full route (A11Y-02 lands in 14b)
- Full keyboard navigation across 7 panels (A11Y-03 lands in 14b)
- `/discovery/[slug]/[strategyId]` nested integration

</domain>

<decisions>
## Implementation Decisions

### Route topology & flag default (KPI-01)
- `/strategy/[id]/v2` ships under `src/app/strategy/[id]/v2/page.tsx` — **public**, mirroring the existing v1 factsheet route. qstats parity is allocator-and-prospect facing alike; simpler routing wins.
- `strategy.ui_v2` localStorage flag default = **OFF in Phase 14a**. Flips to ON when Phase 14b lands the lazy bodies and full coverage. Mirrors precedent in `widget-state-flag.ts:21` ("default OFF until universal coverage"). URL override `?strategy_v2=on|off` allowed.
- Discovery integration (`/discovery/[slug]/[strategyId]`) is **punted to Phase 14b**. Phase 13 ships only `/discovery/[slug]`; the nested strategyId child route is out of 14a scope.

### Eager panel scope & placeholder UI (KPI-02 / KPI-03 / KPI-04 / KPI-05 / KPI-22 / KPI-23a)
- **Panel 1 — Overview**: 6 cards (Supported Exchanges / Types / Subtypes / Markets / Leverage / Avg DTO) reading from `strategies` row + `metrics_json` aggregates via `getStrategyDetailV2`. Eager.
- **Panel 2 — Headline + Equity vs BTC**:
  - 6-cell KPI strip (Cum Return / CAGR / Sharpe / Sortino / Max DD / Vol) — eager.
  - Segmented control: **Cumulative + Underwater** ship eager bodies (reuse `EquityCurve.tsx` and `DrawdownChart.tsx`). Rolling Sharpe + Log Returns buttons render **disabled** with `aria-disabled="true"` and a "Available in Phase 14b" tooltip; bodies land in 14b.
  - BTC overlay default-ON (DIFF-03).
- **Panel 3 — Drawdown**: full-width `DrawdownChart` + `WorstDrawdowns` table; reuse existing components as-is, no v2 fork.
- **Panels 4–7 — Placeholders**: each panel is a standard white card (`bg-card` + `border-border` + 1px borders + `rounded-lg`) with the panel title in heading style and the literal copy "Loading…" as muted body text. Mounted lazily via the IntersectionObserver scaffold; `data-panel-status="placeholder"` attribute so 14b body landing is a single text-replacement operation.
- **Partial-data states (KPI-23a)**: panels 1–3 each render the documented "Awaiting more data (need ≥X days)" copy when the relevant `metrics_json` keys are null; panel layout shape is preserved (no panel-hiding). History bands tested: 7 / 30 / 90 / 365 days via Playwright synthetic fixtures.

### Identity baseline & token additions (DESIGN-01 / DESIGN-02 / DESIGN-03 / A11Y-01 / CLEANUP-01)
- Extend `src/components/charts/chart-tokens.ts` with:
  - `CHART_TICK_STYLE` — exports `{ fontFamily: CHART_FONT_MONO, fontSize: 11, fontVariantNumeric: "tabular-nums", fill: CHART_AXIS_TICK }` for direct spread on Recharts `<XAxis tick={...}>` / `<YAxis tick={...}>`. Documented as the centralized fix for Pitfall 14 (Recharts SVG `<text>` doesn't inherit `font-variant-numeric` from CSS class).
- `CHART_AXIS_TICK = #64748B` already exists (4.85:1 contrast on white) — reuse.
- WCAG-AA contrast test at `tests/a11y/chart-contrast.test.ts` (Vitest + JSDOM): asserts `getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5` and grep-forbids `#94A3B8` / `#718096` as text fill on any axis label / tick / legend rendered inside `/strategy/[id]/v2`. Forbidden-color regex over component imports.
- Bundle hygiene: `npm uninstall @nivo/boxplot`; `ReturnQuantiles.tsx` is hand-rolled SVG with no boxplot dependency (verified). Manual review at PR time confirms ~80KB gzipped saved via `npm run build` size delta.
- DESIGN.md decisions log entry: stamp UC#7 7-panel density-rule deviation under "## Decisions / 7-panel single-strategy density (UC#7 explicit accept)".
- `.github/PULL_REQUEST_TEMPLATE.md` extended with the per-chart identity checklist (or new `.github/PULL_REQUEST_TEMPLATE/strategy-v2.md` if the existing template should remain untouched — Claude's discretion).

### Test infrastructure (Phase 14a-introduced)
- New top-level `tests/a11y/` directory — first member: `chart-contrast.test.ts`. Vitest config extended to include this path (or co-located vitest.config inheritance — Claude's discretion).
- New top-level `tests/visual/` directory — first member: `strategy-v2-panel-count.test.ts`. Asserts the v2 page renders exactly 7 top-level `<section data-panel>` elements via Vitest + JSDOM render. Mocks `getStrategyDetailV2` with a synthetic fixture.
- Partial-data history bands tested via **Playwright** (not Vitest) — `tests/e2e/strategy-v2-partial-data.spec.ts` covers 7-day / 30-day / 90-day / 365-day fixtures. Wired into the existing Playwright CI lane that Phase 13 added.
- Decision recorded: success-criterion paths win over "co-locate next to source" convention. The deviation is intentional and documented here.

### Backend wiring (METRICS-15 path-extraction completion)
- New `getStrategyDetailV2(strategyId)` lib function in `src/lib/queries.ts` — reads scalars from `metrics_json -> 'key'` paths (above-the-fold for Panels 1–3) and emits the panel-1-3 eager response shape. Leaves the existing `getStrategyDetail` (consumed by `/strategy/[id]` v1 public factsheet) untouched — minimal blast radius.
- Lazy panel hook: new `src/hooks/useLazyPanelMetrics.ts` wraps `IntersectionObserver` + `fetchStrategyLazyMetrics` (consumer already shipped by Plan 12-08). Returns `{ data, status: 'idle' | 'loading' | 'error' | 'ready' }`. Phase 14a uses the hook only to mount the placeholder lifecycle (no body fetches yet); Phase 14b panel bodies invoke the real fetch on intersection.
- The path-extraction half completes METRICS-15 (the consumer half shipped Plan 12-08); v1 path stays on `select *, strategy_analytics(*)` until v2 is universally adopted post-14b.

### PR template & workflow
- Per-chart identity checklist added to PR template (DESIGN-03):
  - [ ] White card surface (`bg-card`)
  - [ ] Strategy series uses `CHART_ACCENT` (#1B6B5A); benchmark uses `CHART_TEXT_MUTED` (#94A3B8)
  - [ ] Positive/negative cells use `#16A34A` / `#DC2626`
  - [ ] 1px gridlines (`CHART_BORDER` #E2E8F0)
  - [ ] No Plotly modebar / no Plotly chrome
  - [ ] Axis ticks use `CHART_TICK_STYLE` (DM Sans 11px → Geist Mono 11px tabular-nums)
  - [ ] axe-core green on the chart's container

### Claude's Discretion
- Component file layout under `src/components/strategy-v2/` (e.g. `StrategyV2Shell.tsx`, `OverviewPanel.tsx`, `HeadlineMetricsPanel.tsx`, `DrawdownPanel.tsx`, `LazyPanelPlaceholder.tsx`) is at Claude's discretion provided imports follow `src/components/strategy/` conventions.
- Whether the segmented control wraps `EquityCurve` + `DrawdownChart` as siblings (mounted/hidden) or swaps them on toggle is at Claude's discretion provided the BTC overlay default-ON contract holds across switches.
- Whether the placeholder lifecycle hook `useLazyPanelMetrics` ships in 14a as a true hook or as a passthrough scaffold (emits `status='ready'` immediately for placeholders) is at Claude's discretion — the Phase 14b consumer shape is the contract.
- Exact Vitest config approach for top-level `tests/` dirs (extending `vitest.config.ts` includes vs separate config) is at Claude's discretion.
- PR template extension via existing `.github/PULL_REQUEST_TEMPLATE.md` edit vs new `strategy-v2.md` template file is at Claude's discretion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/charts/EquityCurve.tsx` — existing equity-vs-benchmark chart; supports BTC overlay. Wrap inside Panel 2 segmented control.
- `src/components/charts/DrawdownChart.tsx` — existing underwater chart; reused for both Panel 2 (Underwater toggle) and Panel 3 (full-width).
- `src/components/charts/WorstDrawdowns.tsx` — drawdown table (Started / Recovered / DD% / Days). Reuse as-is in Panel 3.
- `src/components/charts/RollingMetrics.tsx` — exists for v1; will be wrapped in 14b for Panel 5.
- `src/components/charts/chart-tokens.ts` — central token file with `CHART_ACCENT`, `CHART_AXIS_TICK`, `CHART_BORDER`, `CHART_FONT_MONO`, `CHART_TOOLTIP_STYLE`. Extend with `CHART_TICK_STYLE`.
- `src/lib/widget-state-flag.ts` — reference implementation of localStorage + URL-override flag pattern (mirror its 3-tier precedence: URL > localStorage > SSR-safe default).
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:111-225` — `allocations.ui_v2` flag handler; canonical pattern for the `strategy.ui_v2` flag.
- `src/lib/queries.ts:fetchStrategyLazyMetrics()` — Plan 12-08 consumer; pairs with new `getStrategyDetailV2`.
- `src/components/strategy/StarToggle.tsx` — Phase 13 watchlist toggle (no relation to 14a but lives in same component family).

### Established Patterns
- Public route `/strategy/[id]/page.tsx` is async server component using `getPublicStrategyDetail`. Mirror the pattern: `/strategy/[id]/v2/page.tsx` async server component using `getStrategyDetailV2`.
- `src/app/(dashboard)` is allocator-only auth-gated namespace; `src/app/strategy` (no parens prefix) is public. Phase 14a stays under `src/app/strategy/[id]/v2/`.
- Vitest test files: co-located `.test.tsx` next to source; `src/__tests__/` for cross-module integration. Phase 14a deviates by putting `tests/a11y/` and `tests/visual/` at top-level — explicitly required by success-criterion paths.
- Recharts `<XAxis tick={CHART_TICK_STYLE}>` spread pattern (mirroring how `tooltipStyle` is spread today). Avoids per-component className overrides.
- Server components return JSX directly; client interactivity (segmented control, IntersectionObserver) lives in `"use client"` panel components.

### Integration Points
- Route registration: `src/app/strategy/[id]/v2/page.tsx` (new) + `src/app/strategy/[id]/v2/page.test.tsx` (sibling test) + optional `src/app/strategy/[id]/v2/layout.tsx` if metadata diverges from v1.
- Data fetch: `getStrategyDetailV2` exported from `src/lib/queries.ts`; consumed by the new server component.
- Lazy fetch: `useLazyPanelMetrics` hook in `src/hooks/useLazyPanelMetrics.ts`; consumed inside each `LazyPanelPlaceholder` client component.
- Chart tokens: `chart-tokens.ts` extension; consumed across all v2 panel components.
- Tests: `tests/a11y/chart-contrast.test.ts`, `tests/visual/strategy-v2-panel-count.test.ts`, `tests/e2e/strategy-v2-partial-data.spec.ts` — three new test files at top-level dirs.
- DESIGN.md decisions log: edit at the existing "## Decisions" section. PR template: edit `.github/PULL_REQUEST_TEMPLATE.md` (or new `strategy-v2.md`).
- Bundle: `package.json` dependency removal (`@nivo/boxplot`).

</code_context>

<specifics>
## Specific Ideas

- **DIFF-03 BTC overlay default-ON**: Panel 2 Cumulative chart MUST render the BTC benchmark series by default. Toggle-off available via the existing `EquityCurve` benchmark prop. Same for Underwater toggle (BTC overlay rendered as `CHART_TEXT_MUTED` stroke).
- **Pitfall 14 mitigation**: Recharts `<text>` SVG elements don't inherit `font-variant-numeric` from a parent CSS class. The `CHART_TICK_STYLE` token MUST set `fontVariantNumeric: "tabular-nums"` directly on the tick style object so axis ticks render in tabular-nums. Code reviewer should grep all v2 panel charts to verify the spread pattern is used.
- **Pitfall 4 deferred**: DailyHeatmap SVG/Canvas fallback is Panel 4 (KPI-07) — not in 14a scope. The placeholder for Panel 4 must NOT preemptively allocate a Canvas element.
- **Forbidden colors as axis text**: `#94A3B8` is reserved for benchmark STROKES only. Never as text fill on axis labels / ticks / legend. The `chart-contrast.test.ts` enforces this via grep over v2 panel imports.
- **`@nivo/boxplot` audit**: `ReturnQuantiles.tsx` (currently in `src/components/charts/`) was hand-rolled SVG; verified no `@nivo/boxplot` imports. Safe to uninstall the package.
- **`getStrategyDetailV2` shape**: returns `{ strategy: StrategyRow, panel1: OverviewData, panel2Headline: HeadlineScalars, panel2Equity: EquitySeries, panel3: DrawdownData, lazyKeys: ('panel4'|'panel5'|'panel6'|'panel7')[] }`. The `lazyKeys` array signals which placeholders should mount.

</specifics>

<deferred>
## Deferred Ideas

- **Trade Mix maker/taker 4-bucket close-out** (KPI-17) — Phase 12 audit returned `TRADE_MIX_HAS_MAKER_TAKER=false`; 2-bucket fallback shipped in Plan 12-05. Maker/taker dimension waits for v0.17.1 ingestion-side fix.
- **Multi-benchmark correlation matrix (ETH/SOL)** — UC#6 descope to Sprint 13+. Phase 14a + 14b render only "Correlation with BTC".
- **Mobile-responsive polish** for `/strategy/[id]/v2` — desktop-only acceptable per PROJECT.md institutional-product constraint.
- **PDF presskit / tear-sheet auto-generation** — v0.18+ deferred.
- **`/discovery/[slug]/[strategyId]` nested route** — Phase 13 ships only `/discovery/[slug]`; nested integration deferred to 14b (or punted further if scope creep).
- **Universal `getStrategyDetailV2` adoption** — Phase 14a leaves v1 public factsheet on the legacy data path; v1 → v2 cutover happens post-14b once the route is feature-complete and the `strategy.ui_v2` flag is flipped to default-ON.
- **CI-gated bundle-size assertion** — manual review acceptable for the `@nivo/boxplot` removal; scripted size-delta check is a future infrastructure improvement.
- **`@nivo/boxplot` removal validation in CI** — manual `npm run build` size-delta confirmation at PR review time. Future: bundle-stats CI lane.

</deferred>
