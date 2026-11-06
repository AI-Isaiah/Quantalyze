---
phase: 183-dupcount-a-book-whose-marked-duplicate-key-is-already-counte
plan: 02
subsystem: SSR reader (equity history readiness)
tags: [reader, readiness, shared-truth-table, tdd, d-01]
status: complete
requires: ["183-01"]
provides:
  - "equityHistoryReadiness never returns duplicate_account from the key list; the line is reachable only through the stored refusal token"
  - "the TypeScript half of shared_account_resolution.json asserts no cell refuses"
affects: [183-03, 183-04]
key-files:
  modified:
    - src/lib/queries.ts
    - src/lib/__tests__/holder-matrix-parity.test.ts
    - src/lib/queries.test.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/queries.benchmark-feed.test.ts
decisions:
  - "D-01 (founder 2026-10-31): the reader half. The key-list duplicate check is deleted outright; a key list alone cannot prove a collision, so no key-list predicate can mirror the writer."
metrics:
  tasks: 2
  commits: 3
  files: 5
actuals:
  tokens: 45000
  tasks: 2
  commits: 3
plan_head_before: 34b13021ff320d71455ca98e3cac1d41eb7481a3
plan_head_after: 38975ae1eefd9934f9af88a021c4f07f1b41230b
completed: 2026-11-01
---

# Phase 183 Plan 02: Reader never holds a book over a marked duplicate from the key list Summary

`equityHistoryReadiness` no longer returns `duplicate_account` from the key list, so a book whose marked duplicate is counted once by the derive reads `ready` with its curve; a real double count and a not-yet-replaced pre-Phase-183 refusal row still show the duplicate line through the stored token.

## What changed

- `src/lib/queries.ts`: `countsAsDuplicate` and its early return in `equityHistoryReadiness` are deleted; the `isWorkingHolder` import is dropped (`NOT_WORKING_SYNC_STATUSES` stays for `failingToSync`). The order is now identity pending (`key_not_syncing` before `account_identity_pending`), then the series. The stored-token mapping in `untrustworthyRebuildReason` and the `duplicate_account` union member are unchanged. Docs rewritten for `equityHistoryState`, item 2 of `untrustworthyRebuildReason`, `identityStillPending`, `notSyncingIdentityPendingKeyIds`, `equityHistoryReadiness` (the "Review C2 fix coupling" warning is replaced by the Phase 183 coupling to the shared table) and the producer comment in `derivePhase07Fields`.
- `holder-matrix-parity.test.ts`: the guard "the reader never says duplicate_account from the key list: no cell refuses (Phase 183 D-01)" replaces the old exact-where-refuses test; the `refuse` union member and branch are gone; the header doc carries a Phase 183 sentence. "a ready verdict never sits over a shared account the derive counts twice" is unchanged and passes.
- `queries.test.ts`: three cases flipped to `ready` / `key_not_syncing ["k-bad"]`, plus the new "Phase 183 transition" test (DUPCOUNT key shape over a stored `account_duplicate` row, an `account_identity_collision` row, and a trustworthy row).
- `queries.my-allocation.test.ts`: the end-to-end producer case reads `ready` with three return points; the marked key carries `venue_account_id: null` (production shape).
- `queries.benchmark-feed.test.ts`: the rebuilding trigger is an unstamped binance key (`account_identity_pending`); its subject (no benchmark read on a rebuilding book) is unchanged.

## RED evidence

Against the unmodified `queries.ts` (RED commit `2bc2e8e49`, which leaves `queries.ts` untouched):

`Tests  8 failed | 415 passed (423)`

The eight names: `duplicate H=working M=working`, `duplicate H=working M=error`, `duplicate H=working M=sign_in_failed`, `the reader never says duplicate_account from the key list: no cell refuses (Phase 183 D-01)`, `a marked duplicate of a working holder is ready over a v2 series: ...`, `IN-04: the producer lists the failing identity-pending keys, and only under key_not_syncing`, `a marked duplicate whose holder carries the account id is identity-known and ready (Phase 183 D-01)`, `plan 11 + Phase 183 D-01: the same row with a second key marked a duplicate of a working holder reads ready, counted once by the derive`.

Semantic assessment: each failed on the planned assertion (old verdict `rebuilding` / `duplicate_account`), not on an import or collection fault. The benchmark-feed test was green before and after, as the plan said.

TDD gate: RED `test(183-02)` `2bc2e8e49` precedes GREEN `fix(183-02)` `59f3632ef`.

## Mutation checks

- mutation-m1: red (the eight names above; the pre-fix `queries.ts` copied over the fixed one, `Tests  8 failed | 415 passed (423)`), restore: cmp clean, 423 passed afterwards
- mutation-m2: red (`R3-WR-03: an untrustworthy v2 row names its shared-account cause from degrade_reasons`, `Phase 183 transition: the DUPCOUNT key shape reads duplicate_account over a stored pre-Phase-183 refusal row, ...`; the `tokens.includes("account_duplicate") ||` operand deleted from `untrustworthyRebuildReason`), restore: cmp clean

## Full vitest run

`Tests  2 failed | 23310 passed | 315 skipped (23627)`; `Test Files  1 failed | 1183 passed | 20 skipped (1204)`. The only failing file is `src/lib/factsheet/compute.conventions.test.ts` (fixture B and fixture C, pre-existing at base `8c8edc452`). Baseline `23309 passed`; the delta is the one added transition test. No other test pinned the old key-list rule, so nothing beyond the files in `files_modified` was rewritten.

Other gates: `npx vitest run src/lib/__tests__/holder-matrix-parity.test.ts` prints `Tests  75 passed (75)` (4 failed before this plan); targeted run of the plan's files plus `derive-refusal-rows`, `accounttruth-census` and `src/app/(dashboard)/allocations`: `Test Files  163 passed`, `Tests  3244 passed`; `npm run -s typecheck` exit 0; `npm run -s lint` exit 0 (planning hygiene OK).

## Commits

- `2bc2e8e49` test(183-02): a counted-once marked duplicate reads ready from the key list (RED, D-01)
- `59f3632ef` fix(183-02): the reader never holds a book over a marked duplicate from the key list (D-01)
- `38975ae1e` test(183-02): the stale refusal row and a live collision still name the duplicate line; the reader states the writer's rule (SC-2)

## Deviations from Plan

None - plan executed exactly as written. Two small notes: the first prose edit of `identityStillPending`'s doc left a garbled sentence and was corrected before the GREEN commit; the "Phase 183 coupling" note in the `equityHistoryReadiness` doc says only "relies on the writer counting each marked pair once" (it does not restate which member carries the count, which the shared table owns). The 183-02 tick in ROADMAP.md, the progress row (2/4) and the STATE Plan line were hand-edited; no handler was run.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change. T-183-05 (ready over a double-counted curve) and T-183-06 (stale `account_duplicate` row read as the generic line) are mitigated as planned: ready still needs the writer's trustworthy version-2 series, and the stored-token mapping is pinned by the transition test and R3-WR-03 (m2 seen red).

## CHANGELOG sentence (for /gsd-ship)

Fixed: the Overview no longer shows 'rebuilding, duplicate account' for a book whose marked duplicate key is counted once; a real double count and a not-yet-replaced old refusal still show it.

## Self-Check: PASSED

- Files: the five `files_modified` exist and carry the changes described.
- Commits `2bc2e8e49`, `59f3632ef`, `38975ae1e` are ancestors of HEAD; `grep -ac countsAsDuplicate src/lib/queries.ts` and `grep -ac isWorkingHolder src/lib/queries.ts` print 0; the stored-token line is kept.
