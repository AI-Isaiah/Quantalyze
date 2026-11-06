---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 08
subsystem: analytics-service
tags: [trade-read, stalled-claims, job-age-backstop, watchdog-sweep, retention, equivalence-oracle]
status: complete

requires:
  - phase: 171-readceiling
    provides: "plan 04's trade_read_store (begin_claim stalled-claims count, job_too_old, purge_expired), plan 07's resumable read and TradeReadDeferred arm"
provides:
  - "the unforced TradeReadStalled arm of run_reconstruct_allocator_history_job: FAILED permanent, static counts-only text, one reconstruct_failed audit, stored windows kept"
  - "the 24 h job-age backstop at the defer point of _read_bybit_trades_resumable"
  - "main_worker.sweep_expired_trade_reads (hourly per process, time stamped first) called from watchdog_loop in its own guard"
  - "the SC-1 equivalence oracle across claims and across a UTC day"
affects: [171-09, 171-10, 171-12]

actuals:
  tokens: 5709
  tasks: 3
  commits: 2
commits: 2
plan_head_before: b08ef7d1ee68b143f34af76b9e470a7329c419c2
plan_head_after: 40256059d5c1c3a7db5b2df2fe7050c60847258a

tech-stack:
  added: []
  patterns:
    - "a read with no progress ends by a closed cause plus an integer, never by venue text"
    - "retention enforced from the worker's existing recurring path, not a database-scheduled job"
    - "stamp the sweep time before the purge so a failing database is retried an hour later"

key-files:
  created: []
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/main_worker.py
    - analytics-service/tests/test_trade_read_resume.py

key-decisions:
  - "the job-age check runs only when the claim budget has passed at a storable window (the defer point), not on every window: a job past a day that finishes in its claim simply completes"
  - "the stalled arm is not split by forced/unforced: the forced branch has no scope until plan 10, so only the unforced path can raise it today"
  - "the resume tests drive the store's wall clock (_wall_ms) as well as the monotonic one, because the job-age rule reads the real date and the tests' jobs are created at a fixed April date"

requirements-completed: [SC-1]
---

# Phase 171 Plan 08: a read with no progress stops by name; expired rows are swept; claims replay as one pass Summary

An unforced Bybit reconstruct that makes no progress now ends FAILED permanent with a static text (a closed cause, an integer claim count) after three stalled claims of one job, or when its defer point is reached by a job 24 h or older, with the stored windows kept for the next job; `watchdog_loop` calls a throttled `sweep_expired_trade_reads` so kept rows are physically removed within an hour of their 7-day expiry even for a key nobody claims again; and an a6-shaped book read across five claims, and across a UTC day boundary, replays to exactly the equity rows of one unscoped pass.

PLAN_BASE `b08ef7d1ee68b143f34af76b9e470a7329c419c2`. `rev-list --count` over the plan: 2 (before this SUMMARY's own commit).

## What was built

- `services/equity_reconstruction.py`
  - Defer point of `_read_bybit_trades_resumable`: when `store.deadline_passed(scope)`, raise `store.TradeReadStalled("job_age", state.claims)` if `store.job_too_old(scope)`, else plan 07's `TradeReadDeferred`. Docstring updated.
  - Handler, in the inner try beside the `TradeReadDeferred` arm and before `except Exception`: `except store.TradeReadStalled`. One counts-only WARNING (cause, claims, allocator, key, venue), one `allocator.equity.reconstruct_failed` audit (`error_kind` "permanent", the static text), `DispatchResult(FAILED, text, "permanent")`. No purge on this path, no new audit action.
- `main_worker.py`: `from services import trade_read_store`; `_TRADE_READ_SWEEP_INTERVAL_S = 3600.0`, `_sweep_clock = time.monotonic`, `_last_trade_read_sweep`, `async def sweep_expired_trade_reads()` (returns at once inside the interval, stamps the time FIRST, then `purge_expired(get_supabase())`), and its one call in `watchdog_loop` after the orphan sweep in its own `try` / `except Exception` that logs the exception's class name only. `main.py` and the loop's interval default are untouched.
- `tests/test_trade_read_resume.py`: 21 tests (15 from plan 07 plus the 6 below). `_Clock` gained `wall_ms` and `_rig`, `_scope` and `_run_with_database` patch `store._wall_ms` to it; `_scope` now carries a real `created_at` (an hour before `END_DATE`).

Recorded retention bound: a store row is physically removed at most `_TRADE_READ_SWEEP_INTERVAL_S` (1 h) after its `expires_at` (7 days after its last write) while any worker process runs, and earlier on DONE or with its key or account. No database-scheduled job was added.

## Evidence

Stall message text (the tracer's second stop; `claims` is the key's total, which includes the seed claim of the test's earlier job):

`trade read stopped: cause=stalled_claims claims=4; nothing was written to the allocator's history, the stored windows are kept and a later run resumes from them`

The job-age stop is the same text with `cause=job_age`.

Tracer (`test_three_stalled_claims_stop_the_unforced_job_by_name_and_the_sweep_removes_the_expired_rows`): one stored window (window 0) plus its state row, budget zero. Claims 1 to 3 DEFERRED (three `defer_compute_job` calls), claim 4 FAILED permanent with the text above, one failure audit, no snapshot or derived row, `api_keys` row byte-equal, state row `stalled_claims` 3, window 0 still stored. A NEW job id then DEFERRED (fourth defer call, no immediate stall). Store rows before the sweep: 2 (state row, window 0); after the first sweep: 0, with the store's wall clock moved 7 days and 1 s on. Purge-call count over the three `sweep_expired_trade_reads` calls (first; 60 s later; one interval later): 1, 1, 2.

RED first: `red.log` is the tracer at PLAN_BASE code: FAILED (`assert 'unknown' == 'permanent'`, the stall reached the generic arm), not ERROR; the first three claims had DEFERRED as expected. (The wall-clock seam edits to the existing tests were made before the RED run and the other 15 resume tests passed with them.)

Task 2 RED/held (`red-task2.log`): the job-age check was committed with Task 1 (same defect, same edit), so for Task 2 the new tests were run against the module with that one check removed: `1 failed, 19 passed`. Only `test_a_day_old_job_is_stalled_by_name_at_its_defer_point` went RED. The oracles, the watchdog-loop pin and the no-venue-text pin already held after Task 1, for the reason that they are pins of behaviour plans 04 and 07 built (the next-day origin reuse lives in `begin_claim`); the drills below are what show each able to fail. File restored from the byte backup, `cmp` 0.

Oracle (`test_a_book_read_across_claims_equals_a_single_pass`): 105 grid windows over 729 days, 40 trades each except window 40 with 10,500, fees as a dict, a bare number and `None`, the claim budget 25 s on a clock that advances 1 s per venue request. The read took 5 claims (four deferred, storing 25, 16, 25 and 25 windows, the 16 being the claim that also read the 10,500-trade window; then the one that completed) over 14,660 trades (104 x 40 + 10,500); the 730-day `_compute_daily_equity` rows are EQUAL (dict equality) to the single pass and the (symbol, timestamp, amount) sets agree. The next-day test (claim 1 defers after 3 windows, claim 2 a day later) keeps `grid_origin_ms` at the first claim's start, holds no trade before the new start, and replays equal to a single pass from the new start.

Memory reading (a reading, not a gate; synthetic 124,800-trade book, 104 windows of 1,200, `tracemalloc` peak over the read only, venue book built before tracing, in-memory fake database): unscoped `_fetch_bybit_trades` 147.0 MB, scoped (store, one claim, never deferred) 120.5 MB. The scoped output holds the seven-key stored shape instead of full ccxt dicts, which is why it is not higher. The fake stores lists by reference, so this does not include PostgREST JSON bodies (plan 11 measured the largest 5,000-trade chunk at 441,020 bytes).

Gates: quick run (the five files of the plan) `139 passed` at Task 1; the resume file alone `21 passed`; selector `-k "equals_single_pass or stalled or watchdog_loop"` `4 passed`; full analytics suite `13002 passed, 99 skipped`; CI mypy line verbatim `Success: no issues found in 124 source files`. The 3 skips above plan 07's 96 are plan 11's `test_trade_read_store_live.py` (`local-stack lane not configured`), merged into this branch since; none comes from this plan.

Drills (file backed up byte for byte to the scratchpad, edited in place, test run, restored with `cp`, `cmp` exit 0 every time; never git checkout/restore/stash):

| Drill | Edit | FAILED line | cmp |
|-------|------|-------------|-----|
| P start filter | `timestamp >= since_ms` cut removed | `FAILED ...::test_a_resumed_read_on_the_next_day_equals_a_single_pass_from_the_new_start` (`assert all(t["timestamp"] >= since_two ...)`) | 0 |
| Q progress bookkeeping | `record_progress` after a stored window removed | `FAILED ...::test_a_book_read_across_claims_equals_a_single_pass` (`TradeReadStalled: cause=stalled_claims claims=3` at the fourth claim) | 0 |
| X sweep call | `await sweep_expired_trade_reads()` replaced by `pass` | `FAILED ...::test_the_watchdog_loop_runs_the_trade_read_sweep_and_survives_its_failure` (`watchdog_loop hung`) | 0 |
| Y stall arm | `except store.TradeReadStalled` made unreachable (`except ZeroDivisionError`) | `FAILED ...::test_three_stalled_claims_stop_the_unforced_job_by_name_and_the_sweep_removes_the_expired_rows` (`'unknown' == 'permanent'`) | 0 |
| Z job-age backstop | `job_too_old` check removed | `FAILED ...::test_a_day_old_job_is_stalled_by_name_at_its_defer_point` (DEFERRED instead of FAILED) | 0 |

`git diff --stat PLAN_BASE HEAD -- analytics-service/services/ analytics-service/main_worker.py analytics-service/main.py` names `equity_reconstruction.py` and `main_worker.py` only.

## Deviations from Plan

**1. [Rule 3 - blocking] The resume tests drive the store's wall clock**
- **Found during:** Task 1.
- **Issue:** `job_too_old` and the rows' expiry read `store._wall_ms`, the real date (2026-10), while the tests' jobs are created at the fixed `END_DATE` (2026-04-15) and `_scope` carried `created_at=None` (which counts as too old). Every existing deferring test would have become a job-age stall.
- **Fix:** `_Clock.wall_ms` (at `_NOW_MS`) patched into `store._wall_ms` by `_rig`, `_scope` and `_run_with_database`; `_scope` carries a real `created_at`. Plan 07's tests unchanged otherwise and all still pass. File: `tests/test_trade_read_resume.py`.

**2. [Rule 1 - plan text] The job-age check was committed with Task 1, not Task 2**
- It is the same defect and the same few lines as the stall arm, and the tracer's stall message regex already covers both causes. Task 2's RED log was therefore taken against the module with that check removed (see Evidence). Task 3's drill Z covers it as the plan asks.

**3. [Rule 1 - plan text] The Task 2 selector needs a fourth test**
- The plan's selector `equals_single_pass` matches no test (the names it fixes read `equals_a_single_pass`), so `-k "equals_single_pass or stalled or watchdog_loop"` selects only three tests while the verify block requires four. Added `test_a_stalled_job_carries_no_venue_text` (a planted venue signature reaches no log, audit, RPC argument, store row or stall text across both stops), a real H-3 pin for the new arm, which makes the selector pass four. Test names left as the plan fixed them.

**4. Scratch directory**: `/tmp/readceiling-08` is a symlink to a directory under the session scratchpad (the session rule; the plan's verify blocks hardcode the `/tmp` path). The venv is the git-ignored symlink to the main checkout's.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema: the sweep deletes already-expired rows of plan 03's service-role tables through plan 04's `purge_expired`. Threat register: T-171-22 (drills Q, Y, Z), T-171-35 (drill X, tracer sweep assertions), T-171-36 (own guard, class name only, time stamped first, the loop pin).

## For the orchestrator and plans 09 and 10

- Names as the plan fixed them: `_TRADE_READ_SWEEP_INTERVAL_S`, `_sweep_clock`, `_last_trade_read_sweep`, `sweep_expired_trade_reads` in `main_worker`; the arm is `except store.TradeReadStalled as stalled` beside the `TradeReadDeferred` arm. It is the stop for ANY path that raises `TradeReadStalled` inside that try; plan 10's forced side can reuse it or add its own closed token.
- The stalled text's `claims` is the key's total claim count in the state row (it includes claims of earlier jobs), not the job's own.
- Any new test that runs a claim with `job_created_at` at `END_DATE` must patch `store._wall_ms` (use `_rig` or `_scope`), or the job reads as over a day old and stalls at its first defer point.
- Behaviour to know: a deferred reconstruct holds a zero-snapshot book's first daily refresh; the 24 h backstop now bounds that hold (the job ends FAILED permanent, rows kept).

## Self-Check: PASSED

- `analytics-service/services/equity_reconstruction.py`, `analytics-service/main_worker.py`, `analytics-service/tests/test_trade_read_resume.py`: FOUND, nothing under `analytics-service/` uncommitted.
- Commits `3df8f3753` and `40256059d`: ancestors of HEAD on `wt/171-p08`.
- STATE.md and ROADMAP.md untouched.
