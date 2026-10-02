---
phase: 38-composer-factsheet-parity-blank-mode-fix
verified: 2026-06-25T13:45:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open the scenario composer on a real allocator with a live book. Pan/zoom the equity chart with the mouse wheel, drag the MasterBrush window, and use keyboard arrow keys. Confirm the drawdown panel moves in sync with the equity panel (shared xRange)."
    expected: "Wheel-zoom, drag-pan, brush drag, and keyboard navigation all work in the composer exactly as on the factsheet page. Zooming equity zooms drawdown simultaneously."
    why_human: "JSDOM has no layout engine, mouse events, or real SVG rendering. The Q1/Q4 shared-window feel (smooth scroll, brush drag, keyboard nav) can only be confirmed with a real Chromium browser on a live authed session."
  - test: "Open the scenario composer in blank-slate mode (no API keys yet / allocator with an empty book). Add a scenario. Confirm the equity projection chart shows the scenario overlay (not 'Equity data warming up'), the PROJECTED pill is visible, and there is no fabricated live-book baseline line drawn."
    expected: "Scenario overlay renders. PROJECTED honesty pill present. 'Equity data warming up' text absent. Only one line drawn (the scenario), not two."
    why_human: "The code path is unit-tested but the blank-slate UI state requires an authed browser session with an allocator that has no connected exchange keys."
---

# Phase 38: Composer Factsheet Parity + Blank-Mode Fix — Verification Report

**Phase Goal:** The composer's equity chart is factsheet-grade (reuses TimeSeriesChart + MasterBrush interactions) at full width, and the blank-slate equity-projection renders the scenario overlay.
**Verified:** 2026-06-25T13:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Composer equity+drawdown render through the REAL factsheet `TimeSeriesChart` + `MasterBrush` under ONE `FactsheetProvider(persist=false)` | ✓ VERIFIED | `ScenarioFactsheetChart.tsx` imports `TimeSeriesChart`, `MasterBrush`, `FactsheetProvider` from `@/app/factsheet/[id]/v2/`; exactly 1 `<FactsheetProvider` JSX mount with `persist={false}`; `<MasterBrush />` + two `<TimeSeriesChart config=…/>` under it |
| 2 | Composer max width relaxed to `max-w-[1440px]` at all 3 in-scope sites; `AllocationDashboardV2.tsx:157` stays `max-w-[1100px]` | ✓ VERIFIED | `grep -c "max-w-[1440px]"` → ScenarioComposer.tsx=2, AllocationsTabs.tsx=1; `grep -c "max-w-[1100px]"` → AllocationDashboardV2.tsx=1 |
| 3 | Blank-slate (empty baseline + scenario present) renders the scenario overlay; `EquityChart` projection guard mirrors `DrawdownChart`'s `&&!hasScenario` | ✓ VERIFIED | EquityChart.tsx:686: `if ((equityDailyPoints.length === 0 \|\| composite.length === 0) && !hasScenario)`; `EquityChart.scenario.test.tsx` 20/20 passed including blank-slate cases; mutation check documented in SUMMARY |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` | `buildScenarioFactsheetPayload` pure adapter + ChartConfig exports | ✓ VERIFIED | 295 lines (>80 min); exports `buildScenarioFactsheetPayload`, `SCENARIO_EQUITY_CONFIG`, `SCENARIO_DRAWDOWN_CONFIG`; uses `deriveSnapshotDrawdowns` (no hand-rolled loop); 0 inline strokes |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts` | LOCKED-convention pure-fn coverage | ✓ VERIFIED | Exists; passes (12 tests in the targeted suite run) |
| `src/app/factsheet/[id]/v2/factsheet-context.tsx` | additive `persist?: boolean` (default true) | ✓ VERIFIED | Line 177: `persist = true`; line 193: `persist?: boolean`; line 311: `|| !persist` guard; default path byte-identical |
| `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx` | persist opt-out regression tests | ✓ VERIFIED | Modified; factsheet suite 43/43 passed |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | composer-side engine-reuse mount | ✓ VERIFIED | 164 lines (>60 min); imports from factsheet v2 dir; 1 `<FactsheetProvider` with `persist={false}`; MasterBrush + 2 TimeSeriesChart; `data-testid="equity-chart-scenario-overlay"` carried; 0 inline strokes |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx` | Q4 shared-window proof | ✓ VERIFIED | Exists; 3 tests passed |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | swapped to ScenarioFactsheetChart; PROJECTED pill intact; 2× `max-w-[1440px]` | ✓ VERIFIED | Line 2204: `<ScenarioFactsheetChart …/>`; no `<EquityChart` or `<DrawdownChart` JSX render calls remain; PROJECTED pill at line 1849 (unconditional); 2× `max-w-[1440px]` |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | 1× `max-w-[1440px]` loading skeleton | ✓ VERIFIED | Line 127: `className="mx-auto max-w-[1440px] py-6"` |
| `src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx` | source-assertion test: 3 in-scope=1440; out-of-scope=1100 | ✓ VERIFIED | 5 tests passed |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` | legacy projection guard mirrors DrawdownChart `&&!hasScenario` | ✓ VERIFIED | Line 686: `if ((equityDailyPoints.length === 0 \|\| composite.length === 0) && !hasScenario)` |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx` | blank-slate render cases + mutation check | ✓ VERIFIED | 20/20 passed; mutation falsifiability documented in SUMMARY |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ScenarioFactsheetChart.tsx` | `FactsheetProvider(persist=false)` + `MasterBrush` + `TimeSeriesChart` | direct imports from `@/app/factsheet/[id]/v2/` | ✓ WIRED | All three factsheet v2 assets imported and used in JSX |
| `ScenarioFactsheetChart.tsx` | `buildScenarioFactsheetPayload` + `SCENARIO_EQUITY_CONFIG` + `SCENARIO_DRAWDOWN_CONFIG` | import from `./scenario-factsheet-payload` | ✓ WIRED | Imported and used in `useMemo` + JSX |
| `ScenarioComposer.tsx` | `ScenarioFactsheetChart` | import + single JSX render at former equity/drawdown sites | ✓ WIRED | Line 106 import; line 2204 JSX render; old `<EquityChart/>` / `<DrawdownChart/>` JSX calls absent |
| `EquityChart.tsx projection guard (~:686)` | `hasScenario` (defined :507) | `&& !hasScenario` boolean term | ✓ WIRED | Guard reads `hasScenario` which is defined from `scenarioSeries`; `hasScenario` added to memo deps |
| `factsheet-context.tsx` write effect | `persist` prop | `\|\| !persist` early-return guard | ✓ WIRED | Line 311: `if (typeof window === "undefined" \|\| !hydrated.current \|\| !persist) return;` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioFactsheetChart.tsx` | `synthPayload` | `buildScenarioFactsheetPayload({ scenario: scenarioWealthSeries, baseline: baselineEquityDailyPoints, benchmark: btcWealth })` called in `useMemo` | Yes — live composer state variables passed through; adapter proven non-degenerate when scenario present | ✓ FLOWING |
| `EquityChart.tsx` projection | `hasScenario` | `!!scenarioSeries && scenarioSeries.length > 0` (line 507) | Yes — read from prop, not hardcoded | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `scenario-factsheet-payload.test.ts` (12 pure-fn cases) | `npx vitest run scenario-factsheet-payload.test.ts` | 12 passed | ✓ PASS |
| `scenario-shared-window.test.tsx` (Q4 proof) | `npx vitest run scenario-shared-window.test.tsx` | 3 passed | ✓ PASS |
| `composer-width.test.tsx` (PARITY-02 source assertion) | `npx vitest run composer-width.test.tsx` | 5 passed | ✓ PASS |
| `EquityChart.scenario.test.tsx` (PARITY-03 blank-slate + legacy guard) | `npx vitest run EquityChart.scenario.test.tsx` | 20 passed | ✓ PASS |
| `EquityChartWidget.header.test.tsx` (scope boundary: Overview untouched) | `npx vitest run EquityChartWidget.header.test.tsx` | 8 passed | ✓ PASS |
| Factsheet regression suite | `npx vitest run src/app/factsheet/` | 43 passed | ✓ PASS |
| `ScenarioComposer.test.tsx` integration | `npx vitest run ScenarioComposer.test.tsx` | 87 passed | ✓ PASS |
| Full targeted phase test bundle (40 tests across 4 files) | `npx vitest run` on 4 phase-38 test files | 40 passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PARITY-01 | Plans 01, 02, 03 | Composer equity chart reuses factsheet TimeSeriesChart + MasterBrush | ✓ SATISFIED | `ScenarioFactsheetChart.tsx` wired; 3 tests green; factsheet v2 imports confirmed |
| PARITY-02 | Plan 04 | Composer max width relaxed to 1440px | ✓ SATISFIED | 3 literal edits confirmed by grep; source-assertion test pins both directions |
| PARITY-03 | Plan 05 | Blank-slate renders scenario overlay; projection guard mirrors DrawdownChart | ✓ SATISFIED | `&&!hasScenario` at EquityChart.tsx:686; 20/20 scenario tests green including blank-slate cases |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `AllocationsTabs.tsx` | 33 | Pre-existing unused import `trackUsageEventClient` | ℹ Info | Pre-existing, out-of-scope per executor scope boundary; logged to deferred-items.md; no new regression |
| `EquityChart.tsx` | (eslint) | Pre-existing `react-hooks/exhaustive-deps` warning on `period` | ℹ Info | Pre-existing, not introduced by this phase; SUMMARY documents it explicitly |

No TBD/FIXME/XXX markers found in phase-modified files. No unresolved debt markers.

### Human Verification Required

#### 1. Factsheet-grade interactions in live browser (PARITY-01 feel)

**Test:** Open the scenario composer on an allocator that has a connected exchange key and a built scenario. Pan the equity chart with the mouse wheel, drag the MasterBrush timeline window, use keyboard arrow keys on the chart, and click 3M/6M/12M/ALL period buttons.
**Expected:** Wheel-zoom, drag-pan, MasterBrush drag, and keyboard navigation work identically to the factsheet page. The equity and drawdown panels move in sync (shared xRange) on every interaction — a pan on one moves the other.
**Why human:** JSDOM has no layout engine, no real SVG rendering, no mouse-event propagation, and no Chromium D3 zoom behavior. The "feel identical to the factsheet" criterion can only be judged in a real browser.

#### 2. Blank-slate scenario overlay in live authed session (PARITY-03 end-to-end)

**Test:** Open the scenario composer for an allocator with no connected exchange keys (blank book). Build a scenario projection. Inspect the chart area.
**Expected:** The scenario overlay line renders (not "Equity data warming up"). The PROJECTED honesty pill is visible above the chart. Only one line (the scenario) is drawn — no fabricated flat live-book baseline. The sync-freshness stamp is absent (the csv-arm payload carries `computedAt:""` by construction).
**Why human:** Blank-slate mode requires an authed session with a specific allocator state. The unit tests cover this path exhaustively (including mutation check), but the end-to-end compositing of the React tree in real Chromium with live authed state needs a human.

### Gaps Summary

No code gaps. All three requirements are verified in the codebase:
- PARITY-01: `ScenarioFactsheetChart` mounts the real factsheet engine (imported verbatim from `@/app/factsheet/[id]/v2/`), under ONE `FactsheetProvider(persist=false)`, with MasterBrush + two TimeSeriesChart sharing one XRangeContext. The composer's call sites are swapped; the Overview EquityChartWidget is untouched (scope boundary held, confirmed by 8-test Overview header suite green).
- PARITY-02: Three in-scope container literals changed from 1100 to 1440px; AllocationDashboardV2 stays at 1100px. Pinned by a source-assertion test.
- PARITY-03: `EquityChart.tsx:686` guard mirrors `DrawdownChart.tsx:147` exactly; 20 scenario tests pass including the blank-slate case with mutation falsifiability confirmed.

The two human items are the documented "feel identical / live browser" checks. The code evidence is complete and all automated tests pass.

---

_Verified: 2026-06-25T13:45:00Z_
_Verifier: Claude (gsd-verifier)_
