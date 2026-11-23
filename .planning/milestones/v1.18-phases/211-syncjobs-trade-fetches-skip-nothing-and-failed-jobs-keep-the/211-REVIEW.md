---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
reviewed: 2026-11-14T00:00:00Z
iteration: 2
depth: standard
files_reviewed: 9
files_reviewed_list:
  - analytics-service/routers/cron.py
  - analytics-service/routers/exchange.py
  - analytics-service/services/ingestion/long_fetch.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - src/lib/ledger-refresh-marker.ts
  - supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql
  - supabase/migrations/down/20261114120000-rollback.sql
  - supabase/tests/test_enqueue_dedup_record_retract.sql
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
status: issues_found
---

# Phase 211: Code Review Report, iteration 2

**Reviewed:** 2026-11-14
**Depth:** standard
**Files Reviewed:** 9. In iteration 2 only the fix commits `3f52ceb60` (WR-01) and `f107b2006` (WR-02) were re-read in full, together with the function snapshots under `supabase/schema/functions/` that the new lock argument cites. The Python and TS files have not changed since round 1.
**Status:** issues_found. Info only; no Warning or Critical findings remain.

## Summary

**WR-01 is resolved.** The helper now reads `status` with a plain SELECT and returns before the retraction and the INSERT when the row is `done_pending_children`. I checked the claims against the snapshots:
- `_fan_in_lock_rows(v_kids, TRUE)` locks only the ids it is given. Both callers build `v_kids` with `WHERE c.status = 'done_pending_children'` (`mark_compute_job_done.sql:108`, `mark_compute_job_failed.sql:188,195`). The ancestor walk takes no locks.
- **The "status is set only at insert" claim holds.** No `SET status` in `supabase/schema/functions/` assigns `done_pending_children`. The only writes are `v_initial_status` in both overloads of `_enqueue_compute_job_internal` (`:59`, `:257`). Every UPDATE moves a row out of that status (to `pending`, `failed_final` or `running`), never into it. `analytics-service/` and `src/` have no non-test writer of the value. So a row that the helper reads as some other status cannot later be put into `done_pending_children`. In the normal flow, a child stays `done_pending_children` until a parent holding `FOR UPDATE` on it commits the release, so a lock pass never lands on a row that had already left the status when the helper read it.
- The parented enqueue (`_fan_in_lock_rows(p_parent_job_ids, FALSE)`) is still skipped by D11-10.
- The DPC-SKIP arm pins the effect: no event row, and metadata unchanged. Its RED-UNDER twin edits exactly the guard. The arm comment says plainly that a single-session gate cannot prove a lock wait is absent.

**WR-02 is resolved.** The `RAISE WARNING` fires only on `outcome = 'retracted'`. Its format string is a single literal, and it aborts nothing.

The fixes introduce nothing at Warning or above. One residual in the new header text is inaccurate (IN-06).

## Info

### IN-06 (new): The header's "one lock the helper CAN still wait on" leaves out mark_compute_job_done's own UPDATE
**File:** `supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql:66-69`
**Issue:** The header says the only lock the helper can wait on is the `FOR UPDATE` that `mark_compute_job_failed` and `defer_compute_job` take on their own `running` row. The header only considers the FK's `FOR KEY SHARE`. But the helper also runs `retract_ledger_refresh_marker`, whose UPDATE matches `status <> 'done'` (`retract_ledger_refresh_marker.sql:23-28`), so it includes `running` rows. That UPDATE takes `FOR NO KEY UPDATE`, which conflicts with the `FOR NO KEY UPDATE` from `mark_compute_job_done`'s `UPDATE ... SET status = 'done'` on the same running row (`mark_compute_job_done.sql:39-43`). `mark_compute_job_done` keeps that lock while it locks the fan-in rows, takes the bridge advisory lock and runs `sync_strategy_analytics_status`. It is still a plain wait, for two reasons:
- The retraction runs only for correlation-id callers, which are single-statement user RPCs, never a SQL fan-out (D11-5).
- Before the helper, the enqueue holds nothing that `mark_compute_job_done` needs.

Once `mark_compute_job_done` commits, the retraction re-checks the row, sees `done`, and reports `outcome: done`. Behaviour is correct, but the stated residual list is incomplete. A future caller that wraps a correlation-id enqueue inside a larger transaction would be reasoning from a wrong list.
**Fix:** Add `mark_compute_job_done`'s status UPDATE (`FOR NO KEY UPDATE`, which conflicts with the retraction's UPDATE) to the residual paragraph. State the precondition that keeps it a plain wait: the retraction fires only for single-statement correlation-id callers.

### IN-01 (round 1, OPEN, not fixed): A retraction failure can still abort the user's enqueue
**File:** `supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql:288` (retraction call), `:297` (INSERT)
**Issue:** D11-11 makes only the *record* non-failing. The retraction writes the caller's `correlation_id` into the job row, and `compute_jobs_metadata_size_bounded` bounds that row. The INSERT's FK can also raise `23503` if retention deletes the job between the look-up and the INSERT. Neither is realistic today.
**Fix:** Bound `octet_length(p_metadata ->> 'correlation_id')` before retracting, or accept the risk and say so in the header.

### IN-02 (round 1, OPEN, not fixed): `GRANT EXECUTE ... TO service_role` on `_record_enqueue_dedup` is unnecessary
**File:** `supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql:716-717`, plus the matching verify assertion
**Issue:** The SECURITY DEFINER caller runs as the owner, so `service_role` does not need the grant. With it, a direct PostgREST `service_role` caller can write to the side table and retract markers. That contradicts the table comment's "a direct service_role writer fails loud with 42501" and the function COMMENT's "no caller outside the enqueue function".
**Fix:** Revoke it from `service_role` and flip the verify assertion.

### IN-03 (round 1, OPEN, not fixed): The rollback uses a session-level `SET lock_timeout`
**File:** `supabase/migrations/down/20261114120000-rollback.sql:48`
**Issue:** `SET` stays in effect for the session after `COMMIT`. In a manual dashboard run it leaks into later statements.
**Fix:** `SET LOCAL lock_timeout = '3s';`

### IN-04 (round 1, OPEN, not fixed): The route runs the high-water read on the event loop
**File:** `analytics-service/routers/exchange.py:1776`
**Issue:** `load_strategy_high_waters` is synchronous and runs directly in the async route. This matches the route's existing synchronous reads, so it is not a regression.
**Fix:** Optional: `await db_execute(lambda: load_strategy_high_waters(...))`.

### IN-05 (round 1, OPEN, not fixed): A malformed fills cursor now falls back to the daily high-water instead of a full reach
**File:** `analytics-service/services/job_worker.py:2181-2185`
**Issue:** When `X` is unparseable, `parse_since_ms(None, preferred=X)` returns `None`, and the code then falls back to the narrower `daily_since_ms`. The case is rare, and it is logged.
**Fix:** None needed. Recorded against TODOS `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD`.

## Round 1 findings, resolution record

| ID | Severity | Status | Fix commit |
|---|---|---|---|
| WR-01 | Warning | FIXED, verified | `3f52ceb60` |
| WR-02 | Warning | FIXED, verified | `f107b2006` |
| IN-01..IN-05 | Info | OPEN by policy (no fixer for Info) | - |

---

_Reviewed: 2026-11-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Limits: The iteration-2 context ran out after the SQL verification. `defer_compute_job.sql` and the claim functions' SKIP LOCKED clauses were taken from the header and not re-read line by line. The census and test-pin edits in `3f52ceb60` (`mutation-floors.mjs` ARMS_FLOOR 845 to 846, and the three vitest pins) were not re-read._

## Migration and RLS gates (after iteration 2)

- **migration-reviewer, pass 1:** found one CRITICAL. Version `20261114120000` collided with Phase 210's migration of the same timestamp on origin/main (#1268, merged after this branch was cut), and the `down/` rollback collided too. Fixed by commit `6f3f979bc`, which renumbers both files to `20261114130000` and every reference with them; the snapshots were regenerated. After the rename the mutation runner on the gate reads 16/16 biting.
- **migration-reviewer, pass 2:** clean, with 0 findings at any severity.
- **rls-policy-auditor:** 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW. The LOW is that the `GRANT EXECUTE` to service_role on `_record_enqueue_dedup` is unnecessary and lets service_role forge a dedup-event row. It has no cross-tenant scope. It is the same finding as IN-02, recorded and not fixed, per the LOW/INFO policy.
- **silent-failure-hunter re-review of the fix round:** no MEDIUM+ findings, and M-1 is closed. Its one LOW: the helper ignores the `done` and `no_row` outcomes of the retraction; the Python and TypeScript backstops still run. Recorded only.
