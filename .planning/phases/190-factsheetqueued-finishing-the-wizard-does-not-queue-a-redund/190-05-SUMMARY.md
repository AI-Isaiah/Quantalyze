---
phase: 190-factsheetqueued
plan: 05
subsystem: factsheet
tags: [factsheet, inner-gates, recompute, stored-result, cache-key, snapshot, SC-3, SC-4, SC-6]

requires:
  - phase: 190-03
    provides: analyticsUpdating in the resolve stage, effectiveDataQualityFlags, the D-04 withhold, LAST_SUCCESS_SNAPSHOT_KEY (TypeScript)
  - phase: 190-09
    provides: LAST_SUCCESS_SNAPSHOT_KEY and the last_success_snapshot prestamp key (Python)
provides:
  - isStoredResultReadable, the one readability test every single-key inner gate asks
  - storedCashHeadlineGate fourth parameter, and the recomputeOverStoredResult argument of the MTM and smoothed should-read predicates, singleKeyBasisOpts and readSingleKeyBasisOpts
  - basisDqf in resolveFactsheetInputs (each basis reads the flags of the run that wrote its numbers)
  - public factsheet cache key factsheet-v2-payload-v20
  - a vitest pin that the snapshot key is one literal in Python and TypeScript
affects: [190-04, 190-06, 190-07, 190-08]

key-files:
  created:
    - src/lib/stored-analytics-result.parity.test.ts
  modified:
    - src/lib/factsheet/headline-basis.ts
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/lib/factsheet/headline-basis.test.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx

key-decisions:
  - "The readability predicate lives in headline-basis.ts and replaces the isRankableAnalyticsRow call inside storedCashHeadlineGate. With the argument false it is exactly isComputedAnalytics (isRankableAnalyticsRow delegates to it), so the OG card is byte-unchanged in behaviour."
  - "basisDqf keeps the snapshot's flags for everything except mtm_gated_reason, which comes from the live flags (omitted when the live flags carry none), only when effectiveDataQualityFlags(...).source is snapshot. A row whose live flags carry the marker passes dqf unchanged."
  - "The version stays one bump (v19 to v20) with computationStatus kept as a keyPart; the cache wrapper, revalidate and tags are untouched."

requirements-completed: [SC-3, SC-4, SC-6]

actuals:
  tokens: 9400
  tasks: 2
  commits: 2
plan_head_before: 5e86c55dba334f520303a49bf9df76ea76bb0e17
plan_head_after: e3cc5aea03064ca107f7e6a0b3e3580d5519ddea

duration: ~40min
completed: 2026-11-03
status: complete
---

# Phase 190 Plan 05: Inner gates follow the one admission decision, cache key v20 Summary

**An admitted single-key re-run now overlays the stored seven headline scalars and shows its real MTM and smoothed toggles (the resolve stage's one `analyticsUpdating` decision reaches every inner gate), each basis reads the flags of the run that wrote its numbers, and the public factsheet cache moves to `factsheet-v2-payload-v20` so no pre-deploy withheld entry outlives the deploy.**

## What changed

- **`headline-basis.ts`.** New exported `isStoredResultReadable(status, recomputeOverStoredResult)`: `isComputedAnalytics(status)` or `isRecomputeOverStoredResult(status, flag)` (a non-string status is coerced to null). `storedCashHeadlineGate` gains a fourth parameter `recomputeOverStoredResult = false` and refuses with the unchanged `not_rankable` reason when the row is not readable. `headlineVerdict` and `withholdCauseOf` are unchanged. `og-metrics.ts` is untouched (zero diff) and still calls the gate with three arguments, so it still refuses a computing row.
- **`composite-read-path.ts`.** `shouldReadSingleKeyMtmSeries`, `shouldReadSingleKeySmoothedSeries` and `singleKeyBasisOpts` take a trailing `recomputeOverStoredResult = false` and ask `isStoredResultReadable`. `readSingleKeyBasisOpts` takes `options.recomputeOverStoredResult` and threads it to both should-read calls, `singleKeyBasisOpts` and `storedCashHeadlineGate`. The F-4 note on `singleKeyBasisOpts` now names the recompute case. `readCompositeFactsheet` has no status gate and is unchanged; the cash twins (`shouldReadCashSettlementSeries`, `shouldReadSingleKeyCashSeries`, no production caller) are unchanged.
- **`fetch-and-build-payload.ts`.** The `readSingleKeyBasisOpts(` call gets `recomputeOverStoredResult: analyticsUpdating` and `basisDqf` in place of `dqf`. When the effective flags came from the snapshot, `basisDqf` is `dqf` with `mtm_gated_reason` replaced by the live flags' value (key omitted when the live flags have none). The comment above the call no longer says the inner gates ride the raw status.
- **`page.tsx` and pins.** Key `v19` to `v20` with a "Bumped v19→v20 (Phase 190" ledger line; `computationStatus` stays the last keyPart. The three assertions in `page.public-cache-key.test.tsx`, `EXPECTED_KEY_PREFIX` in the share-page isolation test and the CACHE KEY REALITY comment moved. `unstable_cache`, `revalidate` and tags are untouched.
- **`stored-analytics-result.parity.test.ts` (new).** Reads `analytics-service/services/job_worker.py`, extracts the literal from the anchored `LAST_SUCCESS_SNAPSHOT_KEY: Final[str] = "..."` line (fails unless exactly one match), and asserts it equals the TypeScript export.

## Verification

- Task 1 verify (7 files): 7 passed, 384 tests, 0 failed. Task 2 verify (4 files): 4 passed, 40 tests, 0 failed. v19 literal count in `src`: 0 (and 0 elsewhere outside `.planning`); v20: 6 (needs at least 6).
- Wider run of `src/lib/factsheet`, `src/app/factsheet*`, `src/app/api/og`, `closed-sets`, `stored-analytics-result*`, `complete-status-scan` and `phase-148-owner-lane-cache-isolation`: 176 of 177 files pass, 2985 tests pass, **2 fail: `compute.conventions.test.ts` fixtures B and C (`skew` last float digit under local Node 25), the known pre-existing local failure, identical on the base. Not touched.**
- `npm run typecheck`: clean. `npm run lint`: 0 errors, 2 warnings, both pre-existing (`MetricsColumn.tsx` `nativeUnitReason`; `composite-read-path.ts` `isRankableAnalyticsRow` unused import, flagged already in the plan 03 summary and left in place because the import is shared with other unchanged code in the file).
- Acceptance greps: `export function isStoredResultReadable` 1, `recomputeOverStoredResult: analyticsUpdating` 1, `basisDqf` 3, `isStoredResultReadable(` in composite-read-path 3, `git diff --stat -- src/lib/factsheet/og-metrics.ts` empty, `factsheet-v2-payload-v20` in `page.tsx` 1.

## RED / GREEN record

- **Task 1 RED (before any production edit):** 11 new tests failed (3 `isStoredResultReadable`/gate cases, the 4 composite-read-path cases, single-key computing and pending overlay, and both SC-6 per-basis fixtures). **Green on arrival, by design:** the composite `computing` build, the missing-marker case, both D-04 parity pins, the at-rest D-04 control and the live-marker `mtm_gated_reason` control. The composite case builds through `readCompositeFactsheet` with no code change here, as the plan says. The D-04 pins are plan 03's rule read where this plan's gates sit.
- **Can-fail proofs (byte backups in the scratchpad, restored with `cp`, `cmp` silent each time; no git checkout, restore or stash):**

| proof | mutation | RED lines | cmp |
|---|---|---|---|
| basisDqf | `readSingleKeyBasisOpts` called with `dqf` instead of `basisDqf` | `× SC-6: snapshot flags give the cash headline, the live derive's mtm_gated_reason gives the MTM gate`, `× SC-6 (mirror): ...` (2 failed) | silent |
| snapshot-key parity | TypeScript literal changed by one character | `× the Python writer and the TypeScript reader use the same literal` (`expected 'last_success_snapshot' to be 'last_success_snapshoT'`) | silent |
| status keyPart | `computationStatus` replaced by `"none"` in `page.tsx` keyParts | the new computing-status case plus KEY SHAPE, the fingerprint case and both STATUS-MOVES-KEY cases (5 failed) | silent |

After each restore the file was re-run green.

## Known limits (recorded, not fixed here)

1. **Day basis in the derive-to-success window.** The single-key day basis follows the new derive's frozen cash conventions (`readCashConventions`), not the last success's. It differs from the last success's only when the day-basis setting changed in that run.
2. **Composite stitch window (D5 HONEST BOUNDARY in `job_worker.py`).** The stitch rewrites `csv_daily_returns` and its basis series seconds before its atomic headline write. This phase widens the visibility of that window from `complete_with_warnings` rows to every re-run of a composite, because a computing composite over a stored result now builds through `readCompositeFactsheet` from those rows.

## Deviations from Plan

**1. [Rule 3 - Blocking, scope-adjacent] `headline-basis.test.ts` was edited though the plan's `files_modified` does not list it.**
- **Why:** the plan's behavior block requires `isStoredResultReadable` and the gate's fourth argument to be tested, and the existing gate tests live in that file. The addition is two `describe` blocks; no existing case changed.
- **Commit:** `888aae932`.

**2. [Housekeeping] The CACHE KEY REALITY comment's v19 to v20 edit landed in Task 2's commit** (it is a cache-key doc, though the file is `fetch-and-build-payload.ts`, which Task 1 also touched). Both commits compile and are green.

Otherwise the plan was executed as written.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. T-190-10 (cache across status) is mitigated by the v20 bump plus the status keyPart pin; T-190-11 (mixed-generation figures) by `basisDqf`, the bound-snapshot admission from plan 03 and the cross-language key pin.

## Self-Check: PASSED

- Files: `src/lib/stored-analytics-result.parity.test.ts` found; the other nine modified files found.
- Commits: `888aae932` and `e3cc5aea0` are ancestors of HEAD on `feat/190-p05`; `git rev-list --count 5e86c55db..HEAD` printed 2 before this SUMMARY's own commit.
