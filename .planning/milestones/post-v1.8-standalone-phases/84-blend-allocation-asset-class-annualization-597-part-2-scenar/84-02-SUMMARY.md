---
phase: 84-blend-allocation-asset-class-annualization
plan: 02
subsystem: blend-allocation-kpis
tags: [annualization, periodsPerYear, scenario-benchmark, factsheet-preview, "#597"]
requires:
  - "src/lib/factsheet/compute.ts compute(rets, dates, rf, periodsPerYear)"
  - "src/lib/factsheet/rolling.ts rollingVol/Sharpe/Sortino(rets, window, periodsPerYear)"
  - "src/lib/factsheet/bootstrap.ts bootstrapCI(rets, n, block, seed, periodsPerYear)"
  - "src/lib/portfolio-stats.ts computeTrackingError(r, b, periodsPerYear)"
provides:
  - "computeAlphaBeta(returns, benchmark, periodsPerYear = 252)"
  - "computeScenarioBenchmark(portfolioDaily, btcDaily, periodsPerYear = 252)"
  - "ScenarioFactsheetPayloadArgs.periodsPerYear threaded through buildReturnsBody"
  - "ScenarioFactsheetChart / ScenarioBenchmarkSection optional periodsPerYear pass-through prop"
affects:
  - "wave-3 blend-basis wiring (callers that flip crypto blends to 365)"
tech-stack:
  added: []
  patterns:
    - "trailing periodsPerYear = 252 knob; default byte-identical (deep-equal pins)"
    - "RISK metrics ride √periodsPerYear; CAGR stays on the calendar clock (invariant)"
key-files:
  created: []
  modified:
    - src/lib/portfolio-stats.ts
    - src/app/(dashboard)/allocations/lib/scenario-benchmark.ts
    - src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
    - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
decisions:
  - "Kept bootstrapCI's 2000/5/42 defaults explicit and added periodsPerYear at build-payload.ts:237's slot — byte-identical at 252"
  - "Left scenario-stress.ts:123 untouched — its beta-only consumer is basis-invariant and rides the default"
metrics:
  duration: ~9m
  completed: 2026-07-10
  tasks: 2
  files: 7
---

# Phase 84 Plan 02: Blend-side periodsPerYear knobs Summary

Gave the three remaining blend-side pure metric functions the `periodsPerYear = 252`
knob (`computeAlphaBeta`, `computeScenarioBenchmark`, the scenario factsheet preview
payload) plus optional pass-through props on the two host components — default 252
proven byte-identical payload-wide, explicit-365 risk scaling pinned, CAGR proven
basis-invariant. NOTHING flips a basis here; wave-3 callers do that.

## What was built

### Task 1 — computeAlphaBeta + computeScenarioBenchmark (commit 43d59ee5)
- `computeAlphaBeta(returns, benchmark, periodsPerYear = 252)` — the hardcoded
  `* 252` alpha line became `* periodsPerYear`. beta is a dimensionless ratio and
  stays basis-invariant. JSDoc gained the #597 sentence.
- `computeScenarioBenchmark(portfolioDaily, btcDaily, periodsPerYear = 252)` — threaded
  the knob to all FOUR inline 252s: `computeTrackingError(p, b, periodsPerYear)`,
  `stdExcess = te / Math.sqrt(periodsPerYear)`, `informationRatio = (excessMean *
  periodsPerYear) / te`, and `computeAlphaBeta(p, b, periodsPerYear)`. Degenerate
  relative-scale guards are ratio tests → basis-invariant (unchanged). Comments naming
  ×252/·√252 updated to name the parameter. `scenario-stress.ts:123` left untouched
  (its beta-only consumer rides the default).

### Task 2 — scenario factsheet preview + host props (commit 4e4f82cc)
- `ScenarioFactsheetPayloadArgs.periodsPerYear?: number`; `buildReturnsBody` gains a
  second `periodsPerYear` param threaded to `compute(rets, datesR, 0, periodsPerYear)`,
  the three `rolling*` panels, and `bootstrapCI(rets, 2000, 5, 42, periodsPerYear)` —
  mirroring build-payload.ts field-for-field. `buildScenarioFactsheetPayload`
  destructures `periodsPerYear = 252` and forwards it.
- `ScenarioFactsheetChart.tsx` + `ScenarioBenchmarkSection.tsx` each gained an optional
  `periodsPerYear?: number` prop (default 252) forwarded into their call. Additive — no
  existing caller edited.

## Verification (real output)

- `npx vitest run scenario-benchmark.test.ts scenario-factsheet-payload.test.ts
  --no-file-parallelism` → **53 passed** (2 files).
- RED confirmed before each implement: Task 1 4/25 failed (365 arg ignored → no scaling);
  Task 2 2/28 failed (same). GREEN after implement.
- `npx tsc --noEmit` → exit 0.
- `npx eslint <7 touched files>` → exit 0.
- Downstream consumers unaffected: `portfolio-stats.test.ts` +
  `scenario-stress.test.ts` → **88 passed**.

### Acceptance criteria met
- computeAlphaBeta body: only 1 `252` remains (the default value); no hardcoded ×252.
- scenario-benchmark.ts code: 0 inline `Math.sqrt(252)` / `* 252` (all parameterized).
- `compute(rets, datesR, 0, periodsPerYear)` present once; all three rolling calls +
  bootstrapCI carry periodsPerYear.
- Deep-equal default-vs-252 pins on every touched function (T-84-02 mitigation).
- 365 pins: te ×√(365/252), IR ×√(365/252), alpha ×365/252, ann_vol/sharpe/sortino +
  rolling ×√(365/252); beta, correlation, and CAGR proven invariant.

## Deviations from Plan

None to the plan's own files. The plan executed exactly as written.

**Observation (not a deviation by this plan):** `scenario-adapter.ts` /
`scenario-adapter.test.ts` appeared modified in the working tree from a parallel
wave-1 sibling plan (Phase 84 BLEND-01 asset_class threading into
`StrategyForBuilder` units). They are NOT in this plan's `files_modified`, so they
were deliberately NOT staged — each per-task commit staged only this plan's files
individually. They were subsequently committed by the sibling agent.

## Known Stubs

None. All changes are pure parameterization with byte-identical 252 defaults; no
placeholder values, no unwired data paths introduced.

## Self-Check: PASSED
