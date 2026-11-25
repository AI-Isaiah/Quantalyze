---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 10
subsystem: factsheet-engine
tags: [annualization, cagr, calendar-clock, moved-pins, factsheet]
requires: [236-02]
provides:
  - "compute() years = max(1, wholeCalendarDays(first, last)) / CALENDAR_DAYS_PER_YEAR (F-5, Q1)"
  - "every factsheet pin reached by that expression moved with an independent oracle"
affects: [236-05, 236-11]
key-files:
  modified:
    - src/lib/factsheet/compute.ts
    - src/lib/factsheet/compute.metrics.test.ts
    - src/lib/factsheet/compute.conventions.test.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/lib/factsheet/allocator-portfolio-payload.test.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/lib/factsheet/record-length.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts
    - src/__tests__/annualization-census.test.ts
decisions:
  - "compute.ts stays on NOT_YET_MIGRATED: its must_use list still names SD_DDOF, which plan 236-05 wires with the ddof move"
  - "the build-payload byte snapshot and compute.conventions frozen fixtures moved here (outside the plan's file list) because they pin years, cagr and calmar; the plan's task 2 allows it and asks for a SUMMARY line"
metrics:
  completed: 2026-11-25
status: complete
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: e0a02ead851e06c27340e0c97b5554fdb9e6f6e0
plan_head_after: 6fdd4771fe8a2dd28574811eff13e7f885f7d1a8
---

# Phase 236 Plan 10: factsheet compute() on whole days over 365 Summary

The factsheet engine's CAGR and Calmar now ride the same span rule as Scenario, the OG card and the stored engine: first to last observed date, whole days (floor), over 365, with the one-day floor kept (`Math.max(1, ...)`, Python's `max(.., 1)`).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 833aa96d7 | `compute()` year expression, the span tests, frozen fixtures A/B/C, the build-payload byte snapshot, census count |
| 2 | 6fdd4771f | allocator payload year pin, `record-length.ts` docstring, stale comments in the Scenario factsheet payload and its test |

RED at HEAD before the engine edit (Task 1): `compute.metrics` 165-day case (`expected 0.4517453798767967 to be close to 0.4520547945205479`), the new one-observation case, the 1461-day BLEED GATE (`expected 0.00273972602739736 to be less than 1e-12`), the MetricsColumn 438-day record (`expected 1.1991786447638604 to be close to 1.2`). All GREEN after. Task 2 allocator pin: it did not exist at HEAD as a numeric year pin (only a CAGR-invariance pin and a comment), so the new year and CAGR assertions were proven by neutering `compute()` (below): RED `expected 0.15879534565366188 to be close to 0.1589041095890411`.

## Moved pins: old -> new -> why

Each new expected is an inline oracle importing no production helper.

| Pin | Old | New | Why (independent derivation) |
|---|---|---|---|
| `compute.metrics` 166 consecutive dates, `years` | 165 / 365.25 | 165 / 365 | 166 consecutive dates span 165 whole days |
| `compute.metrics` one-observation floor (new case) | n/a | 1 / 365 | `Math.max(1, ...)` over the 365-day year |
| `fetch-and-build-payload` BLEED GATE `years` (new assert) and `cagr` | years 1461/365.25 (= 4 exactly), cagr 0.1 | years 1461/365 = 4.0027, cagr `1.4641^(365/1461) - 1` | USD series spans 1461 whole days; cumulative return 0.4641 = 1.1^4 is unchanged, so only the exponent moves; comment rewritten, "4 EXACTLY" gone |
| `MetricsColumn.record-length` 438-day record | 438 / 365.25 = 1.1992 (comment), `toFixed(2)` = "1.20" | years = 438 / 365 = 1.2000 exactly (new `toBeCloseTo(.., 12)`; the `toFixed(2)` text stays "1.20") | evenly spread over 438 whole days |
| `allocator-portfolio-payload` (new year pin) | none (CAGR-invariance only) | years 58/365; cagr `compounded^(365/58) - 1` | 59 derived returns, 2025-01-02 to 2025-03-01 = 58 whole days; compounded product computed from the returns inline |
| `compute.conventions` frozen A `years` / `cagr` / `calmar` | 0.07939767282683094 / 0.5234445469627809 / 20.27835940200425 | 0.07945205479452055 / 0.5230056434477635 / 20.261356181181778 | 2024-01-01..2024-01-30 = 29 days; `(1 + cum_ret)^(365/29) - 1` from the snapshot's frozen `cum_ret` 0.0339892190644242; `cagr / abs(max_dd)` with frozen `max_dd` -0.025812963296776625. Oracle equals the engine to the last digit |
| `compute.conventions` frozen B | 0.07939767282683094 / 0.32505419329474794 / 14.857582645243307 | 0.07945205479452055 / 0.32479895370976886 / 14.845916149913016 | 29 days; frozen `cum_ret` 0.022598300507845392, `max_dd` -0.02187800001225737; oracle equals engine exactly |
| `compute.conventions` frozen C | 0.09582477754962354 / 0.29428276694257405 / 11.400580536188231 | 0.0958904109589041 / 0.29405426630540665 / 11.391728370145135 | 30 dates with six skipped days end at offset 35 = 2024-02-05, so 35 days; frozen `cum_ret` 0.025026681312998678, `max_dd` -0.025812963296776736; oracle equals engine exactly |
| `__snapshots__/build-payload.test.ts.snap` (3 snapshots, 12-sig-fig strings) | strategyMetrics.years 0.167008898015; comparator btc cagr 2.54804480576, spx 0.347034925773; styleDrift h1 years 0.082135523614 cagr 1.46742714369, h2 cagr -0.778734335177 (+ calmars) | years 0.167123287671; btc cagr 2.54497068844, spx 0.346760286046; h1 years 0.0821917808219 cagr 1.46590227565, h2 cagr -0.778505774239 (+ calmars); api and csv arms also move strategyMetrics.cagr -0.257436458902 -> -0.25728516239 | Regenerated with `-u` into a scratch copy, then EVERY differing path was checked by a script that imports nothing from the repo: only `years`, `cagr`, `calmar` differ; old years x 365.25 is the whole-day count D (61 and 30) and new years is D/365; `ln(1+cagr_new) = ln(1+cagr_old) x 365/365.25` (cumulative return unchanged); calmar ratio equals cagr ratio. `bad: 0` across all 15 groups. The composite arithmetic arm moves `years` only (arithmetic CAGR has no year term) |
| Census `compute.ts` counts | `{ t365_25: 1, ddof0: 1, disp0: 2 }` | `{ ddof0: 1, disp0: 2 }` | the literal is gone; it stays on NOT_YET_MIGRATED because `SD_DDOF` is not referenced until 236-05 |

Pins outside the plan's listed files (listed as the plan asks): `compute.conventions.test.ts` (frozen fixtures A/B/C, a reviewed one-time exception noted in its header, edited by hand and never with `-u`), `__snapshots__/build-payload.test.ts.snap`, and comment-only rewords in `scenario-factsheet-payload.ts` and its test (they stated the retired year length about `compute()`).

## compute.conventions B/C last-ulp skew (deferred-items.md)

Measured under both Node builds. Node 22.22.1 (the `.nvmrc` Node CI runs): all 23 `compute.conventions` tests pass after the move, so the B/C skew failure is a Node 25 effect and does not reproduce on CI. Node 25.8.1: B and C still fail ONLY on `skew` (`-0.11360716852722537` vs `...538`; `0.036844507138639` vs `0.036844507138638946`), identical to HEAD before this plan. This plan's change does not affect it: with a Node 22 run before re-pinning, only `years`, `cagr`, `calmar` differed in all three fixtures, and no skew line. Not re-pinned for skew.

## PROOF-01 (byte backup in the scratchpad, restored with cp, verified with cmp)

(a) Neuter in `src/lib/factsheet/compute.ts`, `years` back on the old divisor (the old literal 365.25 and the fractional day count):
`const years = days / CALENDAR_DAYS_PER_YEAR;` -> `const years = days / 365.25 + 0 * CALENDAR_DAYS_PER_YEAR + ...` with `days = Math.max(1, (end - start) / 86_400_000)`.
- `npx vitest run src/lib/factsheet/compute.metrics.test.ts` RED, the span case first: `× a 0.45-year record (166 days) shows MTD and 3M, and nulls YTD, 6M, 1Y, 3Y and 5Y` / `AssertionError: expected 0.4517453798767967 to be close to 0.4520547945205479, received difference is 0.00030941464375122685, but expected 5e-13`; also `× a one-observation series keeps the one-day floor: years = 1 / 365 (Python's max(days, 1))` / `expected 0.0027378507871321013 to be close to 0.0027397260273972603`; `Tests  2 failed | 31 passed (33)`.
- `cp` restore, `cmp OK (a)`.

(b) Neuter in the same function: `const years = days / CALENDAR_DAYS_PER_YEAR;` -> `const years = days / 366 + 0 * CALENDAR_DAYS_PER_YEAR;`
- Same file RED, same span case first: `× a 0.45-year record (166 days) ...` / `AssertionError: expected 0.45081967213114754 to be close to 0.4520547945205479, received difference is 0.0012351223894003782, but expected 5e-13`; also the one-observation case `expected 0.00273224043715847 to be close to 0.0027397260273972603`; `Tests  2 failed | 31 passed (33)`.
- `cp` restore, `cmp OK (b)`, then GREEN: `Tests  33 passed (33)`.

(T2) The allocator year pin, neutered with the old divisor: `× BLEND-02: risk metrics ride the √365 crypto basis; CAGR byte-identical (calendar clock)` / `AssertionError: expected 0.15879534565366188 to be close to 0.1589041095890411, received difference is 0.00010876393537923024, but expected 5e-13` / `Tests  1 failed | 49 passed (50)`; `cp` restore, `cmp OK (T2 neuter)`, GREEN `Tests  50 passed (50)`.

## Verification

- `grep -a -c "365.25" src/lib/factsheet/compute.ts` = 0 (HEAD 2); `grep -a -c "365.25" src/lib/factsheet/record-length.ts` = 0 (HEAD 1).
- `npx tsc --noEmit -p tsconfig.json`: clean.
- Node 22, `npx vitest run src/lib/factsheet "src/app/factsheet/[id]/v2" "src/app/(dashboard)/allocations/widgets/performance" src/__tests__/annualization-census.test.ts`: 3798 passed, 6 failed, all in three jsdom files (`FactsheetBody.advanced`, `FactsheetView.kpistrip`, `FactsheetView.window-kpis`) as `Test timed out in 5000ms` while tsc and the suite ran together; re-run alone, `Tests  104 passed (104)`. The same directories passed in the earlier Node 25 run.
- Node 25 `npx vitest run src/lib "src/app/factsheet/[id]/v2" ...`: 10296 passed; the only failures were the pre-existing `compute.conventions` B/C skew (and, before moving them, the pins listed above).

## Deviations from Plan

**1. [Rule 3 - Blocking] Pins outside the listed files moved.** `compute.conventions.test.ts` fixtures A/B/C and the `build-payload` byte snapshot reached `compute()`'s year expression and went RED; the plan's Task 2 says they move here with old -> new -> why and a SUMMARY line. Done above.

**2. [Rule 1 - stale comment] Comment-only edits in `scenario-factsheet-payload.ts` and its test.** Plan 236-02 left them because they describe `compute()`; they became false with this change.

**3. Allocator pin premise.** The plan says the allocator-portfolio-payload year pin is RED at HEAD; there was no numeric year pin there. A year and CAGR assertion was added (inline oracle) and shown RED by the PROOF-01 (T2) neuter.

**4. Behavior note (not a regression).** For an unparseable first or last date, `wholeCalendarDays` returns 0, so `days` is 1; the old expression made `days` NaN and `years` NaN. `cagr` was 0 in the NaN case, and it is now the one-day annualization. No caller or test reaches that path, and the plan fixes this form.

## Known Stubs

None.

## Self-Check: PASSED

Files and commits verified below.
