---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 04
subsystem: database
tags: [postgres, supabase-auth, security-definer, rls, sql-gate, mutation-runner, gap-closure]
status: complete

requires:
  - phase: 164.x SQL gate corpus
    provides: pg-lane, mutation runner, RED-UNDER-M annotation grammar, local-stack replay lane
provides:
  - public.auth_user_has_password(p_user_id uuid) RETURNS boolean, LANGUAGE sql STABLE SECURITY DEFINER, search_path pinned to public, pg_catalog, EXECUTE revoked from PUBLIC, anon, authenticated and granted to service_role
  - down/ rollback for the migration
  - supabase/tests/test_auth_user_has_password.sql, nine twinned arms, every arm mutation-proven
affects: [219-06 change-email route (calls the function), 219-08 census pins, ship step (migration-reviewer, rls-policy-auditor)]

plan_head_before: 8878cb9b58ac9bf62df5a34845fb8ea1f897d408
plan_head_after: e1ceaede00f555a99428070b0cf8c36ae06ceb74

actuals:
  tokens: 5600
  tasks: 2
  commits: 2

key-files:
  created:
    - supabase/migrations/20261120120000_auth_user_has_password.sql
    - supabase/migrations/down/20261120120000-rollback.sql
    - supabase/tests/test_auth_user_has_password.sql
  modified: []

key-decisions:
  - "Body is one EXISTS over auth.users filtered on id, NOT NULL and non-empty: false (never NULL) for an unknown id with no COALESCE to mask a mutation"
  - "Grants: REVOKE ALL FROM PUBLIC, anon, authenticated then GRANT EXECUTE TO service_role (the repo's service_role-only RPC pattern); arm 6's twin removes BOTH the REVOKE gap and the GRANT because the bootstrap default privileges also hand service_role EXECUTE"
  - "Gate RED-UNDER-SETUP trimmed to fixtures 01, 02, 07 plus the migration: the function reads only auth.users, so the profiles chain the analog needs is not applied"
  - "No sentinel notice: no arm returns early or skips, so the ci.yml sentinel census does not move"
  - "Verify block is catalogue-only (to_regprocedure), so a mutated migration still applies and the twins go RED on behaviour"

requirements-completed: [GD-05a, GD-01]

coverage:
  - id: D1
    description: "The function answers true for a non-empty password hash and false (never NULL) for an empty hash, a NULL hash and an unknown id, about the asked id only"
    requirement: "GD-05a"
    verification:
      - kind: other
        ref: "bash scripts/pg-lane/run.sh ... --gate supabase/tests/test_auth_user_has_password.sql (exit 0)"
        status: pass
      - kind: other
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_auth_user_has_password.sql (arms 1, 2, 3, 4 RED, identity ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "service_role may EXECUTE and gets the right answer; anon and authenticated are refused 42501; the function is SECURITY DEFINER with a pinned search_path"
    requirement: "GD-05a"
    verification:
      - kind: other
        ref: "test_auth_user_has_password.sql arms 5a, 5b, 6, 7a, 7b, mutation runner RED (identity ok)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The migration applies on a real Supabase Postgres image via the local-stack boot replay and the gate passes there"
    requirement: "GD-05a"
    verification:
      - kind: other
        ref: "scripts/local-stack/run.sh up (baseline-replay line names the migration, no FATAL), psql gate run green, then run.sh down"
        status: pass
    human_judgment: false
---

# Phase 219 Plan 04: auth_user_has_password Summary

**One service_role-only SECURITY DEFINER boolean, `public.auth_user_has_password(uuid)`, that tells an account with no password from a wrong password (GD-05a), its rollback, and a nine-arm SQL gate where every arm goes RED under its own named mutation.**

PLAN_BASE (`git rev-parse HEAD` before the first edit): `8878cb9b58ac9bf62df5a34845fb8ea1f897d408`.

## What was built

- **Migration** `supabase/migrations/20261120120000_auth_user_has_password.sql`: `SET LOCAL lock_timeout`, `CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog`, whose body is a single `SELECT EXISTS (... FROM auth.users u WHERE u.id = p_user_id AND u.encrypted_password IS NOT NULL AND u.encrypted_password <> '')`. Then `REVOKE ALL ... FROM PUBLIC, anon, authenticated;`, `GRANT EXECUTE ... TO service_role;`, a `COMMENT ON FUNCTION`, and a catalogue-only `DO $verify$` (`to_regprocedure`, no table read). No BEGIN/COMMIT, no data-reading DO block, no other object created or replaced.
- **Rollback** `supabase/migrations/down/20261120120000-rollback.sql`: marker-query note first, ledger-row note, route-502 note, catalogue-only precondition, `DROP FUNCTION IF EXISTS public.auth_user_has_password(uuid);`, catalogue-only verify.
- **Gate** `supabase/tests/test_auth_user_has_password.sql`: nine arms (1, 2, 3, 4, 5a, 5b, 6, 7a, 7b), each with a prose `RED-UNDER:` line and a column-0 `RED-UNDER-M:` twin. `RED-UNDER-SETUP` apply list: fixtures 01, 02, 07, then the migration (see decision on trimming below).

## Task Commits

1. **Task 1 (tracer): migration, rollback, gate arm 1** - `109c046d6` (feat)
2. **Task 2: eight more arms, every twin proven** - `e1ceaede0` (test)

## Verification evidence (all re-run at the final tree)

- **pg-lane plain run of the final gate:** `LANE_EXIT=0`, closing notice `has-password gate passed: ...`.
- **Mutation runner, full file:** `baseline exit 0`; arms `1, 2, 3, 4, 5a, 5b, 6, 7a, 7b` each `exit 3  RED (identity ok)`; `restore exit 0`; `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`, `sections 7 / judged 9 / annotated 9 / waived 0 / biting 9`, `No defects in the narrowed scope.` (`--file` never exits 0 by design; the verdict is the printed line.)
- **Task 1 byte-backup neuter (arm 1):** `cp -p` migration to scratchpad, appended `AND false` to the filter line, pg-lane gate `LANE_EXIT=3` with `ERROR:  P0001: TEST FAILED (1): auth_user_has_password answered false for a user with a non-empty password hash, expected true`; `cp -p` restore, `cmp` exit **0**, re-run `LANE_EXIT=0` green.
- **Task 2 byte-backup neuter (arm 3):** `cp -p` migration to scratchpad, dropped the ` AND u.encrypted_password <> ''` term, pg-lane gate `LANE_EXIT=3` with `ERROR:  P0001: TEST FAILED (3): auth_user_has_password answered true for a user whose password hash is the empty string, expected false`; `cp -p` restore, `cmp` exit **0**, re-run `LANE_EXIT=0` green. `git status` showed the migration unmodified afterwards (no git checkout/restore/stash used).
- **Local-stack, measured (not UNMEASURED):** `docker ps` showed no running stack and the 13 Supabase images were cached, so `scripts/local-stack/run.sh up` was run (64 s). Its boot printed `baseline-currency: carried=324 replay=2 marker-sha=match defects=0` and `baseline-replay: 2 migration(s) newer than the dump: 20261119120000_sync_profile_email_from_auth.sql 20261120120000_auth_user_has_password.sql`, then `replayed 20261120120000_auth_user_has_password.sql (ledger row written)`, `replay complete: 2 migration(s) applied on top of the dump`; no `FATAL` line. The loopback DSN passed `capability-probe.mjs --refuse-nonlocal-dsn` (`loopback-dsn: OK`). `psql ... -v ON_ERROR_STOP=1 -f supabase/tests/test_auth_user_has_password.sql` passed both after Task 1 (arm 1) and after Task 2 (all nine arms, closing notice, `ROLLBACK`), and a follow-up count of `hp-%@quantalyze.test` users returned 0. I booted that stack, so `run.sh down` was run at the end (`down complete`, 0 containers).
- **Lints:** `lint-migration-data-dependence`: `83 refusal(s), 83 allowlisted, 0 NEW`; `lint-sql-gates`: `scanned 112 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`; `lint-app-guc --self-test` OK and corpus `app-guc: findings 0`; `check-baseline-currency --replay-set`: `baseline-replay: 2 migration(s) newer than the dump: 20261119120000_sync_profile_email_from_auth.sql 20261120120000_auth_user_has_password.sql`.
- **tsc:** `npx tsc --noEmit` exit 0.
- **Acceptance greps:** migration non-comment lines carry exactly one service_role GRANT; 0 `BEGIN`/`COMMIT`; gate has 9 `RED-UNDER-M` lines with identities exactly `1 2 3 4 5a 5b 6 7a 7b`, 0 `ARMS EXECUTED`, 0 `SKIP (`; `git status --porcelain supabase/schema/` printed nothing. No command in this run used `db push`, `--db-url`, `--linked` or `--project-ref`, and the only connection string used was the loopback lane DSN (`127.0.0.1`).

## Decisions and notes

- **RED-UNDER-SETUP trimmed (plan allowed it when green and every twin bites):** the plan said to start from `test_profiles_email_sync.sql`'s list, remove its migration, append this one. I trimmed further to fixtures `01`, `02`, `07` plus the migration, because this function reads only `auth.users` and the profiles fixtures/migrations in that list exist to make a profile per seeded user. Fixture 02 supplies `auth.users.encrypted_password` (a sql body is validated at CREATE time) and 07 makes the REVOKE arms falsifiable. Measured green on the pg-lane and the local-stack lane (which ignores the list and uses the real schema), and all nine twins bite.
- **No twin needed reordering or retargeting**; the ORDER derived in the plan (catalogue arms 5a/5b before arm 6) held on the first run.
- **Comment-text discipline held:** every twin `find` occurs exactly once in the migration (the runner's `identity ok` proves it). The header says "SECURITY DEFINER" in prose, so arm 5a's find includes the preceding `STABLE` line to stay unique.

## Deviations from Plan

None - plan executed exactly as written. (The only judgment calls are the RED-UNDER-SETUP trim and the local-stack boot being possible this time, both recorded above.)

## Known Stubs

None.

## Threat Flags

None. The new surface (one RPC-callable function) is the plan's own threat model (T-219-14 to T-219-18); the gate pins T-219-14 (arms 7a, 7b), T-219-15 (arm 2) and T-219-16 (arms 5a, 5b). T-219-17: the function returns one boolean and no column.

## Hand-offs

- **D-09 (review step, not an executor task):** migration-reviewer and rls-policy-auditor must both be CLEAN on `20261120120000_auth_user_has_password.sql` and its rollback before merge.
- **Plan 219-08:** this plan did not edit `supabase/schema/baseline-carried-migrations.txt`, the baseline, `supabase/schema/functions/` or any census pin; the new gate file and migration move those censuses (NAME_SET_RATCHET row, COMPARED_FLOOR, snapshot header). Not run here.
- **Plan 219-06:** calls `admin.rpc("auth_user_has_password", { p_user_id: user.id })`; wire contract unchanged.
- **Ship:** the shipper re-picks the `20261120120000` timestamp against origin/main; the rename touches every file found by `grep -rlna 20261120120000 supabase scripts src .planning/phases/219-*`.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261120120000_auth_user_has_password.sql, supabase/migrations/down/20261120120000-rollback.sql, supabase/tests/test_auth_user_has_password.sql
- FOUND commits: 109c046d6, e1ceaede0 (both ancestors of HEAD)
