---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 04
subsystem: database
tags: [postgres, migration, supabase, api_keys, secdef, mutation-gate, mt5d-08, d-18-parity]
requires:
  - phase: 225-01
    provides: api_keys.venue_server and the 13-parameter create_wizard_strategy; ARMS_FLOOR 914 and the census baseline
provides:
  - "public.swap_account_slot(p_new_key uuid, p_old_holder uuid, p_venue_account_id text, p_venue_server text DEFAULT NULL) RETURNS void: the one place that moves an account's holder slot and writes the duplicate marker together, service_role only"
  - "supabase/tests/test_swap_account_slot.sql: 13 arms, each with a RED-UNDER-M twin"
  - "the fourth D-18 twin pinned in TypeScript (migration and snapshot) and Python"
affects: [225-05, 225-06, 225-07, 225-08, 225-09, 225-11, 225-12]
tech-stack:
  added: []
  patterns:
    - "one locked loop reads both rows in id order and writes the D-18 working-ness expression once"
    - "pg_temp helper functions in a gate file return a result token (message, with ' [ROWS CHANGED]' appended when a refused call left a row different), so the arm raises its own TEST FAILED literal"
key-files:
  created:
    - supabase/migrations/20261123180100_swap_account_slot.sql
    - supabase/migrations/down/20261123180100-rollback.sql
    - supabase/schema/functions/swap_account_slot.sql
    - supabase/tests/test_swap_account_slot.sql
  modified:
    - src/lib/account-share-note.test.ts
    - analytics-service/tests/test_derive_allocator_equity_job.py
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
key-decisions:
  - "Followed founder ruling Q1 (admit the working key): the swap moves the slot only from a not-working same-owner holder to a working same-owner key, evaluated inside the function on rows locked FOR UPDATE in id order"
  - "The old holder keeps its own venue_server when it is marked (only its venue_account_id is cleared); the new key is stamped with the passed, normalised server and nothing is inherited from the old holder"
status: complete
commits: 3
plan_head_before: 6a1084ad56cb4a3982587d2a39b1606377510d79
plan_head_after: 0e2c5458bc1a8f606b617ea3f28e0b2f79d947d4
estimate:
  tokens: 115000
  raw_tokens: 115000
  tasks: 4
  confidence: low
actuals:
  tokens: 31000
  tasks: 3
  commits: 3
requirements-completed: []
metrics:
  completed: 2026-11-23
---

# Phase 225 Plan 04: swap_account_slot (MT5D-08) Summary

**Migration A2: one service-role-only SECURITY DEFINER function that moves an account's holder slot from a failing same-owner key to a working one in a single transaction, with a 13-arm twinned gate, the D-18 tuple pinned as its fourth parity twin, and every mutation census moved by measurement.**

Tasks 1-3 are done and committed. **Task 4 (the PROD catalogue gate and PR-1 ship) is PENDING and belongs to the orchestrator.** This SUMMARY deliberately carries no `PROD catalogue gate: PASSED` line; the orchestrator appends it only when both PROD queries pass (see "Task 4" below).

## What was built

- `supabase/migrations/20261123180100_swap_account_slot.sql` (PR-1, no explicit transaction, `SET LOCAL lock_timeout = '3s'`, plain `CREATE FUNCTION` for a new name):
  - One `FOR` loop over `api_keys WHERE id IN (p_new_key, p_old_holder) ORDER BY id FOR UPDATE` reads each row into `v_is_active`, `v_disconnected`, `v_sync_status` and computes working-ness with the D-18 expression written once, in the exact text shape of 20260927180000. The file holds exactly ONE `v_sync_status NOT IN` tuple (header comments do not restate it).
  - Refusals, each `RAISE EXCEPTION '<TOKEN>'` with a static DETAIL that carries no login or server, in this order: `ACCOUNT_SLOT_IDENTITY_MISMATCH` (22023: same key, or blank login; checked before any lock), `ACCOUNT_SLOT_NOT_FOUND` (P0002), `ACCOUNT_SLOT_NOT_SAME_OWNER` (42501), `ACCOUNT_SLOT_NOT_LIVE` (55000), `ACCOUNT_SLOT_IDENTITY_MISMATCH` (exchanges differ, old holder's login is not the named login, both servers set and different after normalisation, old holder itself marked, new key already stamped, new key marked against another key), `ACCOUNT_SLOT_HOLDER_WORKING` (55000), `ACCOUNT_SLOT_NEW_KEY_NOT_WORKING` (55000), `ACCOUNT_SLOT_COMPOSITE_DEPENDENT` (23000).
  - Writes, in the order the real marker trigger and the unique index force: (a) unmark the new key if it is marked, (b) re-point every `duplicate` dependent of the old holder at the new key, (c) ONE update on the old holder (`venue_account_id` NULL, marked `duplicate` against the new key), (d) stamp the new key (login and `NULLIF(lower(btrim(server)), '')`). Nothing is disconnected or deleted.
  - `COMMENT ON FUNCTION` with the contract and token list; `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`; catalogue-only `DO $verify$` (one overload, `prosecdef`, `search_path` in `proconfig`, `has_function_privilege` for service_role/anon/authenticated, `aclexplode` grantee 0). No table row is read: `node scripts/lint-migration-data-dependence.mjs` printed `corpus 328 migration(s), 410 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`
- `supabase/migrations/down/20261123180100-rollback.sql`: `DROP FUNCTION` with a catalogue-only verify; no data involved.
- `supabase/schema/functions/swap_account_slot.sql` generated by `npm run schema:functions`.
- `supabase/tests/test_swap_account_slot.sql`: setup list is `test_api_keys_account_identity.sql`'s full apply list (which already ends with 20260927180000, so it was not added twice), then `20261123180000_api_keys_venue_server.sql`, then `20261123180100_swap_account_slot.sql`. 13 arms, each with `RED-UNDER:` prose, an adjacent `RED-UNDER-M:` twin (every `occurrences` measured with `grep -a -c -F` and equal to 1) and its own `TEST FAILED (<arm>)` literals. Refusal arms assert the message equals the token AND that a fingerprint of both rows (`venue_account_id`, `venue_server`, `account_shared_with_api_key_id`, `account_share_kind`, `disconnected_at`) is unchanged.
  - Arms: `SWAP-ok`, `SWAP-acl`, `SWAP-repoint`, `SWAP-marked-new`, `SWAP-owner`, `SWAP-holder-working`, `SWAP-inactive-holder`, `SWAP-new-failing`, `SWAP-not-live` (both sides), `SWAP-login`, `SWAP-server-conflict`, `SWAP-composite`, `SWAP-server-wildcard`.
- D-18 parity, fourth twin: `src/lib/account-share-note.test.ts` `it.each` gains the migration and the snapshot; the Python parity test also reads the new migration with the same regex, asserts exactly one tuple and equality with the Python set.
- Snapshot census: `NAME_SET_RATCHET` gains a dated `snapshot-only` row for `swap_account_slot` (`scripts/dump-sql-functions.ts`), `COMPARED_FLOOR` 138 -> 139 with a dated MOVED note (`scripts/baseline-content-drift-check.mjs`). No allowlist row.

## Task commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `6f1ddf80b` | migration, rollback, regenerated snapshot, gate with `SWAP-ok` and `SWAP-acl` |
| 2 | `4edad1355` | eleven more arms, fourth D-18 parity twin (TS and Python), ratchet row, `COMPARED_FLOOR` 139 |
| 3 | `0e2c5458b` | both mutation floors and every census counter, one commit |

Tracer gate: `<verify>` re-run end to end before expansion (linter 0 NEW, `--file` run exit 2 with `arms: 2/2/0`, both arms `RED (identity ok)`).

## Measured lines (verbatim)

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_swap_account_slot.sql` (exit 2 by design, "No defects in the narrowed scope."):
```
  baseline  supabase/tests/test_swap_account_slot.sql — exit 0 (3.6s)
  arm SWAP-ok                  exit   3  RED (identity ok)  (4.3s)
  arm SWAP-acl                 exit   3  RED (identity ok)  (4.7s)
  arm SWAP-repoint             exit   3  RED (identity ok)  (3.9s)
  arm SWAP-marked-new          exit   3  RED (identity ok)  (4.2s)
  arm SWAP-owner               exit   3  RED (identity ok)  (4.3s)
  arm SWAP-holder-working      exit   3  RED (identity ok)  (4.7s)
  arm SWAP-inactive-holder     exit   3  RED (identity ok)  (4.2s)
  arm SWAP-new-failing         exit   3  RED (identity ok)  (5.1s)
  arm SWAP-not-live            exit   3  RED (identity ok)  (5.4s)
  arm SWAP-login               exit   3  RED (identity ok)  (5.6s)
  arm SWAP-server-conflict     exit   3  RED (identity ok)  (5.3s)
  arm SWAP-composite           exit   3  RED (identity ok)  (5.7s)
  arm SWAP-server-wildcard     exit   3  RED (identity ok)  (4.9s)
  restore   supabase/tests/test_swap_account_slot.sql — exit 0 (4.7s)
arms: 13/13/0   (executed/annotated/waived)
biting: 13   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 13   (arm lanes actually spawned — tallied inside runLane, independent of the 13 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
```

`node scripts/mutation-runner/run.mjs --parse-only` (exit 0, after Task 3):
```
coverage: files 86/113
arms: 0/927/0   (executed/annotated/waived)
✅ No static defects. Every prose marker has a twin and every needle still matches.
```

Other gates: `node scripts/lint-sql-gates.mjs`: `scanned 113 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` `npm run schema:functions:check`: `SQL function snapshot is current (137 functions).` `node scripts/baseline-content-drift-check.mjs --self-test`: 41 assertions OK. The four census vitest files: 336 passed. Adjacent drift-gate vitest files (baseline-content-drift-allowlist, drift-check-scripts, status-bridge-side-kinds-drift): 953 passed.

## PROOF-01

SQL arms: proven by their twins (runner lines above; the runner restores the pristine gate and migration itself, and the baseline leg and the `restore ... exit 0` line bracket the run).

Parity tests, neuter by byte backup (`cp` to the scratchpad, edit in place, run both tests, restore by `cp`, `cmp`, rerun):
```
cp supabase/migrations/20261123180100_swap_account_slot.sql <scratch>/swap.sql.bak
sed: NOT IN ('revoked', 'sign_in_failed', 'error')  ->  NOT IN ('revoked', 'sign_in_failed', 'erro')   (grep -a -c "'erro')" -> 1)
RED TS:  × supabase/migrations/20261123180100_swap_account_slot.sql
         AssertionError: expected [ 'erro', 'revoked', 'sign_in_failed' ] to deeply equal [ Array(3) ]
         Tests  1 failed | 28 passed (29)
RED PY:  > assert swap_set == set(NOT_WORKING_SYNC_STATUSES), (   [test_working_holder_status_set_matches_ts_and_sql fails on the new file's line]
cp <scratch>/swap.sql.bak supabase/migrations/20261123180100_swap_account_slot.sql ; cmp -> (no output, CMP_SILENT) ; git status shows the migration unmodified
GREEN TS: Tests  29 passed (29)
GREEN PY: 1 passed, 158 deselected
```

## Moved values (Task 3, each read from a failing test or a measured run)

- `scripts/mutation-floors.mjs`: `FILES_FLOOR` 85 -> 86, `ARMS_FLOOR` 914 -> 927, each with a dated RAISED note quoting the parse-only lines. `WAIVED_CEILING` stays 0 (`grep -a -nE '^export const WAIVED_CEILING = 0;'` prints line 3635).
- `src/__tests__/gate-family-meta.test.ts`: registry keys `FILES_FLOOR=86` and `ARMS_FLOOR=927`, each with a new MEASURED lineage entry.
- `src/__tests__/mutation-annotation-parser.test.ts`: `armsSeen` 914 -> 927, `stepsSeen` 1030 -> 1042, `needles.length` 1030 -> 1042 (twelve `edit` steps; the one `sql` step of `SWAP-acl` is skipped by that walk), `filesTotal` 112 -> 113 (two sites), `filesAnnotated` 85 -> 86, `annotatedFiles` length 85 -> 86, and `test_swap_account_slot.sql` added to the by-name list.
- `src/__tests__/mutation-runner-floors.test.ts`: `totalAnchored` 914 -> 927 and the synthetic FULL log (arms, biting, lane-invocations, mean line, `scope: FULL 86/86`, `coverage: files 86/113`, `plus 86 baseline / 86 restore`, offsets 926/928, `printed 87 per-file row(s) but reported 86`, SUBSET denominator 86), plus one new per-file row for the swap gate.
- `src/__tests__/lint-sql-gates.test.ts`: corpus file count 112 -> 113.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's `<verify>` lists `npm run schema:functions:check`, but it can only pass once the snapshot-only ratchet row exists, which the plan assigns to Task 2**
- **Found during:** Task 1 (the check printed `snapshot-only: swap_account_slot` and exited 1 after the snapshot was generated).
- **Fix:** committed Task 1 with the check red as the plan's own task split implies, then added the ratchet row and the `COMPARED_FLOOR` move in Task 2 (the plan's action for Task 2) and re-ran the check green. The Task 1 commit alone therefore does not pass that one check; the Task 2 commit does.
- **Commit:** `4edad1355`

**2. [Rule 1 - Bug in the plan's verify command] `pytest -k parity` selects no test**
- **Found during:** Task 2. The existing test is `test_working_holder_status_set_matches_ts_and_sql`; no test name contains `parity` (it is in the docstring only), so the plan's `-k parity` printed `159 deselected` and would exit 5 ("no tests ran"), which the plan's own `fails_when` treats as failure.
- **Fix:** ran `python3 -m pytest tests/test_derive_allocator_equity_job.py -x -q -k working_holder_status_set` (1 passed), and used the same filter for the PROOF-01 RED and GREEN runs. The test was not renamed.

### Recorded, not changed

- ⚠️ **`node scripts/baseline-content-drift-check.mjs` exits 1 with 2 findings**, both expected until the post-apply re-dump: `DRIFT create_wizard_strategy/13` (plan 01) and `SNAPSHOT_MISSING swap_account_slot/4` (this plan). Reading: `functions compared 139 - MATCH 134, DRIFT 4, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`. No allowlist row was added (project memory: stale-baseline drift red counts as green).
- **Plan 03 overlap:** this worktree's census numbers (`ARMS_FLOOR` 927, `FILES_FLOOR` 86, `coverage: files 86/113`) were measured WITHOUT plan 225-03's edits. Plan 03 edits three existing gate files (`test_api_keys_exchange_not_user_writable.sql`, `test_wizard_session_idempotency.sql`, `test_wizard_composite_fence.sql`). If it adds or removes any annotated arm, the orchestrator must re-measure `--parse-only` after merging both branches and move `ARMS_FLOOR`, `gate-family-meta`, `armsSeen`, `stepsSeen`, `needles.length` and `totalAnchored` to the merged reading (a file count change is not expected).
- **Refusals with no dedicated arm** (the plan names exactly the 13 arms above): `ACCOUNT_SLOT_NOT_FOUND`, the exchange-mismatch, old-holder-is-marked, new-key-already-stamped and new-key-marked-against-another-key legs of `ACCOUNT_SLOT_IDENTITY_MISMATCH`, and the same-key and blank-login guard. They are reachable only through a caller that already resolved the ids, and each leaves the stable state of today; they are not pinned by a twin here.
- A FULL `node scripts/mutation-runner/run.mjs` run was not made (not requested; 927 is the static annotated-unwaived count, an upper bound on biting). CI `sql-mutation` FULL on the PR head owns the real count.
- Docker is down, so no local-stack lane ran; every SQL result above is from the pg-lane (PG16 binaries).

## Known limit (required by the plan)

A holder that has a `composite_member` dependent is **never swapped** (`ACCOUNT_SLOT_COMPOSITE_DEPENDENT`; composites are out of scope by F-2 / Q4). A failing holder inside a composite therefore keeps its slot and the working key stays marked `duplicate`, which is today's state. "Keeps failing" is read as "fails D-18 at the moment the swap is evaluated" (`sync_status` in revoked, sign_in_failed, error, or the key is inactive); there is no count of consecutive failures, and a stricter threshold would need a founder ruling.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-225-10 (cross-tenant takeover: same-owner asserted inside the function, pinned by `SWAP-owner`; EXECUTE to service_role only, pinned by `SWAP-acl` and the migration's own catalogue verify), T-225-11 (D-18 evaluated inside the function on locked rows: `SWAP-holder-working`, `SWAP-new-failing`, `SWAP-inactive-holder`) and T-225-12 (token messages and static DETAIL carry no login or server) are mitigated as planned. T-225-13 is accepted as planned.

## Task 4 (PENDING: orchestrator)

Task 4 is a `checkpoint:human-action` (`gate="blocking"`). The executor has no Supabase MCP and no PROD access, opened no PR and pushed nothing. The orchestrator does the following, and appends the marker answer, both query results verbatim and the line `PROD catalogue gate: PASSED` (only when both pass) to this SUMMARY after PR-1 merges:

1. When waves 1 and 2 are complete, open PR-1 (plans 01-04). It must be the only open PR touching `supabase/migrations`, and migration-reviewer and rls-policy-auditor must be clean at MEDIUM+ before the merge.
2. Merge it, then wait for `supabase-migrate.yml`'s `apply-test` and `apply` jobs on the merge SHA to conclude success.
3. Through the PROD Supabase MCP, read-only, one query per call: run `docs/runbooks/oneaccountonce/marker.sql` first and STOP if the answer is NULL or does not name PROD.
4. Catalogue query: `SELECT p.oid::regprocedure::text AS signature, p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec, has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('create_wizard_strategy', 'swap_account_slot') ORDER BY 1;` Pass: exactly two rows, `create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text,text)` and `swap_account_slot(uuid,uuid,text,text)` (with or without a `public.` prefix), each `prosecdef` true, `authenticated_exec` false, `service_role_exec` true.
5. Column query: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'venue_server';` Pass: one row, `text`, `YES`.
6. Any non-pass: STOP, report it, and do not start wave 3.

Notes for PR-1: the migration timestamps `20261123180000` and `20261123180100` are in the past at ship time, so `migration-policy.yml` may flag one as backdated; if so, rename migration, rollback, `RED-UNDER-SETUP` entry and the twins' `file` fields in one commit. `baseline-content-drift` will be red on PR-1 until the PROD re-dump (see above), and the two ratchet rows (`swap_account_slot`) clear then.

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261123180100_swap_account_slot.sql`, `supabase/migrations/down/20261123180100-rollback.sql`, `supabase/schema/functions/swap_account_slot.sql`, `supabase/tests/test_swap_account_slot.sql`.
- FOUND commits `6f1ddf80b`, `4edad1355`, `0e2c5458b` (ancestors of HEAD); `git rev-list --count 6a1084ad56cb4a3982587d2a39b1606377510d79..HEAD` = 3 before this SUMMARY's own commit.
- STATE.md and ROADMAP.md not modified.
