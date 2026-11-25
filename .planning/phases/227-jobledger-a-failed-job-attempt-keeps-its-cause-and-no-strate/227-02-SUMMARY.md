---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 02
subsystem: database
tags: [postgres, supabase, compute-jobs, watchdog, status-bridge, append-only-ledger, sql-gate, mutation-runner]

requires:
  - phase: 227-01
    provides: "public.compute_job_attempt_failures (cause classes error, watchdog_reset, stall_reclaim, orphan_reaped) and the sorted-bridge-loop shape in mark_compute_job_failed"
provides:
  - "reset_stalled_compute_jobs re-based: one data-modifying CTE per pass writes a watchdog_reset ledger row per reset row, then one sorted bridge loop per distinct (strategy_id, kind)"
  - "reclaim_stuck_compute_jobs re-based the same way, stall_reclaim rows with the PRE-decrement attempt"
  - "SQL lane gate test_reset_stalled_bridge_provenance.sql (arms B1-B5b, SC-4 headline B1) and arms W1-W5 appended to test_compute_job_attempt_failures.sql"
  - "catalogue-only self-verify (22 named clauses) and manual rollback off the auto-apply path"
affects: [227 plan 07 (orphan_reaped), 227 plan 08 (worker wiring), 227 plan 10 (census pins, 500-row reset timing), 230 MT5NIGHTLY]

plan_head_before: f038281e077c21393707eaec764ee4bb3a1f8761
plan_head_after: aea2ac99241e07f9f6901488f25183236e0d5141

actuals:
  tokens: 36623
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "data-modifying CTE trio old/upd/ins: SKIP LOCKED selection remembers pre-update columns, the UPDATE returns them, the ledger INSERT reads them"
    - "gate setup list assembled in timestamp order from a proven base, with a pg-lane stand-in fixture for a column whose real migration cannot be applied whole"

key-files:
  created:
    - supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql
    - supabase/migrations/down/20261124120100-rollback.sql
    - supabase/tests/test_reset_stalled_bridge_provenance.sql
    - scripts/pg-lane/fixtures/44-fixture-compute-jobs-reclaim-count.sql
  modified:
    - supabase/tests/test_compute_job_attempt_failures.sql
    - supabase/schema/functions/reset_stalled_compute_jobs.sql
    - supabase/schema/functions/reclaim_stuck_compute_jobs.sql

key-decisions:
  - "DEC-02-A to DEC-02-E as recorded in the plan and the migration header (both functions, one bridge call per (strategy, kind), row locks then advisory locks, bridge comment corrected in the header not re-issued, reclaim keeps its token)"
  - "The migration restates the ACL with REVOKE ALL ... FROM PUBLIC, anon, authenticated for both functions (a no-op on PROD) so the self-verify's ACL claim holds on a lane that cannot apply 20260516104201"
  - "Self-verify pins COUNTS, not presence: reset has two passes, so a clause one pass satisfies would hide the other pass losing it"

patterns-established:
  - "A twin whose mutation a self-verify clause would catch also stands that one IF down (IF FALSE AND NOT v_x THEN), so the arm, not the migration's own guard, is the first failure"

requirements-completed: []

coverage:
  - id: D1
    description: "A watchdog reset re-derives the strategy status through the bridge: a stale failed row reads computing with sentence and markers NULL, and attempt 2's different sentence under the SAME job id survives (ROADMAP SC-4, HEAL-04)"
    requirement: "HEAL-04"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_reset_stalled_bridge_provenance.sql (arm B1, and B4 for reclaim)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Side-kind reset does not move a published status; a side kind beside a main kind still bounces; two strategies are both re-derived; a key-mode row (NULL strategy_id) makes no bridge call and does not raise"
    requirement: "HEAL-04"
    verification:
      - kind: integration
        ref: "same gate, arms B2, B3, B5, B5b"
        status: pass
    human_judgment: false
  - id: D3
    description: "A reset reads differently from a real error in the ledger: watchdog_reset with pre-reset token and attempt, stall_reclaim with the pre-decrement attempt, two ordered records for reset then real error, return count unchanged, a row inside its kind's window writes nothing"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql (arms W1-W5; E1-E8 unchanged)"
        status: pass
    human_judgment: false

duration: 150min
completed: 2026-11-23
status: complete
---

# Phase 227 Plan 02: JOBLEDGER watchdog reset ledger and bridge Summary

**Both watchdog functions now leave one ledger row naming the reset (`watchdog_reset` / `stall_reclaim`) and re-derive the strategy's analytics status through the existing bridge, so an attempt-2 curated sentence restated under the same job id survives the provenance trigger (TODOS `[164.2-RECLAIM-PROVENANCE]`, ROADMAP SC-4).**

## Accomplishments

- `reset_stalled_compute_jobs` and `reclaim_stuck_compute_jobs` re-based on 20260516104201: each UPDATE became an `old` / `upd` / `ins` data-modifying CTE statement (SKIP LOCKED selection remembers token, attempts, worker; the ledger row carries the PRE-reset values), followed by one loop over `GROUP BY strategy_id, kind ORDER BY hashtext(strategy_id::text), strategy_id, kind` that takes the `mark_compute_job_bridge` advisory lock and `PERFORM`s `sync_strategy_analytics_status(strategy_id, min job id)`. Contract kept: INTEGER count, non-positive-threshold RAISE, LIMIT 500 + FOR UPDATE SKIP LOCKED per pass, `last_error 'worker_stalled'`, `claim_token NULL`; reclaim keeps its attempts decrement, reclaim_count bump and its token.
- Gate `test_reset_stalled_bridge_provenance.sql`: B1 (SC-4 tracer), B2 (side kind negative control), B3 (side + main kind), B4 (reclaim parity), B5 (two strategies), B5b (key-mode row). `test_compute_job_attempt_failures.sql` gained W1-W5 after E8; E1-E8 and their twins are untouched and still all `RED (identity ok)`.
- Self-verify (STEP 3): catalogue-only, 22 named booleans each in its own IF with one literal RAISE. Counts, not presence (two passes in reset).
- Two `prod-body-ack` pragmas. Hashes are the `live` (second hash) column of `--diff-bodies <new snapshot> <pre-change snapshot>`. The pre-change snapshot (phase-branch base f038281e) equals `origin/main`'s (`git diff f038281e origin/main -- <snapshot>` empty for both). Each ack is EARNED only if VAC-04 on the PR reports the same hash for PROD; VAC-08 is RED on the PR until apply-on-merge.
- Manual rollback restores both bodies byte for byte (proof below), keeps ledger rows.

## Task Commits

1. **Task 1 (tracer): reset ledger rows + bridge loop, gate arm B1** - `b9c893402`
2. **Task 2: reclaim parity, arms B2-B5b and W1-W5, fixture 44** - `bfdda427d`
3. **Task 3: self-verify, VAC-04 acks, rollback, twin stand-downs** - `aea2ac992`

Measured from the ledger: `git rev-list --count f038281e077c21393707eaec764ee4bb3a1f8761..HEAD` = 3 at `aea2ac99241e07f9f6901488f25183236e0d5141` (before this SUMMARY's own commit).

## PROOF-01 transcript (verbatim)

Backup, neuter, run, restore by `cp`, `cmp`, re-run. Scratch paths abbreviated.

```
cp supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql <scratch>/mig.proof.bak
cmp -s <that migration> <scratch>/mig.proof.bak        -> backup cmp exit=0
```

**(a) Literal deletion of the reset PERFORM.** The apply refuses at STEP 3 and the gate never runs (the migration's own guard works):

```
psql:supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql:524: ERROR:  P0001: jobledger: reset_stalled_compute_jobs must take the mark_compute_job_bridge advisory lock and call sync_strategy_analytics_status with the reset job id as trigger, otherwise a reset strategy keeps its stale status and curated sentence, or a side-kind reset bounces a published status
lane-exit=3
cp <scratch>/mig.proof.bak <migration>; cmp -s ... -> restore cmp exit=0
```

**(b) Neuter (the B1 twin): PERFORM replaced by `NULL;` with the bridge self-verify IF stood down.** First `TEST FAILED` line from the pg-lane on the neutered tree:

```
psql:supabase/tests/test_reset_stalled_bridge_provenance.sql:145: ERROR:  P0001: TEST FAILED (B1): after the watchdog reset a job whose attempt had stamped a curated sentence and the markers (writer, job), the job reads status pending with claim token NULL (expected pending, NULL), the strategy reads status failed, sentence B1 sentence one: the account login was refused, reconnect the key., source writer, job id 694443ef-8f84-4126-9539-3d65915c6fcd (expected computing and all three NULL), and after attempt 2 re-stamped a different sentence under the same job id the row reads sentence B1 sentence two: the broker gateway was unreachable, nothing is wrong with your key., source NULL, job id NULL (expected the new sentence, writer, and the job id). ...
lane-exit=3
cp <scratch>/mig.proof.bak <migration>; cmp -s ... -> restore cmp exit=0
```

(The `source NULL, job id NULL` on the attempt-2 read is the defect exactly: the provenance trigger dropped the markers.) After restore, the runner:

```
node scripts/mutation-runner/run.mjs --file supabase/tests/test_reset_stalled_bridge_provenance.sql
  baseline ... exit 0
  arm B1 RED (identity ok)   B2 RED (identity ok)   B3 RED (identity ok)
  arm B4 RED (identity ok)   B5 RED (identity ok)   B5b RED (identity ok)
  arms: 6/6/0   biting: 6   lane-invocations: 6   No defects in the narrowed scope.
exit=2
node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql
  arms: 14/14/0   biting: 14   (E1,E2,E4,E3,E3b,E5,E6,E7,E8,W1,W2,W3,W4,W5 all RED (identity ok))
exit=2
```

**Self-verify is not decorative.** One spot check without the stand-down: the W5 mutation (`OR TRUE`) alone aborts the apply with `jobledger: the default pass of reset_stalled_compute_jobs must exclude kinds named in p_per_kind_overrides ...`, restore `cmp` exit 0.

## RED-first evidence for Task 2 (after the fact)

Task 2 is `tdd="true"`; the reclaim body, arms and fixture were written together and committed once, so there is no test-first commit and history was not rewritten. After-the-fact evidence: both gates run against the Task 1 migration (`git show b9c893402:<migration>`) fail on the reclaim arms because reclaim is still the pre-change body: `TEST FAILED (B4)` (strategy still reads status failed) and `TEST FAILED (W2)` (`attempts 2, reclaim_count 0`, no stall_reclaim row). Migration restored by `cp`/`cmp` (exit 0).

## Rollback lane proof

`down/20261124120100-rollback.sql` applied as `--post-apply` after the full setup list: `md5(prosrc)` of the restored functions are `d9952f736e9ccf01be3403aa34ecb097` (reset) and `8fefcacd09fa9962b66248dc60490427` (reclaim), equal to the md5 of the bodies in the pre-change snapshots. anon holds no EXECUTE and service_role keeps it, after the rollback; its postcondition DO block passed.

## Verification run

| Command | Result |
|---|---|
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_reset_stalled_bridge_provenance.sql` | exit 2, 6/6/0, biting 6 |
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql` | exit 2, 14/14/0, biting 14 |
| `node scripts/lint-migration-data-dependence.mjs` | 83 refusals, 83 allowlisted, 0 NEW |
| `node scripts/lint-sql-gates.mjs --self-test` and corpus | 7 rules OK; 117 files, 0 findings |
| `npm run schema:functions` | diff only in the two snapshots this plan owns |
| `npx tsx scripts/check-planning-hygiene.ts` | OK |
| vitest `drift-check-scripts` | pass |
| vitest `mutation-annotation-parser`, `lint-sql-gates` | 5 RED, all corpus-count pins owned by plan 10, see below |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Gate setup list is not "curated-sentence list + bridge + 20260516104201 + plan 01 migration"**
- **Found during:** Task 1 (first lane run)
- **Issue:** that list lacks the 5-argument claim pair, which plan 01's STEP 5 refuses without; and 20260516104201 aborts on its own verify block ("mark_compute_job_done missing NOT EXISTS set-based fan-in") on any list that omits 20260515114555, which plan 01 excluded for the 42725 claim overload clash.
- **Fix:** base is plan 01's proven list, plus `20261023120000` and `20261105120000` (the latest bridge) before `20261024120000`, plus this migration last; 20260516104201 is NOT in the list. The migration creates both functions itself (`CREATE OR REPLACE` creates when absent) and restates the ACL with a `REVOKE` so the lane has PROD's shape. Both gates carry the identical list and say so in their headers.
- **Files modified:** supabase/tests/test_reset_stalled_bridge_provenance.sql, supabase/tests/test_compute_job_attempt_failures.sql, the migration
- **Commit:** b9c893402, bfdda427d

**2. [Rule 3 - Blocking] New pg-lane fixture 44 for `compute_jobs.reclaim_count`**
- **Issue:** reclaim bumps `reclaim_count`, whose only source is 20260510180226 (large, re-bases the claim and mark RPCs, carries its own verify block). Without the column B4/W2 die with 42703.
- **Fix:** `scripts/pg-lane/fixtures/44-fixture-compute-jobs-reclaim-count.sql`, a stand-in in the shape of fixture 36 (`ADD COLUMN IF NOT EXISTS`, type and default from 20260510180226). Placed after fixture 36 in both lists. It is a new file under `scripts/pg-lane/fixtures/`, not a census-pinned one (lint-sql-gates clean).
- **Commit:** bfdda427d

**3. [Rule 1 - Bug] B3's plan-prescribed twin cannot bite; replaced**
- **Issue:** the plan's twin ("GROUP BY strategy_id with the job id taken as min over the group") never reddens B3: the bridge's side-kind early return needs `v_nonterminal_counting_count = 0`, but a reset main-kind job is pending (non-terminal, counting), so whichever job id is the trigger the status bounces. Per-kind grouping is therefore defensive, not observable through status. Measured: that twin was NO-RED.
- **Fix:** the B3 twin skips the bridge for every strategy that has a reset position-poll job (a strategy-level instead of per-kind decision), which does bite B3 (and leaves B2, a negative control, green). The per-kind grouping is still pinned by self-verify (`GROUP BY cj.strategy_id, cj.kind`).
- **Commit:** bfdda427d

**4. [Rule 3 - Blocking] B5 split into B5 and B5b**
- Arm ids are unique per file and carry one twin each, so "two strategies re-derived" (twin: LIMIT 1 on the loop) and "key-mode row, no bridge call, no raise" (twin: drop `strategy_id IS NOT NULL`) are two arms. `sectionOfIdentity` folds B5b into B5, so the runner prints 5 sections over 6 arms.

**5. [Rule 3 - Blocking] PROOF-01 neuter is two-step, not deletion**
- Deleting the PERFORM outright aborts the apply at STEP 3 (transcript (a)); the arm-attributable red is the twin (b). Both recorded. This is why every twin whose mutation a self-verify clause catches also stands that IF down; the twin edits are second `edit` steps in the existing `RED-UNDER-M` objects.

**6. Reporting-only differences**
- W3 uses the per-kind override pass and W1 the default pass on purpose (a W1-only literal swap in the default pass cannot redden W3 and vice versa), and the W4 expected count is computed from the rows by the two thresholds before the call, never from the function or the ledger.
- W3 drives the real `claim_compute_jobs_with_priority` (3 positional arguments, the same call plan 01's E1 makes).
- `SET LOCAL lock_timeout` in the migration warns 25P01 on the lane (psql autocommit), as in plan 01's migration; it is a no-op there and effective under the Supabase apply transaction.

## Local-stack lane substitution

Docker is not available on this host, so `scripts/local-stack/run.sh up` was not run. Every gate run used the throwaway PostgreSQL lane via `node scripts/mutation-runner/run.mjs --file <gate>`. Left to CI, plan 10 owns it: the sql-tests local-stack run of both gates, the live-DB tests that call these functions (`analytics-service/tests/test_compute_jobs_fencing.py` reset NULLs claim_token on both branches, `src/__tests__/compute-jobs-audit-2026-05-07-residual.test.ts` M-0781 500-row bound and its ACL pin, `src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts` reclaim decrements and threshold), and the measured duration of a 500-row reset with bridge calls (no lock_timeout on this path, DEC-02-C).

## Left for plan 10 (census pins, deliberately not edited)

`src/__tests__/mutation-annotation-parser.test.ts` is red in 4 tests (annotation total expected 910, now 964 across all phase-227 branch work; the real-corpus needle count 1028 now 1105; files 112 now 117 in two tests) and `src/__tests__/lint-sql-gates.test.ts` in 1 (`scanned 112 file`, now 117). These count the whole corpus including plans 01, 03-05 and this plan's new gate file (+1 file, +6 arms here, +5 arms in the plan 01 file). `src/__tests__/mutation-runner-floors.test.ts` (FILES_FLOOR, ARMS_FLOOR, totalAnchored) moves too, as plan 01 recorded. `scripts/mutation-floors.mjs` and every other census pin are untouched.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: lock-surface | supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql | The watchdog now INSERTs ledger rows (FK key-share locks on strategies and api_keys) while holding the SKIP LOCKED row locks, then takes bridge advisory locks per strategy. Order is rows, then advisory locks, the same as `mark_compute_job_failed`; no cycle was found (a reset row is `running`, the fan-in cascade locks only `done_pending_children` rows). A 500-row tick with bridge calls is unmeasured here, plan 10's lane run measures it (T-227-05). |

Threat register: T-227-05 (row locks first, then advisory lock, bound 500 per pass; timing measured by plan 10), T-227-06 (the reset only calls the existing bridge, writes no sentence itself, B2 proves a side kind does not bounce), T-227-07 (ACL restated by REVOKE, self-verify asserts no PUBLIC/anon/authenticated EXECUTE and the pinned search_path) are mitigated as planned.

## Notes for the orchestrator

- STATE.md, ROADMAP.md and REQUIREMENTS.md were not touched. MT5D-01 is only partly delivered after this plan (`error`, `watchdog_reset`, `stall_reclaim`; `orphan_reaped` is plan 07, worker wiring plan 08), so it is NOT ready to mark complete. HEAL-04's mechanics are delivered and gated here.
- Anything that merges this branch with plan 01's must keep this migration after `20261124120000` (timestamp order already does).
- `supabase/schema/functions/*.sql` for the two functions are regenerated and committed; `sync_strategy_analytics_status`'s body comment still lists the reset among non-caller writers (DEC-02-D: corrected in the migration header, bridge not re-issued).

## Self-Check: PASSED

Files found: migration, rollback, new gate, fixture 44, edited attempt-failure gate, both function snapshots. Commits `b9c893402`, `bfdda427d`, `aea2ac992` are ancestors of HEAD.
