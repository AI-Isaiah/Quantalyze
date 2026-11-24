---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 10
subsystem: ci-census
tags: [census, mutation-floors, name-set-ratchet, sentinel-table, pg-lane, lane-proof-owed]
status: complete

requires:
  - phase: 227-01..09
    provides: "seven SQL gate files, five new functions, migrations 20261124120000 to 20261124120600"
provides:
  - "FILES_FLOOR 92 and ARMS_FLOOR 979, measured by one full mutation-runner run (exit 0)"
  - "five NAME_SET_RATCHET snapshot-only rows; schema:functions --check exits 0"
  - "sql-tests sentinel table and floors (37 / 568) naming the seven gates"
  - "a repaired RED-UNDER-SETUP for test_compute_job_claim_renewal.sql"
affects: [227-11 (ship records)]

plan_head_before: 1eac2e8e71b04e9a7c58b3e34f7cdc144031df53
plan_head_after: 6bbeb65bf00fdcc5120f5af25533ea64eef7d530
commits: 6

actuals:
  tokens: 55000
  tasks: 3
  commits: 6

key-files:
  created: []
  modified:
    - scripts/mutation-floors.mjs
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - .github/workflows/ci.yml
    - supabase/tests/test_compute_job_claim_renewal.sql
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts
    - analytics-service/tests/test_sql_gate_scoped_updates.py

key-decisions:
  - "Floors are the MEASURED biting count of one full run (979), not the static annotated count"
  - "The two SENTINEL_FLOOR / ARMS_FLOOR shell assignments in ci.yml's sql-tests run block moved with the table (a contract test requires it); no step, job, run:, uses:, needs:, if: or name line changed"

requirements-completed: [MT5D-01, HEAL-01, HEAL-02, HEAL-03, HEAL-04, HEAL-05]
completed: 2026-11-24
---

# Phase 227 Plan 10: Census moves and lane proof Summary

**Schema-gate substitution (orchestrator ruling): no database push was run. The local-stack lane replayed the phase's migrations on the committed dump, and the SQL gates ran against it.**

That sentence is the plan's text. On THIS host the part about the local-stack lane did not happen, because Docker is not available here. What actually ran is recorded verbatim below, and the local-stack proof is OWED to the PR's CI run. It is NOT marked as passed.

## Lane-proof substitution (Docker unavailable, recorded verbatim)

`scripts/local-stack/run.sh up`, `--assert-local-handoff` and the psql loop against the local stack did NOT run. Instead:

1. **Every phase migration applies in filename order on the throwaway pg-lane**, through the mutation runner's full corpus (`node scripts/mutation-runner/run.mjs`, no `--file`). Each gate's `RED-UNDER-SETUP` list applies the phase migrations on top of the lane fixtures, and every baseline (pristine) leg went GREEN. Final run (after the repair in "Deviations"), pasted from the log:

   ```
   scope: FULL 92/92 annotated files
   lane-concurrency: 4   (gate files in flight at once: min(cap 4, availableParallelism 10) ...)
   coverage: files 92/119
   lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated - (none; ...)
   lane-probe: pg_cron AVAILABLE - lane-blocked class is empty, as a hosting lane requires
   arms: 979/979/0   (executed/annotated/waived)
   biting: 979   (executed arms that reddened their OWN arm first - the quantity ARMS_FLOOR bounds)
   lane-invocations: 979   (arm lanes actually spawned ... independent of the 979 the verdict loop counted; plus 92 baseline / 92 restore leg(s))
   per-arm lane time: mean 3.8s over 979 arm run(s)
   No defects. Every annotated arm bit its own arm first.
   exit=0
   ```

   The `--parse-only` reading before the run: `coverage: files 92/119`, `arms: 0/979/0   (executed/annotated/waived)`, exit 0, `No static defects`. The two arm tallies (`arms:` and `lane-invocations:`) agree at 979. `defects: 0`.

2. **The replay set the CI lane will use**, from `node scripts/check-baseline-currency.mjs --replay-set`:

   ```
   baseline-currency: carried=326 replay=7 marker-sha=match defects=0
   baseline-replay: 7 migration(s) newer than the dump: 20261124120000_jobledger_attempt_failures.sql 20261124120100_jobledger_reset_ledger_and_bridge.sql 20261124120200_compute_job_claim_renewal.sql 20261124120300_reconcile_readmit_exhaustions.sql 20261124120400_first_hop_enqueue_sweep.sql 20261124120500_poll_positions_cohort.sql 20261124120600_orphan_reaped_attempt_record.sql
   ```

   All seven migrations, nothing else. Exit 0.

3. **OWED to the PR's CI run, NOT passed here:** the local-stack proof, that is the `sql-tests`, `frontend-local-stack`, `frontend-live-db-lane`, `python` and `e2e-seeded` lanes, including the live-DB tests that call the re-based functions (`analytics-service/tests/test_compute_jobs_fencing.py`, `compute-jobs-audit-2026-05-07-residual.test.ts`, `compute-jobs-audit-2026-05-07-g10b.test.ts`, `claim-failed-retry-dedupe-migrations.test.ts`) and `npm run test:live-db`. The phase orchestrator binds that CI run to the head SHA before merge. Step (2) of Task 1 (`up`, `--assert-local-handoff`) and step (6) (`down`) were not run for the same reason; no psql call touched any database other than the throwaway pg-lane cluster (loopback only, initdb'd under the scratch directory), and nothing was pushed to TEST or PROD (T-227-29).

### Seven gate files on the pg-lane

Each gate's own sentinel and its per-file mutation row (all biting equal to annotated, all arms `RED (identity ok)`):

| Gate | `ALL N ARMS EXECUTED` | Per-file row |
|---|---|---|
| test_compute_job_attempt_failures.sql | 14 | sections 13 / judged 14 / annotated 14 / waived 0 / biting 14 |
| test_reset_stalled_bridge_provenance.sql | 6 | sections 5 / judged 6 / annotated 6 / waived 0 / biting 6 |
| test_compute_job_claim_renewal.sql | 5 | sections 5 / judged 5 / annotated 5 / waived 0 / biting 5 |
| test_reconcile_readmit_exhaustions.sql | 7 | sections 8 / judged 8 / annotated 8 / waived 0 / biting 8 |
| test_first_hop_enqueue_sweep.sql | 21 | sections 14 / judged 21 / annotated 21 / waived 0 / biting 21 |
| test_enqueue_poll_positions_cohort.sql | 7 | sections 11 / judged 11 / annotated 11 / waived 0 / biting 11 |
| test_orphan_reaped_attempt_record.sql | 4 | sections 4 / judged 4 / annotated 4 / waived 0 / biting 4 |

(Annotated arms 14+6+5+8+21+11+4 = 69, and 910 + 69 = 979. The sentinel counts differ from annotated for reconcile_readmit_exhaustions 7 vs 8 and enqueue_poll_positions_cohort 7 vs 11: the sentinel names executed identities, and a gate may annotate extra twinned steps. Each number was read off its own run, not summed.) Run directly on a lane: `test_compute_job_claim_renewal.sql` printed R1 to R5 OK and `ALL 5 ARMS EXECUTED (R1,R2,R3,R4,R5)` after the repair below.

### 500-row reset measurement (plan 02 DEC-02-C, not a gate)

A scratch SQL file outside the repo (in the session scratchpad) seeded stale `running` compute_jobs rows (claimed 30 minutes ago) and called `reset_stalled_compute_jobs(interval '10 minutes')` on the pg-lane with the plan 02 chain applied. The lane's kind check admits nine strategy-target kinds, and one in-flight row per (strategy, kind) is unique, so 500 rows needed 56 strategies (9 kinds each, the last strategy partial), not 50:

- 500 stale running rows across 56 strategies: **`reset_stalled_compute_jobs` returned 500 in 1117 ms** (`clock_timestamp` around the call, bridge loop included; 500 ledger rows written).
- An earlier calibration run: 200 rows across 50 strategies: returned 200 in 285 ms.

This is the throwaway pg-lane on a developer laptop, not the local stack and not PROD; read it as an order of magnitude (about 2 ms per row, so a 500-row pass is about a second), not a production bound.

### schema:functions

`npm run schema:functions` wrote 141 function snapshot files and `git diff --exit-code supabase/schema/functions` exited 0 (no snapshot differs from the migrations). `npx tsx scripts/dump-sql-functions.ts --check` exits 0: `SQL function snapshot is current (141 functions).` and `DRIFT-05 gate (a): baseline 136 name(s) vs migration-replay 141 name(s) - agree, with 5 ratcheted disagreement(s) carried.`

## What was done

### Task 1 - lane proof (recorded above)
Substitution recorded, plan anchors verified (`OK: 1 plan file(s), no stale claims`), replay set printed, all phase migrations and gates proven on the pg-lane through one full corpus run, 500-row timing taken, snapshots proven current. Local-stack legs owed to CI.

### Task 2 - floors and mutation-runner censuses (read off the run, never summed)
- `scripts/mutation-floors.mjs`: `FILES_FLOOR` 85 -> 92, `ARMS_FLOOR` 910 -> 979, each with a dated `RAISED ... 2026-11-24 (Phase 227 JOBLEDGER, plan 10)` provenance comment naming the seven gate files. `WAIVED_CEILING` stays 0. `grep -c "Phase 227" scripts/mutation-floors.mjs` prints 2. The ARMS_FLOOR is a measured biting count (979/979), not the static upper bound earlier phases recorded.
- `mutation-runner-floors.test.ts`: `totalAnchored` 910 -> 979, every derived literal in the synthetic green log (scope 92/92, `coverage: files 92/119`, `arms: 979/979/0`, `biting: 979`, `lane-invocations: 979` plus `92 baseline / 92 restore`, offset literals 978/980, `per-arm lane time: mean 3.8s over 979`), and the seven new per-file rows copied verbatim from the full run.
- `mutation-annotation-parser.test.ts`: `armsSeen` 979, `stepsSeen` and `needles.length` 1028 -> 1130 (read off the failing assertion and confirmed by the green rerun), `filesTotal` 119 (two places), `filesAnnotated` and `annotatedFiles` 92, the seven names added to the by-name list.
- `gate-family-meta.test.ts`: the `FILES_FLOOR=92` and `ARMS_FLOOR=979` strings with their measured provenance.
- Census grep named in the plan (`git grep -n "test_enqueue_dedup_record_retract"`) hits outside Task 2's four files: `.github/workflows/ci.yml` (the sentinel table, comments at three places), `src/__tests__/drift-check-scripts.test.ts` and `src/__tests__/lint-sql-gates.test.ts`. Task 3 owns those and they are done.

### Task 3 - remaining censuses
- `lint-sql-gates.test.ts`: `scanned 112` -> `scanned 119` (measured: `lint-sql-gates: scanned 119 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`).
- `drift-check-scripts.test.ts`: the `SENTINEL_FLOOR=30`/`ARMS_FLOOR=504` pins and the test title move to 37/568 with a dated RAISED comment.
- `.github/workflows/ci.yml`: seven rows added to the sql-tests per-file sentinel table (14, 6, 5, 7, 21, 7, 4, each read with `grep -a -o -m1 'ALL [0-9]* ARMS EXECUTED'`), a dated re-measured comment, `SENTINEL_FLOOR` 30 -> 37 and `ARMS_FLOOR` 504 -> 568 (504 + 64).
- `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`: the count of checked files sharing the text `ALL 7 ARMS EXECUTED` moved 1 -> 3 (reconcile_readmit_exhaustions and enqueue_poll_positions_cohort joined).
- `scripts/dump-sql-functions.ts`: five dated `snapshot-only` `NAME_SET_RATCHET` rows (`record_compute_job_attempt_error`, `renew_compute_job_claims`, `record_reconcile_readmit_exhaustions`, `first_hop_enqueue_sweep`, `record_orphan_reaped_attempt`), each `clearedBy` "a re-dump of supabase/schema/baseline.sql taken after its migration applied to PROD".
- `scripts/baseline-content-drift-check.mjs`: `COMPARED_FLOOR` 138 -> 143 with a dated MOVED comment. Measured by `node scripts/baseline-content-drift-check.mjs`: `baseline-content-drift: functions compared 143 - MATCH 131, DRIFT 7, SNAPSHOT_MISSING 5, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`, `allowlisted rows 3`, `findings 9`. The script exits non-zero (FAILED) and that is **expected until the post-apply re-dump, and recorded, not allowlisted**: five SNAPSHOT_MISSING (the five new functions) and four DRIFT (`enqueue_poll_positions_for_all_strategies/0`, `mark_compute_job_failed/4`, `reclaim_stuck_compute_jobs/1`, `reset_stalled_compute_jobs/2`, functions this phase's migrations re-base). `src/__tests__/baseline-content-drift-allowlist.test.ts` (18 tests) passes against the new floor.
- Table-level census hunts: `git grep -n "mt5_server_clock_readings" -- scripts src .github analytics-service` and `git grep -n "compute_jobs_set_updated_at_trigger" -- scripts src .github` found no census pinning a table or trigger count (only test text and prose), so nothing moved.
- `analytics-service/tests/test_sql_gate_scoped_updates.py` (a census the plan's lists did not name, found by the full pytest run): `_EXPECTED_MATCH_COUNTS` gained `test_reset_stalled_bridge_provenance.sql: 2` with a dated comment.

## Suite results (every command the plan names)

| Command | Result |
|---|---|
| `node scripts/verify-plan-anchors.mjs <this plan>` | `OK: 1 plan file(s), no stale claims.` (and `--pending`: `claims: 32 checked`, `OK: 8 plan file(s), no stale claims.`) |
| `npm test` (`vitest run`, full) | Test Files 2 failed, 1244 passed, 20 skipped (1266); Tests 3 failed, 26625 passed, 306 skipped (26934). The 3 failures are NOT census pins, see "Findings not caused by this plan" |
| `node scripts/lint-sql-gates.mjs --self-test && node scripts/lint-sql-gates.mjs` | `lint-sql-gates self-test OK: 7 rules, red+green each.` / `scanned 119 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |
| `node scripts/lint-migration-data-dependence.mjs` | `corpus 333 migration(s), 415 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` |
| `node scripts/lint-app-guc.mjs --self-test && node scripts/lint-app-guc.mjs` | `self-test OK: 4 finding kinds, red+green each` / `app-guc: findings 0` |
| `npx tsx scripts/dump-sql-functions.ts --check` | exit 0, `SQL function snapshot is current (141 functions).` |
| `npx tsx scripts/check-planning-hygiene.ts` | OK on every rule printed (ROADMAP-STRUCTURE, STATE-POSITION shown) |
| `cd analytics-service && python -m pytest -q` | `2 failed, 15269 passed, 93 skipped` BEFORE the census repair; after it, `test_sql_gate_scoped_updates.py` is 4 passed. The other failure, `test_job_worker_flipretry.py::test_ccxt_price_index_hang_is_bounded_transient`, passes when run alone (18 passed with the repaired file), a load-timing flake in a 34-minute run |
| `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 143 source files` |
| ci.yml guard: `git diff -U0 1eac2e8e7 HEAD -- .github/workflows/ci.yml` then `grep -c -e "^[+-] *run:" -e "^[+-] *uses:" -e "^[+-] *needs:" -e "^[+-] *if:" -e "^[+-] *- name:"` | prints 0 |

The seven census-touching vitest files (mutation-runner-floors, mutation-annotation-parser, gate-family-meta, lint-sql-gates, drift-check-scripts, ci-anti-skip-gate.contract, baseline-content-drift-allowlist) pass together: 7 files, 1320 tests.

### Skips, named
The vitest run reports 306 skipped tests and 20 skipped files, and the pytest run 93 skipped. These are the repo's existing skips (live-DB and local-stack suites that need `scripts/local-stack/run.sh up`, browser or credential-gated suites); none was added by this plan. The live-DB parts of `test_compute_jobs_fencing.py` and the other live-DB tests are among them and are owed to CI as stated above. I did not enumerate the 306 individually.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The claim-renewal gate's setup was stale after plan 02**
- **Found during:** Task 2, the first full mutation-runner run.
- **Issue:** `test_compute_job_claim_renewal.sql` (plan 03) applied the snapshot `supabase/schema/functions/reset_stalled_compute_jobs.sql`. Plan 02's migration moved that body to one writing `compute_job_attempt_failures` and calling the bridge, so the pristine run went RED at R1 with `SQLSTATE 42P01 (relation "public.compute_job_attempt_failures" does not exist)`; the runner reported `baseline ... exit 3`. Plan 03's own summary recorded baseline exit 0 because plan 02's snapshot had not landed in its branch.
- **Fix:** replaced the snapshot entry in the gate's `RED-UNDER-SETUP` with plan 02's apply chain (migrations, not the snapshot) followed by the renewal migration. Re-measured: baseline exit 0, `arms: 5/5/0`, `biting: 5`, all `RED (identity ok)`, and a direct lane run printed R1 to R5 OK and `ALL 5 ARMS EXECUTED`.
- **Files modified:** `supabase/tests/test_compute_job_claim_renewal.sql`
- **Commit:** f66031b36

**2. [Rule 3 - Blocking] ci.yml's sql-tests floors had to move, beyond comment rows**
- **Found during:** Task 3, `ci-anti-skip-gate.contract.test.ts` (`expected 37 to be 30`).
- **Issue:** the plan says edit comments only in ci.yml. The per-file sentinel table is a comment, but the contract test re-derives `SENTINEL_FLOOR` and `ARMS_FLOOR` from it and they are two real shell assignment lines in the sql-tests run block.
- **Fix:** changed exactly those two lines (30 -> 37, 504 -> 568). No `run:`, `uses:`, `needs:`, `if:` or `- name:` line changed; the plan's own guard prints 0.
- **Files modified:** `.github/workflows/ci.yml`
- **Commit:** f5a063751

**3. [Rule 3 - Blocking] Two census pins the plan's lists did not name**
- `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` (the `ALL 7 ARMS EXECUTED` sharer count, 1 -> 3) and `analytics-service/tests/test_sql_gate_scoped_updates.py` (`_EXPECTED_MATCH_COUNTS`), both found by running the suites, both fixed to the measured value. Commits f5a063751 and 6bbeb65bf.

**4. [Process] A full mutation run was repeated**
- The first full run also reported `dirty-checkout` because I edited tracked files while it ran; the rerun was done on a clean tree after committing. Both runs' tallies agree (979 annotated); only the second (exit 0) is quoted as the measurement.

## Findings not caused by this plan (reported, not papered over)

Full vitest is **red by 3 tests in 2 files**, none a census pin and none touching files this phase changed (`git diff 4f0e9edc1 HEAD -- src/lib/factsheet scripts/ci-apt.sh` is empty):

1. `src/lib/factsheet/compute.conventions.test.ts`, fixtures B and C, two inline snapshots: `skew` differs in the last printed digit (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` expected, `0.036844507138638946` received). A floating-point last-ulp difference on this host. Unrelated to jobledger.
2. `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` R4: `bash scripts/ci-apt.sh --self-test` hits the test's 55 s spawn timeout. Run directly, the same self-test prints `ci-apt self-test OK ...` and takes 58.6 s wall clock on this host, so the test's budget is exceeded by host speed, not by a failing phase.

One pytest failure in the 34-minute run (`test_job_worker_flipretry.py::test_ccxt_price_index_hang_is_bounded_transient`) passed on rerun in isolation; treated as load timing, not investigated further.

`node scripts/baseline-content-drift-check.mjs` itself exits non-zero by design until the re-dump (nine expected findings listed above).

## Known Stubs

None. No UI or data-flow stubs were created by this plan.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change at a trust boundary; the plan moved census numbers, comment rows and one test setup list. T-227-29: no database push anywhere; the only database touched was a throwaway loopback pg-lane cluster. T-227-30: every number above was pasted from a run (the stepsSeen figure from a failing assertion plus the green rerun).

## Self-Check

- Commits present: f66031b36, 108e97aed, f5a063751, 33f246314, 8ea72d356, 6bbeb65bf.
- Modified files verified present; STATE.md and ROADMAP.md untouched.
- Local-stack proof NOT run and NOT claimed.
