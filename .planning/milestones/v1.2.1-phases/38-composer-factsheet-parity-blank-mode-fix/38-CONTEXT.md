# Phase 38: Composer factsheet parity + blank-mode fix - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — Areas 2 & 3 accepted as recommended; Area 1 Q1 = full engine reuse, Q4 = equity + drawdown both. Plus a governing principle from the user (below).

<governing_principle>
## ⭐ The factsheet is the source of truth

**User directive (2026-06-25):** "Think of the factsheet as the truth. Because the
scenario is in the end just a blend strategy, it should look **exactly the same** and
use the **same assets** as the factsheet."

This governs every decision in this phase: the scenario composer's equity + drawdown
charts are a *view of a blended strategy*, and a blended strategy is just another
strategy — so it must render through the **same factsheet components** (not lookalikes,
not reimplementations) with the **same visual identity and interactions**. Phase 30
already moved the composer onto the factsheet *chart-token identity*; Phase 38 completes
the convergence by reusing the actual factsheet chart **assets** (`TimeSeriesChart` +
`MasterBrush`) so the scenario charts are indistinguishable from a factsheet chart.

Bias every "Claude's discretion" call toward "do exactly what the factsheet does, reuse
the factsheet's component" rather than adapting/forking.
</governing_principle>

<domain>
## Phase Boundary

Make the composer's equity chart factsheet-grade by **reusing the factsheet
`TimeSeriesChart` + `MasterBrush` as the rendering engine** (wheel-zoom / drag-pan /
brush / keyboard nav working exactly as on the factsheet), relax the composer width so
the chart has room, and fix the blank-slate equity-projection so it renders the scenario
overlay on an empty baseline.

Delivers PARITY-01/02/03:
- **PARITY-01** — composer equity chart reuses factsheet `TimeSeriesChart` + `MasterBrush`
  so wheel-zoom, drag-pan, brush, and keyboard navigation work as on the factsheet.
- **PARITY-02** — composer max width relaxed `max-w-[1100px]` → `max-w-[1440px]`.
- **PARITY-03** — blank-slate (empty baseline) equity-projection renders the scenario
  overlay (the `EquityChart` projection guard no longer bails on empty baseline before
  considering `scenarioSeries`/`composite`, matching `DrawdownChart`'s `hasScenario` guard).

**Scope expanded by discuss:** the **DrawdownChart** ALSO gets factsheet parity (Area 1 Q4)
— both stacked charts share the same factsheet interactions / brush-zoom window, per the
governing principle (the scenario should be wholly factsheet-grade, not half).

**Out of scope:**
- The frozen `scenario.ts` engine (SCENARIO-05) — reuse, never fork.
- Per-key toggle (Phase 37, shipped), annualization (34), per-key dailies (35), repoint (36).
- The factsheet pages themselves — they are the truth; this phase brings the composer TO them,
  it does not change the factsheet.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — PARITY-01 factsheet-chart reuse
- **Q1 = Full engine reuse.** Replace the composer EquityChart's custom SVG projection with
  the factsheet `TimeSeriesChart` + `MasterBrush` as the rendering engine; the composer
  EquityChart becomes a thin adapter that feeds the factsheet chart. Maximum parity — the
  factsheet interactions come for free.
- **Q2 = Preserve scenario overlay + benchmark** by mapping `scenarioSeries` + the benchmark
  onto `TimeSeriesChart`'s multi/comparator-series API (they become additional series). The
  "PROJECTED — hypothetical" framing + the composer's anchoring/tooltip semantics must
  survive the swap.
- **Q3 = Keep the 3M/6M/12M/ALL SegmentedControl** driving the window, with `MasterBrush`
  for brush/refine — matching the factsheet's own period + brush controls.
- **Q4 = Equity + Drawdown BOTH** get factsheet parity, sharing the same interaction /
  brush-zoom window so the two stacked charts behave identically (per the governing principle).

### Area 2 — PARITY-02 width relaxation
- Relax **both** the composer's own containers (`ScenarioComposer.tsx:1810` and `:1860`)
  **AND** the wrapping Scenario-tab container (`AllocationsTabs.tsx:127`) from
  `max-w-[1100px]` → `max-w-[1440px]` — without the outer container the inner change is inert.
- The wider width applies to the **whole composer body**; other tabs/pages stay `1100`.
- Use the **literal `max-w-[1440px]`** (matches the explicit criterion and the existing
  `max-w-[1100px]` literal convention).

### Area 3 — PARITY-03 blank-slate guard
- Fix the `EquityChart` projection guard so an **empty baseline still renders when a scenario
  exists** — mirror `DrawdownChart`'s `hasScenario` guard exactly (don't `return null` on
  `equityDailyPoints.length === 0` before considering `scenarioSeries`/`composite`).
- Blank-slate renders the **scenario overlay only, no synthetic baseline**, keeping the
  existing "PROJECTED — hypothetical" framing (honest — there is no live book in blank mode).

### Claude's Discretion (planner's call) — bias toward "do what the factsheet does"
- Exact adapter seam: whether the composer EquityChart wraps `TimeSeriesChart` directly or a
  shared composer-side wrapper. Prefer the smallest diff that makes the scenario chart use the
  SAME `TimeSeriesChart`/`MasterBrush` instances the factsheet uses.
- How scenario overlay + benchmark map onto `TimeSeriesChart`'s comparator-series model
  (read the factsheet's own usage and mirror it).
- How equity + drawdown share the brush-zoom window (lifted shared range state vs the
  factsheet's existing mechanism — reuse the factsheet's pattern).
- Whether DrawdownChart similarly reuses a factsheet drawdown rendering or shares
  `TimeSeriesChart` — follow whatever the factsheet does for its drawdown panel.
</decisions>

<code_context>
## Existing Code Insights (terrain map, 2026-06-25)

- **Factsheet (the truth):** `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (generic
  comparator-reactive time-series chart; series + value-format + comparator props) and
  `src/app/factsheet/[id]/v2/MasterBrush.tsx` (wheel-zoom / drag-pan / brush / keyboard
  window control). These are the assets to reuse verbatim. Read the factsheet page that
  composes them to mirror the wiring (scenario blend = "another strategy/comparator").
- **Composer equity chart:** `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`
  — custom SVG projection. `scenarioSeries?: WealthPoint[]` overlay (~line 173), benchmark
  (~line 588 firstPositive anchor), `hasScenario` flag (line 507), the `projection` useMemo
  (~line 668) whose guard `if (equityDailyPoints.length === 0 || composite.length === 0) return null`
  is the PARITY-03 blank-slate bug — it bails before considering `hasScenario`. Period control
  via SegmentedControl (3M/6M/12M/ALL). Replace its internals with `TimeSeriesChart`+`MasterBrush`.
- **Composer drawdown chart:** `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx`
  — already has the `hasScenario` guard pattern PARITY-03 should mirror, and now ALSO gets
  factsheet parity (Area 1 Q4) sharing the equity chart's brush-zoom window.
- **Width:** `max-w-[1100px]` at `ScenarioComposer.tsx:1810` + `:1860` and `AllocationsTabs.tsx:127`
  (the Scenario-tab wrapper — the binding outer constraint). Other `max-w-[1100px]` sites
  (demo/layout, security/page, AllocationDashboardV2) are OUT of scope.
- **Phase 30 precedent:** the composer graphs already use the factsheet *chart-token identity*
  (`buildBlendPanels`, factsheet chart tokens) — Phase 38 extends token-parity to component-parity.
- Frozen `computeScenario` engine (`src/lib/scenario.ts`) — the data source is unchanged; only
  the RENDER swaps to the factsheet components.

## Tests that will need updating / adding
- `EquityChart.*.test.tsx` (scenario/boundary/tweaks/v2) — the projection/render path changes to
  TimeSeriesChart; update render assertions; ADD a blank-slate (empty baseline + scenario) render
  test (PARITY-03) and an interaction-parity smoke (brush/zoom/keyboard present).
- `DrawdownChart` tests — parity + shared-window.
- A width assertion (composer + AllocationsTabs container = `max-w-[1440px]`).
- The existing factsheet TimeSeriesChart/MasterBrush tests must stay green (reuse, not fork).
</code_context>

<specifics>
## Specific Ideas
- **Factsheet = truth, reuse the SAME assets** (governing principle). The scenario equity/drawdown
  charts should be visually + interactionally indistinguishable from a factsheet chart — reuse
  `TimeSeriesChart`/`MasterBrush`, do not reimplement.
- PARITY-03 must be honest: blank-slate shows the scenario overlay only (no fabricated baseline),
  "PROJECTED — hypothetical" framing intact.
- Keep the frozen engine + data path byte-identical — this is a RENDER swap, not a data change.
</specifics>

<deferred>
## Deferred Ideas
- Changing the factsheet itself (it is the source of truth — untouched).
- Any data/engine change (out of scope; render-only phase).
- Other `max-w-[1100px]` pages (demo, security, dashboard) — out of scope.
</deferred>
