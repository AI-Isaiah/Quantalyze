---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
plan: 04
subsystem: analytics-service
tags: [bybit, funding, sync_funding, C27, job_worker]
requires: ["223-03"]
provides:
  - "windowed, store-per-window Bybit sync_funding walk (C27)"
affects: [223-05]
key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_job_worker_sync_funding.py
    - analytics-service/tests/test_job_worker_funding_cursor.py
    - analytics-service/tests/test_bybitreads_census_pins.py
decisions:
  - "No self-deadline and no catch of the handler budget: a cut walk still fails as Handler exceeded timeout and each attempt keeps what it stored"
  - "Slicing lives in the handler helper, not in upsert_funding_rows (its continue-past-error behaviour is pinned and shared with scripts/backfill_funding.py)"
status: complete
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: 25199c9bc3315a93fdb328745d5e22997e58a755
plan_head_after: dc8548fcf81ab2abbf485c28dc277366d8358131
requirements: [FLOWK-02]
---

# Phase 223 Plan 04: C27 handler half Summary

The Bybit `sync_funding` arm now walks one 7-day window at a time, oldest first, through plan 03's `fetch_funding_bybit(..., until_ms=...)` and `bybit_funding_windows`, and stores each window (ascending, 500-row slices, stop at the first failing slice) before reading the next; a budget cut still fails the job and keeps every finished window.

C27 fixed by Phase 223 (census row owned by Phase 231, not edited)

BASE (plan start): `25199c9bc3315a93fdb328745d5e22997e58a755`.

## Commits

- `d8d4bc1d2` feat(223-04): windowed walk, `_store_funding_window`, tracer, the three updated tests (Task 1)
- `b5ec3aba1` test(223-04): the eight remaining C27 handler tests, census docstring prose (Task 2)
- `dc8548fcf` test(223-04): the failing-slice test counts calls through a stateful fake so a neutered walk fails on an assertion, not on an exhausted `side_effect` list (made before PROOF-01)
- Task 3 (PROOF-01) makes no commit: all five neuters restored byte-identical (`git status --porcelain -- analytics-service` empty).

## Verification

- `tests/test_job_worker_sync_funding.py tests/test_job_worker_funding_cursor.py tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py`: 102 passed.
- `TestC27WindowedBybitWalk` + census file: 12 passed (9 C27 + 3 census).
- mypy strict (CI command): `Success: no issues found in 142 source files`.
- Region guard (`CancelledError|TimeoutError|wait_for|asyncio.timeout` inside `run_sync_funding_job`..): 0; `C27` in the region: 3; `"sync_funding": 3 * 60` count: 1.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 15 claims.
- `git diff BASE HEAD -- analytics-service/services/job_worker.py`: four hunks, all inside `run_sync_funding_job` (docstring, import block, Bybit arm) plus the new `_store_funding_window` directly after it.
- Tracer RED on pre-change code (real dispatch, real fetcher, fake endpoint): `assert timeline == [...]` failed with `At index 1 diff: ('req', 'linear', 2, 0) != ('req', 'inverse', 1, 0)` (today's walk reads linear for every window before any inverse, and never upserts before the cut). GREEN after the change: `7 passed` in the file.
- The other eight C27 tests pin Task 1's code and passed at once when written (no RED for them in isolation); their ability to fail is what PROOF-01 below shows for the five mechanisms they guard. The four tests with no neuter cycle (resume, empty window, no window left, 429 mid-walk) are behavioural pins of unchanged or trivial paths and carry no PROOF-01 record, as the plan specifies exactly five.

## The three deliberately updated tests (old and new expectation)

1. `TestRunSyncFundingJob::test_happy_path_calls_upsert_with_rows`
   - Old: bare MagicMock cursor, two rows with no `timestamp`, one Bybit fetch, upsert called once with that list.
   - New: recent cursor (one window), rows carry `datetime` timestamps, upsert mock returns the result dict; the upsert still receives exactly those rows (ascending) and the result is DONE.
2. `TestRunSyncFundingJobCursorWiring::test_since_derived_from_funding_cursor_not_last_sync_at`
   - Old: `assert_awaited_once()` and `args[2]` of the only call equal cursor minus overlap, differing from `last_sync_at`.
   - New: the same two assertions on `await_args_list[0]` (the first window); the cursor and `last_sync_at` stay deliberately different. Module docstring sentence now says the FIRST window's start comes from the funding cursor.
3. `test_empty_funding_table_passes_none_for_backfill` renamed `test_empty_funding_table_walks_the_365_day_backfill`
   - Old: `fetch_funding_bybit` awaited once with `args[2] is None`.
   - New: 53 fetches, first start within 5,000 ms of now minus 365 days, contiguous (next start = previous end + 1), last end within 5,000 ms of now, regardless of `last_sync_at`.

## PROOF-01 (five neuters, byte backup outside the repo, restore by `cp`, `cmp`)

Backups lived in the session scratchpad (`.../scratchpad/p04/job_worker.py.bak1..5`). Each block below is the verbatim record: unified diff of the neuter, the first FAILED line, `cmp` and its exit, the GREEN line. Commands were `cd analytics-service && .venv/bin/python -m pytest "<node id>" -q -p no:cacheprovider`, `cmp <backup> services/job_worker.py`.

Cycles: 1 store once after the loop (node `test_c27_a_cancelled_walk_keeps_the_windows_it_finished_and_fails_transient`); 2 newest window first (`test_c27_windows_are_contiguous_int_ms_and_at_most_seven_days`); 3 no sort (`test_c27_each_window_is_stored_oldest_row_first_and_ties_keep_fetch_order`); 4 continue past a failing slice (`test_c27_the_walk_stops_at_the_first_failing_slice`); 5 no slicing (`test_c27_a_window_is_stored_in_500_row_slices`).

```
=== CYCLE 1 ===
--- diff
--- services/job_worker.py (backup)
+++ services/job_worker.py (neutered)
@@ -3121,16 +3121,18 @@
             now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
             windows = bybit_funding_windows(since_ms, now_ms)
             stored_rows = 0
+            all_rows: list[Any] = []
             for w_start, w_end in windows:
                 window_rows = await fetch_funding_bybit(
                     ctx.exchange, strategy_id, w_start, until_ms=w_end
-                )
-                failed = await _store_funding_window(
-                    ctx.supabase, strategy_id, window_rows
                 )
-                if failed is not None:
-                    return failed
+                all_rows.extend(window_rows)
                 stored_rows += len(window_rows)
+            failed = await _store_funding_window(
+                ctx.supabase, strategy_id, all_rows
+            )
+            if failed is not None:
+                return failed
             logger.info(
                 "sync_funding: stored %d bybit funding rows in %d window(s) "
                 "for strategy %s",
--- RED
FAILED tests/test_job_worker_sync_funding.py::TestC27WindowedBybitWalk::test_c27_a_cancelled_walk_keeps_the_windows_it_finished_and_fails_transient
1 failed in 7.13s
--- cmp
cmp exit 0
--- GREEN
1 passed in 7.49s
=== CYCLE 2 ===
--- diff
--- services/job_worker.py (backup)
+++ services/job_worker.py (neutered)
@@ -3121,7 +3121,7 @@
             now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
             windows = bybit_funding_windows(since_ms, now_ms)
             stored_rows = 0
-            for w_start, w_end in windows:
+            for w_start, w_end in reversed(windows):
                 window_rows = await fetch_funding_bybit(
                     ctx.exchange, strategy_id, w_start, until_ms=w_end
                 )
--- RED
FAILED tests/test_job_worker_sync_funding.py::TestC27WindowedBybitWalk::test_c27_windows_are_contiguous_int_ms_and_at_most_seven_days
1 failed in 4.98s
--- cmp
cmp exit 0
--- GREEN
1 passed in 4.94s
=== CYCLE 3 ===
--- diff
--- services/job_worker.py (backup)
+++ services/job_worker.py (neutered)
@@ -3207,7 +3207,7 @@
     from services.funding_fetch import FUNDING_UPSERT_BATCH_SIZE, upsert_funding_rows
-    ordered = sorted(rows, key=lambda r: r["timestamp"])
+    ordered = list(rows)
     for i in range(0, len(ordered), FUNDING_UPSERT_BATCH_SIZE):
         result = await upsert_funding_rows(
             supabase, ordered[i : i + FUNDING_UPSERT_BATCH_SIZE]
--- RED
FAILED tests/test_job_worker_sync_funding.py::TestC27WindowedBybitWalk::test_c27_each_window_is_stored_oldest_row_first_and_ties_keep_fetch_order
1 failed in 7.83s
--- cmp
cmp exit 0
--- GREEN
1 passed in 5.30s
=== CYCLE 4 ===
--- diff
--- services/job_worker.py (backup)
+++ services/job_worker.py (neutered)
@@ -3121,6 +3121,7 @@
             now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
             windows = bybit_funding_windows(since_ms, now_ms)
             stored_rows = 0
+            walk_failure: DispatchResult | None = None
             for w_start, w_end in windows:
                 window_rows = await fetch_funding_bybit(
                     ctx.exchange, strategy_id, w_start, until_ms=w_end
@@ -3129,8 +3130,10 @@
                     ctx.supabase, strategy_id, window_rows
                 )
                 if failed is not None:
-                    return failed
+                    walk_failure = failed
                 stored_rows += len(window_rows)
+            if walk_failure is not None:
+                return walk_failure
             logger.info(
                 "sync_funding: stored %d bybit funding rows in %d window(s) "
                 "for strategy %s",
@@ -3208,6 +3211,7 @@
     from services.funding_fetch import FUNDING_UPSERT_BATCH_SIZE, upsert_funding_rows
     ordered = sorted(rows, key=lambda r: r["timestamp"])
+    failure: DispatchResult | None = None
     for i in range(0, len(ordered), FUNDING_UPSERT_BATCH_SIZE):
         result = await upsert_funding_rows(
             supabase, ordered[i : i + FUNDING_UPSERT_BATCH_SIZE]
@@ -3222,7 +3226,7 @@
                     "strategy %s: %s",
                     strategy_id, err,
                 )
-            return DispatchResult(
+            failure = DispatchResult(
                 outcome=DispatchOutcome.FAILED,
                 error_kind="transient",
                 error_message=(
@@ -3230,7 +3234,7 @@
                     f"batch(es) failed: {upsert_errors[:3]}"
                 ),
             )
-    return None
+    return failure
 async def _resolve_ccxt_flow_price_index(
--- RED
        """Why: continuing past a failed slice would store newer rows ahead
        assert "1 upsert batch(es) failed" in (result.error_message or "")
ERROR    quantalyze.analytics.job_worker:job_worker.py:3224 sync_funding: upsert_funding_rows batch failed for strategy strat-1: boom
FAILED tests/test_job_worker_sync_funding.py::TestC27WindowedBybitWalk::test_c27_the_walk_stops_at_the_first_failing_slice
1 failed in 5.27s
--- cmp
cmp exit 0
--- GREEN
1 passed in 5.35s
=== CYCLE 5 ===
--- diff
--- services/job_worker.py (backup)
+++ services/job_worker.py (neutered)
@@ -3208,9 +3208,9 @@
     from services.funding_fetch import FUNDING_UPSERT_BATCH_SIZE, upsert_funding_rows
     ordered = sorted(rows, key=lambda r: r["timestamp"])
-    for i in range(0, len(ordered), FUNDING_UPSERT_BATCH_SIZE):
+    for i in range(0, len(ordered), len(ordered)):
         result = await upsert_funding_rows(
-            supabase, ordered[i : i + FUNDING_UPSERT_BATCH_SIZE]
+            supabase, ordered[i : i + len(ordered)]
         )
         upsert_errors = result.get("errors") or []
         if upsert_errors:
--- RED
FAILED tests/test_job_worker_sync_funding.py::TestC27WindowedBybitWalk::test_c27_a_window_is_stored_in_500_row_slices
1 failed in 4.57s
--- cmp
cmp exit 0
--- GREEN
1 passed in 4.53s
```

## Statements for the ship CHANGELOG and the next reader

- C27 fixed by Phase 223 (census row owned by Phase 231, not edited).
- Attempts: three attempts at best; otherwise the next day's cron job (04:00 UTC) resumes from the stored cursor and finishes; SC-5 holds either way because every attempt keeps what it stored. (No claim of a fixed number of attempts.)
- Behaviours recorded, not fixed: a key without inverse scope now sends one refused inverse request and one WARNING per window, and the dropped-row WARNING repeats per window.
- Known limits: progress over a range with no funding row is not persisted (an empty window costs two requests each); a single window above the 10,000-row page ceiling still fails that day while keeping earlier windows (RESEARCH A2); the OKX and Binance arms still store once after their walk with no measured timeout (unmeasured risk, not booked; RESEARCH Open Question 2).
- Phase 232 overlap: no hunk outside `run_sync_funding_job` and `_store_funding_window`.

## Backstop evidence: the overlap re-read writes no duplicate row

`upsert_funding_rows` (`analytics-service/services/funding_fetch.py`):

```python
supabase.table("funding_fees").upsert(
    rows_to_insert,
    on_conflict="match_key",
    ignore_duplicates=True,
).execute()
```

`supabase/migrations/20260416081039_funding_fees.sql` line 95: `match_key     TEXT NOT NULL UNIQUE,` and the migration's own check (lines 194-201) raises `Migration 044 failed: funding_fees.match_key UNIQUE missing` if the unique index is absent. A resumed attempt re-reads the 2-day overlap and the database drops the duplicates (unit tests mock this; the live PROD row-growth check across attempts is the VALIDATION manual row, a backstop, after deploy).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test strength] The failing-slice test would have failed on an exhausted `side_effect` list under neuter 4, not on an assertion**
- **Found during:** Task 3 preparation.
- **Issue:** a two-element `side_effect` list makes a neutered walk that goes on to the third slice raise `StopAsyncIteration`, a RED that does not name the broken invariant.
- **Fix:** the fake upsert counts calls and fails only the second, so a walk that continues sees extra calls and the `await_count == 2` / `fetch awaited once` assertions fail.
- **Files modified:** `analytics-service/tests/test_job_worker_sync_funding.py`
- **Commit:** `dc8548fcf`

### Notes

- The shared fake endpoint was extracted (`_hanging_third_window_endpoint`) so the tracer and the resume test use one venue fake; the tracer's assertions are unchanged.
- The Task 2 eight tests were written after the Task 1 code (they pin it), not before; recorded above rather than presented as test-first.
- `_store_funding_window` types `rows` as `list[Any]` because `FundingFeeRow` is not imported at module level in `job_worker.py` and the TYPE_CHECKING block is outside this plan's write scope.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the threat register mitigations T-223-07 and T-223-08 are pinned by the `test_c27_*` tests and the five cycles above.

## Self-Check: PASSED

- `analytics-service/services/job_worker.py` contains `_store_funding_window` (definition and call) and `bybit_funding_windows` (import and call).
- Commits `d8d4bc1d2`, `b5ec3aba1`, `dc8548fcf` are ancestors of HEAD.
- Working tree clean for `analytics-service/` after the last cycle.
