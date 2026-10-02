---
phase: 30-factsheet-graphs-on-the-blend
verified: 2026-06-23T15:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
human_verification_resolved: "2026-06-23 — all headed-browser items confirmed live via /qa (Playwright, real prod data, qa-demo, 2-strategy AV-IC2+AV-SV1 blend = 1062 overlapping days, 0 console errors). GRAPH-02: Returns-distribution Card renders histogram (counts 0–600) + quantiles box ('All') + disclosure '1062 overlapping daily returns · not a forecast'. GRAPH-03: Rolling-metrics Card renders Sharpe/vol/Sortino (accent strokes) + 3M/6M/12M control; WR-01 fix CONFIRMED LIVE — legend reads '126d' at 6M and updates to '63d' on 3M (never stale '365d'), disclosure tracks the window. GRAPH-01: equity (degenerate 'warming up' at $0 AUM) + drawdown render. GRAPH-04: per-panel method/overlap-N/horizon disclosures present; no peer/percentile/signature panel anywhere; PROJECTED pill present."
human_verification:
  - test: "Returns-distribution Card renders correctly in a headed browser at the ScenarioComposer projection section"
    expected: "Histogram bars and quantile box visible; sub-headings 'Return histogram' and 'Return quantiles' present; disclosure line 'Distribution of N overlapping daily returns · historical realized · not a forecast.' visible below the charts"
    why_human: "ReturnHistogram and ReturnQuantiles are Recharts components mocked in jsdom tests; actual SVG rendering and visual identity require a headed browser"
  - test: "Rolling-metrics Card renders correctly with the 3M/6M/12M segmented control"
    expected: "Default '6M' is active; three sub-panels visible (Rolling Sharpe accent line, Rolling volatility, Rolling Sortino); the Sharpe panel legend/tooltip shows the selected window label (e.g. '126d') not '365d'; disclosure '{W}-day rolling window · 252-day annualized · N overlapping days · not a forecast.' visible below"
    why_human: "Recharts Legend and Tooltip rendered text and the WR-01 seriesLabels override are visible only in a headed browser (jsdom Recharts mock renders no label text)"
  - test: "Switching window to 3M updates the Rolling Sharpe line label and disclosure to '63-day rolling window'"
    expected: "Clicking '3M' in the SegmentedControl changes the disclosure to '63-day rolling window · …' and the chart legend/tooltip to '63d'"
    why_human: "Interactive window toggle and resulting label update require a headed browser with real Recharts rendering"
  - test: "Equity and drawdown charts present the factsheet chart-stack visual identity (GRAPH-01)"
    expected: "Drawdown chart axes use the mono 12px tabular tick style (CHART_TICK_STYLE), axis lines use the border token (#E2E8F0), tooltip border matches the factsheet style, and the drawdown fill is the factsheet negative token (#DC2626); visually consistent with EquityChart which already uses the same identity"
    why_human: "CSS token → rendered pixel color correspondence requires a headed browser; jsdom does not apply CSS variables"
---

# Phase 30: Factsheet Graphs on the Blend — Verification Report

**Phase Goal:** An allocator sees factsheet-grade graphs on the BLENDED portfolio — equity/drawdown in the factsheet visual identity plus a returns-distribution view and rolling Sharpe/volatility/Sortino — each declaring its method, overlap-N, and horizon, with peer/percentile/signature ranking never shown on a hypothetical blend.
**Verified:** 2026-06-23T15:00:00Z
**Status:** passed (human gates verified via headed-browser /qa 2026-06-23)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Adapter derives a CUMULATIVE-wealth histogram series from raw daily returns (cumprod of 1+r), never raw daily values | VERIFIED | `scenario-blend-panels.ts:154-158`: `c *= 1 + p.value; return { date, value: c }`. Unit test "histogram cumulative" round-trips through `ReturnHistogram`'s internal `v/cumulative[i]-1` and recovers original returns to 8 decimal places. |
| 2  | Adapter rolling vol/Sharpe are numerically identical to `portfolio-stats.ts::computeRollingMetric` (sample-std n-1 × √252) | VERIFIED | `rollingVolatility` and `rollingSharpeSeries` mirror `computeRollingMetric` loop exactly: `stdDev(slice, true)` (Bessel n-1), `× Math.sqrt(252)`. Parity test passes with `toBeCloseTo(_, 8)`. |
| 3  | Adapter rolling Sortino divides downside RMS by the TOTAL window n × √252 | VERIFIED | `scenario-blend-panels.ts:106`: `Math.sqrt(downSq / window) * ANNUALIZE` — `window` is the total-n, not down-day count. Unit test asserts by-hand value. |
| 4  | Degenerate windows (length < window, <10 usable points, any non-finite value) return [] / {} for every series | VERIFIED | Guard at lines 142-148: `hasNonFinite || portfolioDaily.length < MIN_USABLE || portfolioDaily.length < window → return { ...EMPTY, usableN }`. Positive + negative control tests both pass. |
| 5  | No √365 / *365 / √250 anywhere in the adapter — 252-day annualization only | VERIFIED | `TRADING_DAYS_PER_YEAR = 252`, `ANNUALIZE = Math.sqrt(252)`. Non-comment grep for `/365\|250/` yields only `sharpe_365d` string key and comment lines — no math factor. Source-read test in unit suite asserts no `365`/`250` math literal passes. |
| 6  | Returns-distribution Card (GRAPH-02) renders histogram + quantiles of the blend | VERIFIED | `ScenarioComposer.tsx:2118-2156`: `<Card data-panel="blend-returns-distribution">` mounts `<ReturnHistogram returns={blendPanels.histogramSeries} bins={20} />` + `<ReturnQuantiles data={blendPanels.quantiles} />`. `data-panel` selector present and non-null in ScenarioComposer test R3 guard. |
| 7  | Rolling-metrics Card (GRAPH-03) renders Sharpe + vol + Sortino with 3M/6M/12M toggle | VERIFIED | `ScenarioComposer.tsx:2168-2224`: `<Card data-panel="blend-rolling">` mounts `SegmentedControl` (63/126/252, default 126) + `RollingMetrics` + `RollingVolatilityChart` + `RollingSortinoChart`. Test "blend panel disclosure" confirms above-floor render. |
| 8  | Each panel renders its own method/overlap-N/horizon disclosure and a role=status PartialDataBanner (never role=alert) below floor | VERIFIED | Distribution disclosure at `:2150-2153`; rolling disclosure at `:2218-2221`. Empty branch uses `<PartialDataBanner>` (role="status" per component contract) not role="alert". Test "blend panel empty branch" asserts `role="status"` present and `role="alert"` absent at a sub-10-point input. |
| 9  | WR-01 fix: Rolling Sharpe legend/tooltip label reflects the selected window, not hardcoded "365d" | VERIFIED | `RollingMetrics.tsx` now accepts `seriesLabels` optional prop; ScenarioComposer passes `seriesLabels={{ sharpe_365d: \`${rollingWindow}d\` }}` at `:2203`. `RollingMetrics.test.tsx` "seriesLabels override (WR-01)" describe block has two passing tests asserting the label resolves to the override not the default. |
| 10 | WR-02 fix: Distribution panel gates on the adapter's degenerate verdict (histogramSeries.length === 0), not a re-derived length<10 | VERIFIED | `ScenarioComposer.tsx:2124`: `{blendPanels.histogramSeries.length === 0 ? <PartialDataBanner …>}`. Test "WR-02 — distribution panel gates on the adapter's degenerate verdict" passes, injecting a non-finite point into a ≥10 series and asserting the banner renders. |
| 11 | Honesty invariant: no FactsheetBody/MetricsColumn/buildAllocatorPortfolioFactsheetPayload/PercentileRankBadge import; no ingestSource:"api" | VERIFIED | `grep -n "FactsheetBody\|MetricsColumn\|buildAllocatorPortfolioFactsheetPayload\|PercentileRankBadge\|ingestSource.*api" ScenarioComposer.tsx` returns empty. Static import-guard test in ScenarioComposer.test.tsx passes reading the source via `node:fs`. |
| 12 | Frozen engine: zero diff to `src/lib/scenario.ts` and `src/lib/scenario.test.ts` vs baseline `03d0699c` | VERIFIED | `git diff 03d0699c..HEAD -- src/lib/scenario.ts src/lib/scenario.test.ts` returns empty. Phase-30 frozen-spine guard (3 tests) passes. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/scenario-blend-panels.ts` | Pure-TS adapter exporting `buildBlendPanels` | VERIFIED | 182 lines, exports `buildBlendPanels` + `BlendPanelSeries`; imports `mean`/`stdDev` from `@/lib/portfolio-math-utils` only; no DOM/fetch/Date.now |
| `src/lib/scenario-blend-panels.test.ts` | 7 convention-pin tests (parity, sortino÷n, sharpe, 252-only, histogram-cumulative, quantiles-monotonic, degenerate-[]) | VERIFIED | 7 tests, all passing |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Two new `<Card>` siblings after CorrelationHeatmap, fed by `buildBlendPanels` | VERIFIED | `buildBlendPanels` imported at `:70`, called at `:1322`; Cards at `:2118` and `:2168`; `data-panel` attributes present |
| `src/__tests__/phase-30-frozen-spine-guards.test.ts` | Frozen-engine zero-diff guard (scenario.ts + scenario.test.ts) | VERIFIED | 171 lines, 3 tests passing; FALLBACK_BASE_SHA="03d0699c"; fails loud on unresolvable baseline |
| `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` | Recharts chart reskinned to chart-tokens (no inline hexes) | VERIFIED | Imports `CHART_TICK_STYLE`, `CHART_BORDER`, `CHART_TOOLTIP_STYLE`, `CHART_NEGATIVE`; no `#DC2626`/`#64748B`/`#E2E8F0` in Recharts axis/tooltip calls |
| `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.test.tsx` | Chart-stack token assertion tests | VERIFIED | 2 tests passing: drawdown reads chart-tokens (no inline hexes on Recharts axes), equity chart CSS-var accent verified |
| `src/components/charts/RollingMetrics.tsx` | `seriesLabels` optional prop added (WR-01 fix) | VERIFIED | `seriesLabels?: Record<string, string>` at `:64`; `labelFor()` resolver at `:88-89`; Tooltip + Legend formatters use `labelFor()` |
| `src/components/charts/RollingMetrics.test.tsx` | `seriesLabels` override tested | VERIFIED | describe "seriesLabels override (WR-01)" with 2 tests asserting legend and tooltip text reflect the override |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ScenarioComposer.tsx` | `scenario-blend-panels.ts` | `buildBlendPanels(portfolioDaily, rollingWindow)` | WIRED | Import at `:70`, call at `:1322`, result used at `:2124`/`:2142`/`:2148`/`:2184`/`:2195`/`:2210`/`:2216` |
| `ScenarioComposer.tsx` | `ReturnHistogram, ReturnQuantiles, RollingMetrics, RollingVolatilityChart, RollingSortinoChart` | leaf-chart imports from `@/components/charts/*` | WIRED | Imports at `:72-76`; all five used in Cards |
| `scenario-blend-panels.ts` | `portfolio-math-utils.ts` | `import { mean, stdDev }` | WIRED | `:30`: `import { mean, stdDev } from "@/lib/portfolio-math-utils"` — parity with `computeRollingMetric` is exact |
| `scenario-blend-panels.test.ts` | `portfolio-stats.ts` | numeric-parity assert vs `computeRollingMetric` | WIRED | `computeRollingMetric` imported and used in parity assertions |
| `DrawdownChart.tsx` | `chart-tokens.ts` | `import { CHART_TICK_STYLE, CHART_BORDER, CHART_TOOLTIP_STYLE, CHART_NEGATIVE }` | WIRED | Import at `:18-22`; all four constants used in Recharts props |
| `RollingMetrics.tsx` | `seriesLabels` caller | `labelFor(name)` in Tooltip/Legend formatters | WIRED | `:88-89`, `:158`, `:161`; ScenarioComposer passes the override at `:2203` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioComposer.tsx` blend Cards | `blendPanels` | `buildBlendPanels(portfolioDaily, rollingWindow)` where `portfolioDaily = scenarioMetrics.portfolio_daily_returns ?? []` | Yes — `portfolio_daily_returns` is the frozen engine's unrounded output, same data that drives ScenarioBenchmarkSection/StressVarSection above | FLOWING |
| `buildBlendPanels()` | `histogramSeries` | `cumprod(1+r)` over `portfolioDaily` | Yes — derives from engine data, no static fallback | FLOWING |
| `buildBlendPanels()` | `rollingSharpe/rollingVol/rollingSortino` | rolling window loops over `portfolioDaily` | Yes — sample-std arithmetic over engine data, degenerates to `[]` on real-floor conditions not static empty | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 7 adapter convention-pin tests pass | `npx vitest run src/lib/scenario-blend-panels.test.ts` | 7 passed, 0 failed | PASS |
| ScenarioComposer test suite (76 tests) including R3 guard, WR-02, empty branch, disclosure | `npx vitest run ScenarioComposer.test.tsx` | 76 passed, 0 failed | PASS |
| DrawdownChart token tests | `npx vitest run DrawdownChart.test.tsx` | 2 passed, 0 failed | PASS |
| RollingMetrics seriesLabels override (WR-01) | `npx vitest run RollingMetrics.test.tsx` | 18 passed, 0 failed | PASS |
| Frozen-spine guard (scenario.ts + scenario.test.ts zero diff) | `npx vitest run phase-30-frozen-spine-guards.test.ts` | 3 passed, 0 failed | PASS |
| git diff 03d0699c engine files | `git diff 03d0699c..HEAD -- src/lib/scenario.ts src/lib/scenario.test.ts` | empty | PASS |
| No forbidden imports in ScenarioComposer | `grep FactsheetBody\|MetricsColumn\|... ScenarioComposer.tsx` | no output | PASS |
| No inline hexes on Recharts axes in DrawdownChart | non-comment grep for `#DC2626\|#64748B\|#E2E8F0` on Recharts tick/axisLine/contentStyle | only button chrome at `:192` (out-of-scope; test scoped to `tick={{ … }}` shape) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| GRAPH-01 | 30-03 | Equity + drawdown in factsheet visual identity (chart-tokens) | SATISFIED | DrawdownChart imports all four chart-tokens constants; Recharts axes/tooltip/fill use tokens; EquityChart pre-existing CSS-var stroke confirmed; DrawdownChart.test.tsx pins both |
| GRAPH-02 | 30-01, 30-02 | Returns-distribution view (histogram + quantiles) on the blended portfolio | SATISFIED | `<Card data-panel="blend-returns-distribution">` mounts `ReturnHistogram` (cumulative-wealth feed) + `ReturnQuantiles`; fed by `buildBlendPanels` |
| GRAPH-03 | 30-01, 30-02 | Rolling-metrics (rolling Sharpe / vol / Sortino) on the blended portfolio | SATISFIED | `<Card data-panel="blend-rolling">` mounts all three rolling charts with 3M/6M/12M toggle; `buildBlendPanels` derives each via engine-parity math |
| GRAPH-04 | 30-02 | Every graph states method/overlap-N/horizon; honest empty below floor; no peer/percentile/signature on hypothetical blend | SATISFIED | Per-panel disclosures present; `PartialDataBanner` (role="status") below floor; forbidden-import guard passes; R3/IMPACT-02 guard extended to run non-vacuously with new panels mounted |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `DrawdownChart.tsx` | 192 | `fontSize: 11` in button `style={{}}` | INFO | This is the visibility-toggle radio button's inline style — HTML chrome, not a Recharts chart axis/grid/tooltip. Not in the plan's action swap list (`:155/:213-214/:227/:229/:234/:242`). Deliberately left in scope by the executor per Rule 3; the DrawdownChart test scopes its `fontSize` assertion to `tick={{ … fontSize … }}` shape only, which correctly returns no matches. Not a GRAPH-01 defect. |

No debt markers (`TBD`, `FIXME`, `XXX`) found in phase-30 delta files.

### Human Verification Required

**Status note:** All automated checks pass (12/12 must-haves, 4 test suites green, scope fences clean, frozen engine confirmed). The four items below are headed-browser verifications for visual rendering and interactive behavior that jsdom cannot cover.

#### 1. Returns-distribution Card visual rendering

**Test:** Open the ScenarioComposer on a blend with ≥10 overlapping returns. Scroll to the Returns-distribution Card (below the Correlation heatmap).
**Expected:** "Returns distribution" heading; "Return histogram" sub-heading with histogram bars; "Return quantiles" sub-heading with a 5-number quantile box; disclosure line "Distribution of N overlapping daily returns · historical realized · not a forecast." visible below both charts.
**Why human:** `ReturnHistogram` and `ReturnQuantiles` are Recharts SVG components; jsdom tests mock them to inert divs. Visual fidelity and factsheet chart-stack identity require a headed browser.

#### 2. Rolling-metrics Card — label accuracy (WR-01)

**Test:** Open the Rolling-metrics Card (default window = 6M). Hover the Sharpe line or inspect the legend.
**Expected:** The Rolling Sharpe legend/tooltip label reads "126d" (not "365d"). Switch to "3M" — label changes to "63d"; disclosure changes to "63-day rolling window · …". Switch to "12M" — label changes to "252d".
**Why human:** Recharts Legend and Tooltip rendered text is not accessible via jsdom in the project's test setup (leaf is mocked). The `seriesLabels` wiring is code-verified but the actual rendered text in Recharts requires a headed browser.

#### 3. Below-floor banner display (visual)

**Test:** Open the ScenarioComposer with a blend whose `portfolio_daily_returns` has fewer than 10 points (or shorter than the selected rolling window). Inspect both blend Cards.
**Expected:** Each Card shows its heading followed immediately by the "Awaiting more data" PartialDataBanner (neutral bg, no red/orange color, no role="alert" styling). The chart content area is empty — no headed-but-empty panels.
**Why human:** `PartialDataBanner`'s visual appearance (neutral vs destructive color, token rendering) requires a headed browser.

#### 4. Equity + drawdown factsheet chart-stack visual consistency (GRAPH-01)

**Test:** Open the ScenarioComposer projection section. Observe the Equity and Drawdown charts side by side.
**Expected:** Both charts share the same font style (Geist Mono tabular, 12px), axis line color (#E2E8F0), and tooltip border style. The drawdown fill uses the factsheet negative token (#DC2626). Visually indistinguishable from the standalone factsheet drawdown chart.
**Why human:** CSS token → pixel color correspondence (including CSS variable resolution for the equity chart and chart-token literals for the drawdown chart) requires a headed browser with the full CSS environment.

---

_Verified: 2026-06-23T15:00:00Z_
_Verifier: Claude (gsd-verifier)_
