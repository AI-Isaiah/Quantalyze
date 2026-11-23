---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 07
subsystem: database
tags: [postgres, supabase, compute-jobs, trigger, security-definer, sql-gate, mutation-runner, pg-cron]

requires:
  - phase: 227-01
    provides: "public.compute_job_attempt_failures with the cause_class 'orphan_reaped' value and the (job_id, claim_token, cause_class) identity"
  - phase: 162
    provides: "the retention_compute_jobs_orphaned_running terminalizer (20260826140000 registration) whose running to failed_final transition this plan records"
provides:
  - "public.record_orphan_reaped_attempt(): SECURITY DEFINER trigger function, search_path pinned, executable by no API role"
  - "trigger compute_jobs_record_orphan_reaped_attempt: AFTER UPDATE OF status ON public.compute_jobs, row level, WHEN running to failed_final with error_kind orphaned"
  - "catalogue-only self-verify of the trigger, the function ACL and the ledger CHECK"
  - "SQL lane gate test_orphan_reaped_attempt_record.sql: 4 arms (O1 to O4), 4 twins, all biting, running the lane's real terminalizer command"
  - "manual rollback off the auto-apply path"
affects: [227 plan 10 (census pins), 230 MT5NIGHTLY]

plan_head_before: 8e1bebbe8b36b37af1dde1e0951e37003772f1f2
plan_head_after: 032ead23d8806dc6d0582035a6e9130606db9337

actuals:
  tokens: 10462
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "a WHEN-qualified column-scoped AFTER trigger records a transition made by a cron body that a migration may not re-register"
    - "gate arms execute the deployed cron.job.command and read ledger rows the transition produced; shape pinned from pg_trigger and pg_get_triggerdef"

key-files:
  created:
    - supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql
    - supabase/migrations/down/20261124120600-rollback.sql
    - supabase/tests/test_orphan_reaped_attempt_record.sql
    - supabase/schema/functions/record_orphan_reaped_attempt.sql
  modified: []

key-decisions:
  - "DEC-07-A to DEC-07-C as recorded in the plan and the migration header (trigger scoped by WHEN, what the row carries, no catch-up sweep)"
  - "O2's twin wraps the claim token as COALESCE(OLD.claim_token, <fixed uuid>) instead of replacing it with a bare fixed uuid, so arm O1 (which has a real token) stays green and O2 is the first failure"

patterns-established:
  - "A twin that must redden only its own arm wraps the value (COALESCE) rather than replacing it, when an earlier arm shares the code path"

requirements-completed: []

coverage:
  - id: D1
    description: "A running job reaped by the real terminalizer's claim-stamp arm leaves one orphan_reaped ledger row carrying the claim token, attempt count, worker id and the terminalizer's last_error"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_orphan_reaped_attempt_record.sql (arm O1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The never-claimed 48-hour arm also leaves a row, with a NULL claim token; a real failure through mark_compute_job_failed leaves no orphan_reaped row"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "same gate, arms O2 and O3"
        status: pass
    human_judgment: false
  - id: D3
    description: "The trigger is one enabled, row-level, status-scoped AFTER trigger with a narrow WHEN on a SECURITY DEFINER function no API role can execute; the terminalizer's cron body is untouched"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "same gate, arm O4, plus the migration's own STEP 3 self-verify"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-11-23
status: complete
---

# Phase 227 Plan 07: orphan_reaped attempt record Summary

**A WHEN-scoped `AFTER UPDATE OF status` trigger on `public.compute_jobs` writes one `orphan_reaped` ledger row when the hourly terminalizer ends a running job as `failed_final` with `error_kind` `orphaned`; the terminalizer's cron command is not touched and nothing is scheduled.**

## Accomplishments

- `record_orphan_reaped_attempt()` copies claim token, attempts and worker id from OLD and the job columns plus `error_kind` / `last_error` from NEW into `compute_job_attempt_failures`, `ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING`, `RETURN NULL`. SECURITY DEFINER, `search_path = public, pg_catalog`, `REVOKE ALL` from PUBLIC, anon, authenticated and service_role.
- `compute_jobs_record_orphan_reaped_attempt`: plain `CREATE TRIGGER` (a collision fails loud).
- STEP 3 self-verify reads catalogues only (the data-dependence linter reports 0 NEW refusals): one trigger, enabled, `AFTER UPDATE OF status`, `FOR EACH ROW`, WHEN names `'running'`, `'failed_final'`, `'orphaned'`; the function is SECDEF, pinned, not executable by PUBLIC, anon, authenticated; plan 01's CHECK admits `orphan_reaped`. One named boolean and one literal RAISE per condition.
- Gate arms: O1 (claim-stamp arm, real terminalizer executed from `cron.job.command`), O2 (never-claimed arm, NULL token, api-key-keyed job with NULL strategy), O3 (`mark_compute_job_failed` permanent failure: one `error` row, zero `orphan_reaped`), O4 (shape from `pg_trigger`: tgtype bits for row, AFTER, UPDATE and no INSERT/DELETE/TRUNCATE/INSTEAD OF, column list equal to status only, WHEN tokens, function ACL and config).
- Manual rollback drops the trigger then the function, keeps all ledger rows, with a catalogue precondition and postcondition.

## Task Commits

1. **Task 1 (tracer): function, trigger, arm O1** - `6467dcf31`
2. **Task 2: O2 to O4, self-verify, rollback** - `a640fd2b1`
3. **Gate header SETUP LIST paragraph corrected** - `032ead23d`

Measured from the ledger: `git rev-list --count 8e1bebbe8b36b37af1dde1e0951e37003772f1f2..HEAD` = 3 at `032ead23d8806dc6d0582035a6e9130606db9337` (before this SUMMARY's own commit).

## PROOF-01 transcript (verbatim, scratch paths shown as `<scratch>`)

Commands run from the worktree root on the pg-lane.

```
cp supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql <scratch>/mig07.backup
cmp -s <that migration> <scratch>/mig07.backup        -> backup ok
```

**Neuter edit.** In `record_orphan_reaped_attempt()` the whole `INSERT ... ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;` statement was replaced by `NULL;`, so the trigger still fires and writes nothing. The gate on the neutered tree (first and only failure):

```
psql:supabase/tests/test_orphan_reaped_attempt_record.sql:124: ERROR:  P0001: TEST FAILED (O1): after the real terminalizer reaped a running job (claim token ef2f576b-6a80-499e-8c48-fad1b06145a0, attempts 2, worker w1) the ledger held 0 row(s), the first reading NULL (expected exactly one: cause_class orphan_reaped, that claim token, attempt 2, worker_id w1, error_kind orphaned, error_text starting orphaned_running_reaped:, the job's strategy and kind). A worker death leaves no record once the job row is pruned, so Phase 230 reads a night in which nothing failed.
```

**Restore and GREEN.**

```
cp <scratch>/mig07.backup supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql
cmp -s <scratch>/mig07.backup <that migration>        -> cmp exit=0
node scripts/mutation-runner/run.mjs --file supabase/tests/test_orphan_reaped_attempt_record.sql
  baseline ... exit 0
  arm O1  exit 3  RED (identity ok)
  arm O2  exit 3  RED (identity ok)
  arm O3  exit 3  RED (identity ok)
  arm O4  exit 3  RED (identity ok)
  restore ... exit 0
  arms: 4/4/0   biting: 4   lane-invocations: 4   No defects in the narrowed scope.
exit=2
```

**Self-verify bites too (extra evidence).** With only the CREATE TRIGGER line changed from `AFTER UPDATE OF status` to `AFTER UPDATE` (no stand-down), the apply refuses at STEP 3: `orphan_reaped: the trigger must be AFTER UPDATE OF status, otherwise it fires on every compute_jobs update (a hot table) instead of only on a status change`. Backup restored byte-equal (`cmp` exit 0).

**Rollback lane proof.** Setup list applied, then `down/20261124120600-rollback.sql` as `--post-apply`, then a gate asserting the trigger and function are gone: `ROLLBACK GATE OK: trigger and function gone`, lane exit 0.

**Non-owner firing probe (ad hoc, not in the gate).** The gate runs as the lane superuser, so it cannot prove the REVOKE leaves the trigger working for a non-owner writer. A scratch role (`BYPASSRLS`, SELECT and UPDATE on `compute_jobs`, no EXECUTE on the function, no INSERT on the ledger) updated a running job to `failed_final` / `orphaned`: `probe can execute fn: f`, `FIRING PROBE rows=1`. So the claim "a trigger function needs no caller grant" holds on the lane for a non-owner role, and it rests on PostgreSQL checking EXECUTE at `CREATE TRIGGER` time. Whether the production cron role behaves the same is the same PostgreSQL rule, not a separate measurement. The probe is not committed.

## Verification run

| Command | Result |
|---|---|
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_orphan_reaped_attempt_record.sql` | exit 2, arms 4/4/0, biting 4 |
| `node scripts/lint-migration-data-dependence.mjs` | 83 refusals, 83 allowlisted, 0 NEW |
| `node scripts/lint-sql-gates.mjs` and `--self-test` | 0 findings over 118 files; self-test 7 rules OK |
| `npm run schema:functions` | new snapshot `record_orphan_reaped_attempt.sql` only |
| `git diff --stat 8e1bebbe8b36b37af1dde1e0951e37003772f1f2..HEAD -- 20260826140000 migration, test_retention_orphaned_running.sql, retention-orphaned-running-terminalize.test.ts` | empty (terminalizer migration, its gate and its TS pin untouched) |
| `grep -c "cron\.schedule\|cron\.unschedule"` on the migration | 0 |
| vitest: outagealert-migration-schedules-nothing, retention-orphaned-running-terminalize | 17 passed |
| vitest: gate-family-meta, audit-coverage | 21 and 28 passed |
| vitest: mutation-runner-floors | 3 RED, all census pins owned by plan 10, see below |
| `npx tsx scripts/dump-sql-functions.ts --check` | exit 1 on the name-set ratchet, see below |
| `npx tsx scripts/check-planning-hygiene.ts` | OK |

Also run, all green: vitest `drift-check-scripts` (932 passed; a first run hit my own 110 s wrapper timeout on a loaded host, the re-run without it passed) and `critical-regressions` (181 passed).

## Left for plan 10 (census pins, deliberately not edited)

On this branch (phase branch with plans 01, 03 to 06 plus this plan), `src/__tests__/mutation-runner-floors.test.ts` is red in exactly three tests, all census: the corpus re-derivation expects 910 anchored twins and reads 968 (`expected 968 to be 910`), `FILES_FLOOR` is 85 and the corpus has 91 annotated files, `ARMS_FLOOR` is 910 and the corpus declares 968 non-waived twins. This plan's own share is +1 file and +4 twins (O1 to O4, no waiver). `scripts/mutation-floors.mjs` and every other census pin are untouched.

`dump-sql-functions.ts --check` reports five `snapshot-only:` names (`first_hop_enqueue_sweep`, `record_compute_job_attempt_error`, `record_orphan_reaped_attempt`, `record_reconcile_readmit_exhaustions`, `renew_compute_job_claims`): new functions that are not in `supabase/schema/baseline.sql`. This plan owns one of them (`record_orphan_reaped_attempt`); the `NAME_SET_RATCHET` entry is plan 10's, not edited here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Gate setup list is not the pure union**
- **Found during:** Task 1 (first lane run)
- **Issue:** `20260826140000` re-bases `get_user_compute_jobs` and needs the OUT-parameter shape from `20260516104201` (first attempt: `42P13 cannot change return type of existing function`), whose own self-verify needs the set-based fan-in from `20260515114555` (second attempt: `mark_compute_job_done missing NOT EXISTS set-based fan-in`).
- **Fix:** `20260515114555` and `20260516104201` are listed (before `20260614120000`) and fixture 36 is dropped (`20260515114555` adds `claim_token`). That leaves a 3-argument `claim_compute_jobs_with_priority` beside the 5-argument one, which makes a 3-positional-argument call ambiguous (42725); this gate never calls the claim function, and plan 01's self-verify only needs the 5-argument one to exist. The gate header's SETUP LIST paragraph says so (it said the opposite until `032ead23d`, because only the JSON line was patched in the first two commits).
- **Commits:** 6467dcf31, a640fd2b1, 032ead23d

**2. [Rule 1 - Bug] O2 twin wraps the token instead of replacing it**
- The plan says replace `OLD.claim_token` with a fixed uuid. That would also redden O1 first (O1 expects its real token). The twin is `COALESCE(OLD.claim_token, '<fixed uuid>'::uuid)`, so only the NULL-token arm (O2) changes.

**3. [Rule 3 - Blocking] Twins for O1, O3, O4 also stand down a self-verify IF**
- Each of those twins edits the trigger text the self-verify reads (`orphaned` literal for O1 and O3, `AFTER UPDATE OF status` for O4), so each carries a second edit `IF FALSE AND NOT <name> THEN`. Without it the apply refuses and the gate never runs. The plan asked for exactly this.

**4. [Reporting] Seeds are backdated a century, not 5 hours**
- O1's `claimed_at` and O2's `created_at` are seeded 100 years back, not 5 hours (O1) and 49 hours (O2), the isolation mechanism of `test_retention_orphaned_running.sql` (a seed outranks any foreign candidate under the terminalizer's global `ORDER BY ... LIMIT 100`). Both are far past their windows, so the arms still select the intended terminalizer arm.

**5. [Reporting] Task 2 is tdd="true" but has no test-first commit**
- O2 to O4 were green on the Task 1 tree by construction (the trigger already copies a NULL token, ignores `mark_compute_job_failed`, and has the right shape), so "see each RED against a migration missing its guard" is satisfied only by the twins (each `RED (identity ok)` above) and by the PROOF-01 neuter, not by a failing test-first commit. History was not rewritten to fake one.

### Premises recorded, not measured

- DEC-07-B says arm B's rows have a NULL token. The terminalizer gate's own arm E seeds a NULL `claimed_at` with a NON-NULL token (the shape of 6 rows measured on TEST in 2026-08), in which case the trigger copies that token. O2 seeds the NULL-token shape the plan describes; it asserts the trigger copies what the job held, and does not claim PROD's never-claimed rows have no token.
- The "no caller grant needed" claim for the REVOKE is proven on the lane for a non-owner role (probe above) but not on the production cron role.

## Local-stack lane substitution

Docker is not available on this host. `scripts/local-stack/run.sh up` was not run. Every gate run used the throwaway PostgreSQL lane (`scripts/pg-lane/run.sh`, via `node scripts/mutation-runner/run.mjs --file <gate>`). The gate carries no lane-specific construct (per-arm `BEGIN; DO; ROLLBACK;`, pg_cron probed through `cron.job`), so it should run on the local stack, but that proof is left to CI (plan 10 owns it).

## Known Stubs

None.

## Threat Flags

None. The trigger fires for at most the terminalizer's 200 rows per hour (two `LIMIT 100` arms), is column-scoped with a WHEN that matches only its transition (T-227-21), and its function is not executable by any API role with search_path pinned, proven by the self-verify and arm O4 (T-227-22). The new function writes only to the ledger plan 01 created and reads only OLD and NEW.

## Notes for the orchestrator

- MT5D-01 is only partly delivered by this plan (the `orphan_reaped` cause). It was NOT marked complete; STATE.md and ROADMAP.md were not touched.
- No cron command was changed and nothing is scheduled in the migration.

## Self-Check: PASSED

Files found: migration, rollback, gate, function snapshot. Commits `6467dcf31`, `a640fd2b1`, `032ead23d` are ancestors of HEAD.
