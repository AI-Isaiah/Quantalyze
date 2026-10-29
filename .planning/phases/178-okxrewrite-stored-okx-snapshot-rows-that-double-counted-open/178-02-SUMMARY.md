---
phase: 178-okxrewrite-stored-okx-snapshot-rows-that-double-counted-open
plan: 02
subsystem: runbook-census
tags: [runbook, census, okx, dead-key, pre-flight, refusal-vocabulary]
status: complete

requires:
  - phase: 178-01
    provides: "the exchange-account decision order (zero, dead, refused, crawled) and the audit key account_non_working_accounts_excluded that P7 predicts"
provides:
  - "okx-nonworking-keys.sql: the P7 dead-key census, one read-only statement"
  - "runbook pre-flight P7 and the D-06 'not recomputed' ruling applied before any write"
  - "runbook rule 3 at 16 tokens with a vitest parity pin against the module's two frozensets"
affects: [178-03, 178-05]

actuals:
  tokens: 6000
  tasks: 2
  commits: 2
plan_head_before: c78d593ba1efb8f810a7a6be2a62139b6da3cb4c
plan_head_after: 66a9edeb1943f2ab356a95167f971e6e09cca55e

tech-stack:
  added: []
  patterns:
    - "a recursive CTE builds the marker components the way account_groups does; the exchange-account state is decided in plan 01's order"

key-files:
  created:
    - docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql
  modified:
    - docs/runbooks/marksource-okx-census/README.md
    - docs/runbooks/marksource-okx-history-correction.md
    - src/__tests__/marksource-okx-census-sql.test.ts

key-decisions:
  - "D-06 (founder 2026-10-28): an account whose dead key overlaps the window is kept as stored and named 'not recomputed (D-06)'; other accounts are rebuilt normally"
  - "A dead member on another venue than its group's working keys counts as a dead key (the rebuild reads that account through the working key, so it does not re-read the member)"

requirements-completed: [D-06, SC-2, SC-3]
---

# Phase 178 Plan 02: P7 dead-key census and the 16-token refusal vocabulary (D-06)

**A blocking read-only pre-flight, P7, decides per target `rebuild` or `not recomputed (D-06)` with the exchange-account rule plan 01's code follows, and the runbook's refusal list is now the code's 16 tokens, pinned by a parity test.**

## Accomplishments

- `okx-nonworking-keys.sql` (183 lines, one statement, no comment): the `okx_account` CTE is byte-identical to `okx-snapshot-census.sql`'s. Then `user_key`, `marker_edge`, `reach` (recursive, `UNION`), `key_group`, `group_member`, `exchange_account`, `dead_key`, and P7's own `account_counts`, `window_prediction`, `dead_span`, `dead_summary`, `snapshot_day`, `day_counts`. `exchange_account` carries `has_working`, `deciding_venue_count`, `venue` and `state` (`zero`, `dead`, `refused`, `crawled`, in plan 01's order). `dead_key` is every non-working non-Deribit key with no working same-venue key in its group. Output per a-label: key and exchange-account counts, crawled/dead/zero/refused split by venue, `dead_keys`, `predicted_window_days` (90 with a crawled OKX account, else 730), `dead_keys_with_holdings`, `dead_key_last_holdings_age_days`, `in_window_days_overlapping_dead_key_holdings` (non-bulk stored in-window days within first holdings day minus 1 to last holdings day plus 7), `in_window_days_written_in_bulk`, `p7_outcome`.
- Plan 05 note: the shared block to copy byte for byte runs from `user_key AS (` through the closing `),` of `exchange_account`; it now contains a `group_member` CTE between `key_group` and `exchange_account`.
- README: one table row and one sentence under the intro.
- Runbook: census-file section says five files and gains the table row; heading now reads `Pre-flight P0 to P7`; the P7 bullet after P6 (marker first, run by absolute path with `q`, record the six columns, the founder's ruling quoted verbatim, why it is not a B'1 "predicted outcome", the two-sentence reason, Abort if); a fourth bullet in "What this cannot reach"; the line naming the read-only steps now says P5 to P7.
- Rule 3: `FORCED_REBUILD_REFUSAL_REASONS`, 16 tokens; `account_key_read_stalled` joins the re-enqueue-once list (now 8) with the Phase 171 sentence; record-only list stays 8.
- Tests (118 in the file, was 113): `EXPECTED_FILES` and the "names each okx census file" list extended; one P7 bullet pin; a `describe` of five tests (vacuity guard, stated count, list membership with missing/extra/both-lists messages, each list's stated size equals its distinct token count, `account_key_read_stalled` in the re-enqueue list), parsing both frozensets from `equity_reconstruction.py`.

## RED proof

Task 1, before any census, README or runbook edit (pins edited first). First run: the whole file failed at collection, because the per-file `describe.each` reads the absent census file (`ENOENT` on `okx-nonworking-keys.sql`; `Test Files 1 failed`, `no tests`). To name the failing pins, a zero-byte placeholder with that name was created (removed by the real file one step later); second run, `Tests  4 failed | 109 passed (113)`:

```
× README backticked .sql names equal the directory listing
× is one statement starting with WITH or SELECT          (marksource census file okx-nonworking-keys.sql)
× names each okx census file it runs
× carries the P7 dead-key pre-flight and names the not-recomputed ruling (Phase 178 D-06)
AssertionError: the runbook must name okx-nonworking-keys.sql: expected false to be true
AssertionError: the runbook must carry a pre-flight bullet starting '- **P7 ': the dead-key census runs before any enqueue: expected false to be true
```

Task 2, before the runbook edit, `-t "refusal vocabulary"`: `Tests  3 failed | 2 passed | 113 skipped (118)`:

```
× states the code's token count after FORCED_REBUILD_REFUSAL_REASONS
× lists every code token in exactly one of the two lists and no token the code lacks
× puts account_key_read_stalled in the re-enqueue-once list (Phase 171: the stored windows are kept)
AssertionError: rule 3 says 15 tokens, the code holds 16: ... account_key_read_stalled ...
AssertionError: rule 3 names neither list for: account_key_read_stalled
AssertionError: account_key_read_stalled keeps the stored windows, so a later run can clear it: re-enqueue it once
```

The two that passed on the old text are the vacuity guard and the stated-size test (7 and 8 matched the old lists). The size test was shown able to fail by a byte-backup neuter (`for these 8` changed to `9`): `Re-enqueue ONCE states 9 but lists 8 distinct tokens`; restored with `cmp` exit 0 and the file back to 118 passed. The size test counts distinct tokens because the new sentence names `account_key_read_stalled` a second time inside the list's span.

## Local execution

`p7-lane: gate exit 0; neutered gate exit 3`. Run on a throwaway local PostgreSQL through the pg-lane (`--apply` fixture, `--gate` gate); nothing touched TEST or PROD. The fixture held stand-in `api_keys`, `allocator_holdings` and `allocator_equity_snapshots` with only the columns the file names, and seven OKX owners: the plan's six plus a seventh (working OKX, a dead Bybit key whose holdings ended long before the window, every stored in-window day bulk-written) so the bulk arm is exercised. The gate wraps the committed statement as `CREATE TEMP TABLE p7 AS ...` and asserts 52 (label, column, value) triples with hand-computed oracles: owner 2 and 6 overlap 49, owner 4 overlap 38 with window 730, owner 7 bulk 90, owner 3 dead keys 0 on a two-hop chain, owner 5 `zero` 1 / `refused` 1 / dead 0, owner 6 `dead_other_accounts` 1 and `dead_keys` 2.

Neutered gate (one `p7_outcome` flipped): exit 3, `label a1 column p7_outcome: expected not recomputed (D-06), got rebuild`. Five mutations of the census text were also each caught, exit 3: carry `+ 7` to `+ 0` (a2 overlap 42, not 49), one-direction marker reach (a3 `exchange_accounts` 2, not 1), dead key test ignoring the same-venue working key (a6 `dead_keys` 1, not 2), window fixed at 90 (a4 `predicted_window_days` 90, not 730), bulk days ignored in the outcome (a7 reads `rebuild`).

## Baseline column check

Every column the new SQL names was found in its table's `CREATE TABLE` in `supabase/schema/baseline.sql`: `api_keys` (`id`, `user_id`, `exchange`, `is_active`, `sync_status`, `disconnected_at`, `created_at`, `account_share_kind`, `account_shared_with_api_key_id`), `allocator_holdings` (`api_key_id`, `asof`), `allocator_equity_snapshots` (`allocator_id`, `asof`, `reconstructed_at`).

## Gates

- `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts`: 118 passed.
- `npm run -s check:planning-hygiene`: exit 0 (all three rule lines OK).
- Task verifies: `P7_OK` and `VOCAB_OK`. The scratch directory was deleted after Task 1's commit and confirmed gone.
- The PROHIBITION list holds: no change to the `enqueue`, `newjob`, `inflight`, `pollafter`, `rebuildfn` or `marker` forms; no `crosswalk` form, B'1, P1, P4, `audit` form or B'5 rule 5 and 6 edit; no fixture or gate committed.

## Deviations from Plan

None - plan executed as written. Notes on form:

- The seventh fixture owner and the five census mutations are additions to the plan's six-owner fixture; both stay in scratch.
- `SEQUENTIAL=true` was applied to the commit guard (linked phase worktree on `feat/178-okxrewrite`); the project root pin was run before the first write and before each commit.
- The plan's "four tests" for the vocabulary parity became five (a vacuity guard was added, as the plan itself asks for one).

## Known Stubs

None.

## Threat Flags

None. The new statement is read-only, guarded by the existing census rules, and its output is counts and day counts.

## Self-Check: PASSED

- Files: `docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql`, `docs/runbooks/marksource-okx-census/README.md`, `docs/runbooks/marksource-okx-history-correction.md`, `src/__tests__/marksource-okx-census-sql.test.ts` all FOUND and in `git diff` from the recorded base.
- Commits: `30cb16596` (P7) and `66a9edeb1` (vocabulary) are ancestors of HEAD; `git rev-list --count` from the recorded base reports 2.
- STATE.md and ROADMAP.md untouched.
