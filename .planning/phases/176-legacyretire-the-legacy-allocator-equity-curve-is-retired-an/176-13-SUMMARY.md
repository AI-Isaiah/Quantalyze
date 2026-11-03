---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 13
subsystem: database
tags: [PR-3, D-02, drop-table, migration, sql-gates, censuses, rollback]
requires: ["176-12"]
provides:
  - "migration 20261104120000_drop_allocator_equity_snapshots.sql: delete_allocator_api_key re-based without Step 4, four DROP FUNCTIONs, boundary-row DELETE, DROP TABLE (no CASCADE, no IF EXISTS)"
  - "supabase/migrations/down/20261104120000-rollback.sql (empty table, policies, grants, four functions, old delete body; no row restored)"
  - "test_api_key_delete_atomicity.sql rewritten for the table-gone state"
  - "four retired gates, regenerated function snapshots, every census lowered with a dated measured reason"
affects: ["176-14", "176-15", "176-16"]
key-files:
  created:
    - supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql
    - supabase/migrations/down/20261104120000-rollback.sql
  modified:
    - supabase/tests/test_api_key_delete_atomicity.sql
    - supabase/tests/test_api_keys_history_reconstruct_marker.sql
    - supabase/schema/functions/delete_allocator_api_key.sql
    - scripts/mutation-floors.mjs
    - scripts/baseline-content-drift-check.mjs
    - scripts/dump-sql-functions.ts
    - .github/workflows/ci.yml
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/drift-check-scripts.test.ts
  deleted:
    - supabase/tests/test_replace_allocator_equity_snapshots_window.sql
    - supabase/tests/test_allocator_equity_pre_terminus_flag.sql
    - supabase/tests/test_refresh_fanout_zero_snapshot_bootstrap.sql
    - supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql
    - supabase/schema/functions/replace_allocator_equity_snapshots.sql
    - supabase/schema/functions/replace_allocator_equity_snapshots_window.sql
    - supabase/schema/functions/extract_symbol_value_at.sql
    - supabase/schema/functions/enqueue_refresh_allocator_equity_for_all.sql
key-decisions:
  - "Migration name 20261104120000 kept: origin/main's newest migration is 20261103120000, so nothing sorts at or after it."
  - "No explicit BEGIN/COMMIT in the migration (reviewer invariant #14); the rollback keeps BEGIN/COMMIT like the 20261028120000 rollback, being manual and off the auto-apply path."
status: complete
commits: 3
plan_head_before: fb6490a3968cf42b73bdcb3b127f7577c825be6a
plan_head_after: b67335e36e22870b41d77ea6263b6a960ca7186e
actuals:
  tokens: 135000
  tasks: 3
  commits: 3
---

# Phase 176 Plan 13: PR 3 database tier, the drop Summary

The legacy table `public.allocator_equity_snapshots` and the four functions that wrote or read it are dropped in one
migration, after `delete_allocator_api_key` is re-based without its last two statements that named them. A last-key
cascade delete is proven to work with the table gone, the rollback is proven to restore an identical catalogue, and every
census moves down by measured counts.

Precondition met: plan 12's SUMMARY records `legacy_rows_since` 0 and the founder's go for PR 3 ("Next 176 and PR3",
2026-11-02). `node scripts/verify-plan-anchors.mjs` on the plan printed `OK` (12 claims).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | `d29812fc2` | migration + rewritten `test_api_key_delete_atomicity.sql` |
| 2 | `51dca00e3` | four gates deleted, rollback, snapshots regenerated, precedent comment reworded, four `NAME_SET_RATCHET` rows |
| 3 | `b67335e36` | mutation floors, ci.yml sql-tests pair, `COMPARED_FLOOR`, six census test files |

## Task 1: the tracer (RED on the old body, GREEN on the new)

- Migration name: `git fetch origin main` then `git ls-tree origin/main supabase/migrations/` ends at `20261103120000`,
  so `20261104120000` is free and used unchanged. No reference needed renaming.
- Definer lists (measured with `grep -l`): `delete_allocator_api_key` last defined by 20261028120000;
  `replace_allocator_equity_snapshots` and `_window` by 20261028120000; `extract_symbol_value_at` by 20260421154030;
  `enqueue_refresh_allocator_equity_for_all` by 20261021120000.
- Apply list for the pg-lane: the union of the bridge-derived gate's and the owed-key gate's setup lists (so
  `extract_symbol_value_at`, the fan-out function and the PR 1 re-base of `compute_bridge_outcome_deltas` all exist),
  plus the window migration, ending at 20261102120000. It applied cleanly on the first try.
- **RED at base** (`/tmp/legacyretire-13/red-at-base.log`): that list plus a scratch `DROP TABLE
  public.allocator_equity_snapshots;`, the rewritten gate. Part 1 fails first: `B5b Part 1:
  replace_allocator_equity_snapshots(uuid,jsonb,integer) still exists (Phase 176 D-02)`, exit 3. Part 3 run alone on the
  same list fails at its first call with `ERROR: 42P01: relation "allocator_equity_snapshots" does not exist`, the old
  Step 4 (the T-176-36 failure shape). Both are in the log.
- **GREEN** (`t1-green.log`): same list with the new migration in place of the scratch DROP: exit 0, notices for Part 1,
  Part 2, Part 3 and the migration's own verify; no `ERROR`.
- **The verify block can fail:** a scratch copy of the migration with the snapshot DELETE put back into the re-based
  function aborts with `a function in schema public still names the dropped table or a dropped function`.
- The four DROP FUNCTION lines (`grep -anF 'DROP FUNCTION public.'`):
  - `DROP FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer);`
  - `DROP FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date);`
  - `DROP FUNCTION public.extract_symbol_value_at(uuid, text, date);`
  - `DROP FUNCTION public.enqueue_refresh_allocator_equity_for_all();`
- `/tmp/legacyretire-13/rebase.diff` (old body of 20261028120000 against the new): only the lock comment reworded and
  Step 4 (the `IF p_cascade_holdings THEN` block with the two DELETEs) removed. Signature, `SECURITY DEFINER`,
  `SET search_path = public, pg_temp`, `SET lock_timeout = '3s'`, the `hashtext('alloc:' || auth.uid()::text)` lock and
  Steps 1 to 3 are byte-identical. The lock stays because it still serializes two deletes by one allocator; the header
  and the in-body comment say so.
- `lint-migration-data-dependence.mjs --self-test` OK and the corpus run printed `314 migration(s) ... 83 refusal(s), 83
  allowlisted, 0 NEW`.
- The task's `<automated>` verify printed `OK`.

### The rewritten gate (`test_api_key_delete_atomicity.sql`)

Part 1: table and the four signatures absent; `delete_allocator_api_key` exactly once, `SECURITY DEFINER`, lock key,
`lock_timeout`, `search_path` pin, comment-stripped body names neither the table nor `snapshot_rebuild_boundary`;
`authenticated` has EXECUTE, `anon` does not. Part 2 unchanged. Part 3: (a) sole key, cascade true, called as its owner:
returns 1, no key and no holdings row left, nothing raised, the allocator's `equity_curve` derived row byte-equal;
(b) one of two keys with cascade true keeps the sibling, its holdings and the derived row; (c) cascade false is refused by
the FK restrict (23503) while holdings exist, and deletes the key and reports 0 once they are gone, derived row untouched.

## Task 2: retired gates, rollback, snapshots

- Four gate files removed with `git rm`; `git grep -n test_refresh_fanout_zero_snapshot_bootstrap -- supabase/tests` now
  prints only the reworded precedent line in `test_api_keys_history_reconstruct_marker.sql` (same line count, no arm change).
- Rollback validated on the pg-lane (`t2-rollback.log`): chain + migration + rollback, then the OLD gate
  (`gate.bak`) passes Parts 1, 2 and 3. Stronger: a catalogue dump (function definition md5, comment md5, ACL, config, table
  columns and defaults, constraints, indexes, policies, table ACL and RLS flags, comments) taken before the migration and
  after migration + rollback is identical (24 rows each, `diff` empty).
- `npm run schema:functions` regenerated the snapshots on its own: `delete_allocator_api_key.sql` now names
  `20261104120000_drop_allocator_equity_snapshots.sql` as its source and the four dropped functions' snapshot files were
  removed (130 files written). No manual handling was needed.
- `npm run schema:functions:check` reported the four dropped names as `baseline-only` until the ratchet rows existed (see
  Deviations); after the four dated rows it prints `current (130 functions)` and `agree, with 4 ratcheted disagreement(s)`.

## Task 3: censuses

One full `node scripts/mutation-runner/run.mjs`, no file edited during it: `scope: FULL 79/79 annotated files`,
`lane-concurrency: 4`, `coverage: files 79/106`, `arms: 791/791/0`, `biting: 791`, `lane-invocations: 791 ... plus 79
baseline / 79 restore leg(s)` (tallies agree), `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`,
`per-arm lane time: mean 1.6s`. Its only defects were the two stale-high floor lines. After lowering, a second full run
exited 0 with the same tallies and `No defects. Every annotated arm bit its own arm first.` (`t3-full.log`; the first
run is kept as `t3-full-before-lowering.log`).

| Constant | Old | New | Reason written beside it |
|---|---|---|---|
| mutation `FILES_FLOOR` | 83 | 79 | four retired annotated gate files |
| mutation `ARMS_FLOOR` | 859 | 791 | -68: window 15, pre_terminus_flag 2, zero_snapshot_bootstrap 31, owed_key_reconstruct 20 |
| `WAIVED_CEILING` | 0 | 0 | unchanged, no waiver added |
| ci.yml sql-tests `SENTINEL_FLOOR` | 27 | 26 | window gate's row left the contiguous table |
| ci.yml sql-tests `ARMS_FLOOR` | 408 | 393 | -15 (the window gate's sentinel); sum comment updated, dated "Re-measured" paragraph added; `ci-anti-skip-gate.contract.test.ts` re-derives and passes |
| `COMPARED_FLOOR` | 136 | 132 | four dropped functions leave the chain side (measured `functions compared 132`) |
| `NAME_SET_RATCHET` | - | +4 rows | `baseline-only`, captured 2026-11-02, cleared by the AUTOREDUMP re-dump after the PROD apply |

Census tests moved with dated CURRENCY lines: `mutation-runner-floors` (`totalAnchored` 791, the GREEN_LOG and SUBSET_LOG
fixtures, sum-offset pin 790/791), `mutation-annotation-parser` (`armsSeen` 791, `stepsSeen` and `needles.length` 888,
`filesTotal` 106, `filesAnnotated` 79, by-name list minus four), `gate-family-meta` (threshold registry keys),
`lint-sql-gates` (scanned 106), `drift-check-scripts` (ci.yml pair 26/393). The SUBSET fixtures used a retired file
as their second file; it was swapped for an existing 2-arm gate, `test_commit_scenario_batch_fingerprint_unpriced.sql`.
Whole vitest suite: 1183 files passed (20 skipped); the only 2 failing tests are the known Node 25 `compute.conventions` fixtures B and C.

## Additional verification (beyond the plan)

On the real local-stack lane (`scripts/local-stack/run.sh up`, docker): the baseline dump loads, the lane replays exactly
this one migration (`baseline-replay: 1 migration(s) newer than the dump`), and the migration's catalogue verify passes
against the REAL catalogue, i.e. no function in the PROD dump names the table or a dropped function in executable text.
All 100 non-LANE-ONLY corpus files then pass (`psql -v ON_ERROR_STOP=1`, as ci.yml runs them), including the rewritten
`test_api_key_delete_atomicity.sql`. The rollback also applies on that stack and the old gate passes after it. The stack
was torn down (`run.sh down`).

## For plan 16: R5 expectations and review inputs

Files for migration-reviewer and rls-policy-auditor: `supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql`
and `supabase/migrations/down/20261104120000-rollback.sql`. R5a on PROD (`prosrc ILIKE '%allocator_equity_snapshots%'`,
comments are NOT stripped) should list exactly six functions: `delete_allocator_api_key`,
`enqueue_refresh_allocator_equity_for_all`, `extract_symbol_value_at`, `replace_allocator_equity_snapshots`,
`replace_allocator_equity_snapshots_window` (all five handled by the migration) and
`backfill_api_keys_history_reconstructed_at`, which names the table in a comment only (the migration's verify strips
comments and does not count it). Any other name is a stop. R5b (pg_depend on the table beyond its own objects) expected
none; R5c (cron jobs naming the table or the fan-out) expected 0. ACL after apply: `delete_allocator_api_key` executable
by `authenticated` and `service_role` only (verified in the migration). The pre-drop row count is plan 16's to record.

## CHANGELOG inputs

- Removed: table `public.allocator_equity_snapshots` and functions `replace_allocator_equity_snapshots`,
  `replace_allocator_equity_snapshots_window`, `extract_symbol_value_at`, `enqueue_refresh_allocator_equity_for_all`
  (migration 20261104120000, one-way on PROD; rollback file re-creates an empty table only).
- Changed: `delete_allocator_api_key(uuid, boolean)` no longer deletes snapshot or seam rows on a last-key cascade
  (re-based, same ACL, lock and pins); `snapshot_rebuild_boundary` rows in `allocator_equity_derived` are deleted.
- Tests: four SQL gates retired (window 15 arms, pre_terminus_flag 2, zero_snapshot_bootstrap 31, owed_key_reconstruct 20);
  `test_api_key_delete_atomicity` rewritten to prove the delete works with the table gone.
- Lowered floors, each with its measured reason: mutation `FILES_FLOOR` 83 -> 79, `ARMS_FLOOR` 859 -> 791; sql-tests
  `SENTINEL_FLOOR` 27 -> 26, `ARMS_FLOOR` 408 -> 393; `COMPARED_FLOOR` 136 -> 132. `WAIVED_CEILING` stays 0.
- Notes: four `baseline-only` `NAME_SET_RATCHET` rows and one expected `DRIFT delete_allocator_api_key/2` content-drift
  finding stay until the post-apply re-dump.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 2's verify needs the `NAME_SET_RATCHET` rows that the plan assigns to Task 3**
- **Found during:** Task 2
- **Issue:** `npm run schema:functions:check` (part of Task 2's verify) reports the four dropped names as `baseline-only`
  until the ratchet rows exist, but the plan lists `scripts/dump-sql-functions.ts` only under Task 3.
- **Fix:** the four dated rows (the shape the plan prescribes for Task 3) were added in the Task 2 commit so its verify can pass.
- **Files modified:** `scripts/dump-sql-functions.ts`
- **Commit:** `51dca00e3`

**2. [Rule 3 - Blocking] `baseline-content-drift-check.mjs` cannot exit 0 until the post-apply re-dump**
- **Found during:** Task 3
- **Issue:** after `COMPARED_FLOOR` is set to the measured 132 the gate still exits 1 with one finding, `DRIFT
  delete_allocator_api_key/2`: the committed PROD dump carries the old body, the chain the re-based one. The plan's Task 3
  verify expects exit 0.
- **Fix:** none, by design. Same shape and handling as plan 02 (`compute_bridge_outcome_deltas`) and plan 09
  (`request_allocator_holdings_sync`): the gate's own contract forbids adding an allowlist row, no row was added, and the
  finding clears with the re-dump taken after the PROD apply. The rest of Task 3's verify (R1, R2, R4 and the grep
  conditions) passes; R3 is 1 for this one reason only (`functions compared 132 - MATCH 128, DRIFT 4, SNAPSHOT_MISSING 0`).
- **Files modified:** `scripts/baseline-content-drift-check.mjs` (dated LOWERED paragraph only)

### Other

- The task's RED instruction names both Part 1 and Part 3(a); with `ON_ERROR_STOP` Part 1 aborts the file first, so Part 3 was
  also run alone on the same lane to show its own 42P01 (both logs are concatenated in `red-at-base.log`).

## Known Stubs

None.

## Threat Flags

None. The migration adds no endpoint, auth path or schema surface; it removes one table and four functions and re-issues an ACL
that is no wider than before.

## Self-Check: PASSED

- Created files exist: the migration, the rollback, this SUMMARY.
- Commits exist and are ancestors of HEAD: `d29812fc2`, `51dca00e3`, `b67335e36`.
- `git rev-list --count fb6490a39..HEAD` = 3 before this SUMMARY's own commit; `STATE.md` and `ROADMAP.md` were not touched.
- No uuid, PROD id, amount, account number or home path was written into tracked text; no CI skip token, no co-author or
  generated-with line in any commit message.
