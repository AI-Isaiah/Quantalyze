---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 02
subsystem: database
tags: [postgres, role-config, statement_timeout, sql-gate, mutation-runner, supabase, DBACC-03]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 01
    provides: "243-01-MEASUREMENT.md, VERDICT: PREMISE HOLDS, pin anon 3s / authenticated 8s, idle_in_transaction_session_timeout NOT pinned"
provides:
  - "migration 20261127120000: ALTER ROLE anon 3s / authenticated 8s plus a catalogue-only self-check"
  - "gate supabase/tests/test_client_role_timeouts.sql, six twinned arms, ALL 6 ARMS EXECUTED sentinel"
  - "manual rollback that restates the platform values and never RESETs"
affects: [PR-A ship (migration-reviewer, rls-policy-auditor, CHANGELOG), sql-mutation, sql-tests]
tech-stack:
  added: []
  patterns: ["every RED-UNDER-M twin is a `sql` step after the migration, so the migration's own verify block may assert exact values without aborting a mutated apply"]
key-files:
  created:
    - supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql
    - supabase/migrations/down/20261127120000-rollback.sql
    - supabase/tests/test_client_role_timeouts.sql
  modified:
    - scripts/mutation-floors.mjs
    - .github/workflows/ci.yml
    - TODOS.md
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/lint-sql-gates.test.ts
key-decisions:
  - "Arm 3 is scoped to public and graphql_public (the [api].schemas list), with a 3-SETUP anti-vacuity guard because the pg-lane population is 1 function (measured), not 0"
  - "A statement_timeout of 0 (disabled) and an unparseable value both fail arms 1b/2b; a plain `at most N ms` comparison would have passed 0"
  - "Arm 4 needs no neuter: its twin writes a per-database row equal to the pin (3s), so 1a and 1b stay green and arm 4 is the first failure"
requirements-completed: [DBACC-03]
duration: ~95 min
completed: 2026-11-27
commits: 3
plan_head_before: 672d12ca435c0d08e13ad1fd6f8af63aca15d613
plan_head_after: 721498e458a265b5171aa21d18358a6e9d3ea95c
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
---

# Phase 243 Plan 02: client-role statement_timeout pin and gate Summary

Anon 3s and authenticated 8s `statement_timeout` are now pinned in a migration (restating the platform defaults 243-01 measured), guarded by a six-arm pg-lane gate whose every arm goes RED under its own `sql` twin, with the sentinel census, floors and TODOS ledger moved with it.

Tasks 3/3, files 11 touched (3 created, 8 modified), no checkpoint, no auth gate. The three plan commits are `aff46a74f` (task 1, tracer), `3603f3c48` (task 2), `721498e45` (task 3). `git rev-list --count 672d12ca4..HEAD` reads 6 because plan 243-04 committed three of its own commits (`a34f67ddc`, `2fd4fcefb`, `8d7f8476f`) in the same worktree between mine; `commits: 3` above is the count of this plan's own commits, with the three interleaved ones identified by hash rather than silently subtracted.

## Accomplishments

- Migration `20261127120000_client_role_statement_timeout_pin.sql`: `SET LOCAL lock_timeout`, `ALTER ROLE anon SET statement_timeout = '3s'`, `ALTER ROLE authenticated SET statement_timeout = '8s'`, `NOTIFY pgrst`, and one catalogue-only `DO $verify$` block (global row carries the exact element; no per-database row for the current database carries any `statement_timeout`). No BEGIN or COMMIT. `lint-migration-data-dependence` reports 0 NEW.
- Gate `test_client_role_timeouts.sql`, arms 1a, 1b (anon present, effective <= 3000 ms), 2a, 2b (authenticated, <= 8000 ms), 3 (no client-executable function in `public` or `graphql_public` carries its own `statement_timeout`, hoisting guard), 4 (no per-database row shadows the pin), plus `3-SETUP`. The header states that a green catalogue read is not the PostgREST proof; 243-01-MEASUREMENT.md is. No skip-when-unapplied branch.
- Rollback restates the two values and never RESETs a role (acceptance grep: 0 non-comment `RESET`).
- Censuses: `sql-tests` derivation row plus `SENTINEL_FLOOR` 38 -> 39 and `ARMS_FLOOR` 589 -> 595 in `ci.yml`; `FILES_FLOOR` 96 -> 97 and `ARMS_FLOOR` 1079 -> 1085 in `scripts/mutation-floors.mjs`, `WAIVED_CEILING` stays 0; the five census test files follow the measured corpus (`--parse-only`: `coverage: files 97/124`, `arms: 0/1085/0`).
- `TODOS.md`: the `TRIGGERREVOKE-LOCKHOLD-01` entry is deleted (6 lines). The applied migration `20261009150000` names the id in a comment and is untouched (lineage); the new migration's header names it as the reason it exists. The CHANGELOG naming of the closed id is the PR-A ship step's.

## Precondition (Task 1)

- `tail -n 1 243-01-MEASUREMENT.md` printed `VERDICT: PREMISE HOLDS`; its `## Decision for plan 02` names 3s, 8s and `idle_in_transaction_session_timeout is not pinned`.
- Recorded deviation of plan 01 (authenticated and service_role arms not run; the anon arm is the discriminating proof, because `authenticator` itself carries `statement_timeout=8s`) was treated as satisfying any authenticated-hold requirement, per the orchestrator's instruction.
- `verify-plan-anchors.mjs`: `OK: 1 plan file(s), no stale claims.`
- `git fetch origin main`: latest migration on origin/main is `20261126180000_poll_positions_cohort_ccxt_venues.sql`, before `20261127120000`, so no rename was needed.

## Tracer RED/GREEN

Run on the tracer commit (arms 1a and 1b only), each with a fresh workdir. Last ten lines.

RED, without the migration in `--apply` (pg-lane exit 3):

```
psql:scripts/pg-lane/fixtures/01-fixture-core.sql:1: NOTICE:  00000: schema "auth" does not exist, skipping
LOCATION:  does_not_exist_skipping, dropcmds.c:526
BEGIN
psql:supabase/tests/test_client_role_timeouts.sql:108: ERROR:  P0001: TEST FAILED (1a): anon has no role-level statement_timeout. Without one a client statement can hold a table lock for as long as it likes. Migration 20261127120000 pins it at 3s.
CONTEXT:  PL/pgSQL function inline_code_block line 48 at RAISE
LOCATION:  exec_stmt_raise, pl_exec.c:3911
```

GREEN, with the migration (exit 0):

```
psql:scripts/pg-lane/fixtures/01-fixture-core.sql:1: NOTICE:  00000: schema "auth" does not exist, skipping
LOCATION:  does_not_exist_skipping, dropcmds.c:526
psql:supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql:54: WARNING:  25P01: SET LOCAL can only be used in transaction blocks
LOCATION:  CheckTransactionBlock, xact.c:3602
BEGIN
psql:supabase/tests/test_client_role_timeouts.sql:108: NOTICE:  00000: client role timeouts OK: anon carries a role-level statement_timeout (1a) at or below 3000 ms (1b).
LOCATION:  exec_stmt_raise, pl_exec.c:3911
DO
ROLLBACK
```

After the full gate was written, the plan's second verify was re-run (no migration, `grep -ac "TEST FAILED (1a)"`) and printed `1`; the with-migration run printed the `ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4)` sentinel.

Arm 3 population, measured on the pg-lane with the migration applied: `POPULATION=1`, so the `3-SETUP` guard is present (no twin).

## Mutation runner

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_client_role_timeouts.sql`, exit 2 (clean narrowed run):

```
  baseline  supabase/tests/test_client_role_timeouts.sql — exit 0 (2.7s)
  arm 1a                       exit   3  RED (identity ok)  (2.6s)
  arm 1b                       exit   3  RED (identity ok)  (2.5s)
  arm 2a                       exit   3  RED (identity ok)  (2.3s)
  arm 2b                       exit   3  RED (identity ok)  (2.4s)
  arm 3                        exit   3  RED (identity ok)  (2.3s)
  arm 4                        exit   3  RED (identity ok)  (2.4s)
  restore   supabase/tests/test_client_role_timeouts.sql — exit 0 (2.2s)
arms: 6/6/0   (executed/annotated/waived)
biting: 6   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 6   (arm lanes actually spawned — tallied inside runLane, independent of the 6 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_client_role_timeouts.sql: sections 4 / judged 6 / annotated 6 / waived 0 / biting 6
No defects in the narrowed scope.
```

Arm 4 needed no `neuter`: its twin writes a per-database row at `3s`, equal to the pin, so arms 1a and 1b stay green and arm 4 is measured as the first failure.

`node scripts/lint-sql-gates.mjs --self-test`: `lint-sql-gates self-test OK: 7 rules, red+green each.` The corpus run: `scanned 124 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` `lint-app-guc`: findings 0.

## PROOF-01

PROOF-01 on the implementation file (the migration), byte backup and `cp` back only, no git restore. The migration's verify block holds the anon pin as the pair `['anon', '3s']` rather than a `statement_timeout=3s` literal, so that pair is the verify block's "anon value"; both places were moved to `60s`, so the neutered copy applies and the gate is what fails.

```
backup ok                                   # cp migration -> scratchpad/pin.sql.bak
---neutered diff                            # sed: '3s' -> '60s' in the ALTER ROLE line and in the verify pair
56c56
< ALTER ROLE anon SET statement_timeout = '3s';
---
> ALTER ROLE anon SET statement_timeout = '60s';
69c69
<   v_pairs text[][] := ARRAY[['anon', '3s'], ['authenticated', '8s']];
---
>   v_pairs text[][] := ARRAY[['anon', '60s'], ['authenticated', '8s']];

### RED (neutered migration)               # the Task 1 pg-lane invocation, full gate
exit=3
psql:supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql:54: WARNING:  25P01: SET LOCAL can only be used in transaction blocks
BEGIN
psql:supabase/tests/test_client_role_timeouts.sql:203: ERROR:  P0001: TEST FAILED (1b): anon statement_timeout 60000 ms is above the 3000 ms ceiling (raw value 60s; 0 means disabled and NULL means unparseable)

### restore                                # cp backup -> migration, then cmp
cmp: no difference (rc=0)

### GREEN
exit=0
psql:supabase/tests/test_client_role_timeouts.sql:203: NOTICE:  00000: ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4): anon carries a role-level statement_timeout (1a) at or below 3000 ms (1b), authenticated carries one (2a) at or below 8000 ms (2b), no function that anon or authenticated may execute in public or graphql_public carries its own statement_timeout (3), and no per-database row shadows the global pin (4).
psql:supabase/tests/test_client_role_timeouts.sql:203: NOTICE:  00000: client role timeouts OK: the catalogue the migrations produce holds the pin; this proves the CATALOGUE, not that PostgREST applies it (243-01-MEASUREMENT.md does).
```

`git status` showed the migration clean of unexpected edits afterwards (it was already committed at `aff46a74f`; the restored bytes equal the committed bytes).

## Local-stack replay

`bash scripts/local-stack/run.sh up` exited 0 (about 1m43s). Docker was up with 0 containers before. The lane replays the migration on top of the dump; a failed replay is FATAL, so exit 0 shows the image's `postgres` role may run `ALTER ROLE` on both roles. Lines from the boot:

```
baseline-currency: carried=344 replay=1 marker-sha=match defects=0
baseline-replay: 1 migration(s) newer than the dump: 20261127120000_client_role_statement_timeout_pin.sql
psql:.../supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql:54: WARNING:  SET LOCAL can only be used in transaction blocks
[local-stack] replayed 20261127120000_client_role_statement_timeout_pin.sql (ledger row written)
[local-stack] replay complete: 1 migration(s) applied on top of the dump
[local-stack] up complete
```

The gate against the lane DSN (read from `scripts/local-stack/.stack-env` with the `ci.yml` sed, loopback confirmed first) printed, with `ON_ERROR_STOP=1`:

```
psql:supabase/tests/test_client_role_timeouts.sql:203: NOTICE:  ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4): anon carries a role-level statement_timeout (1a) at or below 3000 ms (1b), ...
psql:supabase/tests/test_client_role_timeouts.sql:203: NOTICE:  client role timeouts OK: ...
DO
ROLLBACK
```

Arm 3 passed on the local stack's `public` and `graphql_public` schemas, so no Supabase-owned or extension function there carries a `statement_timeout` setting for a client-executable function. `bash scripts/local-stack/run.sh down` exited 0; `docker ps --filter name=supabase -q | wc -l` printed `0` and `docker ps -q | wc -l` printed `0`.

## Deviations from Plan

**1. [Environment] First DIAGNOSTIC runner run exited 1 with `dirty-checkout`, second exited 2.**
- **Found during:** Task 2 step 3.
- **Issue:** the runner asserts the working tree is unchanged by its run; plan 243-04 was editing `src/app/api/og/factsheet/**` in the same worktree at the same time, which the runner read as the run changing the tree (the listed paths were all plan 04's). Not a defect in this gate: `arms: 6/6/0`, `biting: 6` and every arm `RED (identity ok)` were already printed in that run.
- **Fix:** re-ran once the other executor's tree was between edits; exit 2, `No defects in the narrowed scope`. The lines pasted above are from the exit-2 run.

**2. [Design, within the plan's latitude] Arms 1b and 2b treat a `0` value as unbounded and an unparseable value as a failure.** A plain `ms <= 3000` comparison would have passed `statement_timeout = 0`, which disables the timeout. Found while writing the unit conversion. Files: `supabase/tests/test_client_role_timeouts.sql`. Commit `3603f3c48`.

**3. [Design] Arm 3 population is 1 on the pg-lane, not 0,** so the plan's conditional `3-SETUP` guard was added (the plan said to add it when above 0).

**Total deviations:** 1 environmental, 2 design notes, 0 auto-fixed bugs. **Impact:** none on scope; the six arms, floors and censuses are as planned.

## Known Stubs

None.

## Known limits

In founder-readable words: this gate proves the role config that the MIGRATIONS produce, on the throwaway PostgreSQL lane and on the local Supabase stack. **Nothing compares the LIVE role config on TEST or PROD against the pin.** A dashboard or platform `ALTER ROLE ... SET statement_timeout` on either project, or a Supabase platform change to the defaults, would go unnoticed until someone reads `pg_db_role_setting` again. The orchestrator decided (plan-check revision 1) not to add a `test-db-drift` arm for it.

Also worth stating plainly:

- The gate's green is a catalogue read. That PostgREST applies the impersonated role's timeout per request is proved by 243-01-MEASUREMENT.md (the anon hold cut at 3.20s and 3.87s, both `57014`), not by this file.
- On the local-stack lane the Supabase image's own defaults may already satisfy arms 1a to 2b, so there the gate is a sanity check; the pg-lane is the lane that proves the migration does anything.
- Arm 3 only covers `public` and `graphql_public` (the exposed schemas). A function-level `statement_timeout` in another schema is not reachable through `/rest/v1/rpc` and is deliberately out of scope.
- `ALTER ROLE ... SET` is cluster-level and absent from `supabase/schema/baseline.sql`; this migration and gate are the only repo-side record.

CHANGELOG notes: The client-role `statement_timeout` pin (anon 3s, authenticated 8s) and its gate prove only what the migrations produce; nothing compares the live role config on TEST or PROD against it, so a dashboard or platform `ALTER ROLE` there goes unnoticed.

For the PR-A ship step: close `TRIGGERREVOKE-LOCKHOLD-01` by name in the CHANGELOG entry (its `TODOS.md` entry is already deleted here); merge precondition is migration-reviewer and rls-policy-auditor each returning no MEDIUM or higher finding for `20261127120000_client_role_statement_timeout_pin.sql`. No `supabase db push` was run (this checkout's CLI is linked to PRODUCTION); the schema proof is the pg-lane plus the local-stack replay.

## Threat Flags

None. The migration changes role config through the existing apply role and adds no endpoint, auth path or file access.

## Next Phase Readiness

Plan 02 is ready for the PR-A review lanes. Nothing in this plan blocks a later plan.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql, supabase/migrations/down/20261127120000-rollback.sql, supabase/tests/test_client_role_timeouts.sql
- FOUND commits: aff46a74f, 3603f3c48, 721498e45
- Acceptance greps: `ALTER ROLE anon ... '3s'` 1, `authenticated ... '8s'` 1, `BEGIN;|COMMIT;` 0, RED-UNDER-M 6, RED-UNDER 6, rollback non-comment RESET 0, ci.yml derivation row 1, `Phase 243 DBBACKSTOP, plan 02` in mutation-floors 2, `WAIVED_CEILING = 0` 1, `TRIGGERREVOKE-LOCKHOLD-01` in TODOS.md 0, supabase containers 0.
- Census tests pass: ci-anti-skip-gate contract + drift-check-scripts (984 tests), mutation-runner-floors (133), mutation-annotation-parser (108), lint-sql-gates + local-stack-lane-wiring + gate-family-meta (169); `npm run lint` exit 0 (4 pre-existing warnings in other plans' test files).
