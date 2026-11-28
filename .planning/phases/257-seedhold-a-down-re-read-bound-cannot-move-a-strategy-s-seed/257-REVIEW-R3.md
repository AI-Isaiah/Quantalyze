---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
reviewed: 2026-11-28T11:42:24Z
round: 3
reviewed_at_sha: 873020d6bf003d7d77584c6d0850d92d72a103ab
depth: deep
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/test_okxtrades_cursor.py
  - analytics-service/tests/test_seedhold_bound.py
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
  necessity: 0
status: clean
---

# Phase 257: Code Review Report, round 3 (WR-R2-01 fix)

**Reviewed:** 2026-11-28T11:42:24Z
**Depth:** deep. I read the fix hunks of `235634140` and traced them into the dispatcher
(`main_worker.py`), `mark_compute_job_failed`, the claim RPC, `sync_strategy_analytics_status` and
the user and admin read paths.
**Files Reviewed:** 4
**Status:** clean. There is no MEDIUM or higher finding. Three Info items are recorded here and nowhere else.

**Severity mapping (as in rounds 1 and 2):** `CR-` is HIGH or CRITICAL, `WR-` is MEDIUM, and `IN-` is LOW or INFO.

## Summary

**WR-R2-01 is closed.**

### The early return is side-effect free, and the `finally` closes the exchange

- The `return DispatchResult(FAILED, "transient")` at `job_worker.py:2561-2579` sits inside the
  handler's `try:` (`:2351`). Its `finally:` (`:2917-2921`) awaits `aclose_exchange`, so the exchange
  closes on this path.
- Every statement between the start of the `try` and the return is a read:
  - `load_strategy_high_waters`;
  - `fetch_all_trades`;
  - the daily DQ drain (`:2422`, into a local, so nothing leaks into the next task's buffer);
  - the stored-fill high-water read;
  - the bound read;
  - the hold read.
- The Phase-1 daily store comes after this point (`"sync_trades"` RPC at `:2773`), and so do the
  provisional bound write, the seed-hold RPC, `advance_sync_cursor` and the flag stamp.
- `_LAST_UNIT_SWITCH_READ` is reset when `fetch_daily_pnl` starts (`exchange.py:2081`), so skipping
  its drain leaks nothing either.

### A malformed mark still takes the reach floor

- `load_strategy_seed_hold` returns `(None, err, True)` only for a value that is present but invalid
  (`trade_resume.py:251-256`). For a read exception it returns `False` in that slot (`:258-264`).
- The caller fails the attempt only on `err and not malformed` (`job_worker.py:2561`). A malformed
  mark falls through to `_hold_read_failed` and `_hold_terms.append(_reach_anchor_ms)` (`:2602`).
- `load_strategy_seed_hold` has no other caller: a repo-wide grep finds only `job_worker.py`.

### The test helper's `expect_outcome` default preserves every existing caller

- `_run_job(..., expect_outcome=DispatchOutcome.DONE)` (`test_okxtrades_cursor.py:270`) keeps the old
  assertion for every existing caller. The failure message now names the error.
- `_run` forwards it through `**job_kwargs`.
- The re-pointed neuter records H5 and H8 name expressions that exist at HEAD (`:2602`, `:2561`).

### Gates re-run at `873020d6b`

- The eight bound- and hold-touching test files (the round-2 set): `457 passed, 1 skipped, 2 xfailed`.
  The two xfails are the `RESIDUAL_DOUBLE_FAULT` arms.
- `mypy --strict` on both service files: `Success`.

### Side effects of the transient return, as you asked

- **Retry and backoff.** `mark_compute_job_failed` sets `failed_retry` and backs off 30 s, then 2 min,
  then 10 min, 1 h and 6 h (`mark_compute_job_failed.sql:89-96`). `max_attempts` defaults to 3
  (`baseline.sql:2079`).
  - If cron enqueues a new pending row meanwhile, the CLAIMPAIR pre-rank exclusion
    (`claim_compute_jobs_with_priority.sql:126-130`) runs that row first. It reads the hold normally.
    The retry later reads the newest `done` row by `claimed_at`.
  - The failed row is never `done`, so it hides no mark.
  - Its own metadata gains nothing, so the retry has no stale own-row mark.
- **Sustained outage.** Three failed attempts within about 2.5 min end the row `failed_final`.
  - Integrity holds: run 1's mark stays on the newest `done` row, and the next row reads it.
  - The strategy then reads `failed`, with the "retries exhausted" copy, until a later `done`
    sync_trades row supersedes it. That is a user-facing cost; see IN-R3-01.
- **Chained derive and `last_sync_at`.** Both are skipped on the failed attempt only. The retry 30 s
  later runs the full epilogue. On `failed_final` they wait for the next cron row, which is the same
  outcome as any other transient sync_trades failure. I judge that acceptable.
- **Error copy.** The new `error_message` lands in `compute_jobs.last_error` and in
  `compute_job_attempt_failures`. Both are operator-only.
  - `get_user_compute_jobs` returns `last_error` as NULL. Its `user_message` is chosen by status and
    `error_kind` (`get_user_compute_jobs.sql:65-88`): "Temporary issue — retrying automatically." for
    `failed_retry`.
  - `computation_error_copy` takes a kind, never a string (`baseline.sql:3579`).
  - The wizard matches only one curated sentence (`SyncPreviewStep.tsx:1436-1442`).
  - The admin card shows the raw string, which is accurate and holds no secret.

## Narrative Findings (AI reviewer)

## Info

### IN-R3-01: A short intermittent read failure can end the row `failed_final` and show the strategy as failed until the next cron sync

**File:** `analytics-service/services/job_worker.py:2561-2579`; `supabase/schema/functions/mark_compute_job_failed.sql:85-96`; `supabase/schema/functions/sync_strategy_analytics_status.sql:728-747`

**Issue:**
- With `max_attempts` 3 and a backoff of 30 s then 2 min, a partial PostgREST degradation of about
  3 minutes can fail all three attempts. That needs the claim and `mark_compute_job_failed` RPCs to
  succeed while this select fails.
- Branch (b) of the status bridge then sets `computation_status = 'failed'` for an unsuperseded
  unmarked `failed_final`.
- The sibling reads in this handler fail open, so this is the one read in the run that fails closed.
- The class already exists: a preflight DB read error or a re-raised 429 ends the same way.
- No data is lost. The trade-off (integrity over one cycle of liveness) is the one WR-R2-01's fix chose.

**Fix:** None required. If it proves noisy, `defer_compute_job` (which does not burn an attempt) is
the alternative to a FAILED return.

### IN-R3-02: Deribit runs now fail on a hold-read blip although their read ignores the seed

**File:** `analytics-service/services/job_worker.py:2483-2486`, `:2561`

**Issue:** `_bound_read` is true for Deribit (`_reach_anchor_ms = 0`), so a hold-read error fails a
Deribit attempt. Yet `fetch_deribit_fills` ignores `since_ms`, so the mark could not have changed what
it reads. The cost is a 30 s delay.

**Fix:** None required.

### IN-R3-03: Status of the round-2 Info items

**File:** `analytics-service/services/trade_resume.py:238`

**Issue:**
- **IN-R2-01** is moot: arm D now asserts on run 2 alone (`_verdict`), and the intervening row ends `failed_retry`.
- **IN-R2-03** is addressed: the docstring, the log line, the comments and H5 are reworded or re-pointed.
- **IN-R2-05** is moot: no reach floor runs on a read error.
- **IN-R2-04** now applies only to the malformed-mark path.
- **IN-R2-02 is still open:** `.order("claimed_at", desc=True)` sorts NULLs first. No write path produces a NULL.

**Fix:** Optional: `nullsfirst=False`.

---

_Reviewed: 2026-11-28T11:42:24Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
