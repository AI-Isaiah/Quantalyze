---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
plan: 02
subsystem: database
tags: [postgres, migration, security-definer, compute_jobs, claim-token-fence, sql-gate, mutation-runner]
requires: []
provides:
  - "public.set_compute_job_seed_hold(uuid, uuid, bigint) RETURNS boolean: service-role-only, claim-token-fenced single-UPDATE merge of {seed_hold_ms} into the running job's compute_jobs.metadata"
  - "SQL gate supabase/tests/test_compute_job_seed_hold.sql (9 arms, 9 twins)"
  - "generated snapshot supabase/schema/functions/set_compute_job_seed_hold.sql (plan 04's parity pin reads it)"
affects: [257-04, 257-05]
tech-stack:
  added: []
  patterns: ["REFUSALRACE single-statement metadata merge", "set_compute_job_progress claim-token fence", "catalogue-only migration verify block"]
key-files:
  created:
    - supabase/migrations/20261128120000_compute_job_seed_hold.sql
    - supabase/migrations/down/20261128120000-rollback.sql
    - supabase/tests/test_compute_job_seed_hold.sql
    - supabase/schema/functions/set_compute_job_seed_hold.sql
  modified:
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
key-decisions:
  - "Founder ruling 2026-11-28, verbatim choice: Job's private record (Recommended). The seed-hold mark lives in the running job's own compute_jobs.metadata under the key seed_hold_ms."
  - "Claim token required non-NULL in SQL, exactly as set_compute_job_progress; non-object metadata becomes a fresh object, as mark_compute_job_kept_figures; p_floor_ms is bigint validated >= 0 (SQLSTATE 22023), zero accepted."
  - "Arm 9 (unknown id) is twinned by a layered mutation (RETURN FOUND -> RETURN TRUE with arms 3, 4, 5 neutered), not left untwinned."
metrics:
  duration: "about 15 minutes"
  completed: 2026-11-28
status: complete
actuals:
  tokens: 30024    # chars/4 over `git diff daa550f6d..d9fa81c25` (the three task commits)
  tasks: 3
  commits: 3
plan_head_before: daa550f6d71b5c8ba47d0db2c9b29d27ce43a6ce
plan_head_after: d9fa81c253c2657e29c106054033870854be3a8a
---

# Phase 257 Plan 02: set_compute_job_seed_hold Summary

One additive migration, `public.set_compute_job_seed_hold(p_job_id uuid, p_claim_token uuid, p_floor_ms bigint) RETURNS boolean`, merges `{seed_hold_ms: p_floor_ms}` into the running job's own `compute_jobs.metadata` in ONE claim-token-fenced UPDATE, service-role only, with a catalogue-only verify block and a nine-arm SQL gate whose every arm bites.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 07f4a6fce | feat(257-02): set_compute_job_seed_hold, the fenced seed-hold merge RPC, and its SQL gate |
| 2 | a1adfd64e | chore(257-02): rollback file, generated function snapshot, function census for set_compute_job_seed_hold |
| 3 | d9fa81c25 | chore(257-02): mutation and lint census for test_compute_job_seed_hold.sql |

`commits: 3` is measured (`git rev-list --count daa550f6d..HEAD` at SUMMARY write).

## Task 1: RED, GREEN, twins, neuter (verbatim)

No database other than the throwaway pg-lane cluster was touched (no Supabase CLI, no linked project, no Docker).

**Pre-migration RED** (apply list minus the new migration; `gate-pre-migration.txt`, exit 3), fails inside arm 1. Re-measured against the COMMITTED gate after the arm 4 restructure (the first measurement quoted `:365:`):

```
psql:supabase/tests/test_compute_job_seed_hold.sql:360: ERROR:  P0001: TEST FAILED (1): public.set_compute_job_seed_hold(uuid, uuid, bigint) does not exist - this gate has nothing to test and must not skip
```

**GREEN** (full apply list, exit 0): `Migration 20261128120000: set_compute_job_seed_hold installed (catalogue verified: SECDEF, pinned search_path, service_role-only EXECUTE).` then `arm 1 OK` through `arm 9 OK` (nine NOTICE lines).

**Mutation runner, `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_seed_hold.sql`** (diagnostic, never exits 0 by design):

```
  baseline  supabase/tests/test_compute_job_seed_hold.sql — exit 0 (1.0s)
  arm 1                        exit   3  RED (identity ok)  (1.1s)
  arm 2                        exit   3  RED (identity ok)  (1.1s)
  arm 3                        exit   3  RED (identity ok)  (1.2s)
  arm 4                        exit   3  RED (identity ok)  (1.2s)
  arm 5                        exit   3  RED (identity ok)  (1.2s)
  arm 6                        exit   3  RED (identity ok)  (1.2s)
  arm 7                        exit   3  RED (identity ok)  (1.2s)
  arm 8                        exit   3  RED (identity ok)  (1.2s)
  arm 9                        exit   3  RED (identity ok)  (1.2s)
  restore   supabase/tests/test_compute_job_seed_hold.sql — exit 0 (1.2s)
arms: 9/9/0   (executed/annotated/waived)
biting: 9   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 9   (arm lanes actually spawned — tallied inside runLane, independent of the 9 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_compute_job_seed_hold.sql: sections 9 / judged 9 / annotated 9 / waived 0 / biting 9
No defects in the narrowed scope.
```

(The first run of this command printed `biting: 8` and two defects: arm 9's layered twin neuters arms 3, 4 and 5, but `neuterArm` silences only the FIRST raise carrying an identity, and arm 4 had four. Arm 4 was restructured into one loop with one return-value raise, and the rerun above is clean. WAIVED_CEILING stays 0.)

**PROOF-01 manual neuter of the fence predicate** (SC-5, research H4). Backup `migration.bak` taken with `cp`; search text `     AND claim_token IS NOT DISTINCT FROM p_claim_token` replaced in place by `     AND TRUE` (diff showed exactly that one line); pg-lane gate run saved to `neuter-h4.txt`:

```
psql:supabase/tests/test_compute_job_seed_hold.sql:360: ERROR:  P0001: TEST FAILED (3): a stale-token write returned t (expected false)
```

Restored with `cp migration.bak <migration>`, then `cmp migration.bak <migration>` printed `cmp exit=0`, and the GREEN rerun exited 0 with all nine `arm N OK` lines. No `git checkout`, `git restore` or `git stash` was used.

**Lints** (each exit 0): `lint-sql-gates.mjs --self-test` (`7 rules, red+green each`), `lint-sql-gates.mjs` (`scanned 129 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`), `lint-migration-data-dependence.mjs --self-test` and corpus (`83 refusal(s), 83 allowlisted, 0 NEW`), `lint-app-guc.mjs --self-test` and corpus (`findings 0`). `grep -a -c "ARMS EXECUTED"` on the gate prints 0 (no completion sentinel, so ci.yml and SENTINEL_FLOOR are untouched).

## Task 2: rollback, snapshot, function census

- `supabase/migrations/down/20261128120000-rollback.sql`: manual, drops the function only, callers-first note, ledger row left in place. Correction to RESEARCH assumption A4: a rollback file DOES exist for `20261126150000` (`down/20261126150000-rollback.sql`); RESEARCH's `find -name "*reread*"` missed it because the file is named by timestamp. A down file is the repo convention, so this plan writes one.
- `npm run schema:functions` wrote exactly one new file under `supabase/schema` (`functions/set_compute_job_seed_hold.sql`). `npx tsx scripts/dump-sql-functions.ts --check` passes (`SQL function snapshot is current (149 functions)`; `1 ratcheted disagreement(s) carried`).
- One `snapshot-only` `NAME_SET_RATCHET` row added for `set_compute_job_seed_hold` (captured 2026-11-28, same `clearedBy` as the Phase 253 row).
- `COMPARED_FLOOR` 150 -> 151, read off `functions compared 151 — MATCH 147, DRIFT 3, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`.
- `npx vitest run src/__tests__/baseline-content-drift-allowlist.test.ts src/__tests__/drift-check-scripts.test.ts`: 2 files, 974 tests passed.

## Task 3: census values (before -> after, with source line)

| Constant | Before | After | Read from |
|---|---|---|---|
| `FILES_FLOOR` (`scripts/mutation-floors.mjs`) | 101 | 102 | `--parse-only`: `coverage: files 102/129` |
| `ARMS_FLOOR` | 1126 | 1135 | `--parse-only`: `arms: 0/1135/0` |
| `WAIVED_CEILING` | 0 | 0 | unchanged |
| `lint-sql-gates.test.ts` scanned | 128 | 129 | `scanned 129 file(s)` |
| `mutation-annotation-parser.test.ts` `armsSeen` | 1126 | 1135 | `arms: 0/1135/0` |
| same, `stepsSeen` and `needles.length` | 1254 | 1262 | +8 `edit` file steps (arm 1's twin is a `sql` step, which the walk skips); the vitest run passed at 1262 |
| same, `filesTotal` (two sites) / `filesAnnotated` / `annotatedFiles` length | 128 / 101 / 101 | 129 / 102 / 102 | `coverage: files 102/129`; file list gained `test_compute_job_seed_hold.sql` |
| `mutation-runner-floors.test.ts` `totalAnchored` and GREEN_LOG | 1126, 101/128 | 1135, 102/129 | per-file row `file test_compute_job_seed_hold.sql: sections 9 / judged 9 / annotated 9 / waived 0 / biting 9` copied from the `--file` run |
| `gate-family-meta.test.ts` registration keys | `FILES_FLOOR=101`, `ARMS_FLOOR=1126` | `FILES_FLOOR=102`, `ARMS_FLOOR=1135` | same lines |

Verification: the five census suites are green (369 tests); the directory-reading sweep over 49 files (`grep -a -l -E "supabase/(migrations|tests|schema)"`) ran 48 files, 47 passed and 1 skipped (2734 tests passed, 46 skipped). The skipped file is one of the env-gated live-database suites (`skipIf` on a database URL), which this plan must not reach. `git diff --name-only <merge-base> -- .github analytics-service/services analytics-service/routers` prints 0 lines.

## Deviations from Plan

**1. [Plan acceptance not literally achievable] `node scripts/baseline-content-drift-check.mjs` prints `findings 1`, not the plan's `findings 0`, so the plan's own `<verify>` line for Task 2 reads red.** The one finding is `SNAPSHOT_MISSING set_compute_job_seed_hold/3`: the function is in the generated snapshot and not yet in `supabase/schema/baseline.sql`, which the ship step re-dumps after the PROD apply. Every earlier function-adding phase recorded the same state in the `COMPARED_FLOOR` doc block ("EXPECTED until the re-dump, and NO allowlist row was added"), and the gate's own message says an allowlist row is never the clearing action. I followed that convention and added no allowlist row. `dump-sql-functions.ts --check` (the name-set ratchet) is green. The state is recorded in the new MOVED note.

**2. [Rule 1 - Bug] Arm 4 restructured so arm 9's layered twin can neuter it.** Found during Task 1 step 5: the first `--file` run reported `neuter-missed` for arm 4 because the runner neuters only the first raise per identity. Arm 4's two cases now share one loop (one return-value raise, one unchanged-row raise). Arm 4's own twin still bites first. Commit 07f4a6fce.

**3. [Planner-discretion item executed] Arm 9 twinned instead of left untwinned**, via the grammar's `neuter` field; the plan allows an untwinned arm only if no single edit can make it the first failure, and the layered twin is strictly stronger.

**4. [Correction] A stale synthetic value in `mutation-runner-floors.test.ts`.** The GREEN_LOG line `at most 4 for this run's 100 target file(s)` read 100 while the corpus already had 101 annotated files (an earlier phase missed it; the test does not compare it). It now reads 102 to match this plan's annotated count, following the Phase 253 template.

Otherwise the plan executed as written. Decisions (1) to (4) in the plan objective were taken as stated. No auth gates, no package installs, no stubs.

## Verification beyond the plan's own commands (after review)

- **Gate on the real schema.** The gate also runs on CI's local-stack lane, so arm 5's rows (a claim token on `pending`, `failed_retry` and `failed_final` rows, a shape no model gate inserts) were checked against the committed dump (`supabase/schema/baseline.sql`): `compute_jobs` carries no CHECK relating `claim_token` to `status` (the checks are attempts, claimed_by, error_kind, exchange, idempotency_key, kind, kind/target coherence, max_attempts, metadata size at 8192 bytes, priority, status values, target XOR, trade_count), and its only triggers are `compute_jobs_record_orphan_reaped_attempt` (AFTER UPDATE OF status when running becomes failed_final) and `compute_jobs_set_updated_at_trigger` (BEFORE UPDATE). Nothing forbids a token on a non-running row, so the insert shapes are valid there. The local-stack lane itself was NOT run (Docker not started).
- **Directory-reading sweep accounting.** The grep listed 49 files; vitest ran 48. The 49th, `src/__tests__/csv-finalize-concurrent-never-classified.test.ts`, is listed in `vitest.local-stack-files.ts` (`LOCAL_STACK_LANE_FILES`), which the default run excludes by design; it needs the local-stack lane (Docker). Of the 48 that ran, 8 contain env-gated live-database cases that skip without a database URL: `retention-crons` (16 skipped), `claim-dedupe-done-pending-children-guard` (1), `compare-holding-rls` (4, all), `delete-allocator-api-key-rpc` (4), `log-audit-event-service-rpc` (5), `strategy-verifications-rls` (4), `user-app-roles-backfill` (5), `wizard-rpcs-live-db` (7). This plan must not reach any database, so they stay skipped.
- **One flake, not caused by this plan.** In a JSON-reporter rerun of the sweep, `drift-check-scripts.test.ts` failed once: `IN-04 ... a failing VAC-08 run leaves no new mktemp directory behind` found `tmp.g1aNCbGzCM` (that test counts new `mktemp` directories under the shared temp directory, and other agents run concurrently). Re-run alone it passed (956 tests). It had also passed in the Task 2 run and in the first sweep.
- **Tests that read `.planning` and the planning hygiene script, run after the SUMMARY was written:** `check-planning-hygiene`, `baseline-wiring-claim`, `critical-regressions`, `seed-integrity`, `verify-plan-anchors`, `contracts-registry`, `ci-docs-path-filter.contract`, `vac06-mechanism-arms`, `accounttruth-census`: 9 files, 543 tests passed. `scripts/check-planning-hygiene.ts` printed OK on all three rules.
- **Census readers outside the two globs.** `scripts/check-gdpr-export-coverage.test.ts`, `src/lib/account-share-note`, `closed-sets.cohort-gate-parity`, `display-labels` and `ledger-refresh-marker` tests: 5 files, 174 passed. Python readers of the migrations (run from `analytics-service/`, no cache or bytecode written): `test_compute_job_metadata_merge_parity`, `_privilege`, `test_ledger_refresh_gates`, `_publish_guard`, `_kind_scope_drift`, `_reuse_collision`, `test_trade_read_resume`, `test_compute_jobs_fencing`: 186 passed, 28 skipped (live-database cases).
- **Docker and processes.** No Docker was started or stopped. Every pg-lane cluster this plan booted was removed by the lane's own exit trap. Two `postgres -D /tmp/.../pgd` processes seen in `ps` (under `oaoc-` and `acs-` temp directories) predate this session and were left alone.

## Hand-over

migration-reviewer and rls-policy-auditor must report no MEDIUM+ before merge (founder ruling 2026-11-28); the migration is a new SECURITY DEFINER function that PROD auto-applies after TEST on merge. Re-check the timestamp against origin/main and the PROD ledger tip at ship: at write time the newest migration on origin/main is `20261127220000_strategy_analytics_anon_column_revoke.sql`, and `20261128120000` sorts after it. The snapshot-only ratchet row and the one expected `SNAPSHOT_MISSING` finding clear with the post-apply re-dump of `supabase/schema/baseline.sql`.

## Threat model coverage

T-257-02 (grant) arm 1 plus its post-apply grant twin and the verify block; T-257-03 (orphaned worker) arms 3, 4, 5 with twins and the manual neuter; T-257-04 (lost update) arms 2 and 8 with twins; T-257-06 (search_path) verify block and arm 1; T-257-07 (schema-only TEST refusal) catalogue-only verify block, data-dependence lint green. No new threat surface beyond the plan's register.

## Self-Check: PASSED

- Files exist: migration, rollback, gate, generated snapshot, this summary.
- Commits present: 07f4a6fce, a1adfd64e, d9fa81c25 (all ancestors of HEAD).
