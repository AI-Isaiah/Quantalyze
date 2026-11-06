---
phase: 183-dupcount-a-book-whose-marked-duplicate-key-is-already-counte
plan: 03
subsystem: ACCOUNTTRUTH census (SQL twin of the reader) and the closed derive refusal vocabulary
tags: [census, refusal-vocabulary, legacy-token, shared-truth-table, tdd, d-01]
status: complete
requires: ["183-01"]
provides:
  - "the census reads a book with counted-once marked duplicates as ready: (e) has no key-list duplicate arm, (b) has no blocking buckets and no gate"
  - "DeriveRefusal holds 7 live members; the retired duplicate token is pinned as a legacy token that the Python, TypeScript and census tests all read"
affects: [183-04]
key-files:
  modified:
    - scripts/accounttruth-census.mjs
    - src/__tests__/accounttruth-census.test.ts
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/tests/fixtures/derive_refusal_rows.json
    - analytics-service/tests/test_derive_refusal_rows.py
    - src/lib/__tests__/derive-refusal-rows.test.ts
decisions:
  - "D-01 (founder 2026-10-31): the census is the third copy of the rule and follows the writer and the reader; duplicate_account stays a valid (e) state, reached only through the stored collision token or the pre-Phase-183 token."
  - "Claude's Discretion (183-CONTEXT), RETIRE: DeriveRefusal.ACCOUNT_DUPLICATE is removed from the closed vocabulary. Evidence 183-RESEARCH Q1: no case reaches it once the gate is gone, its comment was false, plan 183-01 removed its only use. The stored token stays readable through legacy_refusals."
metrics:
  tasks: 2
  commits: 4
  files: 6
actuals:
  tokens: 70000
  tasks: 2
  commits: 4
plan_head_before: adb97f9824297dc345a3b9c5c19d346b246eac01
plan_head_after: 5ccbd6c20d7f4ab3a63ab63a83042a58c613ee64
completed: 2026-11-01
---

# Phase 183 Plan 03: Census twin and refusal vocabulary follow the count-once rule Summary

The census no longer reads a book with a counted-once marked duplicate as held, `duplicate.blocking` and `duplicate.blocking_owners` are gone from section (b), and the marked-duplicate refusal is retired from the closed vocabulary while its token stays readable on stored rows in the writer's table, the reader and the census.

## What changed

- `scripts/accounttruth-census.mjs`: `SQL_B` loses the `blocking` CTE and its two UNION arms, so it is `WITH ${KEYS_CTE}` followed directly by the four marked-count buckets. `SQL_E` loses the `dup` CTE, its `CASE` arm and its `LEFT JOIN`; the state CASE now opens with `WHEN pn.any_failing THEN 'rebuilding:key_not_syncing'`. `pending`, `curve`, `judged` (both stored-token operands of the `duplicate_account` arm) and `state` are otherwise byte-identical. `SECTIONS` entry `b` is titled "keys marked duplicate / composite_member", requires four buckets and has `gate: []`. The header line for (b) and the comments above `SQL_B` and `SQL_E` are rewritten by concept and no longer name the reader's deleted helper. `KEYS_CTE` and sections (a), (c), (d), (f), the marker, read-only and RLS guards and the counts-only bucket check are untouched.
- `src/__tests__/accounttruth-census.test.ts`: the CLI fixture run expects `duplicate.marked: 2` and no `duplicate.blocking`; `greenFixture`'s `b` drops the blocking value; the gate test expects `b: []` with a rewritten comment; the (b) real-PG test is retitled and expects the four marked buckets; a new real-PG test, "(e) a book whose marked duplicates are counted once reads ready over its trustworthy curve (Phase 183 D-01)", seeds six keys (OKX, Deribit and MT5 holders, each with a marked duplicate, the Deribit one failing to sync) and runs section (e) in three states (see below). The (e) refusal-rows replay gains a `legacy:<token>` case per `legacy_refusals` row and floors of at least 7 refusals (moved from 8) and at least 1 legacy row.
- `analytics-service/services/allocator_equity_derive.py`: `ACCOUNT_DUPLICATE` and its false comment are deleted from `DeriveRefusal`; a 3-line comment records the retirement and where the token is read now.
- `analytics-service/tests/fixtures/derive_refusal_rows.json`: 7 `refusals` rows, the four `precedence` rows that named the retired token now name `account_identity_collision` (same `reader_reason`, tokens sorted), a new `legacy_refusals` array holding the one row (token `account_duplicate`, reader line `duplicate_account`), and a rewritten `notes`.
- `analytics-service/tests/test_derive_refusal_rows.py`: `test_no_legacy_refusal_is_a_derive_refusal_member`.
- `src/lib/__tests__/derive-refusal-rows.test.ts`: the `legacy_refusals` type field, a non-empty floor and a loop that reads each legacy token through the reader (state rebuilding, the fixture `reader_reason`, no curve points).

## Real-PG arm (T-183-08)

Executed on a throwaway local PostgreSQL 16 cluster started by the test (`scripts/pg-lane/run.sh --print-pgbin`), never TEST or PROD. Owner A with six keys prints exactly `owners_with_eligible_keys 1, ready 1` over a version-2 trustworthy row. Calibration on the same keys: no equity_curve row reads `rebuilding:awaiting_derivation`; a version-2 refusal row whose `degrade_reasons` is the old token reads `rebuilding:duplicate_account`. Section (b) over `SEED_A` prints exactly `composite_member.marked 0`, `composite_member.marked_live 0`, `duplicate.marked 4`, `duplicate.marked_live 4`.

## RED evidence

Task 1, against the unmodified census script (commit `84355a868`, script unchanged): `Tests  4 failed | 50 passed (54)`. The four FAIL names:

- `(4) a fixture run prints the six sections, counts only > end to end through the CLI's --fixture seam`
- `(4b) ... > every gate bucket is required, except (d)'s GROUP BY bucket, whose absence is a 0`
- `(6) ... > (b) counts marked keys only: the cross-owner key on one account is no duplicate, and since Phase 183 D-01 no marked key holds a book back`
- `(6) ... > (e) a book whose marked duplicates are counted once reads ready over its trustworthy curve (Phase 183 D-01)`

Semantic assessment: each failed on the planned assertion. The (e) arm received `ready: 0, "rebuilding:duplicate_account": 1` where `ready: 1` was expected, i.e. the old key-list arm holding the book, not a harness, seed or collection fault.

Task 2, against the unmodified enum (commit `434a533fc`, enum file unchanged): `2 failed, 9 passed`. The two FAILED names: `test_the_fixture_has_one_refusal_row_per_derive_refusal_member` (the enum still had 8 members against 7 rows) and `test_no_legacy_refusal_is_a_derive_refusal_member` (the legacy token was still a live member). The TypeScript reader file and the census file were green at that commit, as planned, because the reader and the census CASE already map the legacy token.

TDD gate: RED `test(183-03)` precedes GREEN `fix(183-03)` in both tasks, and each RED commit leaves its source file unchanged.

## Mutation checks

- mutation-m1: red (the four census names above; the pre-change script restored over `scripts/accounttruth-census.mjs`, `Tests  4 failed | 50 passed (54)`), restore: cmp clean
- mutation-m2: red (`test_the_fixture_has_one_refusal_row_per_derive_refusal_member`, `test_no_legacy_refusal_is_a_derive_refusal_member`; the pre-change enum file restored over `allocator_equity_derive.py`), restore: cmp clean
- mutation-m3: red (`(e) the untrustworthy reason: every refusal, blocking and precedence row lands on the reader's line`, failing on `legacy:account_duplicate`, and also the new `(e) ... counted once reads ready ...` calibration arm; the stored-token operand of the `duplicate_account` CASE arm replaced by `false`), restore: cmp clean
- mutation-m4: red (`account_duplicate (a pre-Phase-183 refusal row) -> its fixture reader_reason, and never a curve`; the `tokens.includes("account_duplicate") ||` operand deleted from `untrustworthyRebuildReason` in `src/lib/queries.ts`), restore: cmp clean; `git diff HEAD -- src/lib/queries.ts` empty afterwards

## Runbook re-read

`docs/runbooks/derivecron-go-live.md`: the `d06-owner` form still composes. It prepends `__CENSUS_E__` (label e's CTE chain) to its own CTEs `m`, `win`, `fresh` and `okxb`, reads only `keys` and `state`, and names no removed CTE (`dup` / `dp`). `rebuilding:duplicate_account` stays a valid state in its `held` set (the stored collision token reaches it). The runbook was not edited.

## Verification

- Full analytics suite from `analytics-service/` (`-n auto`): `14077 passed, 102 skipped, 1171 warnings`, 0 failed. Same count as plan 183-01 (this plan removes a fixture row, not a test, and adds one test; the parametrised `test_refusal_payload_is_the_fixture_row` lost one id and the new test added one).
- CI's mypy line, verbatim: `Success: no issues found in 131 source files`.
- Plan vitest files (`derive-refusal-rows`, `accounttruth-census`): 2 files, `92 passed`.
- Full `npx vitest run`: `Test Files  1 failed | 1183 passed | 20 skipped (1204)`, `Tests  2 failed | 23312 passed | 315 skipped (23629)`. The 2 failures are the known baseline in `src/lib/factsheet/compute.conventions.test.ts` (fixture B and fixture C) and nothing else.
- `npm run -s typecheck`: exit 0. `npm run -s lint`: exit 0 (0 errors, 2 pre-existing warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, not touched here).

## Deviations from Plan

None - plan executed exactly as written. Two small notes, neither a deviation: (1) m3 also reddens the new (e) calibration arm besides the replay the plan names, which is the stronger result; (2) the `files_modified` list of the plan was followed exactly, with `src/__tests__/accounttruth-census.test.ts` edited in both tasks as the plan prescribes.

## Known Stubs

None.

## Threat Flags

None. The only SQL change is deletion; no bucket was added, so the id-shaped and non-token guards of `parseCounts` still cover everything the census can print (T-183-11).

## For /gsd-ship (CHANGELOG sentence)

Changed: the ACCOUNTTRUTH census no longer prints `duplicate.blocking` / `duplicate.blocking_owners` and no longer reads a book with a counted-once marked duplicate as held; the `account_duplicate` refusal token is retired from the writer and still read on stored rows.

## Self-Check: PASSED

All six files exist; commits `84355a868`, `69afde601`, `434a533fc`, `5ccbd6c20` are ancestors of HEAD; `DeriveRefusal` prints seven tokens without the retired one; `test_no_legacy_refusal_is_a_derive_refusal_member` is present.
