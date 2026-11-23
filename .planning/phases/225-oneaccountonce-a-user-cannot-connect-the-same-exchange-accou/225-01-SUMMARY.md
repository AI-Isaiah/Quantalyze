---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 01
subsystem: database
tags: [postgres, migration, supabase, api_keys, wizard-rpc, mutation-gate, conn-03]
requires: []
provides:
  - "api_keys.venue_server: nullable plaintext column with the named CHECK api_keys_venue_server_valid, ungranted to anon and authenticated"
  - "create_wizard_strategy with exactly one overload, 13 parameters, trailing p_venue_server TEXT DEFAULT NULL stored as NULLIF(lower(btrim(p_venue_server)), '') in the same INSERT that stamps venue_account_id"
  - "hand-edited generated types: api_keys.venue_server and create_wizard_strategy p_venue_server"
affects: [225-02, 225-03, 225-04, 225-05, 225-10]
tech-stack:
  added: []
  patterns:
    - "DROP FUNCTION then CREATE FUNCTION with the REVOKE/GRANT pair re-issued in the same migration"
    - "catalogue-only self-verify (no data-reading DO block)"
key-files:
  created:
    - supabase/migrations/20261123180000_api_keys_venue_server.sql
    - supabase/migrations/down/20261123180000-rollback.sql
  modified:
    - supabase/schema/functions/create_wizard_strategy.sql
    - supabase/tests/test_api_keys_venue_identity_uniq.sql
    - src/lib/database.types.ts
    - src/lib/sec-005-api-keys-projection.test.ts
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
key-decisions:
  - "Followed founder ruling Q2 (separate server column); the unique index api_keys_user_exchange_venue_account_uniq is untouched (plan 10 owns it)"
  - "Rollback keeps the column (keep-data rule) and restores only the 12-parameter function and its ACL"
patterns-established:
  - "6v-* arm family in test_api_keys_venue_identity_uniq.sql section 6: call the wizard RPC under a service_role claim, clear the claim right after"
requirements-completed: [CONN-03]
status: complete
commits: 3
plan_head_before: 2ab976392c596434a9a1476127f4f98e88116bae
plan_head_after: 26253466b64c2992c1a3300940e6169d1db1e0b4
estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 3
  confidence: low
actuals:
  tokens: 22500
  tasks: 3
  commits: 3
metrics:
  completed: 2026-11-23
---

# Phase 225 Plan 01: venue_server column and 13-parameter create_wizard_strategy Summary

**Migration A1 of CONN-03: a nullable, ungranted, CHECKed `api_keys.venue_server` plus a single-overload 13-parameter `create_wizard_strategy` that stores the normalised broker server in the same INSERT as the login, with four biting gate arms and the mutation census moved by measurement.**

## What was built

- `supabase/migrations/20261123180000_api_keys_venue_server.sql` (PR-1, no explicit transaction, `SET LOCAL lock_timeout = '3s'`):
  - `ALTER TABLE public.api_keys ADD COLUMN venue_server text NULL`, CHECK `api_keys_venue_server_valid` (`NULL` or non-blank and at most 128 characters), `COMMENT ON COLUMN`. No grant, not in `API_KEY_USER_COLUMNS_ARR`.
  - `DROP FUNCTION IF EXISTS` the 12-parameter function, then `CREATE FUNCTION` the 13-parameter one, re-based on the latest body (20260814120000): `auth.role()` gate with no `auth.uid()`, the `wizdraft` advisory lock and same-session fence, `attested_venue`. Only the 13th parameter and the added INSERT column differ.
  - `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role` on the 13-type signature, and `COMMENT ON FUNCTION` re-issued.
  - Catalogue-only `DO $verify$`: column text and nullable, exactly one overload, SECURITY DEFINER, service_role EXECUTE, anon and authenticated and PUBLIC none. No row is read. `node scripts/lint-migration-data-dependence.mjs`: `corpus 327 migration(s), 409 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`
  - The unique index is not touched (`grep -a -ci "CREATE UNIQUE INDEX"` on the migration prints 0).
- `supabase/migrations/down/20261123180000-rollback.sql`: manual `psql --single-transaction` rollback with catalogue-only precondition and verify, restoring the 12-parameter function and its ACL pair; keeps the column. Tested on the pg-lane (apply list, then the rollback, then a scratch gate asserting 12-type present and 13-type absent: `ROLLBACK GATE OK`).
- `supabase/schema/functions/create_wizard_strategy.sql` regenerated with `npm run schema:functions` (`schema:functions:check` clean, 136 functions).
- `supabase/tests/test_api_keys_venue_identity_uniq.sql`: `c_sig` and the arm-4 twin moved to the 13-type form; migration appended as the last `RED-UNDER-SETUP` apply entry; four new section-6 arms.
- `src/lib/database.types.ts`: `venue_server` on `api_keys` Row, Insert and Update; `p_venue_server?: string` on the `create_wizard_strategy` Args (alphabetical).
- `src/lib/sec-005-api-keys-projection.test.ts`: one assertion that `API_KEY_USER_COLUMNS_ARR` and the joined string never name `venue_server`. `src/lib/constants.ts` untouched.
- Census (Task 3): `ARMS_FLOOR` 910 -> 914 with a dated RAISED note; registry entry in `gate-family-meta.test.ts`; `armsSeen` 914, `stepsSeen` 1030, `needles.length` 1030 in `mutation-annotation-parser.test.ts`; `totalAnchored` 914 and the synthetic FULL-log literals (910 -> 914, offsets 909/911 -> 913/915, per-file row 8 -> 12) in `mutation-runner-floors.test.ts`. `FILES_FLOOR` unchanged, `WAIVED_CEILING` stays 0 (`grep -a -nE '^export const WAIVED_CEILING = 0;'` prints line 3624).

## Task commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `ce38538de` | migration, rollback, regenerated snapshot, 13-type pin, `6v-writes` tracer arm |
| 2 | `5023a2214` | arms `6v-check-blank`, `6v-omitted`, `6v-no-grant`; hand-edited types; sec-005 assertion |
| 3 | `26253466b` | ARMS_FLOOR and every census counter moved by measurement |

Tracer gate: `<verify>` re-run end to end before expansion (linter 0 NEW, `--file` run exit 2 with `9/9/0` and `6v-writes` RED, `schema:functions:check` clean).

## Measured lines (verbatim)

`node scripts/mutation-runner/run.mjs --parse-only` (exit 0, after Task 2):
```
coverage: files 85/112
arms: 0/914/0   (executed/annotated/waived)
✅ No static defects. Every prose marker has a twin and every needle still matches.
  supabase/tests/test_api_keys_venue_identity_uniq.sql: 12 prose / 12 twin(s) / 0 waiver(s)
```

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_api_keys_venue_identity_uniq.sql` (exit 2 by design, "No defects in the narrowed scope."):
```
  baseline  supabase/tests/test_api_keys_venue_identity_uniq.sql — exit 0
  arm 1 .. arm 6f CCXT: all RED (identity ok)
  arm 6v-writes                exit   3  RED (identity ok)  (3.2s)
  arm 6v-check-blank           exit   3  RED (identity ok)  (3.5s)
  arm 6v-omitted               exit   3  RED (identity ok)  (3.6s)
  arm 6v-no-grant              exit   3  RED (identity ok)  (3.6s)
  restore   supabase/tests/test_api_keys_venue_identity_uniq.sql — exit 0
arms: 12/12/0   (executed/annotated/waived)
biting: 12   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 12   (arm lanes actually spawned — tallied inside runLane, independent of the 12 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
```

Tracer-only run (after Task 1, 8 existing arms + `6v-writes`): `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`, `arm 6v-writes exit 3 RED (identity ok)`.

## PROOF-01

SQL arms: the runner mutates, requires the first `TEST FAILED (<arm>)` to name the arm, and restores the pristine file itself (`restore ... exit 0`, then GREEN baseline at the start of the next run). Each new arm's own line is quoted above (`RED (identity ok)`). Twins: `6v-writes` edits `NULLIF(lower(btrim(p_venue_server)), '')` to `NULL` (occurrences 1, measured with `grep -a -o ... | wc -l`); `6v-check-blank` drops the live CHECK; `6v-omitted` edits the two trailing `DEFAULT NULL` parameters out (occurrences 1, multi-line needle); `6v-no-grant` grants `SELECT (venue_server)` to authenticated.

sec-005 assertion, neuter by byte backup:
```
cp src/lib/constants.ts <scratch>/constants.ts.bak ; add "venue_server" to API_KEY_USER_COLUMNS_ARR
RED:   × does not project api_keys.venue_server (the browser never reads the broker server)
       AssertionError: expected [ 'venue_server', 'id', …(20) ] to not include 'venue_server'
       Tests  1 failed | 6 passed (7)
cp <scratch>/constants.ts.bak src/lib/constants.ts ; cmp -> (no output, CMP_CLEAN) ; git status shows constants.ts unchanged
GREEN: Test Files  1 passed (1) / Tests  7 passed (7)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Gate setup list needed two more fixtures**
- **Found during:** Task 1 (first lane run: baseline exit 3 on `column "api_secret_encrypted" of relation "api_keys" does not exist`).
- **Issue:** the new arms call the wizard RPC under a `service_role` claim, which needs `auth.role()` and the credential columns that the file's old apply list never carried (it never executed the RPC).
- **Fix:** added `scripts/pg-lane/fixtures/15-fixture-auth-role.sql` and `21-fixture-api-keys-credential-columns.sql` to `RED-UNDER-SETUP`, before the migrations, same set `test_wizard_composite_fence.sql` uses. The baseline lane stays GREEN with no new `SKIP (` notice, and arms 1 through 6f still go RED.
- **Files modified:** `supabase/tests/test_api_keys_venue_identity_uniq.sql`
- **Commit:** `ce38538de`, `5023a2214`

**2. [Rule 1 - Bug in the plan's twin] `6v-omitted` twin strips both trailing defaults, not only `p_venue_server`'s**
- **Found during:** Task 2 authoring.
- **Issue:** the plan's twin changes only `p_venue_server TEXT DEFAULT NULL` to `p_venue_server TEXT`. `p_venue_account_id` before it keeps `DEFAULT NULL`, and PostgreSQL refuses a required parameter after one with a default (a `CREATE FUNCTION` error), so the mutated migration would abort at apply and the arm could not be the first failure. (Reasoned from that PostgreSQL rule; the abort itself was not run. The chosen twin was run and bites.)
- **Fix:** the twin edits `p_venue_account_id TEXT DEFAULT NULL,\n  p_venue_server TEXT DEFAULT NULL` to the same two parameters without defaults (a multi-line needle, `occurrences` 1: the bare `p_venue_server TEXT DEFAULT NULL` occurs twice in the file, once in the COMMENT). The arm then fails with 42883 on today's twelve-named-argument call.
- **Commit:** `5023a2214`

**3. [Plan note] Tracer commit carried only the tracer arm**
- The plan puts the tracer arm in Task 1 and the other three in Task 2. The Task 1 commit therefore holds the gate file with `6v-writes` only (the other three arms were written and then added in Task 2), so each commit is its own coherent slice. As the plan's Budget note says, the census files go red between Task 1/2 and Task 3 by design; each commit's own verify passes.

### Recorded, not changed

- `scripts/dump-sql-functions.ts` and `scripts/baseline-content-drift-check.mjs` are **untouched**, as the plan allows. `node scripts/baseline-content-drift-check.mjs --self-test` passes (41 assertions), `COMPARED_FLOOR` stays 138, and `npm run schema:functions:check` plus the DRIFT-05 name-set gate agree (136 names, 0 ratcheted), because the arity change moves no function NAME.
- ⚠️ **`node scripts/baseline-content-drift-check.mjs` now exits 1**, with exactly one new finding: `DRIFT create_wizard_strategy/13 ... differing-lines=4`. This is the documented precedent (`delete_allocator_api_key/2` in the 176 LEGACYRETIRE note: a migration that re-bases a function leaves the committed PROD dump behind until the post-apply re-dump). No allowlist row was added, per the plan. The orchestrator should expect that gate to be red on PR-1 until the baseline is re-dumped from PROD after the apply (project memory: stale-baseline drift red counts as green).
- Other gate files still pin the 12-type signature (`test_api_keys_exchange_not_user_writable.sql` 5h, `test_wizard_composite_fence.sql`, `test_create_wizard_strategy_for_key.sql`). They are outside this plan's `files_modified` and their `RED-UNDER-SETUP` lists do not apply this migration, so the mutation runner is unaffected; plan 03 owns moving them in the same PR. Until it lands, a full-chain `sql-tests` run that replays this migration would redden them.
- Docker is down, so `supabase gen types --local` did not run; `database.types.ts` was hand-edited (RESEARCH A7). `npx tsc --noEmit` is clean.
- Not measured here: a FULL `node scripts/mutation-runner/run.mjs` run (not requested; 914 is the static annotated-unwaived count, an upper bound on biting, as in the floor's own note). CI `sql-mutation` FULL on the PR head SHA owns the real count.

## Verification run

- `node scripts/lint-migration-data-dependence.mjs`: 0 NEW.
- `npm run schema:functions:check`: current (136 functions).
- `npx tsc --noEmit`: clean.
- `npx vitest run src/lib/sec-005-api-keys-projection.test.ts src/__tests__/critical-regressions.test.ts`: 188 passed.
- `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts`: 336 passed.
- Adjacent census/baseline/GDPR/linter vitest files (12 files): 178 passed.
- `node scripts/lint-sql-gates.mjs`: `scanned 112 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`

## Known Stubs

None.

## Threat Flags

None. Threat register items T-225-01 (ACL pair re-issued and catalogue-verified), T-225-02 (no column grant, pinned by `6v-no-grant` and the sec-005 assertion) and T-225-03 (catalogue-only verify, linter 0 NEW, lock_timeout 3s, DEFAULT NULL keeps current callers resolving) are mitigated as planned.

## Notes for the orchestrator and later plans

- Migration timestamp `20261123180000` was already in the past (UTC 18:45) when committed, so no rename is needed on that account. If `migration-policy.yml` reports it as backdated at PR-1, rename the migration, the rollback and the `RED-UNDER-SETUP` entry (and the `RED-UNDER-M` `file` fields of `6v-writes` and `6v-omitted`) in one commit.
- Migration-reviewer and rls-policy-auditor still need to run on PR-1 at ship.
- Plan 04 Task 4's read-only PROD catalogue check should look for the 13-parameter signature and the `venue_server` column before PR-2 merges.

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261123180000_api_keys_venue_server.sql`, `supabase/migrations/down/20261123180000-rollback.sql`, the regenerated `supabase/schema/functions/create_wizard_strategy.sql`.
- FOUND commits `ce38538de`, `5023a2214`, `26253466b` (ancestors of HEAD); `git rev-list --count 2ab976392c596434a9a1476127f4f98e88116bae..HEAD` = 3 before this SUMMARY's own commit.
- STATE.md and ROADMAP.md not modified.
