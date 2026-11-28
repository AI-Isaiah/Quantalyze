---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 10
subsystem: database
tags: [postgres, trigger, fence, api-keys, sql-gate, mutation-runner, local-stack, DBACC-02]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 05
    provides: "public.insert_api_key writer and api_keys_user_id_immutable, applied to PROD"
  - phase: 243-dbbackstop
    plan: 06
    provides: "the validate-and-encrypt route writes through insert_api_key (PR-B, merged as #1405)"
  - phase: 243-dbbackstop
    plan: 08
    provides: "every e2e, script, integration and Python seed writes through insert_api_key"
provides:
  - "migration 20261127220100: enforce_api_keys_insert_writer_fence() SECURITY INVOKER and the api_keys_insert_writer_fence BEFORE INSERT ROW trigger (current_user allow-list: postgres, supabase_admin), catalogue-only self-check"
  - "manual rollback down/20261127220100-rollback.sql"
  - "gate test_api_keys_insert_not_client_writable.sql: old arm 2 replaced by 2s, 2a, 2b, 2c, 2w (each twinned); arm 5 now tells the privilege refusal from the fence's"
  - "gate test_api_keys_exchange_not_user_writable.sql: scrub-half probe runs with the fence disabled inside its rolled-back transaction, plus arm '5c fence restored' (twinned)"
  - "generated dump supabase/schema/functions/enforce_api_keys_insert_writer_fence.sql, one DRIFT-05 snapshot-only row, COMPARED_FLOOR 150 -> 151"
  - "ARMS_FLOOR 1126 -> 1132 and every mutation census literal moved with dated currency notes"
affects: [PR-C merge (migration-reviewer and rls-policy-auditor must return clean first), the post-apply baseline re-dump, ship CHANGELOG entry]
requirements-completed: [DBACC-02]
key-files:
  created:
    - supabase/migrations/20261127220100_api_keys_insert_fence.sql
    - supabase/migrations/down/20261127220100-rollback.sql
    - supabase/schema/functions/enforce_api_keys_insert_writer_fence.sql
  modified:
    - supabase/tests/test_api_keys_insert_not_client_writable.sql
    - supabase/tests/test_api_keys_exchange_not_user_writable.sql
    - supabase/tests/test_insert_api_key_rpc.sql
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - TODOS.md
key-decisions:
  - "Arm 2c grants the probe role to the user BY NAME (format %I), never GRANT <role> TO CURRENT_USER: that form segfaults the local stack's PostgreSQL 17.6.1.113 backend (measured, component not isolated)"
  - "The gate's setup list adds only 20261123180000, 20261127120100 and the fence; 20261125132334, 20261126140500 and fixture 41 are left out because 20261125132334's self-check raises under this file's fixture order"
  - "The fence is SECURITY INVOKER and an allow-list on current_user (postgres, supabase_admin); the verify block does not assert the body so the gate's edit twins can apply"
duration: ~11h by the system clock, much of it waiting on the shared Docker lane and a host at load average 50 to 80
completed: 2026-11-28
commits: 5
plan_head_before: 8df1e762f2fd597f5bc67c7340bf469a22590a1f
plan_head_after: 2c53f06678bd8a7d834baf2e15d7348f20834930
actuals:
  tokens: 12000
  tasks: 4
  commits: 5
---

# Phase 243 Plan 10: the api_keys insert fence Summary

A BEFORE INSERT ROW trigger on `public.api_keys` now refuses every insert whose `current_user` is not `postgres` or `supabase_admin` (42501, naming the role), so only the three postgres-owned SECURITY DEFINER writers, migrations, SQL fixtures and owner sessions can mint a key; a direct `service_role`, `authenticated`, `anon` or later-created role insert, `ON CONFLICT` included, is refused and mints no row.

Tasks 4/4, 13 files touched (3 created, 10 modified), no checkpoint, no auth gate. Commits: `08d9b813b` (task 1, tracer), `bfc49330f` (task 2), `474674278` (task 3), `d9e9cc2c9` (Rule 1 fix, below), `2c53f0667` (task 4). `git rev-list --count 8df1e762f..HEAD` read 5 at SUMMARY write, equal to the code commits (this SUMMARY's commit follows). `.github/workflows/ci.yml` was not touched: `wc -c` read 511664 before and after.

## Precondition

- (a) run here, 2026-11-27 and re-run 2026-11-28: `git fetch origin main -q` exit 0; `git ls-tree --name-only origin/main supabase/migrations/` lists `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql` and `20261127220000_strategy_analytics_anon_column_revoke.sql`; `git show origin/main:src/app/api/keys/validate-and-encrypt/route.ts` contains `admin.rpc("insert_api_key"` (line 945) and no direct insert call (its two remaining `.from("api_keys").insert(` mentions are comments).
- (b), (c), (d) **measured by the orchestrator** 2026-11-27, not re-run here (no PROD MCP): PR-B merged as #1405 (merge commit `9c5c414b04a2bb0899eea9634ac9edc4a7afc2ca`), production deployment 8119670726 newest status `success`; the PROD marker query named PRODUCTION, the ledger holds `20261127120100` and `20261127220000`, anon cannot SELECT `metrics_json_by_basis`; `public.insert_api_key`, `public.create_wizard_strategy` and `public.add_wizard_composite_key` are all owned by `postgres` and SECURITY DEFINER.
- (e) run here: the newest migration on `origin/main` is `20261127220000_strategy_analytics_anon_column_revoke.sql` (origin/main head `c8e33dba6` at the re-check), sorting before `20261127220100`. No rename was needed.
- (f) run here: `node scripts/verify-plan-anchors.mjs <this plan>` printed `claims: 4 checked`, `OK: 1 plan file(s), no stale claims.`, exit 0.

## Tracer RED/GREEN (Task 1)

Each run on a fresh pg-lane workdir with the gate's own `RED-UNDER-SETUP` list.

RED, the setup list minus the fence migration (exit 3), first failure names 2s:

```
psql:supabase/tests/test_api_keys_insert_not_client_writable.sql:619: NOTICE:  00000: Assertion 1 OK: owner session reads its own api_keys row (anti-vacuity control).
psql:supabase/tests/test_api_keys_insert_not_client_writable.sql:619: NOTICE:  00000: Assertion 3 OK: the scrub trigger is present, enabled, and SECURITY INVOKER (defence in depth behind the insert fence).
psql:supabase/tests/test_api_keys_insert_not_client_writable.sql:619: ERROR:  P0001: TEST FAILED (2s): expected exactly one api_keys_insert_writer_fence trigger on public.api_keys, found 0. ...
CONTEXT:  PL/pgSQL function inline_code_block line 144 at RAISE
LANE_EXIT=3
```

GREEN, the full list (exit 0):

```
... NOTICE:  Assertion 2s OK / 2a OK / 2b OK / 2c OK / 2w OK: the writer set is exactly {add_wizard_composite_key, create_wizard_strategy, insert_api_key}.
... NOTICE:  Assertion 5 OK: authenticated INSERT on api_keys is refused 42501 and mints no row.
... NOTICE:  Assertion 6 OK: the ACL class holds ...
... NOTICE:  Assertion 4 OK: owner can still DELETE its own api_keys row (the REVOKE stayed INSERT-only).
DO
ROLLBACK
LANE_EXIT=0
```

Acceptance greps: `current_user IN ('postgres', 'supabase_admin')` in the migration 1, `SECURITY INVOKER` 6, `insert into (public.)?api_keys` (case-insensitive) 0. `node scripts/lint-migration-data-dependence.mjs`: `corpus 350 migration(s), 433 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW`, exit 0.

## Diagnostics (Task 2, after the last gate edit `d9e9cc2c9`, each captured unpiped)

`node scripts/mutation-runner/run.mjs --file <gate>`, exit 2 by design in all three, every arm `RED (identity ok)`:

| gate | exit | arms | biting | lane-invocations | per-file row |
|---|---|---|---|---|---|
| test_api_keys_insert_not_client_writable.sql | 2 | `8/8/0` | 8 | 8 | `sections 4 / judged 8 / annotated 8 / waived 0 / biting 8` |
| test_api_keys_exchange_not_user_writable.sql | 2 | `5/5/0` | 5 | 5 | `sections 5 / judged 5 / annotated 5 / waived 0 / biting 5` |
| test_insert_api_key_rpc.sql | 2 | `9/9/0` | 9 | 9 | `sections 9 / judged 9 / annotated 9 / waived 0 / biting 9` |

All three ended `No defects in the narrowed scope.` The plan said `8/8/0` for the writer gate; it is `9/9/0` because plan 05's review fix added R9, so nothing regressed. `node scripts/lint-sql-gates.mjs`: `scanned 128 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`, exit 0. Twin acceptance counts: `RED-UNDER-M:` lines 8 in the insert gate (was 3) and 5 in the exchange gate (was 4).

## PROOF-01 on the fence (Task 2 step 6)

1. Backup: `cp supabase/migrations/20261127220100_api_keys_insert_fence.sql <scratchpad>/fence.bak`.
2. Neutered: the `RAISE EXCEPTION ... USING ERRCODE = 'insufficient_privilege';` statement replaced by `RETURN NEW;`; `diff` against the backup showed exactly those two lines.
3. pg-lane with the neutered fence (exit 3), the first failure is 2a, 2s having passed:

```
... NOTICE:  Assertion 2s OK: the insert fence is present, enabled, BEFORE INSERT ROW (tgtype 7) and SECURITY INVOKER ...
... ERROR:  P0001: TEST FAILED (2a): a direct service_role INSERT into api_keys SUCCEEDED. The insert fence refused nobody, ...
LANE_EXIT=3
```

4. `cp <backup> <migration>`; `cmp` silent; re-run GREEN (`Assertion 2a OK ... Assertion 2w OK`, `LANE_EXIT=0`).

## Local-stack corpus, before and after (Task 3 step 1)

Both via `node scripts/local-stack/sql-corpus-report.mjs` (the committed diagnostic that mirrors `sql-tests`: `psql -X -v ON_ERROR_STOP=1`, LANE-ONLY excluded from the text, NOTICE-skip nets).

| run | stack built from | result |
|---|---|---|
| BEFORE | the base commit's `supabase/tests` and `supabase/migrations` (no fence), via `LANE_MIGRATIONS_DIR` | `sql-corpus: files=128 pass=122 fail=0 whole-file-skip=0 lane-only=6` |
| AFTER | this tree, fence replayed (`baseline-replay: 2 migration(s) newer than the dump: 20261127220000_... 20261127220100_api_keys_insert_fence.sql`, `baseline-currency: carried=348 replay=2 marker-sha=match defects=0`) | `sql-corpus: files=128 pass=122 fail=0 whole-file-skip=0 lane-only=6` |

The failure sets are equal (both empty) and the six LANE-ONLY files are the same six. No client-role inserter was missed by the plan's census, so the SUMMARY carries no correction list. The AFTER numbers are from the run after the Rule 1 fix below.

## Live-DB lane and Python lane, on the AFTER stack (Task 3 step 2)

- `npm run test:live-db:ledger` (CI's form, which runs `npm run test:live-db` verbatim): `Test Files 2 failed | 47 passed | 2 skipped (51)`, `Tests 7 failed | 429 passed | 81 skipped (517)`, `[live-db-ledger] OK — the failing set is EXACTLY the ledger (7/7). Every corpus file executed; no arm outside the ledger failed; no ledger entry has gone stale.` **This is not "0 failures"**: the 7 failures are the standing `scripts/live-db-execution-ledger.txt` entries (`sanitize-user-rpc` P916 and six in `wizard-rpcs-live-db`, none touching the fence). To check the fence added nothing, I took one pre-fence run: the same command on a stack built from the base migrations (`LANE_MIGRATIONS_DIR`, one replayed migration, `20261127220000`) printed the identical `Test Files 2 failed | 47 passed | 2 skipped (51)`, `Tests 7 failed | 429 passed | 81 skipped (517)` and the same `OK` line. The 81 skipped tests are equal before and after (the lane's own output names arms gated on an unset introspection token among them; I did not itemise all 81).
- Python, from `analytics-service/` with `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY` and `LANE_DB_URL` taken from the lane handoff and `CI=true`: `pytest tests/test_flow_price_store_live.py tests/test_nav_marks_writer_live.py tests/test_trade_read_store_live.py "tests/test_compute_jobs_fencing.py::test_advance_sync_cursor_monotonic_guard_no_regress" -q -rs --no-cov` printed `12 passed, 18 warnings`, no skip line (the same count plan 08 recorded).
- Not run under the fence: the psycopg `INSERT INTO api_keys` sites (`test_csv_daily_returns_dualaxis_live.py`, `test_csv_daily_returns_perkey_rls_live.py`, `test_trigger_rls_audit.py`) and the `*-sql-exec` vitest files connect with the lane DSN as `postgres`, so they pass the allow-list by reasoning, not by a run of mine. None of those three is among the four Python targets I ran. PR-C's `python` and `e2e-seeded` jobs run them against the fence.
- Docker: down after every session, `docker ps --filter name=supabase -q` empty, lock released each time.

## Residual writer census (Task 3 step 3), and a failed plan verify

The plan's verify command (node scan over tracked `.ts/.tsx/.py` for a string-literal `api_keys` relation followed by `.insert(` or `.upsert(`) **exits 1 at HEAD** because its allowlist of three is stale:

```
analytics-service/tests/test_walletoffset_probe.py              (in-memory fake)
src/app/api/keys/validate-and-encrypt/route.test.ts             (two comment lines, 80 and 1694)
src/app/api/keys/validate-and-encrypt/route.ts                  (one comment line, 740)
src/components/strategy/StrategyForm.test.tsx                   (mock / retired-arm comment)
src/lib/sec-005-api-keys-projection.test.ts                     (comment)
```

I classified each by reading the matching lines: `route.ts:740` is the comment `not a direct .from("api_keys").insert(...)` that PR-B wrote above the RPC call, and the two `route.test.ts` hits are comments describing the old shape. None is code. The route's real persist call is `admin.rpc("insert_api_key"`. A second, looser scan (a string-literal `api_keys` followed within 300 characters by `.insert(`/`.upsert(`, over `ts/tsx/py/mjs/js/sh`, `.planning` excluded) adds only `tests/integration/process-key-thin-adapters.test.ts:138` (a mock comment). A SQL/REST scan (`insert into [public.]api_keys`, `rest/v1/api_keys`) outside `.planning`, migrations, schema, tests-sql and docs lists only the lane fixture `25-fixture-api-keys-e2e-census-seed.sql`, the three Python psycopg files and four vitest `*-sql-exec` files above, none of which sets a role. The plan's allowlist needs `route.ts` and `route.test.ts` added (or the comments reworded); that is a plan correction, not a code defect, and I did not edit the merged PR-B comments.

## Closed TODOS bullet

Deleted `**⚖️ ARCHITECTURE DECISION OWED: \`api_keys\` writes have left the RLS-enforced plane entirely**` and its three sub-bullets from `TODOS.md` (4 lines). `git grep -n "left the RLS-enforced plane" -- ':!CHANGELOG.md' ':!.planning'` printed nothing after I reworded the one pointer my own migration header carried; `grep -ac` on `TODOS.md` reads 0. The ship's CHANGELOG entry must name this closed bullet (CLAUDE.md, "TODOS.md holds open work only"); CHANGELOG is outside this plan's file list.

## Generated dump and DRIFT-05 (Task 3 step 0)

- `npm run schema:functions` wrote `supabase/schema/functions/enforce_api_keys_insert_writer_fence.sql` (149 files). `npm run schema:functions:check`: `SQL function snapshot is current (149 functions).`, `DRIFT-05 gate (a): baseline 148 name(s) vs migration-replay 149 name(s) — agree, with 1 ratcheted disagreement(s) carried.`, exit 0.
- `NAME_SET_RATCHET`: one dated `snapshot-only` row for `enforce_api_keys_insert_writer_fence` (captured 2026-11-27, cleared by the re-dump after PR-C's apply). Plan 05's two rows were already deleted on the base by the post-PR-A re-dump (v0.133.105.1), so none had to go.
- `node scripts/baseline-content-drift-check.mjs`: `functions compared 151 — MATCH 147, DRIFT 3, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`, `findings 1`, **exit 1**. The single finding is `SNAPSHOT_MISSING enforce_api_keys_insert_writer_fence/0`, the expected one; the 3 DRIFT rows are the 3 allowlisted ones. `COMPARED_FLOOR` 150 -> 151 with a dated `MOVED 2026-11-27 (Phase 243 DBBACKSTOP, plan 10)` note quoting that line. No allowlist row was added. **CI's baseline-content-drift step is therefore red on PR-C with exactly that one finding until the post-apply baseline re-dump**, as plan 05's was; any other finding is a defect.
- `npx vitest run src/__tests__/baseline-content-drift-allowlist.test.ts`: 18 passed.

## Mutation censuses (Task 4)

`node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 101/128`, `arms: 0/1132/0`, `No static defects.`, exit 0. `FILES_FLOOR` stays 101 (no new gate file), `WAIVED_CEILING` stays 0, `ARMS_FLOOR` 1126 -> 1132 (+5 insert-gate arms, +1 exchange-gate arm). Moved, each with a dated `(Phase 243 DBBACKSTOP, plan 10)` note: `gate-family-meta` ARMS_FLOOR pin; `mutation-annotation-parser` `armsSeen` 1132, `stepsSeen` 1258 and `needles.length` 1258 (read off the failing assertions, `expected 1258 to be 1254`: +4 `edit` steps, 2s and 2w are `sql`); `mutation-runner-floors` `totalAnchored` 1132, the synthetic GREEN_LOG arms/biting/lane-invocations/mean-line literals, the two per-file rows, the severed/extra/garbled/waived/zero/spliced derived literals, and the `rows sum to 1131` case (`MEASURE_FAIL ... rows sum to 1131 ... reports 1132`). `lint-sql-gates.test.ts`, `ci-anti-skip-gate.contract.test.ts` and `drift-check-scripts.test.ts` did not need to move.

## Verification run

| Command | Result |
|---|---|
| census tests (`mutation-runner-floors`, `gate-family-meta`, `mutation-annotation-parser`, `lint-sql-gates`, `ci-anti-skip-gate.contract`, `drift-check-scripts`) | all pass; two slow ones reported 35 s load timeouts on a host at load average 80 and passed on a re-run with `--testTimeout=150000` (`241 passed`) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0, `0 errors, 4 warnings` (all pre-existing, unrelated files); planning-hygiene, route-manifest, canonical-domain checks OK |
| whole `npx vitest run` | `Test Files 8 failed \| 1285 passed \| 20 skipped (1313)`, `Tests 12 failed \| 28270 passed \| 313 skipped`. Re-run of the 8 failed files with `--maxWorkers=2 --testTimeout=150000`: `Test Files 1 failed \| 7 passed (8)`, `Tests 2 failed \| 492 passed`. The 2 are `compute.conventions.test.ts` fixtures B and C, the known pre-existing mismatch (recorded by plans 06 and 08 on the base commit); the other 10 were load timeouts and pass on re-run |
| `node scripts/lint-migration-data-dependence.mjs` | exit 0, 0 NEW |
| `node scripts/lint-sql-gates.mjs` | exit 0, 0 findings |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `GRANT <role> TO CURRENT_USER` segfaults the local stack's backend, so arm 2c used it wrongly**
- **Found during:** Task 3, the first AFTER corpus run. `test_api_keys_insert_not_client_writable.sql` failed `psql exited 2` and the next 12 files failed the same way while the server recovered; the db container log read `server process (PID 377) was terminated by signal 11: Segmentation fault`.
- **Bisect:** a probe script on a fresh lane crashed at the `GRANT zz_dbbackstop_fence_probe TO CURRENT_USER;` line (`sig11 before=0 after=1`); `GRANT ... TO postgres` and `EXECUTE format('GRANT %I TO %I', ..., current_user)` followed by `SET LOCAL ROLE` and the probe INSERT ran clean (`sig11` 0 to 0). The pg-lane (superuser) never showed it, which is why the Task 1 and 2 diagnostics were green.
- **Fix:** arm 2c grants by name through `format('%I', current_user)`, with a header note. The component that crashes was not isolated (the stack ships supautils). Whether PROD's image does the same is UNMEASURED and I did not probe PROD; see the handback for routing.
- **Files modified:** `supabase/tests/test_api_keys_insert_not_client_writable.sql`
- **Commit:** `d9e9cc2c9`

### Plan differences

- **Arms 2c and 2w landed in the Task 1 commit** (I wrote the whole re-shaped gate in one pass), so the `RED-UNDER-M` count was 8 after Task 1, not the plan's 6. Task 2 then added the exchange gate's arm, the writer-gate setup, the rollback and PROOF-01. Final counts match the plan's Task 2 and 4 figures.
- **The gate's setup list is shorter than the plan's append rule.** The plan said to append everything `test_insert_api_key_rpc.sql`'s list has beyond this file's. Measured: with `20261125132334_api_keys_venue_server_owner_read.sql` the lane stops at `Migration 20261125132334 failed: anon unexpectedly holds a privilege on api_keys.venue_server (migration 20260410225608 REVOKE broken?)`, because this file applies fixture 07 (default privileges, which grant anon on tables) before the table exists. I appended only `20261123180000_api_keys_venue_server.sql` (the `venue_server` column `insert_api_key` writes), `20261127120100_...` and the fence last, and left out `20261125132334`, `20261126140500` and fixture 41, none of which an arm needs. The list applies cleanly and every arm bites.
- **BEFORE corpus used the base commit's tests and migrations through `LANE_MIGRATIONS_DIR`**, not "move the fence migration aside". It is the same measurement (no fence on the lane), it leaves the worktree untouched, and it also uses the pre-plan gate files, so the BEFORE set is a clean baseline.
- **The first AFTER boot failed its health check** (`supabase_analytics_quantalyze container is not ready: unhealthy`, the load flake plan 08 also saw) and was retried; the booted retries are the ones reported.
- **Live-DB ran in the ledger form**, `npm run test:live-db:ledger`, because that is CI's command and it is the one that compares the failing set with the standing ledger.
- **The plan's residual-census verify exits 1** on comment hits (above); recorded as a failed verify with a stale allowlist, not a pass.
- **`test_insert_api_key_rpc.sql` reads `9/9/0`**, not the plan's `8/8/0` (R9 predates this plan).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-243-34 and T-243-35 are mitigated by arms 2a, 2b, 2c and the `current_user` mechanism (never a GUC); T-243-36 by arm 2w (recorded limit: dynamic SQL and non-SQL/plpgsql inserters are invisible to it, the fence still refuses them unless postgres owns the function); T-243-38 by arm `5c fence restored`; T-243-39 by the before/after corpus, the live-DB lane and the Python seeds above. T-243-37's PROD halves were measured by the orchestrator.

## Self-Check: PASSED

- `supabase/migrations/20261127220100_api_keys_insert_fence.sql`, `supabase/migrations/down/20261127220100-rollback.sql`, `supabase/schema/functions/enforce_api_keys_insert_writer_fence.sql`: FOUND.
- Commits `08d9b813b`, `bfc49330f`, `474674278`, `d9e9cc2c9`, `2c53f0667` are ancestors of HEAD: FOUND.
- docker down (`docker ps --filter name=supabase -q` empty) and the lane lock directory absent: confirmed.
