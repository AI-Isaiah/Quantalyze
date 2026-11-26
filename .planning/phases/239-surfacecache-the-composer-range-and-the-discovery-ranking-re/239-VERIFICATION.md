---
phase: 239-surfacecache
verified: 2026-11-24T22:00:00Z
status: passed
score: 3/3 must-haves verified
verified_at_sha: d7460e53579e7b2c0e39969755f579a70369707c
drift_subjects:
  - src/app/factsheet/[id]/v2/range-dates.ts
  - src/app/factsheet/[id]/v2/factsheet-context.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/lib/dateday.ts
  - src/lib/queries.ts
  - src/components/strategy/StrategyTable.tsx
behavior_unverified: 0
overrides_applied: 0
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `70d75b85d`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `d7460e535` (#1332) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits (`git diff --name-only 70d75b85d d7460e535 -- <drift_subjects>` is empty), so the rebind changes nothing about what was verified.

# Phase 239: SURFACECACHE Verification Report

**Phase Goal:** The composer range and the Discovery ranking reflect the current truth. The composer holds its range as dates (a 12M preset ends on the latest day; a manual range keeps its dates when the series grows). Discovery ranks BTC-unit and USD returns together as pure performance, with no BTC price conversion (founder ruling 2026-11-24, which corrected the original CACHE-04 premise).
**Verified at:** 70d75b85d49fdd849e14d97f6d7b6a331706f8c5
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 (CACHE-02): a 12M composer preset ends on the latest day, and the selected dates stay the same when the series grows at the front; a test grows the series | VERIFIED | `factsheet-context.tsx` `userRange` is `StoredRange \| null` (dates for a manual range, `{kind:"preset", months}` for a preset). `useXRange` resolves it on every render through `resolveStoredRange` against `basisAxisDates(payload, basis)`. A preset resolves to `[lowerBound(axis, subtractMonths(latest, N)), last]`, so it ends on the latest index. A manual range resolves start to the first index on or after the start date and end to the last index on or before the end date. `ScenarioFactsheetChart.tsx` `PeriodControl` calls `setPresetRange(PERIOD_MONTHS[period])`, and `PERIOD_TRADING_DAYS` is gone. Tests that grow the series: `factsheet-context.provider.test.tsx` ("keeps its DATES when the series grows at the FRONT", "12M preset still ends on the latest day after front growth", "12M preset rolls to the new latest day on back growth"), `ScenarioFactsheetChart.period-presets.test.tsx`, `basis-context.active-axis.test.tsx` (MTM axis front growth). All pass. |
| 2 | SC-2 (CACHE-04, as corrected 2026-11-24): BTC-unit and USD returns are ranked together as pure performance, with no BTC price conversion at list build; a pin test is added only if it encodes that | VERIFIED | The ruling is that today's behaviour is correct, so the phase correctly makes no production change to `queries.ts` or `StrategyTable.tsx` (the diff has no edit to either). `queries.native-unit-ranking.test.ts` pins that `shapeRowAnalytics` leaves a native row's `cagr` and `cumulative_return` unconverted, that `getPercentiles` scores a BTC row in the same six-row population as the USD rows (usd-5 gets 83, which a USD-only cohort would turn into 100), and that `getOwnRowPercentiles` scores an own BTC row against all published rows (43). `StrategyTable.native-unit-ranking.test.tsx` pins raw-CAGR order, the `#n` ordinals and the "in BTC" chip. The `convertNativeReturnsToUsd` sites in `queries.ts` belong to the own-capital MTD and allocation dashboard paths, not the Discovery list or percentile build. |
| 3 | SC-3 (PROOF-01): each gate goes RED on pre-fix code or a neutered copy with its named arm first, is restored from a byte backup (`cp`, `cmp`) and goes GREEN, recorded verbatim in the SUMMARYs | VERIFIED | `239-01-SUMMARY.md` records a RED on pre-fix code for the front-growth arm, then 9 byte-backup neuters (`strict`, `roundtrip`, `bridge`, `drift`, `fallback`, `startlookup`, `widening`, `reffallback`, `inverted`), each with `cmp exit: 0` and GREEN. `239-03-SUMMARY.md` records four neuters (`q-convert`, `q-partition`, `t-sort`, `t-chip`), each RED with the named arm, `cmp exit: 0`, then GREEN. `239-02-SUMMARY.md` records the preset arms. `239-REVIEW.md` records the PROOF-01 for the review fixes WR-01, SFH-M2 and WR-02. I re-ran neuters in a scratch copy (see Behavioral Spot-Checks) and the gates bit as recorded. |

**Score:** 3/3 truths verified (0 present, behavior-unverified). Truth 1 is behavior-dependent, and a passing behavioral test (front and back growth) backs it, so it is VERIFIED rather than PRESENT_BEHAVIOR_UNVERIFIED.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/factsheet/[id]/v2/range-dates.ts` | pure resolver: `StoredRange`, `resolveStoredRange`, `basisAxisDates`, bounds | VERIFIED | 107 lines, substantive, imported by `factsheet-context.tsx` and its test. |
| `src/lib/dateday.ts` `subtractMonths` | calendar-month subtraction with month-end clamp | VERIFIED | Clamps 31 Mar minus 1 month to the last day of February, returns null for an invalid day or a negative or non-integer month count. Called by `resolveStoredRange`. |
| `src/app/factsheet/[id]/v2/factsheet-context.tsx` | date store, `useXRange` resolver, `setPresetRange`, `ActiveBasisContext` | VERIFIED | The three-term clamp and `MIN_VISIBLE_SAMPLES` widening are kept inside `setXRange`. |
| `src/app/factsheet/[id]/v2/basis-context.tsx` | `ActiveBasisContext.Provider` bridge, `resolveRangeScope` full-history rule | VERIFIED | `BasisProvider` publishes the basis, so `useXRange` resolves on the axis the consumer indexes. |
| `ScenarioFactsheetChart.tsx` | presets as calendar months via `setPresetRange` | VERIFIED | `PERIOD_MONTHS` 3, 6, 12. |
| Phase tests (9 files) | gates for SC-1 and SC-2 | VERIFIED | See spot-checks. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `BasisProvider` | `useXRange` | `ActiveBasisContext` | WIRED | The `bridge` neuter in `239-01-SUMMARY.md` turns two `MasterBrush.basis` widened-clamp arms RED. |
| `PeriodControl` | `FactsheetProvider` | `setPresetRange` | WIRED | The period-presets test clicks 12M and reads the resolved range. |
| `useXRange` | `range-dates.ts` | `resolveStoredRange`, `basisAxisDates` | WIRED | The `basisAxisDates` value-equality test against `useBasisSeriesView` pins them together. |
| `resolveRangeScope` | `useXRange` fallback | `s === 0 && e >= last` | WIRED | WR-02 fix. The 169.x D-27, W3 and T-169-44 pins still pass per `239-REVIEW.md` round 3. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `useXRange` | `xRange` | stored dates resolved against `payload` / `seriesByBasis` dates | Yes: the real payload axis, no static fallback beyond the documented full range | FLOWING |
| `PeriodControl` | preset months | click handler to `setStored({kind:"preset"})` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| The 9 phase test files | `npx vitest run` on the nine named files | 9 files, 108 tests passed | PASS |
| Preset neuter: 12M resolves to 252 trading days (scratch copy, byte backup, `cmp`) | neuter `resolveStoredRange` preset branch | RED on 10 tests: provider ("12M preset still ends on the latest day after front growth"), `range-dates.test.ts`, period-presets ("12M is the last 12 calendar months ending on the latest day"); `cmp` 0; GREEN, 52 of 52 | PASS |
| Manual-start neuter: `setXRange` stores `axis[0]` as the start | neuter `factsheet-context.tsx` | RED on 7 tests incl. "keeps its DATES when the series grows at the FRONT" and the MTM front-growth arm; `cmp` 0; GREEN | PASS |
| CACHE-04 separate-group neuter: `getPercentiles` scores BTC and USD in separate cohorts | neuter `queries.ts` | RED on "a BTC row is scored in the same population as the USD rows" (`expected 100 to be 83`); `cmp` 0; GREEN, 3 of 3 | PASS |

The neuters ran in a scratch copy of the worktree at the verified sha, not in the verified checkout. Each was restored from a byte backup and checked with `cmp`.

Broader regression run, `npx vitest run src/app/factsheet "src/app/(dashboard)/allocations/widgets/performance"`: 162 files, 2296 of 2298 tests passed. The two failures were `FactsheetBody.advanced.test.tsx` ("writes 'open' and 'closed' under the registered factsheet-collapse: key on a toggle", `expected undefined to be 'open'`) and `basis-context.window-arithmetic.test.tsx` (one test, 5000 ms timeout). Re-run alone in the same checkout, both files pass (2 files, 36 tests). Both are load-sensitive under the parallel run (the review's round 3 recorded the same class of 5000 ms timeouts under load). Neither file is touched by the phase diff, and the failures did not reproduce in isolation, so they are recorded here and not treated as gaps. This is the one residual uncertainty: I did not run those two files against `origin/main` under the same load to prove they flake there too.

### Probe Execution

Step 7c: SKIPPED. The phase declares no probes.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CACHE-02 | 239-01, 239-02 | Composer range as dates; a 12M preset ends on the latest day; the dates are kept when the series grows at the front | SATISFIED | Truth 1 |
| CACHE-04 | 239-03 | Discovery ranks BTC-unit and USD together as pure performance (corrected 2026-11-24, CORRECTED note already present in `REQUIREMENTS.md`, not re-added) | SATISFIED | Truth 2 |

No orphaned requirements: `REQUIREMENTS.md` maps only CACHE-02 and CACHE-04 to Phase 239. The `[ ]` boxes and the `Pending` traceability rows in `REQUIREMENTS.md` stay for the ship and closeout step. The ship PR is also where the `201.1-COMPOSER-RANGE-AS-DATES` and `164.6.6.2.1-DISCOVERY-RANKING-HONESTY` TODOS entries are deleted and named in the CHANGELOG (`239-CONTEXT.md`).

### Anti-Patterns Found

None. The phase diff has no TBD, FIXME or XXX marker. The review rounds found no MEDIUM or higher survivor after the fixes: WR-01 (percentile pin could not fail for a per-unit cohort) fixed in `fa6f2c24a`, SFH-M2 (cash-sized fallback on a longer axis) fixed in `ad0b7f599`, WR-02 (a range short of the view's end read as full history) fixed in `70d75b85d`. SFH-M1 was dismissed as pre-existing. Round 3 is clean. LOW and INFO items (IN-01 to IN-15) are recorded in `239-REVIEW.md` only, per the repo rule.

### Human Verification Required

None. `239-UI-SPEC.md` states the phase makes no visual change, and the behavior is exercised by jsdom tests.

### Gaps Summary

No gaps. Both requirements are implemented in the code, the gates are shown able to fail by recorded and independently re-run neuters, and the CACHE-04 outcome matches the founder's corrected ruling (no production change, pin tests only).

---

_Verified: 2026-11-24T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
