---
phase: 39-complete-payload-adapter
plan: 02
subsystem: factsheet
tags: [adapter, parity, compute, factsheet, scenario, payload, tdd]
requires:
  - "src/lib/factsheet/quantiles.ts (Plan 01 — exported quantileSummary parity source)"
  - "src/lib/factsheet/compute.ts (population-convention scalar reference)"
  - "src/lib/factsheet/{rolling,streak,calmar-by-year,bootstrap,period-buckets,stress-windows}.ts (panel helpers)"
  - "src/lib/scenario.ts (frozen engine — read-only portfolio_daily_returns)"
provides:
  - "A COMPLETE FactsheetCsvPayload from buildScenarioFactsheetPayload — full compute() scalars + every panel array synthesized from the blend's portfolio_daily_returns (daily RETURN form), parity-by-construction with the real factsheet route"
  - "portfolioDaily threaded composer → ScenarioFactsheetChart → adapter (the daily-RETURN input compute() consumes)"
affects:
  - "Phase 40 (mounts the real FactsheetBody on this now-complete payload)"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (new chart prop)"
  - "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx (new prop + memo dep)"
tech-stack:
  added: []
  patterns:
    - "Two-axis payload: chart LINE (strategyEquity/strategyDrawdowns) on the WEALTH series (D-2 Option a, Phase-38 pins); full scalar metrics + panel arrays on the RETURNS series via compute()/rolling.ts (population stdev, 252 vol/Sharpe, 365.25 CAGR)."
    - "Returns-degenerate gate evaluated BEFORE any compute() call (compute throws on empty) → safe-empty body; never NaN/Inf, never fabricated zeros."
    - "Mutation-falsifiable convention pin: a sample-std bleed fails a hand-computed population-std ann_vol at 6 decimals."
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts"
    - "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
decisions:
  - "D-2 Option (a): kept strategyEquity/strategyDrawdowns on the wealth-series source (deriveSnapshotDrawdowns) — preserves the Phase-38 exact-equality chart pins; only the scalar metrics + panel arrays read the returns axis."
  - "D-5: styleDrift held null (CONTEXT defers the style-drift panel to v2, overriding PAYLOAD-02's helper mention — Rule 7)."
  - "D-6: market correlations / correlationMatrix honest-empty (no aligned benchmark series; constituent correlation is Phase 41)."
  - "D-7: ingestSource hard-coded 'csv' — the 4 synthesized api-only panels stay structurally absent."
  - "D-4 / Pitfall 5: computeStressWindows fed the strat's own returns as benchRet + an empty benchName (no separate blend benchmark exists)."
  - "Made the chart's portfolioDaily prop OPTIONAL (defaults []) rather than required, so pre-existing direct-mount tests (EquityChart.scenario.test.tsx, scenario-shared-window.test.tsx) stay green — the plan's 'build stays green between tasks' contract (Rule 3)."
metrics:
  duration: ~25m
  completed: 2026-06-26
  tasks: 3
  files: 5
---

# Phase 39 Plan 02: Complete payload adapter Summary

Replaced the zeroed/empty body of `buildScenarioFactsheetPayload` with a COMPLETE `FactsheetCsvPayload` synthesized from the blend's `portfolio_daily_returns` (daily-RETURN form) via the population-convention `compute.ts`/`rolling.ts` helper family — mirroring `build-payload.ts`'s csv-arm assembly field-for-field — and threaded that returns series from the composer through `ScenarioFactsheetChart` into the adapter. The result is pinned by a golden-parity fixture whose population-std `ann_vol` assertion is mutation-verified to fail on a sample-std bleed.

## What Was Built

- **`scenario-factsheet-payload.ts`** — new `buildReturnsBody(portfolioDaily)` helper computes the full scalar set + every panel array from the daily-return series: a returns-degenerate gate (`length === 0 || any non-finite || < 2 dates`) short-circuits to safe-empty BEFORE any `compute()` call; the populated path calls `compute(rets, datesR)` (strip `eq`/`dd`), then `rollingVol/Sharpe/Sortino` (population, picked window), `worstDrawdowns(dd, 10)`, the `streakLengths`+`streakHistogram` recipe (MAX_LEN=14), `calmarByYear`, seeded `bootstrapCI`, `monthlyReturnsMatrix`, `dailyReturnsByYear`, `computeStressWindows(datesR, rets, rets, "", [])`, and `quantileSummary` (Plan 01's shared parity source). The chart LINE (`strategyEquity`/`strategyDrawdowns`) keeps its existing WEALTH-series source. Honesty invariants held: `styleDrift: null`, `correlations: []`, `correlationMatrix: {labels:[],matrix:[]}`, `ingestSource: "csv"`.
- **`ScenarioFactsheetChart.tsx`** — added an optional `portfolioDaily?: DailyPoint[]` prop (defaults `[]`), fed into the `buildScenarioFactsheetPayload` `useMemo` + dependency array.
- **`ScenarioComposer.tsx`** — `portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}` added at the chart mount (the same `?? []` guard the sibling stress/MC sections already use).
- **`scenario-factsheet-payload.test.ts`** — new `complete-payload parity` block: `BLEND_30` (n=30, population σ exactly 0.0075) + `BLEND_252` (n=252) returns-form fixtures; field-by-field `strategyMetrics ≡ compute(rets,dates)` at 1e-6; population-std `ann_vol` pin; n-boundary (caveat ON at 30, OFF at exactly 252); panel population + seeded-bootstrap determinism; honesty-invariant + ingestSource-absence block (the 4 synth fields `in payload === false`); degenerate cases (empty / non-finite / single point); the kept Phase-38 equity/drawdown wealth-line pins.
- **`ScenarioComposer.test.tsx`** — new test drives the real engine via a sign-varying `daily_returns` strategy and asserts the chart mock received `portfolioDaily` in daily-RETURN form (both signs, `|v| < 0.5`), distinct from the wealth `scenarioSeries` (~1.0).

## Task-by-Task

| Task | Name | Type | Commit | Files |
| ---- | ---- | ---- | ------ | ----- |
| 1 | Thread portfolioDaily (composer → chart → adapter args) | auto | `002073ec` | adapter, chart, composer |
| 2 (RED) | Failing golden-parity / convention-drift / n-boundary / ingestSource-absence tests | test | `6150fced` | adapter test |
| 2 (GREEN) | Synthesize the complete FactsheetCsvPayload body via compute() | feat | `f7a13563` | adapter, adapter test |
| 3 | Composer mock asserts portfolioDaily = engine portfolio_daily_returns | test | `397d0fe4` | composer test |

TDD: wrote the parity/convention/n-boundary/ingestSource tests first and confirmed RED (4 new assertions failed against the zeroed body; the 3 degenerate tests + the equity-line pin passed since that behavior was unchanged), then implemented the body to GREEN.

## Falsifiability Proof (PAYLOAD-03)

Temporarily mutated `buildReturnsBody` to scale `strategyMetrics.ann_vol` by `√(n/(n−1))` (the exact sample-std ratio). The convention-drift pin went **RED**:
`expected 0.12109414974906214 to be close to 0.11905880899790658` (matching RESEARCH's predicted ~0.12110 vs the population 0.11906). Reverted; the population value passes at 6 decimals. The pin genuinely catches a sample-std bleed.

## Verification

- `npx vitest run "…/scenario-factsheet-payload.test.ts"` — 21/21 green.
- `npx vitest run "…/scenario-factsheet-payload.test.ts" "…/ScenarioComposer.test.tsx"` — 110/110 green (89 composer + 21 adapter).
- `npx tsc --noEmit` — exit 0.
- `npx eslint` on the adapter + both touched test files — 0 errors.
- `npm run test:coverage` (full blocking gate) — **546 files / 6651 tests passed, 0 failed** (284 skipped); coverage lines 84.81 / statements 82.73 / functions 78.31 / branches 75.62 — all clear the ratchet (82/80/74/72). The new adapter file reports 100% line/function coverage (both populated + degenerate branches covered).

Acceptance greps: `compute(rets, datesR)` present on the populated path (line 324, AFTER the returns-degenerate `return` at the gate); `ingestSource: "csv"` / `styleDrift: null` / `correlations: []` all present; `portfolioDaily={scenarioMetrics.portfolio_daily_returns` at the composer chart mount.

## Deviations from Plan

**1. [Rule 3 — blocking issue] Chart `portfolioDaily` prop made OPTIONAL (defaults `[]`)**
- **Found during:** Task 1 (tsc gate).
- **Issue:** Declaring `portfolioDaily` as a *required* prop on `ScenarioFactsheetChartProps` broke six pre-existing direct-mount tests (`EquityChart.scenario.test.tsx`, `scenario-shared-window.test.tsx`) that render the chart without it — `TS2741: Property 'portfolioDaily' is missing`.
- **Fix:** Made the prop optional with a `portfolioDaily = []` default at destructure. This matches the plan's explicit contract that "the new field is optional… so the build stays green between tasks" and is the surgical, non-breaking choice (CLAUDE.md Rule 3). The composer always passes the real value; only legacy direct mounts fall back to `[]` (safe-empty body).
- **Files modified:** `ScenarioFactsheetChart.tsx`.
- **Commit:** `002073ec`.

**2. [Rule 1 — test bug I introduced] `strategyWorst10` populated-assertion moved to BLEND_30**
- **Found during:** Task 2 GREEN.
- **Issue:** I had asserted `strategyWorst10.length > 0` on `BLEND_252`, but `BLEND_252` (`value = i%2 ? 0 : 0.002`) is monotonically non-decreasing — it has *zero* drawdown periods by construction, so `worstDrawdowns` correctly returns `[]`. The assertion, not the implementation, was wrong.
- **Fix:** Moved the worst-10 populated check to `BLEND_30` (which alternates +0.01/−0.005 → real down days), asserting `length > 0` and `depth < 0`. The implementation was correct; this is a test-fixture fix.
- **Files modified:** `scenario-factsheet-payload.test.ts`.
- **Commit:** `f7a13563`.

No architectural changes; no auth gates; no package installs.

## Threat Surface

No new surface. Pure in-process TypeScript: the adapter runs client-side inside a `useMemo` with no network/auth/DB/user-input/RSC boundary (matches the plan's threat model — T-39-02-01 mitigated by the returns-degenerate gate + golden/convention-drift tests; T-39-02-02 mitigated by the hard-coded `ingestSource: "csv"` + the `f in payload === false` absence test that would fail on a flip to the api arm). No package installs (T-39-SC n/a). No new endpoints, schema, or trust boundaries → no threat flags.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts (modified)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx (modified)
- FOUND: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (modified)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts (modified)
- FOUND: src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx (modified)
- FOUND commit: 002073ec (feat 39-02 thread)
- FOUND commit: 6150fced (test 39-02 RED)
- FOUND commit: f7a13563 (feat 39-02 GREEN)
- FOUND commit: 397d0fe4 (test 39-02 composer mock)
