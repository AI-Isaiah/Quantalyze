---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 03
subsystem: database
tags: [postgres, supabase, rls, migration, sql-gate, mutation-runner, pg-lane]
status: complete

requires:
  - phase: 171-readceiling
    provides: D-02 (resumable across runs; persisted trade data needs a migration with an expiry)
provides:
  - public.allocator_trade_reads (one state row per api key)
  - public.allocator_trade_read_windows (numbered chunks of at most 5,000 trades per complete 7-day window)
  - service-role-only access, forced RLS with no policy, cascade erasure from api_keys and auth.users
  - 8-arm SQL gate with a RED-UNDER-M twin on every arm
  - data-keeping manual rollback
  - pg-lane stand-in fixture for the api_keys.user_id -> profiles cascade
affects: [171-04 trade_read_store, 171-06 census pins, 171-07 worker wiring, 171-08 watchdog sweep, 171-12 deploy order record]

actuals:
  tokens: 16330
  tasks: 2
  commits: 2
plan_head_before: dc161d9a6651ae50cbba5b6b43a198ee62453692
plan_head_after: 90d3f7a6134759ee07f80d775f92ae4552803644

tech-stack:
  added: []
  patterns:
    - "service-role-only table: REVOKE ALL from every role, ONE grant to service_role, RLS enabled and forced with zero policies; the grant is the control because service_role has BYPASSRLS"
    - "catalogue-only migration verify block that deliberately does not assert what a twin mutates"

key-files:
  created:
    - supabase/migrations/20261030120000_allocator_trade_reads.sql
    - supabase/migrations/down/20261030120000-rollback.sql
    - supabase/tests/test_allocator_trade_reads.sql
    - scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql
  modified: []

key-decisions:
  - "Access is service-role only (orchestrator decision 3, a narrowing of CONTEXT's owner/service-role wording): no owner policy, no allocator_id, no trigger, no function"
  - "n_trades -1 is reported by allocator_trade_read_windows_array_chk, not _count_chk: CHECKs run in name order and an array length can never be -1; the _count_chk upper bound is proven by an exact 5001 case, the bound itself by an exact 5000 case"
  - "A new pg-lane stand-in fixture was added (Rule 3) because the throwaway cluster lacks the api_keys.user_id -> profiles cascade"

requirements-completed: [SC-1]

duration: ~1h30m
completed: 2026-10-27
---

# Phase 171 Plan 03: the resumable trade-read store Summary

**Two service-role-only tables (a state row per api key, and numbered 5,000-trade chunks per complete 7-day window) that erase with their key and account, with an 8-arm SQL gate where every arm is shown biting under its own mutation.**

## Accomplishments

- Migration `20261030120000_allocator_trade_reads.sql`: both tables, ten named constraints, forced RLS with zero policies, REVOKE ALL then one `GRANT SELECT, INSERT, UPDATE, DELETE ... TO service_role`, `ON DELETE CASCADE` on both `api_key_id` columns, catalogue-only verify block (two `to_regclass` and two primary-key lookups), no transaction statements, no `cron.` call, no policy, trigger or function.
- Gate `test_allocator_trade_reads.sql`: 8 arms (anon/authenticated refused SELECT and INSERT with the pinned privilege message; service_role full DML; state erasure and window erasure through both `delete_allocator_api_key` and deleting the auth user; state CHECKs; window CHECKs incl. exact 5000/5001 bound; both primary keys; catalogue and the exact per-role privilege matrix) ending in `ALL 8 ARMS EXECUTED (1,2,3,4,5,6,7,8)`.
- Rollback `down/20261030120000-rollback.sql`: catalogue-only precondition and verify, REVOKE ALL, renames both tables and both primary keys to `*_rolled_back_20261030`; keeps every row; removes nothing.

## Measurements (all on the local-stack lane or the pg-lane; nothing touched TEST, PROD, Railway or a venue)

- RED before the migration existed (local-stack lane, `red.log`):
  `TEST FAILED (1): public.allocator_trade_reads does not exist - this gate has nothing to test and must not skip`.
- Replay line (`lane-up.log`): `baseline-replay: 1 migration(s) newer than the dump: 20261030120000_allocator_trade_reads.sql`.
- GREEN (local-stack lane, `green.log`): `ALL 8 ARMS EXECUTED (1,2,3,4,5,6,7,8)`, no `TEST FAILED`.
- Erasure, both tables, both paths (arms 3 and 4): key delete through `delete_allocator_api_key` and auth-user delete each erased the state row and the window rows on the local-stack lane (full baseline FK chain) and on the pg-lane (with fixture 41); an unrelated user's row stayed in all four cases.
- Census (data-dependence lint, before and after Task 2): `lint-migration-data-dependence: corpus 309 migration(s), 389 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` Baseline file unchanged.
- Mutation runner, `--file supabase/tests/test_allocator_trade_reads.sql` (diagnostic, exits 2 by design):
  `file test_allocator_trade_reads.sql: sections 8 / judged 8 / annotated 8 / waived 0 / biting 8`, `arms: 8/8/0`, `No defects in the narrowed scope.`
  Per arm, each `RED (identity ok)`, i.e. its OWN arm first: arm 1 (SELECT grant to authenticated on the windows table), arm 2 (grant narrowed to SELECT, INSERT), arm 3 (state FK RESTRICT), arm 4 (windows FK RESTRICT), arm 5 (venue CHECK removed), arm 6 (chunk CHECK removed), arm 7 (`chunk_index` out of the windows primary key), arm 8 (FORCE line of the state table removed). No waiver.
- REVOKE drill: backed the migration up byte for byte, deleted the REVOKE line, booted the lane (the mutated file replayed), gate went RED:
  `TEST FAILED (1): authenticated SELECT on allocator_trade_reads answered no error (the read was allowed), expected 42501 permission denied for the table`.
  Restored from the backup; `cmp` exit 0; `git status` showed the migration unmodified.
- Rollback round trip (local-stack lane, `rollback.log`): seeded one state row and one window row as service_role; `psql --single-transaction` rollback printed `Rollback 20261030120000: ...`; the one catalogue-and-count query printed exactly `t|t`; re-applying the migration printed `Migration 20261030120000: ...`; a second rollback attempt was refused by the precondition (`a *_rolled_back_20261030 table already exists`).
- Linters over the new gate and migration: `lint-sql-gates` self-test OK (7 rules) and corpus `scanned 108 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`; `lint-app-guc` self-test OK and `app-guc: findings 0`; `extract-reference-inserts --audit` exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The pg-lane has no `api_keys.user_id` -> `profiles` cascade**
- **Found during:** Task 2 (mutation runner baseline went RED at arm 3, `1 state row(s) outlived their account`).
- **Issue:** the plan's fact "01-fixture-core.sql models the user-deletion chain" is half true: it models `profiles.id -> auth.users` but `api_keys` is a bare `(user_id UUID)` stub (`02-fixture-sanitize-tables.sql`), so deleting the auth user never reached `api_keys` or these tables on the throwaway cluster. The local-stack lane (real dump) has the FK and was green.
- **Fix:** new additive stand-in `scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql` (mirrors `api_keys_user_id_fkey` ... ON DELETE CASCADE, same house style as fixture 26), listed in this gate's `RED-UNDER-SETUP` immediately before the new migration. It must come AFTER `20260420073003_allocator_holdings.sql`, which seeds `api_keys` rows naming no profile (measured: 23503 when placed earlier). No other gate's apply list changed.
- **Files modified:** `scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql` (new, outside the plan's `files_modified`), `supabase/tests/test_allocator_trade_reads.sql`.
- **Commit:** 90d3f7a61

**2. [Rule 1 - Bug in the gate as specified] `n_trades` -1 cannot report `_count_chk`**
- **Found during:** writing arm 6.
- **Issue:** the behaviour block says n_trades -1 is refused by `_count_chk`. PostgreSQL evaluates CHECKs in name order and an array length can never equal -1, so `allocator_trade_read_windows_array_chk` (sorts first) always reports it. Pinning `_count_chk` would be a gate that fails on a correct migration.
- **Fix:** arm 6 pins `_array_chk` for -1 (documented in the arm), proves `_count_chk` through a 5001-element chunk whose array length matches its count, and proves the bound is exact by accepting 5000. All of the plan's other cases are as written.
- **Commit:** b578a730c

**3. Task 1 carried 5 of the 8 twins, not 0.** The twins for arms 3-8 were written with the arms (the plan said they come in Task 2); arms 1 and 2 were added in Task 2. Nothing else differs; the final state matches the plan.

## Known Stubs

None.

## Threat Flags

None. No network endpoint, auth path or function was added; the only new surface is the two tables, which are in the plan's threat model.

## Notes for the orchestrator and later plans

- Plan 06 (census): a new gate file moves the `lint-sql-gates` scanned-file count (108 now), `ci.yml`'s `sql-tests` sentinel census, and the mutation floors (`FILES_FLOOR`, `ARMS_FLOOR`: this file adds 1 annotated file and 8 biting arms). A new pg-lane fixture file (41) exists; no test or script enumerates fixtures by count (searched), so nothing found to move for it.
- Plan 04/07 name cross-check: constraint and column names are exactly those listed in the plan's "Artifacts" section.
- Migration review before merge (orchestrator-owned): migration-reviewer and rls-policy-auditor on the migration, rollback and gate. Baseline re-dump after the PROD apply is the follow-up release commit.
- Local-stack state left behind: stopped (`run.sh down` exit 0, 0 containers, no `.stack-env`). Nothing of another run was found or touched.
- Scratch lives at `/tmp/readceiling-03` (logs, byte backup `mig.bak`, pg-lane workdir); not tracked.

## Self-Check: PASSED

- Created files exist: migration, rollback, gate, fixture 41 (all tracked, committed).
- Commits exist on `wt/171-p03`: b578a730c, 90d3f7a61.
- Both tasks' automated verify blocks printed `OK`.
