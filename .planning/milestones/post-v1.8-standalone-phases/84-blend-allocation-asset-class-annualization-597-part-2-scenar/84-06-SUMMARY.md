---
phase: 84-blend-allocation-asset-class-annualization
plan: 06
subsystem: analytics
tags: [cagr, annualization, scenario, calendar-clock, two-clocks, closed-sets, vitest]

# Dependency graph
requires:
  - phase: 84-blend-allocation-asset-class-annualization (#597)
    provides: closed-sets calendarYears / annualizationPeriods / blendPeriodsPerYear helpers
provides:
  - "computeScenario CAGR rides the CALENDAR clock (days/365.25 via calendarYears), asset-class/periodsPerYear-INVARIANT"
  - "computeCompositeCurve threaded with optional periodsPerYear = 252 — the last entry on the #597-part-2 locked computeScenario call-site list — proven annualization-INVARIANT"
affects: [scenario-composer blend KPIs, allocator reference panels, scenario-factsheet-payload, peer-rank cohort basis]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-clocks discipline in scenario.ts: RETURN/CAGR = calendar clock (days/365.25, basis-invariant); RISK (vol/sharpe/sortino) = frequency clock (√periodsPerYear)"
    - "Reviewed-edit protocol on a frozen-spine carve-out: RED gap-axis fixture first, deliberate re-derived (never blind-updated) value change per the [73-02] precedent"

key-files:
  created: []
  modified:
    - src/lib/scenario.ts
    - src/lib/scenario.test.ts

key-decisions:
  - "CAGR year-count derived from the ACTUAL return axis (calendarYears(Date.parse(commonDates[0]), Date.parse(commonDates[n-1]))) — mirrors compute.ts — NOT window bounds, so a window wider than member coverage cannot overstate the span"
  - "Gap-axis RED pin derives expected CAGR from the engine's OWN twr (not a naive recompute) and asserts at 4-dp — the engine rounds twr/cagr via toFixed(5), so isolating the CLOCK requires tolerance for that rounding while the calendar-vs-count divergence (~0.13 vs ~11) stays falsifiable"
  - "computeCompositeCurve gains the basis for call-site-contract uniformity only; the wealth curve consumes no annualized metric, so invariance is a deep-equal (toEqual) proof rather than an assumption"

patterns-established:
  - "252-vs-365 CAGR invariance pin (calendar clock is basis-free) alongside a sharpe/vol divergence pin (frequency clock) — the canonical two-clocks regression guard"
  - "Gap-robustness pin: identical returns/n but wider date span → different CAGR, identical sharpe/vol"

requirements-completed: [BLEND-03]

# Metrics
duration: 7min
completed: 2026-07-10
---

# Phase 84 Plan 06: Scenario CAGR calendar-clock conversion Summary

**computeScenario's CAGR converted from the count clock (n / periodsPerYear) to the calendar clock (days / 365.25 via closed-sets `calendarYears`) — asset-class/basis-INVARIANT and gap-robust — plus computeCompositeCurve threaded with the optional basis and pinned annualization-INVARIANT.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-09T23:56:47Z
- **Completed:** 2026-07-10T00:04:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- CAGR now rides the calendar clock: `years = calendarYears(Date.parse(commonDates[0]), Date.parse(commonDates[n-1]))`, so a sparse/gappy track no longer over-annualizes. The `years > 0 ? … : null` guard is preserved verbatim.
- Discharged the in-file `#597-blend FOLLOW-UP` warning block (scenario.ts:509-524) and replaced it with the two-clocks contract comment, citing compute.ts / metrics.py TWR-05 and the [73-02] re-derive-not-blind-update precedent.
- Three new CAGR pins: gap-axis calendar-vs-count divergence (the RED test), 252-vs-365 CAGR invariance (sharpe/vol still differ), and gap-robustness (same n / wider span → different cagr, identical sharpe/vol).
- `computeCompositeCurve` gains an optional trailing `periodsPerYear = 252` forwarded as the 4th arg of its internal `computeScenario` call — completing the #597-part-2 locked call-site list — with a 365-vs-default deep-equal invariance pin.
- Every existing NON-CAGR pin remained byte-identical at the default 252 basis (test-file diff is 100% additive; 0 deletions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Calendar-span CAGR in computeScenario** — `ada9a316` (feat)
2. **Task 2: computeCompositeCurve pass-through + invariance pin** — `ede77bde` (feat)

_(Parallel executor 84-07 landed `d347b691` on this shared branch between the two commits — expected; it touched only its own csv-finalize route file.)_

_Note: Task 1 is a reviewed math edit; RED (gap-axis fixture asserting the calendar value) was written and confirmed failing against the count-based source, then source + all pins were committed together as one atomic feat._

## Files Created/Modified
- `src/lib/scenario.ts` — CAGR clock switched to `calendarYears` (import added); comment block rewritten to the two-clocks contract; `computeCompositeCurve` signature + internal call threaded with `periodsPerYear = 252`.
- `src/lib/scenario.test.ts` — added the CAGR calendar-clock describe block (gap-axis divergence, 252-vs-365 invariance, gap-robustness) and the computeCompositeCurve annualization-invariance deep-equal pin.

## Verification (real output)

**Baseline (before edit):** `46 passed`.

**RED confirmation (3 new pins vs count-based source):**
```
FAIL [gap-axis] … expected metrics.cagr ≈ 0.1329 (calendar), source produced ~11.27 (count)
FAIL [invariance] … AssertionError: expected 1.46242 to be 0.86295 (252 vs 365 cagr differed under count clock)
FAIL [gap-robustness] … expected 1.11432 to not be close to 1.11432 (identical under count clock)
Tests  3 failed | 46 skipped (49)
```

**GREEN (after edit):**
```
npx vitest run src/lib/scenario.test.ts --no-file-parallelism
Test Files  1 passed (1)
      Tests  50 passed (50)
```

**Typecheck:** `npx tsc --noEmit` → `TSC_EXIT=0`.
**Lint:** `npx eslint src/lib/scenario.ts src/lib/scenario.test.ts` → `ESLINT_EXIT=0`.

**Acceptance criteria (Task 1):**
- `grep -v '^\s*//' … | grep -c "n / periodsPerYear"` → `0` (count clock gone)
- `grep -c "calendarYears(Date.parse(commonDates\[0\])" …` → `1`
- test-file diff → `121 insertions(+), 0 deletions` (no non-CAGR expectation modified)

**Acceptance criteria (Task 2):**
- `computeCompositeCurve` signature carries `periodsPerYear = 252`; internal `computeScenario(` call forwards it as the 4th arg (verified).
- 365-vs-default deep-equal (`toEqual`) invariance pin present and passing.
- Only `src/lib/scenario.ts` + `src/lib/scenario.test.ts` changed by this plan (no caller edited).

## Decisions Made
- **Span from the series axis, not window bounds** — a window wider than member coverage would overstate the calendar span; deriving from `commonDates[0..n-1]` mirrors the shipped compute.ts convention.
- **Gap-axis pin derives expected CAGR from the engine's own (rounded) twr at 4-dp tolerance** — the engine rounds both twr and cagr via `toFixed(5)`, so an over-tight 10-dp expectation built from a naive `1.01^24` recompute tripped on a benign ~2.5e-6 rounding gap. Using the engine's own twr and 4-dp isolates the CLOCK while keeping the calendar-vs-count divergence (~0.13 vs ~11) firmly falsifiable.
- **Degenerate zero-span cagr-null path left as a preserved guard, not an independent test** — on the success path `n ≥ 10` distinct sorted dates guarantee `last > first`, so `calendarYears > 0` always; the `years > 0 ? … : null` guard is preserved verbatim and the null-cagr degenerate paths (no strategies / <10 days / NaN) remain covered by the existing pins.

## Deviations from Plan

None — plan executed exactly as written. The gap-axis RED test's expectation was refined (engine-own-twr, 4-dp) during the RED→GREEN loop to account for the engine's `toFixed(5)` rounding; this is test-fixture calibration within the planned Task 1 scope, not a source deviation. No source logic outside the CAGR clock and the `computeCompositeCurve` signature/call was touched.

## Known Stubs
None — pure in-process math edit; no placeholder values, empty data sources, or TODO markers introduced.

## Issues Encountered
- **Interleaved parallel commit:** executor 84-07 committed `d347b691` on this shared branch between my two commits, so `git diff HEAD~2 HEAD` initially appeared to omit Task 1's changes. Verified both my commits are intact on HEAD (`import { calendarYears }` at line 75; `calendarYears(Date.parse(commonDates[0]) …)` at line 528) and that 84-07's commit touched only its own route file. No cross-contamination; only `git add <file>` explicit staging was used throughout.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- `computeScenario`'s CAGR is now the honest calendar-span figure and basis-invariant, so the wave-2/3 blend call sites (ScenarioComposer, scenario-compare, share-resolve, queries.ts, allocator reference panels) can pass `blendPeriodsPerYear` for the RISK metrics without the CAGR drifting — the two clocks are independent.
- The locked computeScenario call-site list is complete (`computeCompositeCurve` was the last entry).

## Self-Check: PASSED
- FOUND: 84-06-SUMMARY.md
- FOUND: ada9a316 (Task 1 commit)
- FOUND: ede77bde (Task 2 commit)
- FOUND: `calendarYears` in src/lib/scenario.ts

---
*Phase: 84-blend-allocation-asset-class-annualization*
*Completed: 2026-07-10*
