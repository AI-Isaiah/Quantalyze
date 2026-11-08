---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 03
subsystem: figure-gate, list-contract, scenario-risk
tags: [trust-04, trust-05, d-02, d-09, d-15, figure-gate, missing-last]

requires:
  - phase: 194-02
    provides: MIN_ANNUALIZATION_OBS, FIGURE_DEFS_VERSION and record_observations in metrics.py; historicalVarCvar in return-stats.ts
provides:
  - "`src/lib/figure-gate.ts`: the one D-15 verdict (`gateAnnualized`, `recordClears`, `figureRecord`, `figureSpan`, `spanDays`, `gatedValue`, `ANNUALIZED_KEYS`) and every UI-SPEC sentence (`withheldReason`, `withheldCellTitle`, `shortTrackNote`, `shortTrackMarkerTitle`, `SHORT_TRACK_MARKER`, `windowNeedsTitle`, `notShownLine`, `VAR_METHOD_LINE`)"
  - "`src/lib/list-figures.ts`: `isMissingFigure`, `compareWithMissingLast`, `rangeMatches` (D-09)"
  - "Scenario `computeVaR` / `computeExpectedShortfall` on `historicalVarCvar`"
affects: [194-04, 194-05, 194-06, 194-07, 194-08, 194-09, 194-10, 194-11, 194-12, 194-13]

actuals:
  tokens: 9940
  tasks: 3
  commits: 3

plan_head_before: 0c903d745f72b31e6c8b4df62c2bc23d210c36c7
plan_head_after: bab4485a7f877a0a9b530433f0ef42f0c57edb71

tech-stack:
  added: []
  patterns: ["thresholds and copy in one pure module, pinned to the Python constants by a text-read vitest", "missing-last comparator with stable ties, never a zero substitute"]

key-files:
  created:
    - src/lib/figure-gate.ts
    - src/lib/figure-gate.test.ts
    - src/lib/list-figures.ts
    - src/lib/list-figures.test.ts
  modified:
    - src/lib/factsheet/comparator-block.ts
    - src/lib/portfolio-stats.ts
    - src/lib/portfolio-stats.test.ts
    - src/app/(dashboard)/allocations/lib/scenario-stress.test.ts
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-02-SUMMARY.md

key-decisions:
  - "D-15 as written: the TOTAL record withholds (crypto 90 calendar days, non-crypto 60 observations, interim non-crypto without a count: 90 days); the window only qualifies (`short` under 365 days). A selected range is never withheld."
  - "`gatedValue` returns null for a withheld state and for any non-finite value, never a substitute number (SC-5, D-05)."
  - "Scenario `computeVaR`/`computeExpectedShortfall` keep their empty-input 0 and clamp the tail to [0, 1] (the M-0541 intent, plus a confidence above 1). A non-empty input with no finite return gives NaN, not 0."

requirements-completed: []  # TRUST-04 / TRUST-05 close with the surface plans that call these modules

duration: 1 session (3 task commits)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 03: figure-gate, list-figures, Scenario VaR/CVaR Summary

**One pure module now decides whether an annualised figure shows (total record: 90 days crypto, 60 observations otherwise; the window only adds the `<1y` note) and says why, a second gives every list the missing-sorts-last contract, and Scenario VaR/CVaR run on the same historical helper as the producer and the factsheet.**

## Accomplishments

- Tracer (task 1): `figure-gate.ts` with `MIN_ANNUALIZATION_DAYS = 90`, `MIN_ANNUALIZATION_OBS = 60`, `ONE_YEAR_DAYS = 365`, `FIGURE_DEFS_VERSION = 2`, the verdict, and the revised UI-SPEC copy verbatim. `comparator-block.ts` imports `MIN_ANNUALIZATION_DAYS` and `spanDays` and `COMPARATOR_ANNUALIZATION_FLOOR_DAYS` re-exports the one 90. A vitest reads `metrics.py` as text and pins the three constants (each defined exactly once, equal to the TS value).
- 32 gate tests: crypto 0/89 withheld, 90/364 short, 365 full, null span null; non-crypto 59 withheld, 60 short (60 observations over 84 days included), 300 over 420 full, 1 withheld; the interim fallback (89 withheld, 90 short); the blend vectors (one crypto leg 70 over 70 days withheld, two traditional legs short, unknown-class leg 70 over 69 days withheld, the same vector as plan 13's `blend_gate_crypto`); the window under a cleared record (20 days short, 365 full, null null, under a withheld record any window withheld); chain-broken 61-day span; the D-05 cumulative 1.2e13 case; copy plurals and thousands separators.
- `list-figures.ts` (task 2): 13 tests, including the range-contains-0 and descending-sort cases, a stable two-missing order in both directions, an inactive filter matching a null, unparsable bound text, and the D-05 13-digit case.
- Scenario (task 3): `computeVaR` and `computeExpectedShortfall` call `historicalVarCvar`; the inclusive tail filter is gone. The golden Scenario CVaR moved from -0.070 to -0.080 (hand derivation below).

## RED proofs (neuter, byte backup, restore)

Task 1 (`figure-gate.ts`, backup `cp -p`, restored and `cmp` clean after each, 32 passed after):
1. `>=` to `>` at the 90-day boundary: `AssertionError: expected 'withheld' to be 'short'` in `crypto record (calendar-day bound, D-15) > a 90-day record is short` (the interim fallback case also RED).
2. `recordClears` ignores observations (span for every non-crypto record): `AssertionError: expected 'withheld' to be 'short'` in `non-crypto record (observation bound, D-15) > 60 observations spanning 84 days are short: the bound is observations, not days` (the two-traditional-legs blend also RED).
3. `windowSpanDays` dropped from the window rule: `AssertionError: expected 'full' to be 'short'` in `the window qualifies a cleared record and never withholds it (D-15) > a 20-day selected range inside a cleared record is short, never withheld` (the 365/364 case also RED).

Task 2 (`list-figures.ts`): a missing value turned into 0 in both `rangeMatches` and `compareWithMissingLast` gave `6 failed`, including `ascending: finite ascending, then the two missing rows in input order` (`expected [ 'b', 'd', 'c', 'e', 'a' ]`), `a missing value never matches an active bound, including a range that contains 0` (`expected true to be false`) and the negative-value sort; restored, 13 passed.

Task 3 (`portfolio-stats.ts`): CVaR put back to the inclusive tail filter gave `2 failed` (`ES ... EXCLUDES the VaR element` and the Scenario golden CVaR); restored, green.

## Scenario golden CVaR: hand derivation

The 20-value series, sorted ascending: `[-0.080, -0.060, -0.045, ...]`. n = 20, confidence 0.95, tail = 1 - 0.95 = 0.05000000000000004, k = floor(tail x 20) = floor(1.0000000000000009) = 1. VaR = sorted[1] = -0.060 (unchanged). CVaR = mean of the max(1, 1) = 1 smallest = sorted[0] = -0.080. The old value, -0.070, was mean([-0.080, -0.060]) because the inclusive tail contained the VaR element.

`portfolio-stats.test.ts`: the old "ES is the mean of the tail (returns <= VaR)" test asserted the retired inclusive definition and was replaced. New hand-derived cases: n = 40 with sorted `[-0.10, -0.06, -0.03, 0.01 x 37]`, k = floor(0.05 x 40) = 2, VaR = sorted[2] = -0.03, CVaR = (-0.10 + -0.06) / 2 = -0.08 (the old rule would give -0.0633...); n = 5 at 0.95, k = 0, CVaR = VaR = sorted[0] = -0.05; confidence 0 (k = 5, CVaR = mean of all five = 0.01); confidence 1.5 clamps to the worst return.

## Gates

- `npx vitest run src/lib/figure-gate.test.ts src/lib/factsheet/comparator-block`: 6 files, 74 passed. `src/lib/list-figures.test.ts`: 13 passed.
- Task 3 verify set (`portfolio-stats`, `scenario-stress`, `RiskTabPanel.book-series`, `widgets/risk`): 13 files, 134 passed.
- `npx vitest run src/lib`: 7222 passed, 26 skipped, 2 failed: the known `compute.conventions.test.ts` fixtures B and C (`skew`, 17th digit), in `deferred-items.md`.
- `npm run typecheck`: clean. `npm run lint`: 0 errors after the edit below.

## Deviations from Plan

**1. [Rule 3 - Blocking] `npm run lint` red on plan 02's SUMMARY.** `check-planning-hygiene` (LOCAL-USERNAME) flagged an absolute home path at `194-02-SUMMARY.md:109` (deviation 1 named the `node_modules` symlink target). Replaced the path with "the main checkout's `node_modules`"; nothing else in that file changed. Committed with this plan's docs commit.

**2. No Co-Authored-By trailer.** The first task commit carried the system attribution trailer; the hard rule and the project memory forbid it, so the commit was amended before anything else was built on it (hash `25bb74096` is the amended one).

**3. `computeVaR` all-non-finite input returns NaN.** The plan said to keep the empty-input return. For a non-empty input with no finite return the helper reports null, and returning 0 would be a substitute number (SC-5), so the function returns NaN (what the old sort-based code propagated). Scenario's own finite-check upstream means it never reaches this.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files exist (`figure-gate.ts`, `figure-gate.test.ts`, `list-figures.ts`, `list-figures.test.ts`); commits `25bb74096`, `55a38dad2`, `bab4485a7` are ancestors of HEAD.
