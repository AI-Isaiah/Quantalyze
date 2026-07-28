---
phase: 38-composer-factsheet-parity-blank-mode-fix
plan: 01
subsystem: allocations/composer-charts
tags: [adapter, pure-fn, factsheet-parity, chart-engine-reuse, tdd]
requires:
  - "@/lib/factsheet/types (FactsheetPayload / FactsheetCsvPayload / ComparatorBlock / ComputeSummary / RollWindowPick)"
  - "@/app/(dashboard)/allocations/lib/drawdown (deriveSnapshotDrawdowns)"
  - "@/app/factsheet/[id]/v2/chart-configs (ChartConfig type)"
provides:
  - "buildScenarioFactsheetPayload(args): FactsheetCsvPayload — date-keyed scenario → index-aligned minimal payload"
  - "SCENARIO_EQUITY_CONFIG / SCENARIO_DRAWDOWN_CONFIG — the two ChartConfig constants Plan 03's mount imports"
affects:
  - "Plan 03 (engine-reuse mount) consumes this adapter + the two configs"
  - "Plan 02 reads payload.strategyId for the storage key"
tech-stack:
  added: []
  patterns:
    - "pure zero-dep adapter (mirrors src/lib/scenario-blend-panels.ts)"
    - "date→value Map index-alignment (mirrors EquityChart.tsx:593-595)"
    - "degenerate-collapse on empty/non-finite input"
key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts"
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts"
  modified: []
decisions:
  - "Synthesize a minimal FactsheetPayload (csv arm) rather than fork/decouple the factsheet — keeps every factsheet file byte-identical (their tests cannot break)."
  - "csv arm is correct by construction: a hypothetical scenario physically cannot carry peer-rank/portfolio panels (no-invented-data)."
  - "Benchmark kept SPARSE (missing day → null) per the composer's own EquityChart.tsx:593-595 pattern; assigned through ComparatorBlock.cumulative at one documented boundary (the field is typed number[]|null because the factsheet pre-aligns DENSE upstream, but the runtime path-builder/Y-domain scan both `continue` on null)."
metrics:
  duration: ~10m
  completed: 2026-06-25
  tasks: 1
  files: 2
---

# Phase 38 Plan 01: Scenario→FactsheetPayload adapter Summary

A pure, zero-dependency `buildScenarioFactsheetPayload` adapter that bridges the composer's date-keyed scenario wealth + optional benchmark into a minimal, valid `FactsheetPayload` (the `csv` arm) the factsheet `TimeSeriesChart` + `MasterBrush` consume verbatim — index-aligned to one canonical `dates[]` axis — plus the two `ChartConfig` constants Plan 03's engine-reuse mount imports.

## What was built

- **`scenario-factsheet-payload.ts`** — `buildScenarioFactsheetPayload({ scenario, baseline?, benchmark?, strategyId? }): FactsheetCsvPayload`:
  - Establishes ONE canonical `dates[]` axis = the scenario's own dates; `strategyEquity[i]` = scenario wealth at `dates[i]`.
  - Index-aligns the benchmark into `comparators.btc.cumulative` via a date→value Map (missing day → `null`, dropped by `TimeSeriesChart.buildPath`); `activeComparator` = `"btc"` when a benchmark is present, else `"none"`.
  - Derives `strategyDrawdowns` via the shared `deriveSnapshotDrawdowns` helper (no hand-rolled peak loop).
  - Blank-slate (scenario present, no baseline) → non-empty `strategyEquity` + `dates` (PARITY-03 data precondition).
  - Degenerate input (empty scenario, or ANY non-finite/Infinity value) → safe empty payload (`dates: []`, `strategyEquity: []`, `cumulative: null`), never throws.
  - Safe-defaults the ~30 other `FactsheetCommon` fields (zeroed `ComputeSummary`, `enough:false` rolling windows, empty arrays, inert comparator blocks).
  - Exports `SCENARIO_EQUITY_CONFIG` (growth, baseline 1, `stratField:"strategyEquity"`, `comparatorField:"cumulative"`, `rebaseOnZoom:true`) and `SCENARIO_DRAWDOWN_CONFIG` (percent, baseline 0, `stratField:"strategyDrawdowns"`, `fill:true`, no comparator). No inline strokes/colors — `resolveSeries` owns color via these configs.
- **`scenario-factsheet-payload.test.ts`** — 12 LOCKED-convention pure-fn cases: canonical dates axis + index-aligned equity; benchmark missing-day→null (interior + trailing gaps); `activeComparator` switching (with/without/empty benchmark); drawdowns-match-helper; blank-slate non-empty; degenerate empty/NaN/Infinity collapse; safe defaults + csv arm; custom `strategyId` flow-through; both ChartConfig field assertions.

## Verification

- `npx vitest run ".../scenario-factsheet-payload.test.ts"` → **12 passed**.
- `npx tsc --noEmit` → **clean** (return type-checks as `FactsheetCsvPayload`; no `any` cast on the payload).
- `grep deriveSnapshotDrawdowns` → present (drawdown reuse, no hand-rolled loop).
- Inline `stroke`/`color:` count (comments excluded) → **0**.
- `git diff --name-only` (src) → exactly the two new files; **no factsheet file touched**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type correctness] `ComparatorBlock.cumulative` is typed `number[] | null`, not `(number|null)[]`**
- **Found during:** Task 1 (first `tsc --noEmit` after GREEN).
- **Issue:** The factsheet pre-aligns the benchmark to a DENSE series upstream (`comparator-block.ts:61` feeds `benchSummary.eq`), so `cumulative` is typed non-nullable. The composer's benchmark is genuinely SPARSE against the scenario axis, and the plan/research mandate "missing day → null" (mirroring `EquityChart.tsx:593-595`).
- **Fix:** Kept the sparse `(number|null)[]` (runtime-correct — `TimeSeriesChart`'s `buildPath` + Y-domain scan both `continue` on `v == null`, lines 87/118) and assigned through the field via a single documented `as ComparatorBlock["cumulative"]` at the one boundary, with a comment explaining the factsheet's dense-vs-composer-sparse divergence. Did NOT edit the factsheet truth file (`types.ts`) — that would violate "factsheet untouched."
- **Files modified:** `scenario-factsheet-payload.ts`
- **Commit:** `ce61f8ed`

## TDD Gate Compliance

This plan is a single TDD task (`tdd="true"`). RED was confirmed (test failed to resolve the missing module) before GREEN. RED test + GREEN implementation are committed together as one atomic feat commit (`ce61f8ed`) per the sequential-executor protocol (one task = one commit). No separate `test()` commit gate because the plan defines a single combined task.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts`
- FOUND: `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts`
- FOUND: commit `ce61f8ed`
