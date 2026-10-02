---
phase: 23-scenario-persistence-compare
plan: 03
subsystem: allocations-scenario-compare
tags: [scenario, compare, honesty, computeScenario, persist-04, tdd]
requires:
  - "computeScenario + ComputedMetrics (src/lib/scenario.ts, frozen SCENARIO-05)"
  - "buildStrategyForBuilderSet (scenario-adapter.ts)"
  - "collapseAliasedHoldingStrategies (scenario-dealias.ts)"
  - "methodologyLine (scenario-history.ts)"
  - "evaluateSampleFloor / SAMPLE_FLOOR_OVERLAPPING_DAYS (sample-floor.ts)"
  - "CompareTable scaffold + findWinner (src/components/strategy/CompareTable.tsx)"
provides:
  - "computeMetricsForDraft(draft, liveInputs) → ComputedMetrics — pure engine-path round-trip for a saved draft"
  - "buildLiveBookDraft(liveInputs) → ScenarioDraft — synthetic all-on equity-weight live-book draft"
  - "ScenarioCompareTable — CompareTable-mirrored grid with per-column methodologyLine + em-dash honesty + Best Sharpe callout"
affects:
  - "Plan 23-04 (the compare panel that wires these into the Scenario tab)"
tech-stack:
  added: []
  patterns:
    - "Extract React render-path compute chain into a pure helper for off-render reuse"
    - "Per-column independent window stamp (tfoot) vs CompareTable's single header"
key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/scenario-compare.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx"
  modified: []
decisions:
  - "Max Drawdown uses higherIsBetter=true (tested CompareTable flag), NOT the UI-SPEC's 'false' — the signed ComputedMetrics.max_drawdown would otherwise crown the worst drawdown (winner inversion). Rule 1 fix, test-pinned."
  - "Live-book column computed via the synthetic all-on equity-weight draft through the SAME engine path (not payload.liveBaselineMetrics) so all six metrics populate honestly."
  - "Per-column methodologyLine stamp lives in a <tfoot> row — heterogeneous windows; no shared-window header (Phase 24 owns alignment)."
metrics:
  duration: "~25 min"
  completed: 2026-06-21
  tasks: 2
  files: 4
---

# Phase 23 Plan 03: Scenario Compare Engine + Render Summary

The compare spine for PERSIST-04: a pure `computeMetricsForDraft(draft, liveInputs)` that re-resolves a saved draft's return series from the live payload and runs the frozen `computeScenario`, plus `ScenarioCompareTable` mirroring `CompareTable` with per-column `methodologyLine(n)`, em-dash honesty, winner highlighting, and a neutral Best-Sharpe callout.

## What Was Built

### Task 1 — `computeMetricsForDraft` + `buildLiveBookDraft` (`scenario-compare.ts`)

A pure helper that extracts the composer's `ScenarioComposer.tsx:460-630` chain verbatim — `buildStrategyForBuilderSet` → overlay `draft.toggleByScopeRef`/`draft.weightOverrides` into `projectionState` → `collapseAliasedHoldingStrategies` → `buildDateMapCache` → `computeScenario` — so a saved draft round-trips to the SAME `ComputedMetrics` the composer would show. No new compute algorithm; the frozen engine is the only producer.

Honesty invariants (all test-pinned):
- **No leverage.** The projection state OMITS the optional `leverage` map, so `computeScenario`'s `lev()` defaults every leg to 1 (byte-identical pre-R4 path). A leverage field smuggled onto the draft is never read — proven by an identical-TWR assertion.
- **Degenerate → null.** The engine's null-metric path flows straight through (NO `?? 0`); a degenerate draft yields `twr/cagr/sharpe/sortino/volatility = null`, asserted `not.toBe(0)`.
- **Heterogeneous windows.** Two drafts over different windows each report their own `n` (90 vs 60), asserted distinct.
- **`buildLiveBookDraft`** returns a synthetic all-on, equity-weight, zero-override, no-leverage draft. Run through `computeMetricsForDraft` it populates all six metrics non-null on a healthy book; a genuinely degenerate live book still renders null (honest em-dash), not a 0.

### Task 2 — `ScenarioCompareTable` (`ScenarioCompareTable.tsx`)

Mirrors `CompareTable` exactly for the table scaffold + `findWinner` + `formatValue` em-dash, reading keys from `ComputedMetrics`. The live book participates as a column (own window + winner candidacy).

Load-bearing divergence and honesty gates (all test-pinned):
- **Per-column `methodologyLine(n)` stamp** in a `<tfoot>` caption row — three columns with `n` = 120/65/90 render three DIFFERENT stamps; there is no single shared-window header (Pitfall 5).
- **Em-dash everywhere on a degenerate column** — each of the six value cells is `"—"`, with explicit `not.toMatch(/0\.00/)`, `not.toMatch(/0%/)`, `not.toMatch(/\bN\/A\b/)`, `not.toBe("0")` so a fabricated 0 FAILS the test.
- **Winner cell** = `text-accent font-bold` + `" ✓"` via `findWinner` (skips nulls).
- **Below-floor column** (`n < SAMPLE_FLOOR_OVERLAPPING_DAYS` = 60) gated to the neutral `SAMPLE_FLOOR_HEADING` + `sampleFloorBody` copy in its stamp cell — asserted no `role="alert"`, no red/amber.
- **Best Sharpe callout** names the leader in neutral `text-text-secondary`; the winning cell carries the accent ✓.
- **Under-selection** (< 2 columns) renders the UI-SPEC hint "Select 2 or more scenarios (or the live book) to compare."

Only UI-SPEC tokens/copy used — no new icons, no new tokens.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Max Drawdown winner direction (winner inversion)**
- **Found during:** Task 2 (winner test failed: the live book's `-30%` drawdown was crowned winner).
- **Issue:** The plan/UI-SPEC specified `higherIsBetter=false` for Max Drawdown. But `computeScenario` stores `max_drawdown` as a NEGATIVE number (`scenario.ts:333-344`: `maxDD` starts at 0, takes the most-negative `dd`). With `false` (pick minimum), `findWinner` crowns the MOST-negative value — i.e. the WORST drawdown — as the winner. This is a correctness inversion on the honesty-critical surface.
- **Fix:** Use `higherIsBetter=true` for Max Drawdown — the tested, shipped `CompareTable.tsx:33` flag (the analog the plan says to mirror "matching CompareTable's existing METRICS flags"). A less-severe drawdown (`-0.05`) is numerically higher than a worse one (`-0.30`), so `true` correctly crowns the least-severe drawdown. Volatility (a positive magnitude) keeps `false`. (CLAUDE.md Rule 7: surfaced the UI-SPEC ↔ analog conflict, picked the more-tested pattern; documented inline.)
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` (METRICS flag + explanatory comment), `ScenarioCompareTable.test.tsx` (added a `not.toContain("-30.00%")` non-inversion assertion).
- **Commit:** `8bd0d015`

### Test-design adjustment (not a deviation from intent)

During GREEN of Task 2, the RED test scoped degenerate/below-floor assertions to a `scenario-col-{name}` wrapper that does not exist (a compare column's cells are spread across separate `<tr>` rows with no single DOM ancestor). Re-scoped to per-cell (`cell-{name}-{key}`) and per-stamp (`stamp-{name}`) testids on the component, which is a faithful DOM contract. All behavior assertions are unchanged in intent.

## TDD Gate Compliance

Both tasks followed RED → GREEN with explicit commits:
- Task 1: `e5c29c60` (test, RED) → `b87a6c1b` (feat, GREEN). RED failed on missing module (no false-green).
- Task 2: `93f3e8df` (test, RED) → `8bd0d015` (feat, GREEN). RED failed on missing module.

No REFACTOR commits needed — both implementations are minimal mirrors of existing primitives.

## Verification

- `npx vitest run scenario-compare.test.ts ScenarioCompareTable.test.tsx scenario.test.ts` → **41 passed (3 files)** (6 engine + 7 table + 28 frozen-engine pins; engine not regressed).
- `npx tsc --noEmit` → exit 0.
- `npx eslint` over all four files → 0 problems.
- Coverage gate: both new source files carry their tests (no coverage regression).

## Known Stubs

None. Both files are fully wired to the frozen engine and existing primitives.

## Notes for Plan 23-04

`ScenarioCompareTable` takes `{ columns: ScenarioColumn[], liveBook: ScenarioColumn | null }` where `ScenarioColumn = { name, metrics: ComputedMetrics }`. The panel produces each column via `computeMetricsForDraft(savedDraft, liveInputs)` and the live-book column via `computeMetricsForDraft(buildLiveBookDraft(liveInputs), liveInputs)`. `liveInputs: ScenarioCompareInputs` is assembled exactly as the composer does (holdingsSummary + holdingReturnsByScopeRef + added-strategy lookups + symbolByHoldingId).

## Self-Check: PASSED

- All 4 source files present on disk (verified via `[ -f ]`).
- All 4 task commits present in git log: `e5c29c60`, `b87a6c1b`, `93f3e8df`, `8bd0d015`.
