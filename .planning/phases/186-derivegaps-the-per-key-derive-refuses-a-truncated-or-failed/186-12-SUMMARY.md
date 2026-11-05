---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 12
subsystem: TS parity twins
tags: [allocator-equity, failing-key, legacy-token, d-07, sc-4, cross-runtime]
status: complete

requires:
  - phase: 186-08
    provides: "readFailingKeyExits, FAILING_KEY_EXITED_FLAG"
  - phase: 186-11
    provides: "legacy_blocking list in derive_refusal_rows.json; failing_key_exits cells in writer_residual_resolution.json"
provides:
  - "derive-refusal-rows.test.ts: legacy_blocking rows read through untrustworthyRebuildReason"
  - "writer-residual-parity.test.ts: readFailingKeyExits names the exits the writer records, cell by cell"
affects: [186-14]

plan_head_before: 28e3268c81215a149ad8b478f522f76e7dfabcbc
plan_head_after: 6c5a0f356
commits: 2

actuals:
  tokens: 5200
  tasks: 2
  commits: 2

key-files:
  modified:
    - src/lib/__tests__/derive-refusal-rows.test.ts
    - src/lib/__tests__/writer-residual-parity.test.ts

key-decisions:
  - "No production code changed: queries.ts and accounttruth-census.mjs are byte-equal to the phase branch base."
---

# Phase 186 Plan 12: TS parity twins for the token retirement and the exit names Summary

The two TS twins now read the fixtures plan 186-11 moved: a stored pre-186 `failing_key_series_ended` payload still reads `rebuilding` / `shared_account_no_working_key`, and `readFailingKeyExits` returns exactly the exits the writer records for every shared cell.

## What was built

- `derive-refusal-rows.test.ts`: `Table.legacy_blocking`, an `it.each` over it (untrustworthy payload carrying only that token reads `rebuilding` with the row's `reader_reason` and no points), and a guard that the list is non-empty and shares no token with `blocking`.
- `writer-residual-parity.test.ts`: `Cell` gains optional `derive.failing_key_exits` and the key fields `read_incomplete` and `inputs`; `payloadFor` emits the `failing_key_exited` flag and the `failing_key_exits` list only for cells carrying exits; a new describe asserts, per cell with exits, one named entry per exit with the same key id, reason and day, and per cell without exits, no flag and `[]`. A table guard requires a dated day, a `day: null`, both reasons, and at least one cell without exits.

## RED / neuter evidence

- Task 1: the reader's legacy arm exists, so the new assertion is green first. Neuter from byte backup (`queries.ts.bak`): the `failing_key_series_ended` alternative removed from `untrustworthyRebuildReason`; `neuter-12-1.log` shows 2 FAILED (the new legacy row and the precedence row naming it); restored with `cp`, `cmp` equal, `git diff` clean.
- Task 2: `payloadFor` reverted to `flags: []` and no list from a byte backup; `red-12-2.log` shows 3 FAILED (all three exit cells); restored byte-equal, then 18 of 18 green.

## Verification

- `npx vitest run` on `derive-refusal-rows.test.ts`, `writer-residual-parity.test.ts`, `queries.test.ts`, `accounttruth-census.test.ts`: 4 files, 285 tests passed. The census test passes unchanged (it iterates `blocking`, which no longer lists the token).
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors (2 pre-existing warnings, none in the touched files; eslint on the two files is clean).
- No Python touched, so no pytest or mypy run.
- `git diff 28e3268c8 -- src/lib/queries.ts scripts/accounttruth-census.mjs` is empty.

## Deviations from Plan

None - plan executed exactly as written. `node_modules` is the symlink to the main checkout; no dependency mismatch appeared, so it was not replaced.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- FOUND commits d5a5e5d53 and 6c5a0f356 on agent-186-p12
- FOUND `legacy_blocking` in derive-refusal-rows.test.ts and `failing_key_exits` in writer-residual-parity.test.ts
