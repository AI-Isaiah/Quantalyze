---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 01
subsystem: database
tags: [postgres, supabase, compute-jobs, append-only-ledger, rls, security-definer, sql-gate, mutation-runner]

requires:
  - phase: 164.9.3.1
    provides: "the latest mark_compute_job_failed body (fan-in cascade, 55006 and 55P03 fences, sorted bridge loop) that this plan re-bases"
  - phase: 164.9.3
    provides: "the claim pair whose M-1137/M-1138 last_error clear this ledger is written ahead of, and whose self-verify pin is carried forward"
provides:
  - "public.compute_job_attempt_failures: append-only per-attempt failure ledger, no FK to compute_jobs, owner cascades, RLS on with no policy, service_role SELECT only"
  - "mark_compute_job_failed writes one cause_class 'error' row in the failing transaction"
  - "public.record_compute_job_attempt_error(uuid, uuid, text, text) RETURNS boolean, service_role only, for the 55P03 and late-55006 paths"
  - "SQL lane gate test_compute_job_attempt_failures.sql: 9 arms, 9 twins, all biting"
  - "manual rollback off the auto-apply path"
affects: [227 plan 02 (watchdog_reset, stall_reclaim writers), 227 plan 07 (orphan_reaped trigger), 227 plan 08 (worker wiring), 227 plan 10 (census pins), 230 MT5NIGHTLY]

plan_head_before: 0bb1b4293909e4a12315e5039528ba704695348c
plan_head_after: 3132a29b260b441836f08da0652ad22a52750c6d

actuals:
  tokens: 31359
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "append-only ledger written by SECURITY DEFINER functions in the failing transaction, identity UNIQUE (job_id, claim_token, cause_class)"
    - "catalogue-only self-verify with one named boolean per IF so a gate twin can stand exactly one IF down"
    - "worker-lost RPC whose claim token is attested by the job row or by an existing ledger row, columns copied from the attesting source"

key-files:
  created:
    - supabase/migrations/20261124120000_jobledger_attempt_failures.sql
    - supabase/migrations/down/20261124120000-rollback.sql
    - supabase/tests/test_compute_job_attempt_failures.sql
    - supabase/schema/functions/record_compute_job_attempt_error.sql
  modified:
    - supabase/schema/functions/mark_compute_job_failed.sql

key-decisions:
  - "DEC-01-A to DEC-01-F as recorded in the plan and the migration header (four-value cause vocabulary, write at the failure source, identity (job_id, claim_token, cause_class), no FK to compute_jobs with owner cascades, Phase 230 columns copied from the job, RLS on with no policy and SELECT-only grant)"
  - "The late-55006 path files the real error under the attempt and worker of the existing reset row, never the job row's (the job may already be re-claimed)"
  - "Gate arm order E1, E2, E4, E3, E3b, E5, E6, E7, E8: E4 before E3 because its twin (accept any token on a running job) would otherwise redden E3's re-claimed job first"

patterns-established:
  - "Twin for a NULL-handling arm wraps rather than replaces (COALESCE(p_error, ...)), so earlier arms with a non-NULL input still pass and the arm under test is the first failure"

requirements-completed: []

coverage:
  - id: D1
    description: "A failed attempt's cause (attempt, cause_class error, error_kind, error text, claim token) stays readable after attempt 2 is claimed and ends done, while the M-1137 last_error clear still holds"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql (arm E1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A worker-lost real error (55P03, late 55006) is recordable; forged or unknown tokens record nothing"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "same gate, arms E2, E3, E3b, E4"
        status: pass
    human_judgment: false
  - id: D3
    description: "Edges: NULL error stays NULL, cascaded fan-in children record nothing, records survive job-row deletion and read in a stable order, anon/authenticated hold nothing and service_role cannot INSERT"
    requirement: "MT5D-01"
    verification:
      - kind: integration
        ref: "same gate, arms E5, E6, E7, E8"
        status: pass
    human_judgment: false

duration: 95min
completed: 2026-11-23
status: complete
---

# Phase 227 Plan 01: JOBLEDGER attempt-failure ledger Summary

**Append-only `public.compute_job_attempt_failures` written by `mark_compute_job_failed` in the failing transaction, plus a token-attested `record_compute_job_attempt_error` RPC for the 55P03 and late-55006 paths; a failed attempt now keeps its cause after the M-1137 re-claim clear.**

## Performance

- **Duration:** about 95 min
- **Tasks:** 3 of 3
- **Files:** 4 created, 1 modified (plus 1 regenerated snapshot)

## Accomplishments

- Table, RLS (on, no policy, no FORCE), grants (REVOKE ALL then SELECT for service_role), column and table comments stating append-only, read order (attempt, recorded_at, id), owner cascade, retention and sanitize position.
- `mark_compute_job_failed` re-based byte for byte on 20261024120000 with ONE added `INSERT ... ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING` immediately after the status UPDATE. The fan-in cascade children record nothing (arm E6).
- `record_compute_job_attempt_error`: attested by the running job row (copies job columns) or by an existing watchdog_reset / stall_reclaim row of the same job (copies that row's attempt and worker_id).
- STEP 5 self-verify reads catalogues only (the data-dependence linter reports 0 NEW refusals) and carries the 20260927120000 item (6) pin forward: the 5-arg claim still matches `last_error\s*=\s*NULL` and `error_kind\s*=\s*NULL`.
- Rollback restores the 20261024120000 body byte for byte (see lane proof below), sets the table and its six constraints aside, drops the RPC.
- VAC-04: one `prod-body-ack` for `mark_compute_job_failed`. Hash is the `live` column of `--diff-bodies <new snapshot> <pre-change snapshot>`. Confirmed that `origin/main`'s snapshot of the function equals the plan's base snapshot (`git diff 0bb1b4293909 origin/main -- supabase/schema/functions/mark_compute_job_failed.sql` is empty), so the base stands in for origin/main as the header says. It is EARNED only if VAC-04 on the PR reports the same hash for PROD; VAC-08 is RED on the PR by construction until apply-on-merge.

## Task Commits

1. **Task 1 (tracer): ledger table, mark write, arm E1** - `c7d8bbcd3`
2. **Task 2: worker-lost RPC, arms E2, E4, E3, E3b, E5, E6** - `d5ceb41cc`
3. **Task 3: STEP 5 self-verify, arms E7 and E8, VAC-04 ack, rollback** - `6a839ae76`
4. **Header correction (gate SETUP LIST paragraph)** - `3132a29b2`

Measured from the ledger: `git rev-list --count 0bb1b4293909e4a12315e5039528ba704695348c..HEAD` = 4 at `3132a29b260b441836f08da0652ad22a52750c6d` (before this SUMMARY's own commit).

## PROOF-01 transcript (verbatim)

Commands run from the worktree root. Backup first, neuter, run, restore by `cp`, `cmp`, re-run.

```
cp supabase/migrations/20261124120000_jobledger_attempt_failures.sql <scratch>/mig.backup
cmp -s <that migration> <scratch>/mig.backup        -> backup ok
```

**(a) Neuter edit.** In `mark_compute_job_failed`'s MT5D-01 INSERT, `WHERE cj.id = p_job_id` (the one immediately before `ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;` in the mark function) was replaced by `WHERE FALSE`, so the INSERT is present and writes nothing.

```
node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql
  baseline  supabase/tests/test_compute_job_attempt_failures.sql — exit 3 (5.4s)
  baseline  - supabase/tests/test_compute_job_attempt_failures.sql
      pristine corpus did not go GREEN (exit 3); first failure: E1
exit=1
```

First `TEST FAILED (E1)` line from the pg-lane directly on the neutered tree:

```
psql:supabase/tests/test_compute_job_attempt_failures.sql:172: ERROR:  P0001: TEST FAILED (E1): after attempt 1 failed through mark_compute_job_failed and attempt 2 was claimed and ended done, the ledger held 0 row(s) after the failure, 0 after the re-claim and 0 after done, the first row reading NULL (expected exactly one row, unchanged throughout: attempt 1, cause_class error, error_kind transient, error_text 'E1 attempt one failed', claim_token <uuid>); the job row reads status running, attempts 2, last_error NULL, error_kind NULL after the re-claim (expected running, 2, NULL, NULL because the M-1137 clear stays). ...
```

**Restore and GREEN.**

```
cp <scratch>/mig.backup supabase/migrations/20261124120000_jobledger_attempt_failures.sql
cmp -s <scratch>/mig.backup <that migration>        -> cmp exit=0
node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql
  baseline ... exit 0 (3.4s)
  arms: 9/9/0   biting: 9   No defects in the narrowed scope.
exit=2
```

**(b) Literal deletion of the INSERT (extra evidence, see Deviations).** With the INSERT statement deleted outright the apply refuses at STEP 5 and the gate never runs:

```
ERROR:  P0001: jobledger: mark_compute_job_failed must write the compute_job_attempt_failures record after the UPDATE that sets last_error, in the same transaction, otherwise a failed attempt keeps no cause
cmp2 exit=0   (backup restored, byte-equal)
```

Final per-arm run (final tree, after the header correction): every arm `RED (identity ok)` for E1, E2, E4, E3, E3b, E5, E6, E7, E8; `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`, exit 2.

## Task 2 RED evidence (after the fact)

Task 2 is `tdd="true"` and asks to see each test RED against the Task 1 tree. Arms E2 to E6 were written together with STEP 4 and committed as one commit, so no test-first commit exists, and history was not rewritten to fake one. After-the-fact evidence: the Task 2 gate (`d5ceb41cc`) run on the pg-lane against the Task 1 migration (`c7d8bbcd3`) fails at once:

```
ERROR:  P0001: TEST FAILED (E2-SETUP): record_compute_job_attempt_error raised SQLSTATE 42883 (message: function public.record_compute_job_attempt_error(uuid, uuid, unknown, unknown) does not exist) on a running job with its own token, so the worker-lost path cannot be exercised.
```

The same gate on the Task 2 tree is green with 7 of 7 twins biting.

## Rollback lane proof

Lane run A: setup list without the new migration, `md5(prosrc)` of both `mark_compute_job_failed` rows in `pg_proc`: `14c0271f44d5864a0156da8822b87f12`, `3f4d4f1547563e3a6c6693964a98c736`. Lane run B: setup list with the migration, then `down/20261124120000-rollback.sql`: the same two md5 values, table renamed to `compute_job_attempt_failures_rolled_back_20261124`, six constraints renamed `*_rb_20261124`, ACL and function comment intact.

## Verification run

| Command | Result |
|---|---|
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql` | exit 2, 9/9/0, biting 9 |
| `node scripts/lint-migration-data-dependence.mjs` | 83 refusals, 83 allowlisted, 0 NEW |
| `node scripts/lint-sql-gates.mjs --self-test` and corpus | 7 rules OK; 113 files, 0 findings |
| `npm run schema:functions` | diff only in the two snapshots this plan owns |
| vitest: audit-coverage, claim-failed-retry-dedupe-migrations, compute-jobs-audit-g10b, compute-jobs-audit-residual, retention-orphaned-running-terminalize, drift-check-scripts, gate-family-meta | pass (5 files passed, 2 skipped files / 65 skipped tests are pre-existing skips in that set) |
| vitest: mutation-runner-floors | 3 RED, all census pins owned by plan 10, see below |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Gate setup list is not the pure union**
- **Found during:** Task 1 (first lane run of arm E1)
- **Issue:** adding the fan-in list's `20260515114555_compute_jobs_claim_token_fencing.sql` beside the claim pair leaves a 3-arg `claim_compute_jobs_with_priority` next to the 5-arg one, so the 3-positional-argument claim call raises 42725.
- **Fix:** excluded that migration; fixture 36 supplies `compute_jobs.claim_token` (as the claim pair's own gate does), placed right after fixture 37; fixture 29 and `20260927120000` follow `20260924230827`. Full list is the single-line `RED-UNDER-SETUP` of the gate; the gate header paragraph now says so (it said the opposite until `3132a29b2`).
- **Files modified:** supabase/tests/test_compute_job_attempt_failures.sql
- **Commit:** c7d8bbcd3, 3132a29b2

**2. [Rule 3 - Blocking] E7 landed in the Task 3 commit, not Task 2**
- **Issue:** the E7 twin needs STEP 5's `IF NOT v_no_fk_ok THEN` to stand down (the FK would abort the apply otherwise), and STEP 5 is Task 3. Task 2's "lists E1 to E7" criterion is therefore met at Task 3, not Task 2.
- **Commit:** 6a839ae76

**3. [Rule 1 - Bug] E3 split into E3 and E3b; arm order E4 before E3; E5/E6 twins reshaped**
- E3b is a separate arm id so its twin (copy attempt and worker from the job row) can be annotated (arm ids are unique per file). E4 runs before E3 because E4's twin would otherwise redden E3's re-claimed running job first. The E5 twin wraps `COALESCE(p_error, ...)` rather than a bare literal, which would have reddened E1 first. The E6 twin widens the INSERT's WHERE to the cascaded child.

**4. [Rule 3 - Blocking] PROOF-01 neuter is `WHERE FALSE`, not deletion**
- Deleting the INSERT outright aborts the apply at STEP 5 (the migration's own guard, transcript (b) above), so the gate would never execute. Both transcripts are recorded.

**5. Reporting-only differences**
- The plan's "5-arg" claim overload is `claim_compute_jobs_with_priority(integer, text, boolean, text[], text[])`; STEP 5 and arms use that signature (the gate calls it with 3 positional arguments).
- The file-delete check after each commit printed nothing (no deletions).
- The plan's `has_function_privilege('public', ...)` form replaces `_assert_no_public_execute` in STEP 5 so the self-verify does not depend on a helper the lane may lack; it works on the lane.

## Local-stack lane substitution

Docker is not available on this host. `scripts/local-stack/run.sh up` was not run. All gate runs used the throwaway PostgreSQL lane (`scripts/pg-lane/run.sh`, via `node scripts/mutation-runner/run.mjs --file <gate>`). E8 proves privileges with `SET LOCAL ROLE anon/authenticated/service_role` on the lane, not with a JWT. The local-stack proof (sql-tests lane, the live-DB analytics tests `analytics-service/tests/test_compute_jobs_fencing.py` and the three src/__tests__ files that name `mark_compute_job_failed`) is left to CI, plan 10 owns it.

## Left for plan 10 (census pins, deliberately not edited)

`src/__tests__/mutation-runner-floors.test.ts` is red in exactly three tests, all the census this gate moved: `totalAnchored` (910, asserted at line 766, now 919), `FILES_FLOOR` (85, now 86), `ARMS_FLOOR` (910, now 919). `scripts/mutation-floors.mjs`, `scripts/dump-sql-functions.ts`, `scripts/baseline-content-drift-check.mjs`, `.github/workflows/ci.yml` and every other census pin are untouched.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: lock-surface | supabase/migrations/20261124120000_jobledger_attempt_failures.sql | The new INSERT in `mark_compute_job_failed` takes FK key-share locks on `strategies` and `api_keys` while the job row is already held `FOR UPDATE`. The plan dictated the FKs (owner cascade); for the reviewer to weigh against the fan-in lock order, not redesigned here. |

Threat register: T-227-01 (arm E8 plus STEP 5), T-227-02 (arm E4), T-227-03 (same-transaction write, UNIQUE), T-227-04 (owner cascades, no FK to compute_jobs; retention and GDPR canon routed to /gsd-secure-phase) are mitigated as planned.

## Notes for the orchestrator

- MT5D-01 is only partly delivered by this plan (the `error` cause). Plans 02 (watchdog_reset, stall_reclaim), 07 (orphan_reaped) and 08 (worker wiring) deliver the rest, so the requirement was NOT marked complete and STATE.md and ROADMAP.md were not touched.
- The `.planning/phases/` SUMMARY and these code files are the only things this branch changes.

## Self-Check: PASSED

Files found: migration, rollback, gate, both function snapshots. Commits `c7d8bbcd3`, `d5ceb41cc`, `6a839ae76`, `3132a29b2` are ancestors of HEAD.
