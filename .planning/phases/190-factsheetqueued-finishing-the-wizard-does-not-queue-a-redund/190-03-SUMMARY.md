---
phase: 190-factsheetqueued
plan: 03
subsystem: factsheet
tags: [factsheet, stale-analytics, recompute, stored-result, snapshot, d-04, evidence-rule]

requires:
  - phase: 190-01
    provides: the MARKER, A2 and SNAPSHOT verdicts (all HOLDS) this plan rests on
provides:
  - stored-analytics-result.ts, a dependency-free evidence module (storedEntryCount moved, hasStoredAnalyticsResult, effectiveDataQualityFlags, usesLastSuccessSnapshot, isSameInstant, hasUnboundDerivePrestamp, LAST_SUCCESS_SNAPSHOT_KEY)
  - isRecomputeOverStoredResult in closed-sets.ts (display predicate; isComputedAnalytics and isRankableAnalyticsRow unchanged)
  - the resolve stage (G1) admits a pending or computing row over a stored success result on every factsheet lane
  - FactsheetCommon.analyticsUpdating as a required boolean (false on terminal success)
  - the D-04 withhold for a terminal-success row whose derive prestamp left no bound snapshot
affects: [190-04, 190-05, 190-06, 190-07, 190-09]

tech-stack:
  added: []
  patterns:
    - "the evidence rule and the snapshot binding live in one isomorphic module, row state only, with no lane input"
    - "a prestamp is detected positively by its last_success_snapshot key, never by a missing marker"

key-files:
  created:
    - src/lib/stored-analytics-result.ts
    - src/lib/stored-analytics-result.test.ts
  modified:
    - src/lib/closed-sets.ts
    - src/lib/closed-sets.test.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
    - src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx

key-decisions:
  - "Check (c), success-written flags carrying cumulative_method, is the third evidence check, read through the effective flags (live flags, else a snapshot bound to the row's computed_at)."
  - "D-04: a terminal-success row with a derive prestamp (snapshot key present, marker absent) and no bound snapshot is withheld as not_computed with no analyticsFailed; a legacy row at rest is untouched."
  - "The three whole-payload snapshot pins were updated in Task 1's commit instead of Task 2's, so no commit leaves a red test."

requirements-completed: [SC-3, SC-4, SC-6]

actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: ae62935d13ef102646cc715251a24e45d97dd759
plan_head_after: 4a4cac5ea44ef535a5676107346bf061f82a86af

duration: ~35min
completed: 2026-11-03
status: complete
---

# Phase 190 Plan 03: Stored-result admission for the factsheet Summary

**A pending or computing strategy that stores a success result (series, finite headline, success-written flags) now builds its factsheet from the stored values with `analyticsUpdating: true` and its last-good `computedAt` on every lane, including across the derive hop's prestamp via a `computed_at`-bound `last_success_snapshot`; a first-ever compute, a failed row, and a terminal-success row left with an unbound derive prestamp (D-04) stay on today's queued state.**

## What changed

- **`src/lib/stored-analytics-result.ts` (new, no imports).** `storedEntryCount` moved verbatim out of `fetch-and-build-payload.ts`. `effectiveDataQualityFlags` returns the live flags when they carry a top-level string `cumulative_method`, else the flags inside `last_success_snapshot` when that snapshot is a well-formed non-null object, its `computed_at` is the same instant as the row's (`isSameInstant`, compared as instants so Postgres and JS spellings match) and its flags carry the marker, else the live flags. `hasStoredAnalyticsResult` needs all three checks. `hasUnboundDerivePrestamp` is the D-04 state.
- **`closed-sets.ts`.** `isRecomputeOverStoredResult` added next to `isComputedAnalytics`. The diff against the plan base is additions only; `isComputedAnalytics` and `isRankableAnalyticsRow` bodies are byte-unchanged.
- **`fetch-and-build-payload.ts` (resolve stage).** G1 withholds only `!isComputedAnalytics(status) && !analyticsUpdating`. `dqf` is now the effective flags, so every flag the build reads comes from the success whose numbers are stored. The D-04 withhold follows G1. The ok result and `strategyArg` carry `analyticsUpdating` (the USD-view build inherits it). The STALE-01 comment was rewritten to the phase 190 rule.
- **`types.ts` / `build-payload.ts`.** `FactsheetCommon.analyticsUpdating: boolean` (required); `FactsheetStrategyInput.analyticsUpdating?` optional, defaulting to false. `scenario-factsheet-payload.ts` sets it false (the only literal outside the builder that `tsc` named).

## Verification

- Final run of the plan's seven-file verify: **7 files, 299 tests passed, 0 failed, 0 skipped** (`stored-analytics-result.test.ts`, `closed-sets.test.ts`, `page.stale-analytics.test.tsx`, `page.owner-compute-state.test.tsx`, `build-payload.test.ts`, `fetch-and-build-payload.test.ts`, `complete-status-scan.test.ts`). `page.owner-compute-state.test.tsx` passes unchanged, so the KCS-09 owner lines still render.
- `npm run typecheck`: clean. `npm run lint`: 0 errors; 2 warnings, both pre-existing in files this plan did not touch (`MetricsColumn.tsx` `nativeUnitReason`, `composite-read-path.ts` `isRankableAnalyticsRow`).
- Snapshot: the three whole-payload pins changed by exactly the key `"analyticsUpdating":false,` and nothing else. Checked against the plan base (`ae62935d1`): removing that key from the new file reproduces the base file exactly, and the key appears 3 times. (The plan's verify one-liner diffs against `HEAD`, which only works before the snapshot is committed; it was committed in Task 1, so the check was run against the base commit instead.)
- All acceptance greps hold: `isRecomputeOverStoredResult` 1, `analyticsUpdating: boolean` 1, `function storedEntryCount` in fetch-and-build-payload 0 and `export function storedEntryCount` in the new module 1, `effectiveDataQualityFlags(` 1, `hasUnboundDerivePrestamp(` 1, `190 D-04` 2, `LAST_SUCCESS_SNAPSHOT_KEY = "last_success_snapshot"` 1.

## Tracer gate

Task 1 is `type="tracer"`. Auto mode is active (`auto_advance` true). After the commit the page test was re-run end to end (7 of 7 passed): "Tracer verified end-to-end — expanding".

## RED / GREEN record

- **Task 1 RED:** the re-cut V3 and the new V3b failed on today's code (`expected null not to be null`). GREEN: both pass, and V1, V2, V2b, V4, V5 are unchanged.
- **Task 3 RED, before the GREEN step:** the seven `hasUnboundDerivePrestamp` unit cases failed (`not a function`), and D04-1, D04-2 and D04-3 failed (`expected { ... } to be null`, because those rows build today). **D04-4, D04-5 and D04-6 were green before and after the GREEN step**, so they pin the at-rest guarantee, not the new code.

## Can-fail proofs (byte backups in the scratchpad, restored with `cp`, `cmp` silent each time; no git checkout, restore or stash)

| proof | mutation | RED lines | cmp |
|---|---|---|---|
| (a) | G1 withholds every non-terminal row again | `× V3 ...`, `× V3b ...` (2 failed) | silent |
| (b) | the evidence check returns true unconditionally | `× SC-6: a computing row whose flags are csv_source only and carry no snapshot stays withheld`, `× SC-6: a snapshot bound to a different success ... is never used` (2 failed) | silent |
| (c) | `isSameInstant` returns true | `× SC-6: a snapshot bound to a different success than the row's computed_at is never used` (1 failed) | silent |
| (d) | `effectiveDataQualityFlags` ignores the snapshot | `× V3b ...` (1 failed) | silent |
| (e) | `hasUnboundDerivePrestamp` returns false | `× D04-1`, `× D04-2`, `× D04-3` (3 failed) | silent |
| (f) | condition (iii), the key presence, dropped | `× D04-5` plus V4 and V5 (3 failed): the legacy row at rest would be hidden | silent |
| (g) | the new withhold deleted from the resolve stage | `× D04-1`, `× D04-2`, `× D04-3` (3 failed) | silent |

After each restore the page file was re-run green (12 of 12 after (a) to (d), 18 of 18 after (e) to (g)).

## Deviations from Plan

**1. [Rule 3 - Blocking] The snapshot update and the `scenario-factsheet-payload.ts` literal were done in Task 1's commit, not Task 2's.**
- **Found during:** Task 1 (`npm run typecheck` named the scenario payload literal as soon as `analyticsUpdating` became required, and three whole-payload pins failed).
- **Fix:** added `analyticsUpdating: false,` to the scenario literal and ran `build-payload.test.ts -u`, then proved the update added that key and nothing else. This keeps every commit compiling and green. The files are the ones the plan names for Task 2; only the commit they land in moved.
- **Commit:** `a11239949`.

Otherwise the plan was executed as written. Choice the plan left open: V3b's "one payload field showing the build read the snapshot's flags" is `payload.dataQuality.smallBaseMeasured` (`small_base_measured` exists only in the snapshot's flags in the fixture). It is a pure `dqf` read, so it needs no native-unit USD-view mocks.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change; `analyticsUpdating` is computed in the resolve stage from the analytics row alone (T-190-06), and the visibility predicates and cache key are untouched here (plan 05 bumps the key).

## Notes for downstream plans

- Plan 04 can read `payload.analyticsUpdating` and `payload.computedAt` as written.
- Plan 05 pins `LAST_SUCCESS_SNAPSHOT_KEY` against the Python twin and threads `recomputeOverStoredResult` into the inner gates; `usesLastSuccessSnapshot` is exported for it and plan 07.
- OQ-2 is as defaulted: `isComputedAnalytics` and `isRankableAnalyticsRow` are not widened, so percentile cohorts and progress consumers still see terminal success only.

## Commits

- `a11239949` feat(190-03): a pending or computing re-run over a stored success result keeps its factsheet
- `51b2944c4` test(190-03): pin SC-4 and SC-6, the evidence rule and the snapshot binding
- `4a4cac5ea` feat(190-03): D-04 a terminal-success row with an unbound derive prestamp falls back to the queued state

## Self-Check: PASSED

Created files exist (`src/lib/stored-analytics-result.ts`, `src/lib/stored-analytics-result.test.ts`), all three commits are ancestors of HEAD on `feat/190-p03`, and the final verify run was green.
