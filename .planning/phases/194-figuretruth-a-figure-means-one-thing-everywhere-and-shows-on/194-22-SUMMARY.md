---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 22
subsystem: portfolio-components
tags: [trust-05, d-11, d-15, sharpe-delta, sharpe-lift, simulator, optimizer]

requires:
  - phase: 194-06
    provides: the `<1y` marker markup (StrategyTable) the optimizer cell copies in shape
  - phase: 194-12
    provides: gateDelta, widenedWithheldReason, widenedShortNote, shortTrackMarkerTitle
  - phase: 194-13
    provides: sharpe_lift_span_days, sharpe_lift_state, sharpe_lift_failing_record on every optimizer suggestion
provides:
  - "annualization_periods on the simulator ok response (producer) and as optional on the strict ok schema branch"
  - "gateSimulatorDeltas and impact-delta-annualization-note on the Simulate Impact panel"
  - "OptimizerSuggestionRow.sharpe_lift_span_days / .sharpe_lift_state / .sharpe_lift_failing_record, parseLiftState, parseWireFigureRecord"
  - "the gated Sharpe lift cell on the Holdings optimizer"
affects: ["194-24"]

tech-stack:
  added: []
  patterns: ["the client reads the producer's verdict and never re-derives a record it does not hold", "an older producer deploy is the null state: the figure as before, no note"]

key-files:
  created: []
  modified:
    - analytics-service/services/simulator_scoring.py
    - analytics-service/tests/test_simulator_scoring.py
    - src/lib/api/simulatorSchema.ts
    - src/lib/api/simulatorSchema.test.ts
    - src/components/portfolio/PortfolioImpactPanel.tsx
    - src/components/portfolio/PortfolioImpactPanel.test.tsx
    - src/lib/types.ts
    - src/lib/portfolio-analytics-adapter.ts
    - src/lib/portfolio-analytics-adapter.test.ts
    - src/components/portfolio/PortfolioOptimizer.tsx
    - src/components/portfolio/PortfolioOptimizer.test.tsx

key-decisions:
  - "The optimizer component's `sharpe_lift_failing_record` is typed as the WIRE shape (snake_case), because the component receives raw stored/route JSON, not adapter output; it reads it through `parseWireFigureRecord`, exported from the adapter, so the shape check exists once."
  - "A withheld simulator delta is announced by its reason, not as 'not computable' and not as a change."

requirements-completed: [TRUST-05]

status: complete
commits: 2
plan_head_before: de4a9813054a217410c6705c50ed76b139be71d1
plan_head_after: 5c0a16d03ff4f537f92f81af3a30e4013f24f11c
actuals:
  tokens: 33000
  tasks: 2
  commits: 2

completed: 2026-11-07
---

# Phase 194 Plan 22: Sharpe deltas and lifts under D-15 Summary

The Simulate Impact panel and the Holdings optimizer now withhold a Sharpe change only when a compared record fails D-15's total-record minimum, and show it with one muted note (panel) or a `<1y` marker (optimizer) when the compared window is under a year; the producer gained one field, `annualization_periods`, so the client can tell a crypto book from a traditional one.

## What was built

**Task 1 (tracer): simulator basis to chip and announcement.**
- `simulate_add_candidate` adds `"annualization_periods": blend_ppy` to the ok response only (the value both Sharpes were already annualised at; nothing recomputed). `_empty_result` and the non-ok branches are unchanged.
- `simulatorSchema.ts`: `annualization_periods: z.number().int().positive().optional()` on the strict ok branch, so neither deploy order 500s a simulator call (T-194-48).
- `gateSimulatorDeltas(data)` (exported, `PortfolioImpactPanel.tsx`) builds ONE `figureRecord` (first and last curve date across both curves, `overlap_days`, `annualization_periods`) and gates `sharpe_delta` with `gateDelta(record, record, span)`. Withheld: untoned dash, the reason in the chip title, the same reason as the muted line `impact-delta-annualization-note`, and the announcement reads the reason instead of a Sharpe change. Short: the value stays and the line carries `widenedShortNote("delta", span)`. Absent field: state `null`, byte-identical to before. MaxDD, Correlation, Concentration and the partial-history banner are untouched.

**Task 2: optimizer lift state passed through and the cell gated.**
- `OptimizerSuggestionRow` gains the three fields; `parseOptimizerSuggestionRow` parses them (`asNumber`, a closed-set `parseLiftState`, a shape-checked `parseWireFigureRecord`; null when absent or malformed, T-194-43).
- `SuggestionRow` reads the producer's state, passes `gatedValue(sharpe_lift, state)` to the cell, appends the withheld reason (or the short marker title) to the cell tooltip, and renders the `<1y` marker (plan 06's markup shape) for a short state with a known span. Order and the other two cells are unchanged.

## Neuter -> RED -> restore (cp -p byte backups, cmp-verified after each restore)

Task 1:
1. `sharpe_delta` returned raw (the gate neutered): `FAIL ... crypto book, curves spanning 59 days: Sharpe withheld ...` / `AssertionError: expected '+0.150' to be '—'`; also `... traditional book, 59 observations: withheld ...` and `gateSimulatorDeltas > passes the producer's value through ...` (3 failed | 52 passed).
2. `annualization_periods` ignored, record built at 365: `FAIL ... traditional book, 60 observations over 84 days: value kept, short note` / `AssertionError: expected '—' to be '+0.150'`, and `... 59 observations: withheld, the record names its own count` (2 failed | 53 passed).
3. Producer returning a constant 252 instead of `blend_ppy`: `FAILED tests/test_simulator_scoring.py::TestAnnualizationPeriods::test_crypto_book_leg_gives_365` (1 failed, 21 passed).

Task 2:
1. `gatedValue` call dropped from the cell: `FAIL ... withheld, crypto failing record of 50 days: a dash with no lift colour ...` / `AssertionError: expected '+0.15' to be '—'`, and `... withheld without a usable record` (2 failed | 25 passed).
2. Withholding on `sharpe_lift_span_days` under 90 instead of reading the state (the superseded D-11 reading): `FAIL ... short, span 60: the value prints with <1y and the span's marker title` / `AssertionError: expected '—' to contain '+0.15'` (1 failed | 26 passed).

## Verification

- `pytest tests/test_simulator_scoring.py tests/test_simulator_router.py` (from `analytics-service/`): 85 passed. `mypy --strict ...` as CI runs it: `Success: no issues found in 132 source files`.
- `vitest run` over PortfolioImpactPanel, `src/lib/api`, the adapter, PortfolioOptimizer, `portfolio.signed-zero`: 233 passed. The whole `allocations` directory: 2786 of 2787 passed; the one failure (`RiskTabPanel.book-series`, a lazy-loaded widget `findByTestId`) passed on the next two runs alone, so it is a timing flake under the full-directory load, not caused by this plan (the plan touches nothing in its import graph).
- `npm run typecheck` clean; `eslint` clean on every changed source and test file.
- All four Task 1 grep literals present; `sharpe_lift_state` and `sharpe_lift_failing_record` present in the adapter, `sharpe_lift_state` in `PortfolioOptimizer.tsx`.

## Assumptions recorded

- **A-194-D13-04:** the partial-history banner is left as it is. It is about the overlap sample size, it is not one of the factsheet's amber short-record warnings, and it is not on a page D-13 names. A test pins it byte-identical when Sharpe is withheld.
- **A-194-D22-01:** the delta record's span is taken from the union of both curves' first and last dates (both cover the same aligned window), so an empty curve cannot hide the span. Its `observations` is `overlap_days`, as the plan states.
- **A-194-D22-02:** the withheld simulator delta is announced as the reason sentence after the other chips, not as "Sharpe not computable", because "not computable" says the metric could not be measured, which is false here.
- **A-194-D22-03:** the short optimizer state with an unknown span shows the value without a marker rather than inventing a number.

## Deviations from Plan

**1. [Rule 1 - Shape mismatch] The failing record reaches the component in wire shape.** The plan has the adapter map `span_days/observations/crypto` to a camelCase `FigureRecord` and the component read it. But `PortfolioOptimizer` is fed by `watchlist-read.ts` (a plain cast of the stored JSON) and by the route's raw `suggestions`, neither of which runs the adapter, so the component would have received snake_case at runtime under a camelCase type. Fix: the component's `OptimizerSuggestion.sharpe_lift_failing_record` is typed as the wire shape and parsed with `parseWireFigureRecord` (exported from the adapter, also used by `parseOptimizerSuggestionRow`), and `sharpe_lift_state` is closed-set checked with `parseLiftState` at read. The adapter's `OptimizerSuggestionRow` carries the camelCase `FigureRecord`, as the plan says. Files: `PortfolioOptimizer.tsx`, `portfolio-analytics-adapter.ts`. Commit `5c0a16d03`.

**2. [Rule 2 - Test coverage] `simulatorSchema.test.ts` was extended** (not in the plan's file list) to pin the schema behaviors the plan lists (365 and 252 parse, absent parses, non-integer rejected), plus 0, negative and string. Commit `68c60a8e4`.

**3. Task 2 acceptance diff.** `PortfolioOptimizer.tsx` also gained the figure-gate and adapter imports and the local reads at the top of `SuggestionRow` (state, record, span, reason). These are the lift cell's own call-site inputs, not a separate hunk, and nothing else in the file moved.

## Known Limits

- A suggestion stored before plan 13 ships has no state and shows as before until the optimizer next runs; a simulator response from an analytics deploy older than this plan has no `annualization_periods` and shows as before.
- A withheld lift whose stored failing record is malformed prints the dash without a reason (the tooltip is unchanged): a guessed record would print a false count.
- The withheld reason sits in the label's tooltip (as the plan specifies), not on the dash itself.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the new keys are an integer and short strings over data the owner already sees.

## Deferred Issues

None from this plan. `RiskTabPanel.book-series.test.tsx` "VaR renders a value ..." flaked once under the full allocations-directory run (see Verification); not logged to `deferred-items.md` to avoid a merge conflict with parallel plans appending to it.

## Task Commits

1. **Task 1 (tracer): simulator basis to the delta verdict to the Sharpe chip and the announcement** - `68c60a8e4`
2. **Task 2: optimizer lift state passed through and the lift cell gated** - `5c0a16d03`

## Self-Check: PASSED

All eleven modified files exist; commits `68c60a8e4` and `5c0a16d03` are ancestors of HEAD; `STATE.md` and `ROADMAP.md` untouched.
