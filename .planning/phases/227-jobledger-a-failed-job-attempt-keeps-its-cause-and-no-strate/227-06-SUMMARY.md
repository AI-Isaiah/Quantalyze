---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 06
subsystem: database
tags: [postgres, security-definer, daily-poll, cohort, strategy-sync-cursors, mutation-runner]

requires:
  - phase: 164.5.1.4
    provides: strategy_sync_cursors, the per-strategy cursor the cron sync advances
provides:
  - re-based SECURITY DEFINER public.enqueue_poll_positions_for_all_strategies() RETURNS integer with the widened cohort (private strategies, live key, job OR cursor)
  - SQL gate test_enqueue_poll_positions_cohort.sql (P1 to P7, 11 twinned identities)
  - rollback restoring the 20260412094449 body
affects: [227-10 (census pins and the per-file arm table), 227-11 (validation map)]

actuals:
  tokens: 21000
  tasks: 3
  commits: 2
plan_head_before: 4ff1d5bcdd08b9d70ec6526d96778b0e79c45039
plan_head_after: 3dd50879f35ff10d9a0cd2949291cad0e73a3eb9

tech-stack:
  added: []
  patterns:
    - "twin layered with a neuter of the migration's own self-verify clause, so the apply does not abort before the gate runs"
    - "cohort read from either sync path (compute-job OR per-strategy cursor) instead of replacing one with the other"

key-files:
  created:
    - supabase/migrations/20261124120500_poll_positions_cohort.sql
    - supabase/migrations/down/20261124120500-rollback.sql
    - supabase/tests/test_enqueue_poll_positions_cohort.sql
  modified:
    - supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql

key-decisions:
  - "DEC-06-A both conjuncts decided together: status IN (published, pending_review, private); key health = done sync_trades job OR strategy_sync_cursors.last_sync_at inside 30 days (add-alongside, accepted debt until every sync path writes the cursor)"
  - "DEC-06-B key liveness: the cohort now requires an active and connected key, a tightening of today's cohort"
  - "The migration restates REVOKE ALL FROM PUBLIC, anon, authenticated (a no-op on PROD and TEST, where 20260412094449 issued it) so a database with no earlier definition does not leave the fan-out callable by a browser role, and so arm P7 is falsifiable on the lane"

requirements-completed: [HEAL-05]

duration: 45min
completed: 2026-11-23
status: complete
---

# Phase 227 Plan 06: Daily positions poll cohort Summary

**The daily `poll_positions` enqueue now covers private strategies kept current by the cron sync (a `strategy_sync_cursors` row advanced in the last 30 days, alongside the old done-`sync_trades`-job signal), and it stops reading any key that is deactivated or disconnected; the per-strategy enqueue, its idempotency key, its metadata and the worker's argument-less call are unchanged.**

## OPEN ITEM, STATED LOUDLY: the fresh PROD measurement (Task 3, first half) was NOT taken

The Supabase MCP tool `mcp__claude_ai_Supabase__execute_sql` was not available to this executor (it is not in the tool list, and the tool-search tool that would load it does not exist here). The orchestrator's brief says to leave the measurement for it in that case, and I did not use the CLI fallback. **No PROD count is recorded below and none is invented.** The marker query result, the six counts by status and the "does the widening add any private strategy on today's data" reading are all still owed. If the new-cohort column for `private` reads 0, that is a FINDING (the widening would be inert on today's data, and the cursor writes need checking), not a success.

Ready-to-run queries (SELECT only, one per call, marker first; record counts only, no ids):

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

```sql
WITH k AS (
  SELECT s.id, s.status, ak.is_active, ak.disconnected_at,
         EXISTS (SELECT 1 FROM compute_jobs cj
                  WHERE cj.strategy_id = s.id AND cj.kind = 'sync_trades'
                    AND cj.status = 'done' AND cj.updated_at > now() - interval '30 days') AS has_job,
         EXISTS (SELECT 1 FROM strategy_sync_cursors c
                  WHERE c.strategy_id = s.id
                    AND c.last_sync_at > now() - interval '30 days') AS has_cursor
    FROM strategies s JOIN api_keys ak ON ak.id = s.api_key_id
   WHERE s.api_key_id IS NOT NULL)
SELECT status,
       count(*)                                                                         AS with_key,
       count(*) FILTER (WHERE is_active AND disconnected_at IS NULL)                    AS key_live,
       count(*) FILTER (WHERE has_cursor)                                               AS cursor_30d,
       count(*) FILTER (WHERE has_job)                                                  AS job_30d,
       count(*) FILTER (WHERE status IN ('published','pending_review') AND has_job)     AS today_cohort,
       count(*) FILTER (WHERE status IN ('published','pending_review','private')
                          AND is_active AND disconnected_at IS NULL
                          AND (has_job OR has_cursor))                                  AS new_cohort,
       count(*) FILTER (WHERE status IN ('published','pending_review') AND has_job
                          AND NOT COALESCE(is_active AND disconnected_at IS NULL, false)) AS dropped_by_liveness
  FROM k GROUP BY status ORDER BY status;
```

(`new_cohort` matches the migration's `ak.is_active` filter, which treats a NULL flag as not live; `dropped_by_liveness` is the "keys today's cohort admits and the new one drops" count.)

## Performance

- **Duration:** about 45 min
- **Tasks:** 3 of 3 attempted; Task 3's PROD half deferred (above), its pytest half done
- **Files:** 3 created, 1 modified (the regenerated snapshot)

## Accomplishments

- Re-based `enqueue_poll_positions_for_all_strategies()` from its only definition (20260412094449; no later migration redefines it, measured by grep). Only the loop's WHERE changed: status list gains `private`, `ak.is_active` and `ak.disconnected_at IS NULL` added, and the done-job EXISTS became one side of an OR whose other side reads `strategy_sync_cursors`. Everything else is the old body byte for byte: the rollback's function text hashes to the same normalized value as the pre-change snapshot (`afed2d96...`), which is also the `prod-body-ack`.
- Catalogue-only self-verify block (SECURITY DEFINER, pinned `search_path`, `integer` return, comment-stripped body contains `'private'`, `strategy_sync_cursors`, `disconnected_at IS NULL`, `ak.is_active`, `interval '30 days'` exactly twice, `'poll_positions'`, `'daily-poll-'`, does not contain `'draft'`; no EXECUTE for PUBLIC, anon, authenticated). It reads no row.
- Gate `test_enqueue_poll_positions_cohort.sql`: P1 (private cron-synced strategy gets exactly one job with the daily idempotency key), P2 (published + done job 3 days old + no cursor still polled), P3 and P3/active (disconnected and deactivated key never polled), P4 and P4/archived (draft and archived not polled), P5 and P5/job (40-day-old cursor, 40-day-old job: not polled), P6 (second call the same day returns 0, one job), P7/body (kind, `daily-poll-` prefix, `enqueued_by daily_loop` still in the body) and P7 (anon, authenticated, PUBLIC hold no EXECUTE). Assertions are scoped to this file's own strategy ids (return values are asserted as lower bounds, except P6's second-call 0).
- Rollback `down/20261124120500-rollback.sql`: marker query first, catalogue-only pre and post conditions, restores the 20260412094449 body and comment. Run on the pg-lane after the migration: post-condition passed (`rollback gate OK`).

## Task Commits

1. **Task 1 (tracer): cohort re-base and arm P1** - `40c709fb9` (feat)
2. **Task 2: arms P2 to P7, twins, rollback** - `3dd50879f` (test)
3. **Task 3: PROD measurement and worker regression** - no code; worker pytest run recorded below, PROD measurement deferred

## Verification evidence

Environment substitution, recorded verbatim: Docker is not available on this host, so no local-stack run was possible. Every SQL gate run below is on the throwaway PostgreSQL pg-lane (`scripts/pg-lane/run.sh`, driven by `node scripts/mutation-runner/run.mjs --file ...` and, for PROOF-01 and the rollback, by `scripts/pg-lane/run.sh` directly with the gate's own apply list). The local-stack proof is left to CI (plan 10).

Diagnostic run (`node scripts/mutation-runner/run.mjs --file supabase/tests/test_enqueue_poll_positions_cohort.sql`, exit 2 = no defects in the narrowed scope):

```
  baseline  supabase/tests/test_enqueue_poll_positions_cohort.sql — exit 0
  arm P1 / P2 / P3 / P3/active / P4 / P4/archived / P5 / P5/job / P6 / P7/body / P7   each: exit 3  RED (identity ok)
arms: 11/11/0   (executed/annotated/waived)
biting: 11
lane-invocations: 11
No defects in the narrowed scope.
```

PROOF-01, run directly (not through the runner's copies): `cp` backup of the migration, then `'private'` removed from the status list in the working copy (and the matching self-verify clause neutered, exactly as the P1 twin does, so the apply reaches the gate):

```
=== NEUTERED RUN ===
psql:supabase/tests/test_enqueue_poll_positions_cohort.sql:285: ERROR:  P0001: TEST FAILED (P1): the daily enqueue returned 0 and left 0 poll_positions job(s) for a private strategy with an active, connected key and a cron cursor advanced 2 days ago, expected a count of at least 1 and exactly 1 job. Private strategies never get position snapshots.
cp back; cmp -s backup working-copy: exit 0
=== RESTORED RUN ===
NOTICE: ALL 7 ARMS EXECUTED (P1, P2, P3, P4, P5, P6, P7): a private cron-synced strategy is polled (P1), ...
node scripts/mutation-runner/run.mjs --file ... : exit 2
```

Linters: `node scripts/lint-migration-data-dependence.mjs` OK (83 allowlisted, 0 NEW); `node scripts/lint-sql-gates.mjs` 0 findings (it flagged an R2 comment-strip idiom in an earlier draft of the gate; fixed by using `regexp_replace(pg_get_functiondef(...), '--[^\n]*', '', 'g')`); `lint-sql-gates --self-test` OK (7 rules); `lint-app-guc` 0 findings.

Worker regression (F-8 liveness half): `cd analytics-service && .venv/bin/python -m pytest tests/test_daily_enqueue_lock.py tests/test_main_worker.py -k "daily" -q` printed `14 passed, 67 deselected`. `main_worker.py` still calls `enqueue_poll_positions_for_all_strategies` with `{}` (line 1214) and `tests/test_main_worker.py` and `tests/test_daily_enqueue_lock.py` pin that call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] The migration restates the REVOKE**
- **Found during:** Task 1 (lane setup)
- **Issue:** the plan says "CREATE OR REPLACE keeps the existing ACL; do not re-grant". On PROD and TEST that holds. On the pg-lane no earlier definition exists (no gate applies 20260412094449), so the function is new there and Supabase's default privileges (fixture 07) grant EXECUTE to anon and authenticated; arm P7 and the self-verify's ACL clause could not be true, and a database without the older migration would leave the daily fan-out callable by a browser role (T-227-20).
- **Fix:** added `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` (a no-op on PROD and TEST). Nothing is granted. P7's twin removes `authenticated` from it.
- **Files modified:** supabase/migrations/20261124120500_poll_positions_cohort.sql
- **Commit:** 40c709fb9

**2. [Plan wording] Arms split into 11 identities, sentinel left at "ALL 7 ARMS EXECUTED"**
- The plan names P1 to P7 with P3a/P3b-style twins allowed. I used `P3` + `P3/active`, `P4` + `P4/archived`, `P5` + `P5/job`, `P7` + `P7/body`, each with its own twin and `TEST FAILED (...)` literal (12 `TEST FAILED (P` occurrences). The sentinel counts the seven numbered arms.

### Deferred

- **Task 3 PROD measurement** (see the OPEN ITEM section). Owed by the orchestrator.

## Decisions Made

DEC-06-A to DEC-06-D as in the plan and the migration header. In addition: asserting return values as lower bounds (`>= 1`) in P1 so the arm stays about this file's own rows on a database other people share; P6's second-call `0` is robust because the first call enqueues every eligible strategy.

## Issues Encountered

- `npm run schema:functions:check` is red at the phase-branch head with three `snapshot-only` rows (`record_compute_job_attempt_error`, `record_reconcile_readmit_exhaustions`, `renew_compute_job_claims`), all from sibling plans' functions, none from this plan's. This is the NAME_SET_RATCHET row plan 10 owns (plan 04's summary names it); I did not touch it.

## Census pins this plan moves (NOT edited; plan 10 owns them)

This plan adds 1 annotated gate file, **11 twins** (ARMS_FLOOR delta +11 in `mutation-runner-floors.test.ts` and the twin counts in `mutation-annotation-parser.test.ts`), **18 needle steps** (the needle-count delta in the parser test: P1 2, P2 1, P3 2, P3/active 2, P4 2, P4/archived 1, P5 2, P5/job 2, P6 1, P7/body 1, P7 2), 1 sentinel file for `contracts/ci-anti-skip-gate.contract.test.ts` (its per-file arm table needs this file's `ALL 7 ARMS EXECUTED`), and the runner's `coverage: files` count +1. The migration count also moves one migration-census test. Sibling plans add their own deltas to the same counts.

## Threat Flags

None beyond the plan's register. T-227-18 (revoked key: P3, P3/active), T-227-19 (fan-out size: the cursor admits only okx, binance, bybit per DEC-06-C; the size measurement is part of the owed PROD query; idempotency per day: P6), T-227-20 (re-based SECDEF: ACL restated, P7 and the self-verify assert no EXECUTE for PUBLIC, anon, authenticated).

## Known Stubs

None.

## Self-Check: PASSED for the code deliverables (Task 3 PROD half open, see below)

- FOUND: supabase/migrations/20261124120500_poll_positions_cohort.sql, supabase/migrations/down/20261124120500-rollback.sql, supabase/tests/test_enqueue_poll_positions_cohort.sql, supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql
- FOUND commits: 40c709fb9, 3dd50879f (ancestors of HEAD)
- Acceptance re-run: `grep -c "strategy_sync_cursors"` in the snapshot = 1, `grep -c "'private'"` in the snapshot = 1, `grep -c "TEST FAILED (P"` in the gate = 12, `grep -c "prod-body-ack:"` in the migration = 1, rollback present.
- NOT satisfied: the Task 3 acceptance criteria that need the PROD marker result, the six counts and the private-added reading (deferred, loudly, above).
