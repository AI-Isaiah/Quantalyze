# Phase 40: Mount the Real Factsheet Body — Research

**Researched:** 2026-06-26
**Domain:** React component reuse / mount-seam extension (in-repo, no external deps)
**Confidence:** HIGH

## Summary

Phase 40 is a small, additive, in-repo reuse change with one structurally
load-bearing seam. The entire factsheet body subtree (`FactsheetBody`,
`FactsheetView.tsx:156-287`) is already an exported, mountable component and is
**already mounted in production** inside the allocations dashboard chrome by
`AllocationDashboardV2.tsx:143-150` (the Overview surface), under
`<FactsheetProvider>` with exactly the prop shape Phase 40 needs
(`hideHeader hideAllocatorSection topSlot=…`). That existing mount is the
precedent that retires most of the risk: the body already renders inside the
`<main aria-label="Dashboard content">` page chrome without a duplicate-`<main>`
violation, because its root is `<article id="factsheet-main">`, not `<main>`.

The Phase-40 change replaces the Phase-38 two-chart render inside
`ScenarioFactsheetChart.tsx:167-193` (MasterBrush + `SCENARIO_EQUITY_CONFIG` +
`SCENARIO_DRAWDOWN_CONFIG`) with `<FactsheetBody scenarioMode hideHeader
hideAllocatorSection hideFooter={false} topSlot={<PeriodControl/>}>`, inside the
**same** `<FactsheetProvider payload={synthPayload} persist={false}>` that
already exists in that file. `scenarioMode?: boolean` is added to
`FactsheetBodyOptions` (default `false`), threaded only into `ControlBar` (to
suppress the Share-link + Compare-strategies actions) and into `MetricsColumn`
(an inert seam for Phase 42). The Phase-39 adapter already produces a complete,
single-axis, safe-on-degenerate `FactsheetCsvPayload`, so every panel has real
or honestly-empty data by construction.

**Primary recommendation:** Do the mount entirely inside
`ScenarioFactsheetChart.tsx` (never `ScenarioComposer.tsx` — a static guard
forbids the literal `FactsheetBody` there). Add `scenarioMode?: boolean`
default-`false` to `FactsheetBodyOptions`, `ControlBar`, and `MetricsColumn`.
Verify the BODY-03 degenerate matrix with a **net-new jsdom render test** that
mounts the real `FactsheetBody` under a real `FactsheetProvider` with the
adapter's safe-empty + single-strategy + sub-N + non-finite payloads — this is
the only render-level coverage of the real body that does not exist yet.

## User Constraints (from 40-CONTEXT.md)

### Locked Decisions

**Body composition (what the composer mounts)**
- **REPLACE** the Phase-38 two-chart render with the real `<FactsheetBody>` (it
  already includes MasterBrush + equity + drawdown via `PerformanceCharts` using
  the real `chart-configs.ts` configs). The scenario-specific configs
  (`SCENARIO_EQUITY_CONFIG`/`SCENARIO_DRAWDOWN_CONFIG`) become unnecessary once
  the full body renders through the real configs.
- `hideHeader={true}` — the composer owns the title.
- **`hideFooter={false}` — SHOW the footer** (disclaimer + page stamp). USER
  OVERRIDE of the initial hide recommendation.
- `hideAllocatorSection={true}` — defensive; api-gated anyway (never renders for
  the csv blend), pass the flag for intent + belt-and-suspenders.

**scenarioMode additive prop**
- Default `false` (BODY-02 locked); the composer passes `scenarioMode={true}`.
- In Phase 40 it gates: suppress the ControlBar Share-link + Compare-strategies
  actions; keep Display / Reset view / ComparatorPicker. It also threads to
  `MetricsColumn` as the seam for Phase-42's peer carve-out (no new visible panel
  in Phase 40).
- Thread surface: `FactsheetBody → ControlBar` (+ `MetricsColumn` seam) ONLY.
  Do not thread into KpiStrip/Header this phase.
- The "PROJECTED — hypothetical" framing stays in the **composer chrome**
  (v1.1.0 IMPACT-01), NOT inside the body.

**Degenerate states, period control & byte-identity**
- **Preserve the composer's Phase-38 PeriodControl** (3M/6M/12M/ALL) above the
  body (or via the body's `topSlot`); it coexists with the body's MasterBrush +
  ControlBar (all drive the one shared `XRangeContext`).
- **Preserve the Phase-38 blank-slate handling** for the no-blend/empty case; the
  body renders Phase-39's safe-empty payload without crashing.
- BODY-03 test matrix: healthy / single-strategy / sub-N-overlap / non-finite
  blends EACH render every panel — including lazy heatmaps + (absent-for-csv)
  signature panels — without throwing.
- Byte-identity (BODY-02): a test asserts `FactsheetBody` default props ≡
  `scenarioMode={false}`; `page.tsx` / the v2 route / the Overview
  `EquityChartWidget` are untouched. The PERMANENT byte-identity gate is Phase 43
  (GUARD-02).

### Claude's Discretion

- Where `PeriodControl` renders (`topSlot` vs above-body). **Recommendation
  below: `topSlot`** — see Must-Answer #1.
- The exact shape of the BODY-03 render test and byte-identity test.

### Deferred Ideas (OUT OF SCOPE)

- The actual peer-percentile panel + `scenarioPeer` carve-out → Phase 42.
- Constituent-correlation diversification panel → Phase 41.
- The permanent byte-identity regression GATE + WCAG-AA axe + toggle fold →
  Phase 43 (GUARD-01..04).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BODY-01 | Scenario tab renders the REAL `FactsheetBody` under `<FactsheetProvider persist={false}>`, fed the complete synthesized payload. | `FactsheetBody` is an exported mountable subtree (`FactsheetView.tsx:156`); the provider + persist=false already exist at `ScenarioFactsheetChart.tsx:170`; the complete payload is produced by `buildScenarioFactsheetPayload` (Phase 39, verified complete). The mount edit is shown in Must-Answer #1. |
| BODY-02 | Additive `scenarioMode?: boolean` (default `false`); the real route, Discovery detail, Overview `EquityChartWidget` stay BYTE-IDENTICAL. | All current call sites pass no `scenarioMode` → default `false` → no behavior change. The four threading edits are additive (Must-Answer #2, #4). |
| BODY-03 | Every panel renders without crashing across healthy / single-strategy / sub-N / non-finite blends, incl. `next/dynamic` lazy panels. | Per-panel degenerate audit (Must-Answer #3): every panel either early-returns on empty arrays or formats non-finite via `—`. Net-new render test required. |
| BODY-04 | api-only synthetic panels stay ABSENT by construction (`ingestSource` stays `"csv"`). | Adapter hardcodes `ingestSource:"csv"` (`scenario-factsheet-payload.ts:436`); the `FactsheetCsvPayload` type physically lacks `peerPercentile`/`allocatorPortfolios`; all four panels gate on `=== "api"` (Must-Answer #3, BODY-04 table). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Render factsheet body subtree | Browser / Client (`"use client"`) | — | Entire factsheet v2 family is client-only (`FactsheetView.tsx:1`); SSR is a no-op via context. No server tier touched. |
| Payload synthesis (blend → FactsheetCsvPayload) | Browser / Client (pure TS) | — | `buildScenarioFactsheetPayload` is pure, zero-dep, no fetch/DOM/time (`scenario-factsheet-payload.ts`). Phase 39 already shipped it. |
| Shared zoom/pan window | Browser / Client (React context) | — | `XRangeContext` in `FactsheetProvider`; one provider = one window. |
| `scenarioMode` behavior gate | Browser / Client (prop threading) | — | A pure presentational prop; no data tier. |
| Benchmark fetch (BTC) | already done upstream | — | Composer already fetches `btcDaily`/`btcWealth`; Phase 40 does not touch it. |

**No server, DB, or API-tier work in Phase 40.** This is a pure
client-component reuse change.

## Must-Answer #1 — The mount edit, concretely

### Current state (Phase 38) — `ScenarioFactsheetChart.tsx:167-193`

```tsx
<FactsheetProvider payload={synthPayload} persist={false}>
  <div className="mb-1 flex items-center justify-end">
    <PeriodControl axisLength={axisLength} />
  </div>
  <MasterBrush />
  <div data-testid="equity-chart-scenario-overlay" className="mt-4">
    <TimeSeriesChart config={SCENARIO_EQUITY_CONFIG} />
  </div>
  <div className="mt-4">
    <TimeSeriesChart config={SCENARIO_DRAWDOWN_CONFIG} />
  </div>
</FactsheetProvider>
```

### Phase-40 target

```tsx
<FactsheetProvider payload={synthPayload} persist={false}>
  <FactsheetBody
    payload={synthPayload}
    scenarioMode
    hideHeader
    hideAllocatorSection
    hideFooter={false}
    topSlot={
      <div
        data-testid="equity-chart-scenario-overlay"
        className="mb-1 flex items-center justify-end"
      >
        <PeriodControl axisLength={axisLength} />
      </div>
    }
  />
</FactsheetProvider>
```

Notes on this transformation:
- `FactsheetBody` is imported from `@/app/factsheet/[id]/v2/FactsheetView`
  (the same module `AllocationDashboardV2.tsx:13` imports it from).
- `SCENARIO_EQUITY_CONFIG` / `SCENARIO_DRAWDOWN_CONFIG` / the inline
  `<MasterBrush/>` / `<TimeSeriesChart/>` imports become **dead** in this file.
  CONTEXT says the scenario configs "become unnecessary once the full body
  renders." Decision for planner: the body renders equity via the real
  `chart-configs.ts` `cumulative` config and drawdown via `underwaterAcc`, so the
  two `SCENARIO_*_CONFIG` exports are no longer mounted. **However**
  `scenario-factsheet-payload.test.ts:160-176` asserts on those two exported
  constants. Keep the exports (and their tests) OR migrate those two tests; do
  not silently delete an exported+tested constant (Rule 6/12). Recommend: keep
  the exports defined for now (they are cheap config objects), mark dead at the
  mount; remove in a later cleanup — the simplest surgical change.
- The `data-testid="equity-chart-scenario-overlay"` hook is currently on the
  equity chart wrapper and is asserted by `scenario-shared-window.test.tsx:99-102`
  and `EquityChart.scenario.test.tsx`. **Relocate it onto the `topSlot` wrapper
  (or another stable element) and re-point those tests** — the equity chart is no
  longer a distinct wrapper. This is a known test-update, not a regression
  (see Must-Answer #6).

### PeriodControl: topSlot vs above-body

**Recommendation: `topSlot`.** Rationale:
- `FactsheetBody` renders `topSlot` at `FactsheetView.tsx:188`, immediately after
  the (suppressed) header and **before** `KpiStrip`/`SectionNav`/`ControlBar`/
  `MasterBrush`. That is exactly where the Phase-38 PeriodControl sat (above the
  charts). Putting it in `topSlot` keeps it inside the `<article>` and inside the
  provider so `PeriodControl`'s `useXRange()` call resolves (it MUST be a provider
  descendant — `ScenarioFactsheetChart.tsx:96`).
- Putting it *above* the body (a sibling of `<FactsheetBody>` but still inside
  `<FactsheetProvider>`) also works mechanically, but the UI-SPEC §Mount Layout
  Contract explicitly specifies `topSlot` (40-UI-SPEC.md:138-147), so `topSlot`
  is the conformant choice.

### Does FactsheetBody already render its own period/range control? (reconcile)

`FactsheetBody` renders **two** native window controls, neither of which is a
3M/6M/12M/ALL period control:
1. `MasterBrush` (`FactsheetView.tsx:195`) — the draggable equity-sparkline
   window. Drives `setXRange` directly.
2. `ControlBar`'s "Reset view" button (`FactsheetView.tsx:844-851`) — calls
   `resetXRange()` (full range).

There is **no** 3M/6M/12M/ALL `SegmentedControl` inside `FactsheetBody`. The
composer's `PeriodControl` is therefore **complementary, not redundant** — it
adds fixed-period jumps that the factsheet body does not natively offer. All
three controls (`PeriodControl`, `MasterBrush`, `ControlBar` reset) drive the
**one** shared `XRangeContext` (`FactsheetProvider`'s single `xRange` state,
`factsheet-context.tsx:202`), so they stay in sync by construction. CONTEXT
locks "keep PeriodControl"; this is consistent — no conflict. `[VERIFIED:
codebase grep — no SegmentedControl/3M/6M in FactsheetView.tsx or ControlBar]`

## Must-Answer #2 — scenarioMode threading mechanics

### Step 1 — add to `FactsheetBodyOptions` (`FactsheetView.tsx:135-146`)

```ts
export interface FactsheetBodyOptions {
  hideHeader?: boolean;
  hideAllocatorSection?: boolean;
  hideFooter?: boolean;
  topSlot?: ReactNode;
  /** Composer-mount flag (default false). Suppresses ControlBar Share/Compare
   *  actions and threads to MetricsColumn as the Phase-42 peer-carve-out seam.
   *  Default false keeps every existing call site byte-identical. */
  scenarioMode?: boolean;
}
```

Destructure with default in `FactsheetBody` (`FactsheetView.tsx:156-162`):
`scenarioMode = false`.

### Step 2 — ControlBar: does it take props or read context?

**`ControlBar` currently takes NO props and reads only context**
(`FactsheetView.tsx:825-866`): `usePayload()`, `useXRange()`, `useComparator()`,
and the local `useShareMode()`. The precise additive change is to **add a
`scenarioMode?: boolean` prop** and conditionally omit two children:

- The Share-link button is rendered unconditionally at `FactsheetView.tsx:852`
  via `<ShareLinkButton strategyId={payload.strategyId} />`.
- The "Compare strategies" `<a>` is rendered at `FactsheetView.tsx:853-862`,
  already gated on `!shareMode`.

Additive change:
```tsx
function ControlBar({ scenarioMode = false }: { scenarioMode?: boolean }) {
  // …existing body…
  return (
    <section className="…">
      <DisplayMenu />
      <button …>Reset view</button>
      {!scenarioMode && <ShareLinkButton strategyId={payload.strategyId} />}
      {!scenarioMode && !shareMode && (
        <a href={`/compare?ids=${payload.strategyId}`} …>Compare strategies</a>
      )}
      <ComparatorPicker />
    </section>
  );
}
```
And in `FactsheetBody`: `<ControlBar />` → `<ControlBar scenarioMode={scenarioMode} />`
(`FactsheetView.tsx:191`).

Default `false` ⇒ both items render exactly as today ⇒ byte-identical for the
real route. The UI-SPEC (40-UI-SPEC.md:179-185) confirms only these two items
are suppressed; Display / Reset view / ComparatorPicker stay. Absence (not
`aria-hidden`, not `disabled`) is the correct a11y treatment for a
non-applicable action (40-UI-SPEC.md:305-307). `[VERIFIED: codebase —
ControlBar signature + child elements at FactsheetView.tsx:825-866]`

### Step 3 — MetricsColumn seam

`MetricsColumn` currently takes NO props (`MetricsColumn.tsx:19`). Add
`scenarioMode?: boolean` now even though it gates nothing in Phase 40 (it is the
Phase-42 carve-out seam, per CONTEXT + PEER-01):

```tsx
export function MetricsColumn({ scenarioMode = false }: { scenarioMode?: boolean }) {
  // Phase 40: prop accepted, no conditional render on it yet (Phase 42 seam).
  // …existing body unchanged…
}
```
In `FactsheetBody`: `<MetricsColumn />` → `<MetricsColumn scenarioMode={scenarioMode} />`
(`FactsheetView.tsx:269`).

**Lint caution:** an unused destructured prop will trip
`@typescript-eslint/no-unused-vars`. Either (a) reference it in a
`void scenarioMode;` no-op with an eslint-disable + a comment naming Phase 42, or
(b) prefix-ignore. Preferred: a short comment + `void scenarioMode;` so the seam
is self-documenting and grep-able. The planner must call this out — a naive
"accept but ignore" will fail the lint gate.

Default `false` on all three keeps every existing call site
(`page.tsx:384`, `discovery/[slug]/[strategyId]/page.tsx:128`,
`AllocationDashboardV2.tsx:143`) byte-identical. `[VERIFIED: codebase — three
call sites pass no scenarioMode]`

## Must-Answer #3 — BODY-03 degenerate-render AUDIT (per panel)

**Audit basis:** the Phase-39 SAFE-EMPTY payload sets every array to `[]`,
every scalar to `0` (or `null` for the nullable extended metrics), `n=0`,
`start/end=""`, `years=0`, `dates=[]`, `comparators.*` all-null with
`activeComparator="none"` (`scenario-factsheet-payload.ts:147-258, 310-330`).
Per-panel verdicts (file:line cited):

| Panel / element | Empty-payload verdict | Guard (file:line) |
|---|---|---|
| **KpiStrip** | SAFE — renders 7 cells, every value `pct/num`-formatted to `"—"` for non-finite; `0` formats to `"0.0%"`/`"0.00"` (finite). `m.n=0 < 252` → low-N caveat "⚠ Only 0 observations" renders (cosmetically odd but not a crash). | `signTone`/`maxDdTone` finite-guard `FactsheetView.tsx:593-596`; `pct`/`num`/`pctSigned` `—` on non-finite (`format.ts`). |
| **MasterBrush** | SAFE — `eq.length < 2` ⇒ `path=""` (`MasterBrush.tsx:54`); `n<2` guards in `idxToX`/`xToIdx` (`:79,:85`); `startDate/endDate` fall to `"—"` (`:186-187`); `yearTicks([])→[]` (`:328`). No throw. | `MasterBrush.tsx:54,79,85,186,328` |
| **SectionNav** | SAFE — builds the section list; `ingestSource="csv"` drops Signatures + Allocator anchors (`FactsheetView.tsx:700,704`); IntersectionObserver early-returns when no elements (`:719`). No data reads that can throw. | `FactsheetView.tsx:700,704,719` |
| **ControlBar** | SAFE — pure presentational + context setters; reads `payload.strategyId` (a string) only. | `FactsheetView.tsx:825-866` |
| **PerformanceCharts** (each `TimeSeriesChart`) | SAFE — empty payload ⇒ `rollingWindow.enough=false`+`rollingBetaWindow.enough=false` (`notEnoughWindow()`), so all rolling configs are FILTERED OUT (`FactsheetView.tsx:336-337`) and the `NotEnoughDataPanel` copy renders (`:356-361`). The remaining configs (`cumulative`, `underwaterAcc`) feed `TimeSeriesChart` with empty `strategyEquity`/`strategyDrawdowns`. `TimeSeriesChart` uses `resolveSeries` + array scans that `continue` on empty — renders an empty axis, no throw. | `FactsheetView.tsx:336-337,356`; degenerate gate sets `enough:false` at `scenario-factsheet-payload.ts:319`. |
| **HistogramChart** | SAFE — `xRange=[0,0]` over empty `strategyReturns`; the bin loop produces empty counts, `stratP99` falls to `0.005` fallback (`HistogramChart.tsx:59-62`), `maxCount=0`→`barH=0` (`:122`), no bars. No throw. | `HistogramChart.tsx:59-62,117,122` |
| **QuantileBoxPlotPanel** | SAFE — empty quantiles all `0`; `span=max(|p95-p05|,0.005)` floors the divisor (`DistributionPanels.tsx:197`); `(hi-lo)||1` guard (`:205`). Draws a degenerate-but-valid box. No throw. | `DistributionPanels.tsx:197,205` |
| **EndOfYearBarsPanel** | SAFE — `yearly={}` ⇒ `rows.length===0` ⇒ **early return null** (`DistributionPanels.tsx:64`). | `DistributionPanels.tsx:64` |
| **MonthlyReturnsHeatmap** (lazy) | SAFE — `monthlyReturns=[]` ⇒ `rows.length===0` ⇒ **early return null** (`HeatmapPanels.tsx:41`). | `HeatmapPanels.tsx:41` |
| **DailyReturnsHeatmap** (lazy) | SAFE — `dailyHeatmap=[]` ⇒ `years.length===0` ⇒ **early return null** (`HeatmapPanels.tsx:160`). | `HeatmapPanels.tsx:160` |
| **StressWindowsPanel** | SAFE — `windows=[]` AND `totalCatalogued=0` ⇒ **early return null** (`StressWindowsPanel.tsx:16-17`). | `StressWindowsPanel.tsx:16-17` |
| **StreakDistributionPanel** | SAFE — `emptyStreaks()`: `winsByLength=[]`, `totalWins=0`, `maxLen=0`. Header renders `0 winning streaks …`. `StreakHist` with `data=[]` and `maxLen=0`: `barW = plotW/0 = Infinity`, but `data.map` over `[]` emits no bars and the x-tick `Array.from({length:0})` is empty — **Infinity is computed but never consumed** (no NaN reaches an attribute). No throw, no NaN in DOM. | `emptyStreaks()` `scenario-factsheet-payload.ts:221-231`; `StreakHist` map over `[]` `AnalyticalPanels.tsx:85,104`. **LOW-RISK FLAG**: `barW=Infinity` is latent; if a future edit renders a baseline rect using `barW` unconditionally it would emit `width="Infinity"`. Recommend the BODY-03 test assert no `Infinity`/`NaN` substring in the streak panel's serialized SVG. |
| **MetricsColumn** sub-tables | SAFE — see breakdown below. | — |
| ↳ Compound/Main/Returns/Max-DD panels | SAFE — all values via `pct`/`num`/`signed`/`pctNeg`, each `—` on non-finite (`MetricsColumn.tsx:257-277`); `0` formats finite. `isoToMonthDay("")→"—"` (`:251`). | `MetricsColumn.tsx:251,257-277` |
| ↳ RollingMetricsPanel | SAFE — `rollingStats([])` returns all-null, formatted `—` (`MetricsColumn.tsx:322,423`). | `MetricsColumn.tsx:403-425` |
| ↳ CumulativeReturnsPanel | SAFE — `eq=[]`, `n=0`, `last=1`, `periodReturn` returns null when `n<2` (`MetricsColumn.tsx:348`). | `MetricsColumn.tsx:347-352` |
| ↳ ExtendedMetricsPanel | SAFE — `q` all-zero finite; `m.kurt/recovery_factor` may be `0`/`null`, `num`/`pct` handle both. | `MetricsColumn.tsx:376-401` |
| ↳ WorstDrawdownsTablePanel | SAFE — `strategyWorst10=[]` ⇒ `rows.length===0` ⇒ **early return null** (`MetricsColumn.tsx:441`). | `MetricsColumn.tsx:441` |
| ↳ EoyReturnsPanel | SAFE — `yearly={}`, no comparator ⇒ `years.length===0` ⇒ **early return null** (`MetricsColumn.tsx:524`). | `MetricsColumn.tsx:524` |
| ↳ CalmarByYearPanel | SAFE — `calmarByYear=[]` ⇒ `rows.length===0` ⇒ **early return null** (`AnalyticalPanels.tsx:159`). | `AnalyticalPanels.tsx:159` |
| ↳ BootstrapCIPanel | SAFE — `emptyBootstrapCI()`: zeroed point/lo/hi + `hist.bins=[]`. `BootHist` `degenerate = bins.length===0 || hi===lo` ⇒ renders the "no variance / all resamples produced …" branch (`AnalyticalPanels.tsx:279,285-297`). No throw. | `AnalyticalPanels.tsx:279,285` |
| ↳ StyleDriftPanel | ABSENT — `payload.styleDrift` is `null` (Phase-39 D-5 holds it null) ⇒ **early return null** (`BatchDPanels.tsx:20`). | `BatchDPanels.tsx:20`; `scenario-factsheet-payload.ts:473` |
| ↳ StrategyThesisPanel | SAFE — reads metadata; `strategyName="Scenario"`, `start/end=""`→`startYr/endYr=""`; `n=0`, `years=0` format fine. Renders generic prose. No throw. | `MandatePanels.tsx:24-50` |
| ↳ TermsPanel | SAFE — `trustTier=null`→`"—"`; `iso("")→"—"` (`MandatePanels.tsx:148`); `startDate=null` skips the live-since row. No throw. | `MandatePanels.tsx:53-125,148` |
| ↳ LeverageProfilePanel | ABSENT — `return null` always (`MandatePanels.tsx:143-146`). | `MandatePanels.tsx:145` |
| ↳ PeerPercentilePanel | ABSENT — gated on `ingestSource==="api"` in `MetricsColumn.tsx:116` (and an inner `!== "api"` guard `BatchDPanels.tsx:84`). csv → never rendered. | `MetricsColumn.tsx:116`; `BatchDPanels.tsx:84` |
| **AllocatorSection** | ABSENT — gated on `!hideAllocatorSection && ingestSource==="api"` (`FactsheetView.tsx:275`); `hideAllocatorSection=true` AND csv → doubly suppressed. | `FactsheetView.tsx:275` |
| **SignaturesSection / CrossSignaturesSection** | ABSENT — gated on `hasComparator && ingestSource==="api"` (`FactsheetView.tsx:241`). csv → never rendered. | `FactsheetView.tsx:241` |
| **FactsheetFooter** | SAFE — `strategyId="scenario"`→stamp `QSF · SCENARIO · —` (`computedAt=""`→`isoToYmd→"—"`). Static prose. No throw. | `FactsheetView.tsx:960-979,993` |
| **FactsheetHeader** | ABSENT — `hideHeader=true` suppresses it (`FactsheetView.tsx:187`). | `FactsheetView.tsx:187` |

### Single-strategy / sub-N-overlap / non-finite cases

- **Single-strategy / sub-N (`10 ≤ n < 252`)**: the populated path runs through
  `compute()`; every panel has real data. `pickRollingWindow(rets.length)` falls
  back to a 30d window for short series, so rolling panels EITHER render with the
  short window OR `enough=false` → `NotEnoughDataPanel` (both handled,
  `FactsheetView.tsx:336-361`). Low-N caveats fire honestly via `n<252` checks in
  `KpiStrip` (`:664`), `MetricsColumn` (`:42`), `BootstrapCIPanel` (`:216`). No
  crash. `[VERIFIED: scenario-factsheet-payload.ts:338-383 populated path]`
- **Non-finite blend**: the adapter's degenerate gate
  (`scenario-factsheet-payload.ts:305-308`) collapses ANY non-finite return to
  the SAFE-EMPTY body BEFORE `compute()` is called — so a non-finite value never
  reaches a panel; the panel-level case reduces to the empty-payload column
  above. This is PAYLOAD-05, already covered by
  `scenario-factsheet-payload.test.ts:326,351`. The body never sees NaN/Inf.

### Verdict

**No panel needs a new defensive guard for the empty payload.** Every panel
either early-returns on its empty array or formats non-finite values to `"—"`.
The real factsheet already handles low/empty-data CSV strategies (the same csv
arm `build-payload.ts` produces), which is why every guard already exists. The
**single latent LOW-RISK item** is `StreakHist`'s `barW=Infinity` when
`maxLen=0` — it is never consumed in the empty case, but the BODY-03 render test
should assert the serialized body contains no `"Infinity"`/`"NaN"` substring as
a regression tripwire.

## Must-Answer #3.5 — Blank-slate reconciliation

There is **no covering "overlay" `<div>`** over the chart in this codebase. The
"blank-slate" is an **entry mode** (`entryMode: "book" | "blank"`,
`ScenarioComposer.tsx:504`), not a z-indexed overlay. The relevant honest-empty
states are:
1. **`entryMode==="blank"`** with no strategies added: `displayHoldings=[]`
   (`ScenarioComposer.tsx:515`), so `scenarioMetrics.portfolio_daily_returns` is
   empty ⇒ the adapter returns the safe-empty payload ⇒ the body renders its
   empty panel states (per the audit above). Nothing covers it; the body simply
   renders the safe-empty article.
2. **`allDataSourcesExcluded`** (every data source toggled off): the composer
   renders an `<EmptyStateCard heading="Select at least one data source" …>` at
   `ScenarioComposer.tsx:2189-2196` — this is a **sibling card above** the chart
   region, NOT an overlay over the body. It coexists with the body, which renders
   the safe-empty article beneath it (the engine returns null KPIs + empty
   curve).
3. **`scenarioAum <= 0`**: the "Illustrative shape only — no live capital
   connected" `aria-live="polite"` div (`ScenarioComposer.tsx:2255-2262`) sits
   **inside the same `<div className="relative mt-6">`** that wraps
   `ScenarioFactsheetChart`, as a sibling BELOW it. Composer-owned chrome, NOT
   pushed into the body (UI-SPEC §Composer chrome, 40-UI-SPEC.md:118-120).

**Reconciliation:** replacing the two-chart render with the full body **preserves
all three** — they are composer-chrome siblings/cards, none of them is a literal
overlay layered on the chart. The body underneath renders the safe-empty payload
without throwing (verified in Must-Answer #3). The "PARITY-03" guard that
EquityChart.scenario.test.tsx pins concerns the legacy `EquityChart.tsx` path
(the Overview's `EquityChartWidget`), which Phase 40 **does not touch** — that
test stays green untouched. `[VERIFIED: codebase — ScenarioComposer.tsx
504,515,2189,2255; no overlay div over ScenarioFactsheetChart]`

## Must-Answer #4 — Byte-identity strategy (BODY-02)

### Confirmation: adding `scenarioMode?` (default false) changes no call site

Three call sites mount the body and pass **no** `scenarioMode`:
- `page.tsx:384` — `<FactsheetView payload={payloadWithTrust} />` (the real v2
  route; `FactsheetView` wraps its own `persist=true` provider, then renders
  `FactsheetBody` with no `scenarioMode`).
- `discovery/[slug]/[strategyId]/page.tsx:128` — `<FactsheetView payload=… />`.
- `AllocationDashboardV2.tsx:143` — `<FactsheetBody … />` (Overview), no
  `scenarioMode`.

All resolve `scenarioMode = false` ⇒ `ControlBar` renders Share + Compare ⇒
`MetricsColumn` makes no conditional render. **Byte-identical.** `[VERIFIED:
codebase grep — only ScenarioFactsheetChart will pass scenarioMode={true}]`

`page.tsx` is untouched (the diff touches `FactsheetView.tsx` only to add the
optional interface field + thread the default-false prop into two children — no
behavior change at `false`).

### Proposed byte-identity test (BODY-02, the Phase-40 version)

A jsdom test rendering `FactsheetBody` twice under a real `FactsheetProvider`:
once with default props, once with `scenarioMode={false}`, and asserting
`container.innerHTML` is identical. Use a populated `FactsheetCsvPayload` fixture
(reuse `buildScenarioFactsheetPayload` with a healthy returns series so the body
is fully populated). This pins "default ≡ explicit false" and runs in
milliseconds. (The PERMANENT route-level byte-identity gate is GUARD-02 →
Phase 43; Phase 40 only needs the prop-level equivalence test.)

### Existing snapshot/render coverage to lean on

- There is **no** existing jsdom snapshot of the v2 route or of `FactsheetBody`
  rendered with the real subtree — `AllocationDashboardV2.*.test.tsx` both
  **mock** `FactsheetBody` (`AllocationDashboardV2.staleness.test.tsx:47`,
  `…baseline-unknown.test.tsx:46`). So the BODY-02 and BODY-03 jsdom render tests
  are **net-new** (they are the first tests that mount the real body subtree in
  jsdom). The Overview `EquityChartWidget` has its own tests
  (`EquityChart*.test.tsx`) that Phase 40 does not touch.

## Must-Answer #5 — a11y landmark risk (JOURNEY-03 class)

### Does FactsheetBody emit a `<main>` / role=region / tablist?

- **`<main>`**: NO. The body root is `<article id="factsheet-main" tabIndex={-1}>`
  (`FactsheetView.tsx:179-181`) — an `<article>`, not `<main>` and not
  `role="main"`. The page chrome's `<main aria-label="Dashboard content">` lives
  in the dashboard layout (`allocations/page.tsx:60` documents it). **No second
  `<main>` is introduced.** `[VERIFIED: FactsheetView.tsx:179]`
- **role=region**: NO explicit `role="region"` in the body. `FactsheetFooter`
  is a plain `<footer>` scoped to the `<article>` (`FactsheetView.tsx:963`), not
  a page-level landmark — and the v1.2 Phase-33 bug was specifically a
  `role="region"` on a `<footer>`, which this body does NOT do.
- **tablist**: the body emits **no** `role="tablist"`. The only tablist in the
  mount is the composer's `PeriodControl` (`role="tablist" aria-label="Period"`,
  `ScenarioFactsheetChart.tsx:111`), which sits in `topSlot` inside the
  `<article>`, a **sibling** of (not nested in) the composer's top-level tab bar.
  `ComparatorPicker` uses `role="group"`, not tablist (`ComparatorPicker.tsx:24`).
  `SectionNav` is a `<nav aria-label="Factsheet sections">` with `<a>` links
  (`FactsheetView.tsx:741-742`) — a navigation landmark, not a tablist.

### Landmark elements to be aware of (none need neutralizing)

| Element | Role | File:line | Risk |
|---|---|---|---|
| `<article id="factsheet-main">` | article | `FactsheetView.tsx:179` | None — not a duplicate `<main>`. |
| `<nav aria-label="Factsheet sections">` | navigation | `FactsheetView.tsx:741` | None — distinct accessible name; safe alongside any page nav. |
| `<footer>` (factsheet) | contentinfo (scoped to `<article>`) | `FactsheetView.tsx:963` | LOW — a `<footer>` that is a descendant of `<article>` is NOT a `contentinfo` landmark (HTML scoping rule); only a top-level `<footer>` is. Since it's inside `<article>`, no page-level `contentinfo` duplication. `[CITED: html.spec — footer sectioning scope]` |
| `PeriodControl` (topSlot) | tablist | `ScenarioFactsheetChart.tsx:111` | None — sibling of the composer tab bar, distinct `aria-label="Period"`; each tab carries `aria-selected={false}` (`:124`) which a11y requires. Must NOT be removed. |

**Conclusion:** mounting the full body inside the composer introduces **no**
duplicate `<main>`, `role=region`, or nested-tablist violation. The
`AllocationDashboardV2` precedent (already shipped, mounts the same body in the
same chrome) is the empirical proof. The permanent axe gate is Phase 43
(GUARD-03); Phase 40's only a11y obligation is to not regress, which the audit
confirms. `[VERIFIED: FactsheetView.tsx landmark scan + AllocationDashboardV2
precedent]`

## Must-Answer #6 — Test surface

| Test file | Current shape | Phase-40 action |
|---|---|---|
| `widgets/performance/scenario-shared-window.test.tsx` | Mounts the REAL `ScenarioFactsheetChart`; asserts MasterBrush + exactly **2** `svg[role="img"][tabindex="0"]` chart SVGs (`:96-97`), the `equity-chart-scenario-overlay` testid (`:99-102`), and that PeriodControl/keyboard nav drive the shared window. | **MUST UPDATE.** After the mount swaps to `FactsheetBody`, the body renders MANY more chart SVGs (PerformanceCharts: cumulative + underwater + others), so the `=== 2` assertion is wrong. Re-point: assert MasterBrush present, ≥1 chart SVG, PeriodControl tablist present + drives the shared window. Relocate the `equity-chart-scenario-overlay` testid to the `topSlot` wrapper (see Must-Answer #1). The shared-window proof (PeriodControl narrows the brush label) remains valid and should stay. |
| `widgets/performance/EquityChart.scenario.test.tsx` | Tests BOTH the legacy `EquityChart` AND `ScenarioFactsheetChart` blank-slate (PARITY-03, `:498-560`): empty baseline + present scenario ⇒ a real strategy `<path d=…>` renders, exactly ONE strategy line, no "warming up" copy. | **LIKELY UPDATE.** The PARITY-03 asserts on the scenario equity line's SVG `<path>`. After the swap, the equity line renders through the body's `PerformanceCharts` `cumulative` config (still a real `<path>`), but the selector (`querySelector` on the equity wrapper) may need re-pointing if it keyed off the old `data-testid`/structure. Verify the path-presence assertion still resolves; update the selector, keep the honesty intent. The legacy-`EquityChart` describes (the Overview path) are UNTOUCHED. |
| `components/ScenarioComposer.test.tsx` | **MOCKS** `ScenarioFactsheetChart` entirely (`:94-96` → `<div data-testid="scenario-factsheet-chart-mock">`). All ~20 assertions test the PROPS passed to the mock (`portfolioDaily`, `scenarioSeries`, wealth-form, no sync-stamp). Plus the **static guard at `:3377-3393`** asserting `ScenarioComposer.tsx` source matches NO `FactsheetBody|MetricsColumn|buildAllocatorPortfolioFactsheetPayload` and no `ingestSource:"api"`. | **MOSTLY STAYS GREEN.** Because the mount lives in `ScenarioFactsheetChart.tsx` (not `ScenarioComposer.tsx`) and the composer test mocks that component, the prop-passing assertions are unaffected. **The static guard (`:3377`) STAYS GREEN** precisely because `ScenarioComposer.tsx` still imports only `ScenarioFactsheetChart` (`:111`), never `FactsheetBody` directly. ⚠️ **HARD CONSTRAINT: the planner MUST do the mount in `ScenarioFactsheetChart.tsx`, never inline in `ScenarioComposer.tsx`** — moving the mount into the composer would trip this guard. The no-`MetricsColumn`/`buildAllocatorPortfolioFactsheetPayload` clauses also stay satisfied (those live in the factsheet module, imported transitively, not in the composer source string). |
| `widgets/performance/scenario-factsheet-payload.test.ts` | Phase-39 tests: payload completeness, degenerate safety, AND assertions on `SCENARIO_EQUITY_CONFIG`/`SCENARIO_DRAWDOWN_CONFIG` (`:160-176`). | **STAYS GREEN if the two SCENARIO_* exports are kept.** If the planner deletes those now-unused exports, these two `it()` blocks must be deleted/migrated in the same change. Recommend keeping the exports (cheap) to keep this test untouched. |
| `widgets/performance/DrawdownChart.scenario.test.tsx` | Legacy DrawdownChart scenario path (the Overview/legacy widget). | **UNTOUCHED** — Phase 40 does not change the legacy DrawdownChart. |
| **NET-NEW: `FactsheetBody` BODY-03 render test** | — | **CREATE.** Mount the real `FactsheetBody` under a real `FactsheetProvider` with the adapter's safe-empty / single-strategy(n≈30) / sub-N / healthy(n≈300) / non-finite-collapsed payloads; assert each renders without throwing and the serialized SVG has no `"NaN"`/`"Infinity"`. This is the only render-level coverage of the real body and does not exist today. |
| **NET-NEW: BODY-02 prop-equivalence test** | — | **CREATE.** `FactsheetBody` default vs `scenarioMode={false}` → identical `innerHTML` (Must-Answer #4). |

⚠️ **Test-infra note (verified pattern):** any test that mounts a real
`FactsheetProvider` MUST stub `localStorage` + `@/lib/sentry-capture`, because
the provider's cross-tab persistence primitive touches both on mount even at
`persist={false}` (the hook still registers). The canonical stub block is in
`scenario-shared-window.test.tsx:24-43` and `EquityChart.scenario.test.tsx:13-32`
— copy it verbatim into the net-new BODY-02/BODY-03 tests.

## Runtime State Inventory

This is a refactor of a render seam, but it touches no stored data, no live
service config, no OS-registered state, no secrets/env vars, and no build
artifacts.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — the synth payload is ephemeral, computed client-side per render; `persist={false}` blocks all localStorage/URL writes (`factsheet-context.tsx:282,321`). Verified by grep. | None |
| Live service config | None — no external service touched. Verified. | None |
| OS-registered state | None — pure frontend component change. Verified. | None |
| Secrets / env vars | None — no env var read or named. Verified. | None |
| Build artifacts | None — TypeScript/TSX source only, compiled by the existing Next build. The two now-dead `SCENARIO_*_CONFIG` exports are source constants (not artifacts); if removed, no reinstall needed. | None |

**Cross-tab bleed (GUARD-04 class):** mounting the body does NOT re-introduce
the Phase-38 RT2 cross-tab state-bleed. The mount stays inside the existing
`<FactsheetProvider persist={false}>`, which gates BOTH the URL write
(`factsheet-context.tsx:321`) AND the hydration READ
(`factsheet-context.tsx:282`). No new `storageKey` or provider is added. The
permanent test for this is GUARD-04 (Phase 43); Phase 40 must simply keep the
mount inside the existing persist=false provider — do NOT add a second provider.

## Common Pitfalls

### Pitfall 1: Mounting `FactsheetBody` in `ScenarioComposer.tsx` (trips the static guard)
**What goes wrong:** `ScenarioComposer.test.tsx:3377-3393` reads
`ScenarioComposer.tsx` off disk and asserts it contains no `FactsheetBody`
literal (even in a comment). A naive "put the mount in the composer" trips it.
**How to avoid:** keep the mount in `ScenarioFactsheetChart.tsx` (a separate file
the composer imports at `:111`). The composer source string never gains the
forbidden token.
**Warning sign:** the test "no factsheet import on the blend path … (static
guard, T-30-05)" fails.

### Pitfall 2: Deleting the `equity-chart-scenario-overlay` testid
**What goes wrong:** `scenario-shared-window.test.tsx:99-102` and
`EquityChart.scenario.test.tsx` query it. Removing the equity-chart wrapper drops
the testid and breaks those tests.
**How to avoid:** relocate the testid onto a stable element (the `topSlot`
wrapper) and re-point the assertions; don't just delete it.

### Pitfall 3: Asserting "exactly 2 chart SVGs" after the swap
**What goes wrong:** `scenario-shared-window.test.tsx:96-97` expects `=== 2`
chart SVGs (Phase-38 had exactly equity + drawdown). The full body renders many
more. The assertion will fail.
**How to avoid:** relax to `≥1` (or assert the specific configs you expect) and
keep the shared-window proof (PeriodControl narrows the brush label).

### Pitfall 4: Unused `scenarioMode` in `MetricsColumn` failing the lint gate
**What goes wrong:** an accepted-but-unused destructured prop trips
`@typescript-eslint/no-unused-vars` and fails CI.
**How to avoid:** add a `void scenarioMode;` no-op (or an explicit
eslint-disable) with a comment naming Phase 42 as the consumer.

### Pitfall 5: Deleting the `SCENARIO_*_CONFIG` exports without migrating their tests
**What goes wrong:** `scenario-factsheet-payload.test.ts:160-176` asserts on the
two exported configs. Deleting the exports breaks those `it()` blocks.
**How to avoid:** keep the exports defined (cheap), OR delete+migrate the two
tests in the same change. Recommend keeping them.

### Pitfall 6: Coverage ratchet (lines 82 / functions 74 / branches 72 / statements 80)
**What goes wrong:** adding `scenarioMode` branches to `ControlBar`/`MetricsColumn`
without exercising them lowers branch coverage and can trip the ratchet.
**How to avoid:** the BODY-02 (scenarioMode={false}) + a `scenarioMode={true}`
render assertion (Share/Compare absent) cover both branches. Per CLAUDE.md the
`frontend-coverage` CI job is a blocking gate.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Scenario tab rendered a bespoke two-chart subset (Phase 38) | Mount the entire real `FactsheetBody` fed a synthesized csv payload | Phase 40 (this) | The scenario blend gets every factsheet panel "for free"; parity-by-construction. |
| `FactsheetBody` mounted only on the real route + Overview | Also mounted on the Scenario composer | Phase 40 | `scenarioMode` is the first per-mount behavior flag on the body. |

**Not deprecated, just newly dead at the mount:** `SCENARIO_EQUITY_CONFIG`,
`SCENARIO_DRAWDOWN_CONFIG` (the body uses the real `chart-configs.ts` `cumulative`
+ `underwaterAcc` instead).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Keeping `SCENARIO_*_CONFIG` exports defined-but-unused is acceptable (vs deleting). | Must-Answer #1 / #6 | LOW — if the planner prefers deletion, two tests must move; either way is correct. |
| A2 | `StreakHist` `barW=Infinity` (maxLen=0) is never consumed in the empty case and emits no `Infinity` attribute. | Must-Answer #3 | LOW — verified by code read (map over `[]`); the BODY-03 test's no-`Infinity` assertion is the tripwire if a future edit changes this. |
| A3 | The composer's `<main>` lives in the dashboard layout/page chrome (not re-emitted by the body). | Must-Answer #5 | LOW — `allocations/page.tsx:60` documents the single `<main>`; AllocationDashboardV2 already mounts the body in it without a duplicate-main axe failure. |

**All other claims in this research are `[VERIFIED]` against the codebase** (file
contents read this session) — no external packages, registries, or docs were
needed.

## Open Questions

1. **Should the two `SCENARIO_*_CONFIG` exports be removed now or deferred?**
   - What we know: they become unmounted dead code; two tests assert on them.
   - What's unclear: whether the planner wants a zero-dead-code diff (delete +
     migrate tests) or a minimal surgical diff (keep them).
   - Recommendation: keep them this phase (minimal change), schedule removal in
     a later cleanup — matches Rule 3 (surgical changes).

## Environment Availability

> No external dependencies. This is a pure in-repo TSX render-seam change
> compiled by the existing Next build and tested by the existing Vitest suite.

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Vitest + @testing-library/react | BODY-02 / BODY-03 jsdom render tests | ✓ | existing (`npm test` = `vitest run`) | — |
| @vitest/coverage-v8 | coverage ratchet gate | ✓ | existing (`npm run test:coverage`) | — |
| Playwright + @axe-core (e2e) | composer-axe (GUARD-03 → Phase 43, not this phase) | ✓ | `e2e/composer-axe.spec.ts`, `e2e/helpers/axe.ts` | — |

No missing dependencies.

## Validation Architecture

> `workflow.nyquist_validation` not disabled → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (jsdom env) + @testing-library/react; Playwright for e2e/axe |
| Config file | `vitest.config.ts` (coverage thresholds lines 82 / functions 74 / branches 72 / statements 80) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/widgets/performance/ src/app/factsheet/\[id\]/v2/ --no-file-parallelism` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BODY-01 | Scenario mount renders the real `FactsheetBody` (MasterBrush + body panels) under one persist=false provider | unit (jsdom) | `npx vitest run src/app/\(dashboard\)/allocations/widgets/performance/scenario-shared-window.test.tsx` | ✅ exists — UPDATE (relax `===2`, re-point testid) |
| BODY-02 | `FactsheetBody` default ≡ `scenarioMode={false}`; `scenarioMode={true}` suppresses Share + Compare | unit (jsdom) | `npx vitest run src/app/factsheet/\[id\]/v2/FactsheetBody.scenario-mode.test.tsx` | ❌ Wave 0 |
| BODY-03 | Real body renders without throwing across safe-empty / single-strategy / sub-N / healthy / non-finite; no NaN/Infinity in SVG | unit (jsdom) | `npx vitest run src/app/factsheet/\[id\]/v2/FactsheetBody.degenerate.test.tsx` | ❌ Wave 0 |
| BODY-04 | api-only panels absent on the csv blend (allocator / signatures / peer suppressed) | unit (jsdom) | covered inside the BODY-03 test (`getElementById("factsheet-allocator")===null`, etc.) + existing `audit-c20.test.ts` ingestSource pin | ✅ partial (`audit-c20.test.ts`) + ❌ Wave 0 render assertion |
| BODY-02 (route) | Real v2 route + Overview EquityChartWidget byte-identical | unit (jsdom) | existing `EquityChart*.test.tsx` stay green untouched (negative confirmation) | ✅ exists |

### Sampling Rate
- **Per task commit:** `npx vitest run` on the two touched dirs above
  (`--no-file-parallelism` to avoid the documented local contention flake).
- **Per wave merge:** `npm test` (full suite) + `npm run test:coverage` (ratchet).
- **Phase gate:** full suite green + coverage ratchet green before
  `/gsd:verify-work`. (Composer-axe e2e is Phase 43, not a Phase-40 gate.)

### Wave 0 Gaps
- [ ] `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx` — covers
  BODY-03 (+ BODY-04 render-absence). Needs the localStorage + sentry stub block
  (copy from `scenario-shared-window.test.tsx:24-43`).
- [ ] `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` — covers
  BODY-02 (prop equivalence + Share/Compare suppression). Same stub block.
- [ ] Update `scenario-shared-window.test.tsx` (relax `===2`, re-point
  `equity-chart-scenario-overlay` testid).
- [ ] Verify `EquityChart.scenario.test.tsx` PARITY-03 selectors still resolve;
  update selector if keyed off the removed structure.
- No framework install needed — Vitest + RTL already present.

## Security Domain

> `security_enforcement` enabled (absent = enabled). This phase is a pure
> client-render reuse change with **no new data flow, no fetch, no input, no
> auth, no crypto, no persistence write**. The synth payload is computed
> client-side from data already in scope; `persist={false}` blocks all storage
> writes.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Route already auth-gated upstream (middleware + approval gate); Phase 40 adds no auth surface. |
| V3 Session Management | no | No session interaction. |
| V4 Access Control | no | No new data access; the body reads only the ephemeral synth payload. |
| V5 Input Validation | no (n/a) | No user input enters this phase; the payload is engine-derived and already validated/clamped by the Phase-39 degenerate gate. |
| V6 Cryptography | no | None. |
| V7 Errors/Logging | minor | The body's existing `console.error` for missing rolling fields (`FactsheetView.tsx:320`) is benign; no secret in any log. |

### Known Threat Patterns for client TSX reuse
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tab state bleed via shared URL/localStorage (the Phase-38 RT2 class) | Information disclosure | `persist={false}` gates both write + hydration-read (`factsheet-context.tsx:282,321`); Phase 40 keeps the single persist=false provider, adds none. GUARD-04 (Phase 43) pins this permanently. |
| XSS via synthesized payload strings | Tampering | All body text is React-escaped JSX; the only `dangerouslySetInnerHTML`-class sink in the v2 route is the JSON-LD `<script>` in `page.tsx:379` (`.replace(/</g,"\\u003c")`-escaped), which Phase 40 does not touch. |
| Leaking a real strategy's identity into the hypothetical | Information disclosure | `scenarioMode` suppresses Share-link + Compare (which would otherwise expose `/compare?ids=` and a copyable URL for a non-existent strategy); `strategyId="scenario"` is a synthetic constant. |

No security controls to add; the phase's security posture is "do not regress the
existing persist=false isolation," verified above.

## Sources

### Primary (HIGH confidence — codebase, read this session)
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — `FactsheetBody`, `FactsheetBodyOptions`, `ControlBar`, `KpiStrip`, `SectionNav`, section layout, ingestSource gates.
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` — `FactsheetProvider`, `persist` gate (RT2 read + write), split contexts.
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` — the seam, `PeriodControl`, persist=false provider.
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` — the Phase-39 complete adapter + safe-empty defaults.
- `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:143-150` — the EXISTING in-chrome `FactsheetBody` mount precedent.
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, `DistributionPanels.tsx`, `AnalyticalPanels.tsx`, `MandatePanels.tsx`, `BatchDPanels.tsx`, `HeatmapPanels.tsx`, `MasterBrush.tsx`, `HistogramChart.tsx`, `StressWindowsPanel.tsx`, `ComparatorPicker.tsx` — per-panel degenerate audit.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (mount site ~2168-2263, entryMode/blank-slate) + `ScenarioComposer.test.tsx` (mock + static guard `:3377`).
- `src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx`, `EquityChart.scenario.test.tsx`, `scenario-factsheet-payload.test.ts` — test surface.
- `e2e/composer-axe.spec.ts`, `vitest.config.ts`, `package.json` — validation infra.
- `src/app/factsheet/[id]/v2/page.tsx:384`, `discovery/[slug]/[strategyId]/page.tsx:128`, `allocations/page.tsx:60` — call sites + chrome `<main>`.

### Secondary / Tertiary
- None — no external sources required; no packages installed (no Package
  Legitimacy Audit needed: this phase installs nothing).

## Metadata

**Confidence breakdown:**
- Mount edit (BODY-01): HIGH — the seam, provider, and a production precedent
  (AllocationDashboardV2) all exist and were read directly.
- scenarioMode threading (BODY-02): HIGH — exact signatures of `ControlBar`/
  `MetricsColumn`/`FactsheetBodyOptions` confirmed; all call sites enumerated.
- Degenerate audit (BODY-03/04): HIGH — every panel's empty-path guard cited
  by file:line; the Phase-39 safe-empty payload shape confirmed against tests.
- a11y landmarks (BODY-02 a11y): HIGH — body root is `<article>` not `<main>`;
  AllocationDashboardV2 precedent.
- Test surface: HIGH — mock + static-guard mechanics read directly; the
  net-new vs update split is grep-confirmed.

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (30 days — stable in-repo surface; no fast-moving
external deps). Re-verify only if `FactsheetView.tsx`, `ScenarioFactsheetChart.tsx`,
or the scenario adapter change before planning.

## RESEARCH COMPLETE

Phase 40 mounts the already-exported, already-production-proven `FactsheetBody`
into the Scenario composer by swapping the Phase-38 two-chart render inside
`ScenarioFactsheetChart.tsx` (NOT `ScenarioComposer.tsx` — a static source guard
at `ScenarioComposer.test.tsx:3377` forbids the literal there) for
`<FactsheetBody scenarioMode hideHeader hideAllocatorSection hideFooter={false}
topSlot={<PeriodControl/>}>` inside the existing `<FactsheetProvider
persist={false}>`. The additive `scenarioMode?: boolean` (default `false`)
threads only into `ControlBar` (suppressing the Share-link + Compare-strategies
actions) and into `MetricsColumn` (an inert Phase-42 seam requiring a
`void scenarioMode;` to pass lint), leaving all three existing call sites
byte-identical. Every body panel is already safe against the Phase-39
safe-empty / single-strategy / sub-N / non-finite payloads (each early-returns on
empty arrays or formats non-finite to `"—"`; the only latent item is
`StreakHist`'s unconsumed `barW=Infinity`, covered by a no-`Infinity` test
assertion), and the api-only panels stay absent by construction via the frozen
`ingestSource:"csv"`. No `<main>`/`role=region`/nested-tablist landmark is
introduced (the body root is `<article>`, proven safe by the existing
AllocationDashboardV2 mount). The work needs two NET-NEW jsdom render tests
(BODY-02 prop equivalence, BODY-03 degenerate matrix — both requiring the
localStorage+sentry stub block) plus targeted updates to
`scenario-shared-window.test.tsx` (relax the `===2` SVG count, relocate the
`equity-chart-scenario-overlay` testid) and a selector check in
`EquityChart.scenario.test.tsx`; the composer test stays green because it mocks
`ScenarioFactsheetChart`. No external dependencies, no server/DB/secret/env
changes, no security controls to add beyond preserving the existing persist=false
isolation.
