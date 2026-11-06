---
phase: 183-dupcount-a-book-whose-marked-duplicate-key-is-already-counte
plan: 01
subsystem: analytics-service / allocator equity derive (writer)
tags: [derive, identity-gate, account-groups, tdd, shared-truth-table]
status: complete
requires: []
provides:
  - "derive_allocator_equity refuses on account_identity_collisions only; a marked duplicate counted once draws its curve"
  - "shared_account_resolution.json with no refusing cell (consumed by plan 183-02 on the TypeScript side)"
affects: [183-02, 183-03, 183-04]
key-files:
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/fixtures/shared_account_resolution.json
    - analytics-service/tests/test_holder_matrix_parity.py
    - analytics-service/tests/test_derive_allocator_equity_job.py
decisions:
  - "D-01 (founder 2026-10-31): count once, draw the curve; only a collision refuses"
metrics:
  tasks: 2
  commits: 3
  files: 4
actuals:
  tokens: 60000
  tasks: 2
  commits: 3
plan_head_before: e28d894b026c0a1b6780087504daabb0cb2ead1c
plan_head_after: 86166838398240336c092819e48509ec702577d1
completed: 2026-11-01
---

# Phase 183 Plan 01: Writer counts a marked duplicate once and draws the curve Summary

The derive's identity gate no longer refuses a book whose marked duplicate key the account-group loop already counts once; only two counted keys on one account (`account_identity_collision`) still refuse, and the shared truth table now has no refusing cell.

## What changed

- `analytics-service/services/job_worker.py` (`derive_allocator_equity`): the marked-duplicate list comprehension is deleted and the gate is `if collisions:` with `reason = DeriveRefusal.ACCOUNT_IDENTITY_COLLISION.value`. The WARNING drops the duplicate-key count from its format string and argument list together. `_persist_refusal`, the Sentry scope, both tags, the static message and the `DONE` return are unchanged. The identity-gate comment now says the group loop counts a marked pair once and a real double count is two COUNTED keys on one account. `rows_by_id` and `working_holder_predicate` keep other uses.
- `shared_account_resolution.json`: the three cells `duplicate / holder working / marked working, error, sign_in_failed` now compose `["H", "O"]`, trustworthy, reader `ready`. `notes` rewritten for D-01 (still 72 cells).
- `test_holder_matrix_parity.py`: the `refuse` branch is gone; every cell asserts `_refusal_upserts(fake) == []`.
- `test_derive_allocator_equity_job.py`: two pins rewritten and renamed, the `duplicate` params and `_refusal_case_duplicate` removed, the PROD-shaped Deribit plus MT5 test and the marker-pair collision unit added, and the `_gate_key` header comment rewritten.

## RED evidence

Against the unmodified `job_worker.py` (commit `d84ff6f06`), `pytest tests/test_holder_matrix_parity.py tests/test_derive_allocator_equity_job.py` printed `6 failed, 212 passed`. The six FAILED names:

- `test_the_derive_resolves_each_cell_as_the_table_says[duplicate-H_working-M_working]`
- `test_the_derive_resolves_each_cell_as_the_table_says[duplicate-H_working-M_error]`
- `test_the_derive_resolves_each_cell_as_the_table_says[duplicate-H_working-M_sign_in_failed]`
- `test_duplicate_with_working_holder_is_counted_once_and_drawn`
- `test_duplicate_whose_marked_key_fails_behind_a_working_holder_counts_through_the_holder`
- `test_a_book_with_marked_deribit_and_mt5_duplicates_draws_one_curve_and_sends_no_event`

Semantic assessment: each failed on the planned assertion, namely the refusal row that the old gate wrote (`the table has no refusing cell`, and `expected one composed curve, got 0 upserts`), not on an import, fixture or collection fault. No ERROR lines.

TypeScript (plan 183-02 owns the reader, left RED on purpose): `npx vitest run src/lib/__tests__/holder-matrix-parity.test.ts` printed `Tests  4 failed | 71 passed (75)` after the same fixture commit, and still prints it after this plan.

TDD gate: RED `test(183-01)` `d84ff6f06` precedes GREEN `fix(183-01)` `2ae46a58b` and leaves `job_worker.py` unchanged. The GREEN commit type is `fix`, as the plan prescribes.

## Mutation checks

- mutation-m1: red (the six names above, restoring the pre-fix `job_worker.py`; log holds 6 FAILED lines), restore: cmp clean
- mutation-m2: red (`test_duplicate_with_revoked_holder_is_a_collision`, `test_duplicate_with_disconnected_holder_is_a_collision`, `test_identity_collision_persists_its_refusal_reason`, `test_identity_refusal_is_a_warning_not_info[collision]`, `test_identity_refusal_reaches_sentry_as_an_event[collision]`; gate changed to `if collisions and False:`), restore: cmp clean
- mutation-m3: red (`test_a_marker_pair_that_were_both_counted_collides_as_one_account`; marker-link loop in `account_identity_tokens` ANDed with `False`), restore: cmp clean; `allocator_equity_derive.py` equals HEAD afterwards

## Full analytics suite

`14077 passed, 102 skipped, 1171 warnings in 88.15s (0:01:28)`, 0 failed. Baseline at 8c8edc452 was `14078 passed, 102 skipped`; the count moved by minus 3 removed `duplicate` params (`_refusal_case_duplicate` and the two identity-refusal params) plus 2 added tests (PROD-shaped book, marker-pair unit). Renames are net zero. No test other than the ones named here pinned the old refusal, so nothing else was rewritten in step (4).

CI's mypy line (strict, from `analytics-service/`): `Success: no issues found in 131 source files`.
The quick suite (`test_derive_allocator_equity_job.py`, `test_holder_matrix_parity.py`, `test_derive_refusal_rows.py`): `230 passed`.

## Commits

- `d84ff6f06` test(183-01): a counted-once marked duplicate composes in the shared table and the writer tests (RED, D-01)
- `2ae46a58b` fix(183-01): the derive counts a marked duplicate once and draws the curve; only a collision refuses (D-01)
- `861668383` test(183-01): a marker pair both counted still collides; the collision branch can fail (SC-1)

## Deviations from Plan

None in behaviour. Two small notes:

- The `notes` string in the fixture carried a third sentence that stated "a duplicate behind a WORKING holder is refused" (the D-01/D-04 provenance clause). It was reworded in the same edit as the `refuse` definition, because leaving it would have contradicted the table.
- The `_gate_key` header comment rewrite (Task 2 step 2) was held back from the RED commit so it does not name the marker-pair unit before that unit exists; it landed in the Task 2 commit.

The PROD-shaped test needed no fixture-shape fix: the composed payload was trustworthy at 140000 with the `venue` set per key to `deribit` / `mt5` after `_series_rows`.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change.

## CHANGELOG sentence (for /gsd-ship)

Fixed: a book whose marked duplicate key is already counted once draws its equity curve instead of the rebuilding panel; a real double count still refuses.

## Self-Check: PASSED

- Files: the four `files_modified` exist and differ from base only as described.
- Commits `d84ff6f06`, `2ae46a58b`, `861668383` are ancestors of HEAD.
- `grep -ac duplicate_keys analytics-service/services/job_worker.py` prints 0; `allocator_equity_derive.py` is unchanged from HEAD.
