---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 05
subsystem: database
tags: [postgres, security-definer, trigger, sql-gate, mutation-runner, supabase, DBACC-02]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 02
    provides: "census baselines SENTINEL_FLOOR 39 / ARMS_FLOOR 595, FILES_FLOOR 97 / ARMS_FLOOR 1085"
provides:
  - "migration 20261127120100: public.insert_api_key (SECURITY DEFINER, service_role only, one overload) and the api_keys_user_id_immutable trigger"
  - "gate test_insert_api_key_rpc.sql, eight twinned arms R1..R8, ALL 8 ARMS EXECUTED sentinel"
  - "gate test_api_keys_user_id_immutable.sql, six twinned arms 1a, 1b, 2a, 2b, 3, 4, ALL 6 ARMS EXECUTED sentinel"
  - "manual rollback with a deploy-order warning"
  - "generated function dumps and two dated NAME_SET_RATCHET rows"
affects: [PR-B (route, seeds, e2e move to insert_api_key), PR-C (insert fence), migration-reviewer, rls-policy-auditor, sql-mutation, sql-tests]
tech-stack:
  added: []
  patterns:
    - "an arm that another arm's twin neuters carries exactly ONE RAISE: the runner's neuter replaces a single RAISE per arm, so a multi-raise arm reports neuter-missed"
    - "a pg_temp caller that returns 'OK|id' or 'SQLSTATE|message' lets an arm assert after RESET ROLE instead of inside a handler (lint rule R1)"
key-files:
  created:
    - supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql
    - supabase/migrations/down/20261127120100-rollback.sql
    - supabase/tests/test_insert_api_key_rpc.sql
    - supabase/tests/test_api_keys_user_id_immutable.sql
    - supabase/schema/functions/insert_api_key.sql
    - supabase/schema/functions/enforce_api_keys_user_id_immutable.sql
  modified:
    - scripts/mutation-floors.mjs
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/lint-sql-gates.test.ts
key-decisions:
  - "p_id uuid DEFAULT NULL is part of the frozen insert_api_key signature (seeds key later rows on a caller-chosen id; the route never passes it)"
  - "The immutability trigger has NO column list and is named api_keys_user_id_immutable so it sorts after api_keys_account_share_same_owner and api_keys_lock_exchange and judges the final row"
  - "No NAME_SET allowlist row and no CONTENT_DRIFT_ALLOWLIST row suppresses the two SNAPSHOT_MISSING findings; raising COMPARED_FLOOR records the functions joining the corpus and suppresses nothing"
requirements-completed: [DBACC-02]
duration: ~1h 50m
completed: 2026-11-27
commits: 4
plan_head_before: a8a40a760b09382aeb22e471fb18e6ff4454a627
plan_head_after: c3744964499ffb2911da37fb8a4c5ed503168561
actuals:
  tokens: 36500
  tasks: 4
  commits: 4
---

# Phase 243 Plan 05: insert_api_key writer and api_keys.user_id immutability Summary

An audited, postgres-owned SECURITY DEFINER writer `public.insert_api_key` (service_role only, attests the venue, normalises login and server, one overload) and a BEFORE UPDATE trigger that refuses any change of `api_keys.user_id` from every role including the table owner and BYPASSRLS service_role, guarded by two twinned gates (8 and 6 arms, all biting), with every census moved.

Tasks 4/4, 15 files touched (6 created, 9 modified), no checkpoint, no auth gate. Commits: `e78d7cf8b` (task 1, tracer), `80861645b` (task 2), `3f0c806d1` (task 3), `c37449644` (task 4). `git rev-list --count a8a40a760..HEAD` reads 4, equal to this plan's commits (the worktree ran this plan alone).

## Final signature (PR-B plans copy it exactly)

```sql
public.insert_api_key(
  p_user_id uuid,
  p_exchange text,
  p_label text,
  p_api_key_encrypted text,
  p_api_secret_encrypted text DEFAULT NULL,
  p_passphrase_encrypted text DEFAULT NULL,
  p_dek_encrypted text DEFAULT NULL,
  p_nonce text DEFAULT NULL,
  p_kek_version integer DEFAULT NULL,
  p_venue_account_id text DEFAULT NULL,
  p_venue_server text DEFAULT NULL,
  p_id uuid DEFAULT NULL
) RETURNS uuid
```

Argument type list for GRANT / COMMENT / `to_regprocedure`: `uuid, text, text, text, text, text, text, text, integer, text, text, uuid`. `p_kek_version` NULL stores 1. `is_active` is omitted (table default true). A duplicate venue identity raises 23505 whose message names `api_keys_user_exchange_venue_account_uniq` (no handler around the INSERT). `service_role` only: `anon`, `authenticated` and PUBLIC EXECUTE are revoked, and the body refuses any JWT role but `service_role` with 42501 `insert_api_key: caller role (<role>) may not write api_keys`. Trigger: `api_keys_user_id_immutable`, function `enforce_api_keys_user_id_immutable()` (SECURITY INVOKER).

## Accomplishments

- Migration `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql`: `SET LOCAL lock_timeout`, STEP 1 the writer with its REVOKE/GRANT pair and COMMENT, STEP 2 the trigger function (unconditional RAISE, 42501, no row value) and the trigger with `WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)` and NO column list, and one catalogue-only `DO $verify$` (one overload, SECURITY DEFINER, pinned search_path, ACL, trigger function not SECURITY DEFINER, one trigger of that name). No BEGIN or COMMIT. `lint-migration-data-dependence`: `0 NEW`. The normalisation expressions were copied from the latest `create_wizard_strategy` (`20261123180000`, no later migration redefines it).
- Gate `test_insert_api_key_rpc.sql`: R1 attested row lands, R2 ACL, R3 in-body gate (authenticated claims, no claims, malformed claims), R4 one overload + SECDEF + search_path, R5 normalisation (padded mixed-case server, blank server, blank login, value already in the route's normal form), R6 `p_id`, R7 NULL owner 22023, R8 duplicate 23505 naming the constraint.
- Gate `test_api_keys_user_id_immutable.sql`: 1a structure (tgtype equal to 19, enabled, WHEN text, no `UPDATE OF`, function not SECDEF, no client EXECUTE), 1b firing order, 2a owner refused, 2b service_role refused, 3 same-value / same-owner upsert / other-column writes pass, 4 a rewriting BEFORE trigger cannot repoint a key.
- Rollback `down/20261127120100-rollback.sql` with the never-after-PR-B warning.
- Generated dumps `supabase/schema/functions/insert_api_key.sql` and `enforce_api_keys_user_id_immutable.sql` (`npm run schema:functions`), plus two dated `snapshot-only` rows in `NAME_SET_RATCHET`.
- Censuses moved (details below).

## Tracer RED/GREEN

Task 1 commit (arms R1 and 2a only), each lane with a fresh `mktemp -d` workdir. Last lines.

RED, without the migration in `--apply`:

```
test_insert_api_key_rpc.sql (exit 3, undefined function, as the plan predicted)
HINT:  No function matches the given name and argument types. You might need to add explicit type casts.
QUERY:  v_id := public.insert_api_key(v_owner, 'deribit', 'iak-r1', 'x')
CONTEXT:  PL/pgSQL function inline_code_block line 24 at assignment
LOCATION:  ParseFuncOrColumn, parse_func.c:636

test_api_keys_user_id_immutable.sql (exit 3)
psql:supabase/tests/test_api_keys_user_id_immutable.sql:71: ERROR:  P0001: TEST FAILED (2a): an owner UPDATE of api_keys.user_id answered no error (the repoint ran), expected the trigger's 42501 refusal
CONTEXT:  PL/pgSQL function inline_code_block line 38 at RAISE
```

GREEN, with the migration (both exit 0):

```
psql:supabase/tests/test_insert_api_key_rpc.sql:79: NOTICE:  00000: insert_api_key tracer OK: service_role landed an attested row (R1).
DO
ROLLBACK

psql:supabase/tests/test_api_keys_user_id_immutable.sql:71: NOTICE:  00000: api_keys user_id immutable tracer OK: the owner cannot repoint a key (2a).
DO
ROLLBACK
```

## Mutation runner

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_insert_api_key_rpc.sql`, exit 2 (clean narrowed run):

```
  baseline  supabase/tests/test_insert_api_key_rpc.sql — exit 0 (1.2s)
  arm R1                       exit   3  RED (identity ok)  (1.3s)
  arm R2                       exit   3  RED (identity ok)  (1.2s)
  arm R3                       exit   3  RED (identity ok)  (1.2s)
  arm R4                       exit   3  RED (identity ok)  (1.3s)
  arm R5                       exit   3  RED (identity ok)  (1.5s)
  arm R6                       exit   3  RED (identity ok)  (2.1s)
  arm R7                       exit   3  RED (identity ok)  (1.7s)
  arm R8                       exit   3  RED (identity ok)  (1.8s)
  restore   supabase/tests/test_insert_api_key_rpc.sql — exit 0 (1.8s)
arms: 8/8/0   (executed/annotated/waived)
biting: 8   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 8   (arm lanes actually spawned — tallied inside runLane, independent of the 8 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_insert_api_key_rpc.sql: sections 8 / judged 8 / annotated 8 / waived 0 / biting 8
No defects in the narrowed scope.
```

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_api_keys_user_id_immutable.sql`, exit 2:

```
  baseline  supabase/tests/test_api_keys_user_id_immutable.sql — exit 0 (2.9s)
  arm 1a                       exit   3  RED (identity ok)  (2.6s)
  arm 1b                       exit   3  RED (identity ok)  (2.9s)
  arm 2a                       exit   3  RED (identity ok)  (3.0s)
  arm 2b                       exit   3  RED (identity ok)  (2.7s)
  arm 3                        exit   3  RED (identity ok)  (2.5s)
  arm 4                        exit   3  RED (identity ok)  (2.4s)
  restore   supabase/tests/test_api_keys_user_id_immutable.sql — exit 0 (2.4s)
arms: 6/6/0   (executed/annotated/waived)
biting: 6   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 6   (arm lanes actually spawned — tallied inside runLane, independent of the 6 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_api_keys_user_id_immutable.sql: sections 4 / judged 6 / annotated 6 / waived 0 / biting 6
No defects in the narrowed scope.
```

`--parse-only`: `coverage: files 99/126`, `arms: 0/1099/0`. `node scripts/lint-sql-gates.mjs`: `scanned 126 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`

## PROOF-01 (byte backup and `cp` back only; no git restore, checkout or stash)

### PROOF-01 on the writer (the migration)

The attestation neutered: the `attested_venue` VALUE expression in the INSERT replaced by NULL.

```
backup ok                                   # cp migration -> scratchpad/insert_api_key.sql.bak
---neutered diff
157c157
<     p_exchange, NULLIF(btrim(p_venue_account_id, E' \t\r\n'), ''), NULLIF(lower(btrim(p_venue_server, E' \t\r\n')), '')
---
>     NULL, NULLIF(btrim(p_venue_account_id, E' \t\r\n'), ''), NULLIF(lower(btrim(p_venue_server, E' \t\r\n')), '')

### RED (neutered migration, full gate on the pg-lane)
psql:supabase/tests/test_insert_api_key_rpc.sql:260: ERROR:  P0001: TEST FAILED (R1): stored exchange deribit and attested_venue NULL, expected both deribit (the writer attests the exchange)
CONTEXT:  PL/pgSQL function inline_code_block line 48 at RAISE
exit=3

### restore                                # cp backup -> migration, then cmp
cmp: no difference (rc=0)

### GREEN
psql:supabase/tests/test_insert_api_key_rpc.sql:260: NOTICE:  00000: ALL 8 ARMS EXECUTED (R1, R2, R3, R4, R5, R6, R7, R8): service_role lands an attested row (R1), ...
psql:supabase/tests/test_insert_api_key_rpc.sql:260: NOTICE:  00000: insert_api_key OK: the writer contract holds.
exit=0
```

### PROOF-01 on the trigger (the migration)

The refusal neutered: the RAISE of `enforce_api_keys_user_id_immutable` replaced by `RETURN NEW;`.

```
backup ok                                   # cp migration -> scratchpad/trigger.sql.bak
---neutered diff
189,190c189
<   RAISE EXCEPTION 'api_keys.user_id is immutable: a key never changes owner'
<     USING ERRCODE = 'insufficient_privilege';
---
>   RETURN NEW;

### RED (neutered migration, full gate on the pg-lane)
psql:supabase/tests/test_api_keys_user_id_immutable.sql:235: ERROR:  P0001: TEST FAILED (2a): an owner UPDATE of api_keys.user_id answered no error (the repoint ran), expected the trigger's 42501 refusal with the row unchanged (row image changed: t)
CONTEXT:  PL/pgSQL function inline_code_block line 93 at RAISE
exit=3

### restore
cmp: no difference (rc=0)

### GREEN
psql:supabase/tests/test_api_keys_user_id_immutable.sql:235: NOTICE:  00000: ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4): the trigger is BEFORE UPDATE FOR EACH ROW ...
psql:supabase/tests/test_api_keys_user_id_immutable.sql:235: NOTICE:  00000: api_keys user_id immutable OK: no role can change a key's owner.
exit=0
```

Both migration files were restored byte-for-byte (`cmp` silent) and `git status` showed them clean afterwards.

## Local-stack replay

`bash scripts/local-stack/run.sh up` exited 0 (Docker had 0 containers before). Lines from the boot:

```
baseline-currency: carried=344 replay=2 marker-sha=match defects=0
baseline-replay: 2 migration(s) newer than the dump: 20261127120000_client_role_statement_timeout_pin.sql 20261127120100_insert_api_key_rpc_and_user_id_immutable.sql
[local-stack] replayed 20261127120000_client_role_statement_timeout_pin.sql (ledger row written)
[local-stack] replayed 20261127120100_insert_api_key_rpc_and_user_id_immutable.sql (ledger row written)
[local-stack] replay complete: 2 migration(s) applied on top of the dump
[local-stack] up complete
```

Against the lane DSN (read from `scripts/local-stack/.stack-env` with the `ci.yml` sed, loopback confirmed first), `psql -X -v ON_ERROR_STOP=1 -f` exited 0 for all four files:

```
test_insert_api_key_rpc exit=0           ALL 8 ARMS EXECUTED (R1, R2, R3, R4, R5, R6, R7, R8): ...  /  insert_api_key OK: the writer contract holds.
test_api_keys_user_id_immutable exit=0   ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4): ...  /  api_keys user_id immutable OK: no role can change a key's owner.
test_api_keys_insert_not_client_writable exit=0   Assertion 4 OK: owner can still DELETE its own api_keys row (the REVOKE stayed INSERT-only).
test_cleanup_orphaned_api_keys_sweep exit=0       CLEAN-02 Part 3 OK: sanitize_user still deletes api_keys (GDPR account deletion unaffected by the sweep).
```

The last line is the proof that `sanitize_user` completes and deletes the user's keys with the trigger present. `bash scripts/local-stack/run.sh down` exited 0; `docker ps --filter name=supabase -q | wc -l` printed 0 and `docker ps -q | wc -l` printed 0.

## DRIFT-05 census move and expected findings

`npm run schema:functions` wrote the two dumps; `schema:functions:check` first reported `snapshot-only: enforce_api_keys_user_id_immutable` and `snapshot-only: insert_api_key`, then went green after two dated `snapshot-only` rows were added to `NAME_SET_RATCHET` (`SQL function snapshot is current (148 functions)`; `DRIFT-05 gate (a): baseline 146 name(s) vs migration-replay 148 name(s) - agree, with 2 ratcheted disagreement(s) carried`).

`node scripts/baseline-content-drift-check.mjs`, pasted:

```
baseline-content-drift: chain files 148 (supabase/schema/functions/*.sql, sorted)
baseline-content-drift: functions compared 150 — MATCH 145, DRIFT 3, SNAPSHOT_MISSING 2, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: allowlisted rows 3 — check_fan_in_ready/1, reject_sentinel_writes/0, retention_delete_guard/0
baseline-content-drift: findings 2
```

`COMPARED_FLOOR` 148 -> 150 with a dated `MOVED 2026-11-27 (Phase 243 DBBACKSTOP, plan 05), 148 -> 150` note. **Expected findings: exactly two `SNAPSHOT_MISSING`, `insert_api_key/12` and `enforce_api_keys_user_id_immutable/0`.** Their migration is not on PROD yet, so the committed `supabase/schema/baseline.sql` lacks them; they clear at the `chore(release)` re-dump of the baseline taken after PR-A's apply, which also turns the two `NAME_SET_RATCHET` rows `ratchet-stale` so they are DELETED then. No allowlist row was added for either. The CI `baseline-content-drift` step is therefore expected RED with exactly those two findings until the re-dump; any other finding is a defect. `npx vitest run src/__tests__/baseline-content-drift-allowlist.test.ts`: 18 passed.

## Census moves (Task 4)

Measured with `--parse-only`: `coverage: files 99/126`, `arms: 0/1099/0`.

- `scripts/mutation-floors.mjs`: `FILES_FLOOR` 97 -> 99, `ARMS_FLOOR` 1085 -> 1099, dated comments; `WAIVED_CEILING` stays 0.
- `.github/workflows/ci.yml` `sql-tests`: two derivation rows (`test_api_keys_user_id_immutable.sql` 6, `test_insert_api_key_rpc.sql` 8), `SENTINEL_FLOOR` 39 -> 41, `ARMS_FLOOR` 595 -> 609 and its trailing sum (+ 8 + 6), one `# Re-measured` note.
- `drift-check-scripts.test.ts` (`SENTINEL_FLOOR=41` / `ARMS_FLOOR=609` pins), `gate-family-meta.test.ts` (two `mutation-floors.mjs ::` pins), `mutation-annotation-parser.test.ts` (`armsSeen` 1099, `stepsSeen` and `needles.length` 1232 -> 1242, `filesTotal` 126, `filesAnnotated` 99, `annotatedFiles` 99, both names in the by-name list in sorted position), `mutation-runner-floors.test.ts` (`totalAnchored` 1099, the `coverage: files` and `GREEN_LOG` literals, two new per-file rows), `lint-sql-gates.test.ts` (`scanned 126 file`).
- `stepsSeen` +10: six file steps in `test_insert_api_key_rpc.sql` (R1, R3, R5, R6, R7 `edit`, R8 `insert-after`) and four in `test_api_keys_user_id_immutable.sql` (2a, 2b, 3, 4 `edit`). Neither new sentinel reads `ALL 7`, so the contract test's `okCount` did not move.

Verification: the seven census files run together, 1394 tests passed in 7 files. `npm run lint` exit 0.

Full suite, `npx vitest run` (740 s): `Test Files  5 failed | 1288 passed | 20 skipped (1313)`, `Tests  6 failed | 28237 passed | 306 skipped`. The five failed files, none a census this plan moves:
- `src/lib/factsheet/compute.conventions.test.ts` (2 tests), `scripts/factsheet-census/count.test.tsx` and `src/lib/return-stats.single-source.test.ts`: all three are on the orchestrator's known pre-existing red list. `return-stats.single-source` also failed when re-run in isolation (the known red).
- `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` (R4: `ci-apt.sh --self-test` hit its 55 s spawn timeout under full-suite load, `SIGKILL`) and `src/__tests__/mutation-annotation-parser.test.ts` (one 30 s timeout in the real-corpus rule 3b walk, which the orchestrator lists as load-sensitive): both PASSED when re-run in isolation (`Test Files 1 failed | 3 passed (4)` for the four-file re-run, the one failure being `return-stats.single-source`).

Other checks run after the last code commit: `node scripts/lint-app-guc.mjs --self-test` OK and `node scripts/lint-app-guc.mjs` `findings 0` (arm 4's `imm.second` setting is in a SQL gate and the scan finds nothing), `node scripts/mutation-runner/run.mjs --parse-only` ends `No static defects`, `node scripts/verify-plan-anchors.mjs` on plans 05 to 10 each `OK: 1 plan file(s), no stale claims`, and `git fetch origin main` shows the latest origin/main migration is still `20261126180000_poll_positions_cohort_ccxt_venues.sql`, before `20261127120100` (no rename needed). `npm run lint` exit 0.

## Deviations from Plan

**1. [Rule 1 - Bug] Neuter requires exactly one RAISE per neutered arm.**
- **Found during:** Task 3, first mutation-runner run of the immutability gate (`arms 6/6/0`, `biting: 3`, `neuter-missed` on 2b, 3 and 4).
- **Issue:** the runner's neuter replaces a single `RAISE` of the neutered arm, and arms 1a (seven raises) and 2a (two raises) are neutered by the twins of 2b, 3 and 4, so their other raises still fired.
- **Fix:** 1a and 2a each collapsed to one RAISE carrying the first problem found (1a builds a `v_problem` text through one CASE; 2a computes the row image first and raises once with both facts). The failure branches still name the arm first and the assertions are unchanged.
- **Files modified:** `supabase/tests/test_api_keys_user_id_immutable.sql`. **Verification:** re-run printed `arms: 6/6/0`, `biting: 6`. **Commit:** `3f0c806d1`.

**2. [Rule 3 - Blocking] The lane's `api_keys` stub has no service_role UPDATE grant.**
- **Found during:** Task 3, first GREEN run (arm 2b answered `permission denied for table api_keys`, which is also 42501).
- **Issue:** the pg-lane `api_keys` is a stub created before the Supabase default-privileges stand-in, so service_role holds no table privileges there. On the real stack the default privileges grant ALL.
- **Fix:** the gate restates `GRANT ALL ON public.api_keys TO service_role` in its rolled-back fixture (a no-op on the real stack); arms 2b and 3 additionally pin the trigger's own message text so a bare privilege refusal cannot satisfy them.
- **Files modified:** `supabase/tests/test_api_keys_user_id_immutable.sql`. **Commit:** `3f0c806d1`.

**3. [Design, within the plan's latitude] Arm R3 covers three claim shapes** (authenticated, none, malformed), not only the authenticated shape the plan named, because the fail-closed `auth.role()` wrapper is part of the contract. All three share the one arm id and one twin.

**4. [Design] The `NAME_SET_RATCHET` rows carry shorter `clearedBy` text** than the plan's example, using the shape of the previous rows ("a re-dump of supabase/schema/baseline.sql taken after its migration applied to PROD"); the reason fields name Phase 243 DBBACKSTOP and the migration file.

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking), 2 design notes. **Impact:** none on scope; the arms, floors and censuses are as planned.

## Known Stubs

None.

## Known limits

- The immutability trigger protects against a repoint by statement or by a rewriting BEFORE trigger. It does not protect against a role that can run DDL (`DISABLE TRIGGER`, `DROP TRIGGER`): only a reviewed migration can, and arm 1a goes RED on a disabled trigger on every lane (threat T-243-18, accepted).
- Nothing calls `insert_api_key` in this plan. Until PR-B merges the writer is unused, and until PR-C merges a direct `service_role` insert into `api_keys` still works. The founder-accepted narrowing ("only the audited writer path can insert, and user_id can never be repointed") is half delivered here: the "can never be repointed" half.
- The RPC has no `auth.uid()` check by design: ownership stays bound at the route, which takes `user_id` from the session.
- The CI `baseline-content-drift` step is red with the two `SNAPSHOT_MISSING` findings above until the post-apply re-dump.

CHANGELOG notes (for the PR-A ship step): the audited `insert_api_key` writer and the `api_keys.user_id` freeze ship additive and unused until PR-B; the DRIFT-05 gate carries two expected `SNAPSHOT_MISSING` findings until the re-dump; no `TODOS.md` entry is closed by this plan. Merge precondition (PR-A): migration-reviewer and rls-policy-auditor each return no MEDIUM or higher finding for `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql`. No `supabase db push` was run (this checkout's CLI is linked to PRODUCTION); the schema proof is the pg-lane plus the local-stack replay.

## Threat Flags

None. The migration adds one RPC reachable only by service_role (T-243-13 mitigated by REVOKE, GRANT and the in-body gate, arms R2 and R3) and one trigger; no endpoint, auth path or file access beyond the plan's threat register.

## Next Phase Readiness

PR-B plans (06 to 08) may copy the signature above. Their precondition (this migration in the PROD ledger) is not met by this plan: it applies on the PR-A merge.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql, supabase/migrations/down/20261127120100-rollback.sql, supabase/tests/test_insert_api_key_rpc.sql, supabase/tests/test_api_keys_user_id_immutable.sql, supabase/schema/functions/insert_api_key.sql, supabase/schema/functions/enforce_api_keys_user_id_immutable.sql
- FOUND commits: e78d7cf8b, 80861645b, 3f0c806d1, c37449644
- Acceptance greps: `CREATE FUNCTION public.insert_api_key(` 1, `BEFORE UPDATE OF` 0, `SECURITY INVOKER` 4, `EXCEPTION WHEN` 1, RED-UNDER-M 8 and 6, both sentinels 1, `Phase 243 DBBACKSTOP, plan 05` in mutation-floors 2, ci.yml derivation rows 2, `WAIVED_CEILING = 0` 1, `name: "(insert_api_key|enforce_api_keys_user_id_immutable)"` 2, supabase containers 0.
