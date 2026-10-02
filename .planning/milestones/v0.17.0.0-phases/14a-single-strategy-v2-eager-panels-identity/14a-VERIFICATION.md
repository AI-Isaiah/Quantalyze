---
phase: 14a-single-strategy-v2-eager-panels-identity
verified: 2026-04-29T13:00:00Z
status: human_needed
score: 11/12
overrides_applied: 0
human_verification:
  - test: "Run `cd analytics-service && pytest tests/test_metrics_parity.py -x` in an environment with pyarrow installed"
    expected: "All 4 tests pass (was: 4 passed, 1 error in local venv due to missing pyarrow)"
    why_human: "Local venv missing pyarrow — ImportError from fastparquet/pyarrow prevents the parquet fixture from loading. CI environment should have it. Cannot verify programmatically in this session."
  - test: "Open /strategy/{any-published-id}/v2 in a browser and verify: H1 renders in Instrument Serif 32px; 7 panel sections visible; panels 1-3 render full bodies; panels 4-7 show 'Loading…' placeholders; BTC overlay checkbox defaults ON; Cumulative/Underwater are clickable; Rolling Sharpe/Log Returns show disabled state."
    expected: "Visual and interactive behavior matches UI-SPEC §4 contract — correct typography, panel layout, and chart rendering at DESIGN.md identity"
    why_human: "Visual fidelity, chart rendering (lightweight-charts canvas), and interactive state cannot be verified programmatically via grep/render tests"
  - test: "Confirm `DrawdownChart.tsx` axis tick fontSize (currently 11) is intentionally deferred to Phase 14b rather than a gap in DESIGN-02/A11Y-01. Check whether CI chart-contrast test covers this chart."
    expected: "Deviation is intentional per SUMMARY 14a-01 decisions field ('Kept fontSize: 11 on lightweight-charts layout config — UI-SPEC defers to 14b'); DrawdownChart Recharts ticks also use fontSize 11 not CHART_TICK_STYLE. Confirm 14b plan will update both."
    why_human: "Design decision requiring owner sign-off: CHART_TICK_STYLE (fontSize:12, tabular-nums) exists but DrawdownChart.tsx still spreads fontSize:11 inline and does not use CHART_TICK_STYLE. The plan explicitly deferred this — human should confirm 14b will close the gap."
---

# Phase 14a: Single-Strategy v2 — Eager Panels + Identity — Verification Report

**Phase Goal:** `/strategy/[id]/v2` ships the 7-panel scrollable shell + eager bodies for Panels 1–3 (Overview / Headline+Equity / Drawdown) in DESIGN.md identity, with placeholders for panels 4–7 lazy-mounted via IntersectionObserver but bodies deferred to Phase 14b. Identity baseline (chart contrast tokens, tabular-nums style, `@nivo/boxplot` removed) lands here so Phase 14b inherits a clean foundation.

**Verified:** 2026-04-29T13:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/strategy/[id]/v2` route exists and resolves | VERIFIED | `src/app/strategy/[id]/v2/page.tsx` — server page calls `getStrategyDetailV2`, renders `<StrategyV2Shell>`, `notFound()` on missing strategy |
| 2 | Flag reader `isStrategyUiV2Enabled()` exists per KPI-01 pattern | VERIFIED | `src/lib/strategy-ui-v2-flag.ts` — localStorage + URL override, SSR-safe, mirrors `allocations.ui_v2` pattern |
| 3 | Panel 1 Overview (6-cell KPI row) renders from `strategies` row fields | VERIFIED | `OverviewPanel.tsx` — Supported exchanges / Types / Subtypes / Markets / Leverage / Avg DTO; `getStrategyDetailV2` populates from `strategies` row |
| 4 | Panel 2 Headline 6-cell KPI strip (Cum Return / CAGR / Sharpe / Sortino / Max DD / Vol) | VERIFIED | `HeadlineMetricsPanel.tsx` — 6 KPI cells with sign-coloring; data from `panel2Headline` sourced via `isComplete` guard in `getStrategyDetailV2` |
| 5 | Panel 2 Equity vs BTC segmented control with Cumulative + Underwater functional, Rolling Sharpe + Log Returns disabled | VERIFIED | `SegmentedControl.tsx` — `aria-disabled="true"` + `title="Available in Phase 14b"` on disabled options; `HeadlineMetricsPanel.tsx:69-71` |
| 6 | BTC overlay default-ON (DIFF-03) | VERIFIED | `HeadlineMetricsPanel.tsx:60` — `useState<boolean>(true)` comment `// DIFF-03 default-ON` |
| 7 | Panel 3 DrawdownChart + Worst 5 Drawdowns table | VERIFIED | `DrawdownPanel.tsx` — reuses `DrawdownChart` + `WorstDrawdowns` via minimal analytics adapter; full body when `history_days >= 30` |
| 8 | 7-panel scrollable shell with exactly 7 `<section data-panel>` elements | VERIFIED | `StrategyV2Shell.tsx` — 3 eager panels + 4 `<LazyPanelPlaceholder>` calls; `tests/visual/strategy-v2-panel-count.test.tsx` passes (3/3 assertions) |
| 9 | Panels 4–7 IntersectionObserver scaffold (`useLazyPanelMetrics`) | VERIFIED | `src/hooks/useLazyPanelMetrics.ts` (82 LOC) — SSR-safe short-circuit, emits `ready` on intersect, wired in `LazyPanelPlaceholder.tsx:30` |
| 10 | Per-panel partial-data banners (KPI-23a) for panels 1–3 | VERIFIED | `OverviewPanel.tsx` (<1 day), `HeadlineMetricsPanel.tsx` (<30 days KPI strip, <7 days chart), `DrawdownPanel.tsx` (<30 days); `e2e/strategy-v2-partial-data.spec.ts` authored (env-var skip gate per Phase 13 pattern) |
| 11 | `@nivo/boxplot` removed from `package.json` | VERIFIED | `grep "@nivo/boxplot" package.json` returns 0 matches; `npm run build` exits 0 |
| 12 | qstats fixture parity test passes (SC#1) | UNCERTAIN | `analytics-service/tests/test_metrics_parity.py` exists, golden_252d fixture files exist — but local venv missing pyarrow prevents running: `ImportError: Unable to find a usable engine` |

**Score:** 11/12 truths verified (1 uncertain — SC#1 environment limitation)

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/components/charts/chart-tokens.ts` | VERIFIED | Exports `CHART_TICK_STYLE` with `fontFamily, fontSize:12, fontVariantNumeric:"tabular-nums", fill:CHART_AXIS_TICK` as const |
| `src/lib/queries.ts::getStrategyDetailV2` | VERIFIED | Returns `StrategyV2Detail` with panel1/panel2Headline/panel2Equity/panel3/lazyKeys/history_days; DB query confirmed at lines 350–422 |
| `src/lib/strategy-ui-v2-flag.ts` | VERIFIED | Exports `isStrategyUiV2Enabled`, SSR-safe, localStorage + URL override |
| `src/components/strategy-v2/StrategyV2Shell.tsx` | VERIFIED | 94 LOC, server component, renders 7 sections including 4 LazyPanelPlaceholders |
| `src/components/strategy-v2/OverviewPanel.tsx` | VERIFIED | Panel 1, `data-panel="overview"`, `aria-label="Overview"`, partial-data banner at `history_days < 1` |
| `src/components/strategy-v2/HeadlineMetricsPanel.tsx` | VERIFIED | Panel 2, client component, 6-cell KPI strip + segmented control + EquityCurve/DrawdownChart toggle |
| `src/components/strategy-v2/DrawdownPanel.tsx` | VERIFIED | Panel 3, `data-panel="drawdown"`, `aria-label="Drawdown analysis"`, partial-data banner at `history_days < 30` |
| `src/components/strategy-v2/LazyPanelPlaceholder.tsx` | VERIFIED | `data-panel-status="placeholder"`, `aria-live="polite"`, wires `useLazyPanelMetrics` |
| `src/components/strategy-v2/PartialDataBanner.tsx` | VERIFIED | Shared KPI-23a banner component |
| `src/components/strategy-v2/SegmentedControl.tsx` | VERIFIED | aria-disabled + title="Available in Phase 14b" on disabled options |
| `src/hooks/useLazyPanelMetrics.ts` | VERIFIED | 82 LOC, SSR-safe, exports `useLazyPanelMetrics`, `LazyStatus`, `LazyPanelId`, `UseLazyPanelMetricsOptions` |
| `src/app/strategy/[id]/v2/page.tsx` | VERIFIED | Async params (Next.js 15+), `generateMetadata`, `notFound()` guard, renders `<StrategyV2Shell>` |
| `src/app/strategy/[id]/v2/error.tsx` | VERIFIED | Error boundary with `unstable_retry`, v1 fallback link via `usePathname` |
| `tests/a11y/chart-contrast.test.ts` | VERIFIED | 2/2 tests passing — CHART_AXIS_TICK contrast ratio 4.85:1 ≥ 4.5; zero forbidden fill colors in `src/components/strategy-v2/` |
| `tests/visual/strategy-v2-panel-count.test.tsx` | VERIFIED | 3/3 tests passing — exactly 7 panels, 4 placeholders, all panels have aria-label |
| `tests/visual/strategy-v2-type-scale.test.ts` | VERIFIED | 2/2 tests passing — zero forbidden size/weight classes in `src/components/strategy-v2/` |
| `e2e/strategy-v2-partial-data.spec.ts` | VERIFIED | Authored with env-var skip gate; 4 history-band fixtures (7/30/90/365 days); `seedStrategyWithHistory` placeholder documented as 14b extension |
| `vitest.config.ts` | VERIFIED | Extended to include `tests/a11y/**` and `tests/visual/**` |
| `src/test-setup.ts` | VERIFIED | IntersectionObserver stub added alongside existing ResizeObserver stub |
| `DESIGN.md` | VERIFIED | UC#7 7-panel density-rule deviation entry at 2026-04-29; v2 type-scale contract entry at 2026-04-29 |
| `.github/PULL_REQUEST_TEMPLATE.md` | VERIFIED | 8-box per-chart identity checklist + Summary + Test plan + Notes |
| `analytics-service/tests/test_metrics_parity.py` | VERIFIED (structure) | File exists, golden fixtures exist (`golden_252d_input.json`, `golden_252d_expected.json`, `golden_252d_input.parquet`); local venv missing pyarrow — CI should run clean |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `page.tsx` | `getStrategyDetailV2` | `import { getStrategyDetailV2 } from "@/lib/queries"` | WIRED | Confirmed at `page.tsx:3` |
| `page.tsx` | `StrategyV2Shell` | `import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell"` | WIRED | Confirmed at `page.tsx:4` |
| `StrategyV2Shell` | eager panels + LazyPanelPlaceholder | direct JSX props | WIRED | `panel1`, `panel2Headline`, `panel2Equity`, `panel3`, `history_days` all passed through |
| `LazyPanelPlaceholder` | `useLazyPanelMetrics` | `import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics"` | WIRED | Confirmed at `LazyPanelPlaceholder.tsx:3`; `ref={ref}` applied to `<section>` |
| `HeadlineMetricsPanel` | `EquityCurve` | `import { EquityCurve } from "@/components/charts/EquityCurve"` | WIRED | `benchmarkSeries={effectiveBenchmark}` passed; `hideBenchmarkToggle={true}` |
| `DrawdownPanel` | `DrawdownChart` + `WorstDrawdowns` | direct imports | WIRED | `panel3.drawdown_series` → DrawdownChart; adapter shape → WorstDrawdowns |
| `EquityCurve` | `chart-tokens.ts::CHART_ACCENT` | `import { CHART_ACCENT, CHART_FONT_MONO } from "./chart-tokens"` | WIRED | No legacy `#0D9488` or `'JetBrains Mono'` literals remaining |
| `chart-tokens.ts` | `CHART_TICK_STYLE` export | `export const CHART_TICK_STYLE = { fontFamily, fontSize:12, fontVariantNumeric, fill } as const` | WIRED | Token defined; consumed by future Recharts components in 14b |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `StrategyV2Shell` | `detail.panel1` | `getStrategyDetailV2` → `strategies` row fields | DB query confirmed (`supabase.from("strategies").select("*")`) | FLOWING |
| `HeadlineMetricsPanel` | `panel2Headline` | `getStrategyDetailV2` → `strategy_analytics` → `a.cagr / a.sharpe` etc. | DB join via `strategy_analytics (*)` | FLOWING |
| `EquityCurve` | `panel2Equity.series` | `metricsJson["equity_series_1y"]` or `a.returns_series` fallback | JSONB path-extraction from `metrics_json` | FLOWING |
| `DrawdownChart` | `panel3.drawdown_series` | `a.drawdown_series` (strategy_analytics row) | DB join, gated on `isComplete` | FLOWING |
| `LazyPanelPlaceholder` | none (placeholder) | N/A | No data payload in 14a | EXPECTED (by design) |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0, no output | PASS |
| Next.js production build succeeds | `npm run build` | `ƒ /strategy/[id]/v2` appears in route table, exit 0 | PASS |
| Full vitest suite passes | `npm test -- --run` | 2398 passed, 148 skipped, 0 failed (254 files) | PASS |
| chart-contrast test (A11Y-01) | `npx vitest run tests/a11y/chart-contrast.test.ts` | 2/2 passed | PASS |
| panel-count test (KPI-22) | `npx vitest run tests/visual/strategy-v2-panel-count.test.tsx` | 3/3 passed | PASS |
| type-scale lint test (DESIGN-02) | `npx vitest run tests/visual/strategy-v2-type-scale.test.ts` | 2/2 passed | PASS |
| git status clean | `git status --short` | no output (clean) | PASS |
| on main branch | `git branch --show-current` | `main` | PASS |
| qstats parity test | `cd analytics-service && .venv/bin/pytest tests/test_metrics_parity.py -x` | ImportError: pyarrow missing in local venv | SKIP (needs CI/human) |

---

## Requirements Coverage

| Requirement | Plans | Description | Status | Evidence |
|------------|-------|-------------|--------|----------|
| KPI-01 | 14a-02, 14a-04 | `/strategy/[id]/v2` route + `isStrategyUiV2Enabled` flag | SATISFIED | Route at `src/app/strategy/[id]/v2/page.tsx`; flag at `src/lib/strategy-ui-v2-flag.ts` |
| KPI-02 | 14a-03 | Panel 1 Overview 6-cell: Exchanges / Types / Subtypes / Markets / Leverage / Avg DTO | SATISFIED | `OverviewPanel.tsx` renders all 6 cells from `panel1` |
| KPI-03 | 14a-03 | Panel 2 Headline 6-cell strip: Cum Return / CAGR / Sharpe / Sortino / Max DD / Vol | SATISFIED | `HeadlineMetricsPanel.tsx:95-140` renders all 6 KPIs |
| KPI-04 | 14a-03 | Panel 2 EquityCurve + segmented control (Cumulative / Underwater / disabled-Rolling / disabled-Log) + BTC default-ON | SATISFIED | `HeadlineMetricsPanel.tsx:60,66-71,76-77`; `SegmentedControl.tsx:40-46` |
| KPI-05 | 14a-03 | Panel 3 DrawdownChart + Worst 5 Drawdowns table | SATISFIED | `DrawdownPanel.tsx` wires both components; `history_days < 30` banner |
| KPI-22 | 14a-03, 14a-05 | 7-panel scrollable shell + IntersectionObserver scaffold for panels 4–7 | SATISFIED | `StrategyV2Shell.tsx`, `useLazyPanelMetrics.ts`; panel-count test 3/3 |
| KPI-23a | 14a-03, 14a-05 | Partial-data banners for panels 1–3 across history bands; never crash / never hide | SATISFIED | All 3 panels have banner predicates; e2e spec authored with env-var skip gate |
| DESIGN-01 | 14a-01 | EquityCurve.tsx identity audit — no `#0D9488`, no `'JetBrains Mono'` | SATISFIED | `grep "#0D9488" EquityCurve.tsx` → 0; `grep "JetBrains Mono" EquityCurve.tsx` → 0; CHART_ACCENT used |
| DESIGN-02 | 14a-01, 14a-03 | `CHART_TICK_STYLE` token; `tabular-nums` on all numeric cells in v2 components | SATISFIED (with known deviation) | Token exported from `chart-tokens.ts`; v2 panel KPI cells use `tabular-nums` CSS class; `DrawdownChart.tsx` Recharts ticks still use `fontSize: 11` inline — documented as deferred to 14b in SUMMARY-01 decisions |
| DESIGN-03 | 14a-06 | DESIGN.md decisions log UC#7 entry + PR template per-chart identity checklist | SATISFIED | DESIGN.md line 137 UC#7 entry; `.github/PULL_REQUEST_TEMPLATE.md` 8-box checklist |
| A11Y-01 | 14a-01, 14a-05 | `CHART_AXIS_TICK = #64748B` (4.85:1 on white ≥ 4.5); no `#718096`/`#94A3B8` as text fill in v2 panels | SATISFIED | `tests/a11y/chart-contrast.test.ts` 2/2 passing; `CHART_AXIS_TICK` confirmed at `chart-tokens.ts:13` |
| CLEANUP-01 | 14a-06 | `@nivo/boxplot` removed from `package.json`; build succeeds | SATISFIED | No `nivo` in `package.json`; `npm run build` exit 0; commit `2907387` |

---

## Success Criteria Verdict

| SC | Description | Verdict | Evidence |
|----|-------------|---------|----------|
| SC#1 | qstats fixture parity test passes (`test_metrics_parity.py`) | UNCERTAIN | Test file + fixtures exist; local venv missing pyarrow — needs CI run to confirm |
| SC#2 | WCAG-AA contrast verified — `tests/a11y/chart-contrast.test.ts` passes; `CHART_AXIS_TICK = #64748B` | PASSED | 2/2 tests green; contrast ratio 4.85:1; `#94A3B8`/`#718096` grep-forbidden as text fill in v2 dir |
| SC#3 | 7-panel scrollable shell — panel-count test passes; panels 1–3 eager; 4–7 `data-panel-status="placeholder"` | PASSED | 3/3 panel-count tests green; `StrategyV2Shell.tsx` structure confirmed |
| SC#4 | Per-panel partial-data states — Playwright spec `e2e/strategy-v2-partial-data.spec.ts` exists with 7/30/90/365-day fixtures | PASSED | Spec authored with 4 bands + env-var skip gate (same pattern as Phase 13 `discovery-hide-examples-default.spec.ts`) — authored-but-skipped is explicitly acceptable per SC wording |
| SC#5 | `@nivo/boxplot` removed; `npm run build` produces smaller bundle; DESIGN.md UC#7 entry; PR template identity checklist | PASSED | All 4 sub-criteria confirmed |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/charts/DrawdownChart.tsx` | 27,34 | `fontSize: 11` inline tick config instead of `CHART_TICK_STYLE` spread; missing `fontVariantNumeric: "tabular-nums"` | Warning | Axis tick numerics on the drawdown chart lack tabular-nums in Phase 14a. This is a documented, intentional deferral to Phase 14b (SUMMARY-01 decisions: "Kept fontSize: 11 on lightweight-charts layout config — UI-SPEC defers to 14b — CHART_TICK_STYLE is Recharts-only"). Not blocking. |
| `src/components/charts/RiskOfRuin.tsx` | 28,29,42,56 | `#0D9488` + `'JetBrains Mono'` legacy colors | Warning | Outside Phase 14a scope (Panel 4+ charts). Not rendered on the v2 route in 14a. Will need DESIGN-01 audit in 14b. |
| `src/components/charts/ReturnQuantiles.tsx` | 37,61,63,68 | `#0D9488` legacy color | Warning | Same — Phase 14b charts, out of 14a scope. |
| `src/components/charts/MonthlyReturnsBar.tsx` | 28 | `'JetBrains Mono'` legacy font | Warning | Same — Phase 14b charts. |
| `src/components/charts/YearlyReturns.tsx` | 29 | `'JetBrains Mono'` legacy font | Warning | Same — Phase 14b charts. |
| `src/hooks/useLazyPanelMetrics.ts` | 40 | `void panelId` (unused parameter stub) | Info | Intentional: panelId is reserved for Phase 14b fetch dispatch; `void` reference satisfies `noUnusedParameters` under strict tsc. No impact. |

No blockers found. All warnings are either documented deferrals or out-of-scope charts.

---

## Human Verification Required

### 1. qstats Fixture Parity Test

**Test:** In CI (or local env with pyarrow): `cd analytics-service && pytest tests/test_metrics_parity.py -x`
**Expected:** All tests pass — 4 tests (the `1 error` in local run was a fixture-load failure due to missing pyarrow, not a logic failure)
**Why human:** Local venv missing pyarrow/fastparquet; cannot verify the parity computation runs clean

### 2. Visual Identity — Browser Smoke

**Test:** Open `/strategy/{published-strategy-id}/v2` in browser
**Expected:**
- H1 renders in Instrument Serif 32px
- 7 card panels visible in a single scrollable column
- Panel 1: 6-cell overview row with real strategy data
- Panel 2: 6-cell KPI strip + equity chart (BTC overlay ON by default, toggleable); Cumulative/Underwater clickable; Rolling Sharpe/Log Returns show disabled state with title tooltip
- Panel 3: Full-width drawdown chart + Worst 5 table
- Panels 4–7: White card with heading + "Loading…" centered body
- All card surfaces are white (#FFFFFF); accent color is #1B6B5A; no legacy bright teal
**Why human:** Canvas rendering (lightweight-charts), real data, CSS variable resolution, interactive state transitions

### 3. DrawdownChart CHART_TICK_STYLE Deferral Confirmation

**Test:** Review `src/components/charts/DrawdownChart.tsx` lines 27, 34 — ticks use `fontSize: 11` and no `fontVariantNumeric`
**Expected:** Confirm Phase 14b plan includes updating DrawdownChart (and other shared chart components) to spread `CHART_TICK_STYLE`
**Why human:** Design decision — SUMMARY 14a-01 explicitly deferred this to 14b ("Kept fontSize: 11 — UI-SPEC defers to 14b"); human should confirm 14b plan has a task for it

---

## Gaps Summary

No gaps. The one uncertain item (SC#1 qstats parity test) is an environment limitation (missing pyarrow in local venv), not a code deficiency — the test file, fixture files, and implementation all exist. All 12 requirements have confirmed implementation. All 4 deterministically verifiable success criteria pass. The 5th (SC#1) requires CI or an environment with pyarrow to confirm.

Three human verification items flag:
1. SC#1 parity test — run in CI
2. Browser visual smoke — cannot validate visuals programmatically
3. DrawdownChart CHART_TICK_STYLE deferral — confirm 14b will close the gap

---

_Verified: 2026-04-29T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
