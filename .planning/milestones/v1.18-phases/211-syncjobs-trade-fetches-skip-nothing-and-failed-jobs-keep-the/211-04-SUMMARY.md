---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 04
subsystem: analytics-service
tags: [sync-trades, resume-point, high-water, last_sync_at, tdd]

requires:
  - "211-01: services/trade_resume.py load_strategy_high_waters"
provides:
  - "run_sync_trades_job seeds the daily-P&L read from the stored high-water and the fills read from the fills cursor or the high-water"
affects: [167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 1021bd5d975786be2f347ffba24a49501cccb20d
plan_head_after: 8f7652f143dc7ce9011501cb9b9cd480806f2071

key-files:
  created:
    - analytics-service/tests/test_sync_trades_resume_seed.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_job_worker.py

key-decisions:
  - "The single since_ms became daily_since_ms (stored high-water via load_strategy_high_waters, ccxt arm only) and fills_since_ms (last_fetched_trade_timestamp, else daily_since_ms); last_sync_at is no longer a seed"

requirements-completed: [SC-1, SC-4]
status: complete
---

# Phase 211 Plan 04: Queued sync_trades seeds from the stored high-water Summary

**`run_sync_trades_job` no longer seeds from the poll-overwritten `api_keys.last_sync_at`: the daily-P&L read resumes from the stored `is_fill = false` high-water, and the fills read keeps its cursor and falls back to that high-water.**

## Accomplishments

- Daily read: `daily_since_ms` from `load_strategy_high_waters(ctx.supabase, [strategy_id])` (awaited through `db_execute`), ccxt arm only; MT5 arm issues no high-water read.
- Fills read: `fills_since_ms = parse_since_ms(None, preferred=last_fetched_trade_timestamp)`, else `daily_since_ms`. A failed high-water read gives `None` (full reach) on both reads.
- The two stale C-1 / epilogue comments now describe the split; the `advance_fetched_cursor` expression and `advance_sync_cursor` parameters are byte-identical.

## RED on the unchanged job (Task 1)

- case (a) `test_fresh_last_sync_at_and_no_fills_cursor_reach_back_to_stored_day`: `assert 1794549600000 == 1778112000000` (the last_sync_at instant)
- case (c) `test_failed_high_water_read_gives_full_reach_on_both_reads`: `assert 1794549600000 is None`
- case (b) was added in Task 2 and is covered by N1 and N3 below (its pre-change RED is the N1 neuter, which restores the old seed).

## Neuter proofs (SC-4), each restored by `cp` and confirmed with `cmp` byte-identical

| Neuter | Result |
|---|---|
| N1: seed the daily read from `last_sync_at` with the fills cursor preferred | RED: all three cases (a), (b), (c) |
| N2: fills fallback uses `last_sync_at` instead of the high-water | RED: (a) on the `fetch_raw_trades` assertion (its `fetch_all_trades` assertion passes first), and (c); (b) stays GREEN |
| N3: daily read seeded from the fills cursor | RED: (b) only, on the `fetch_all_trades` assertion |

## Verification

- `pytest` over test_sync_trades_resume_seed, test_job_worker, test_mt5_sync_path, test_mt5_handover, test_failed_status_logged, test_ana_recon_audit, test_sync_trades_preserves_fills: 224 passed, 3 SKIPPED (not passes): one in test_job_worker and two in test_sync_trades_preserves_fills, all "TEST_SUPABASE_DB_URL unset".
- mypy as CI runs it: `Success: no issues found in 139 source files`.
- Acceptance greps: `ctx.key_row.get("last_sync_at")` 0, `load_strategy_high_waters(ctx.supabase, [strategy_id])` 1, `since_ms=fills_since_ms` 1, `since_ms=daily_since_ms` 1, `falls back to last_sync_at` 0.
- Log-noise note: no suite printed the "stored-high-water read failed" fail-open log at ERROR level under `log_cli`; nothing was silenced and the helper's catch was not widened.

## Deviations from Plan

**1. [Rule 3 - Blocking] `TestSyncTradesFeatureFlag.test_sync_trades_feature_flag_off` patched `db_execute` with `side_effect=lambda fn: asyncio.to_thread(fn)`**
- **Found during:** Task 2 verify run
- **Issue:** that patch returned an un-awaited coroutine; the job now unpacks `db_execute`'s return value, so it raised `TypeError: cannot unpack non-iterable coroutine object`.
- **Fix:** the patch now uses `new=AsyncMock(side_effect=lambda fn: fn())`, the form every sibling test uses. Test harness only; production `db_execute` already returns the value.
- **Files modified:** analytics-service/tests/test_job_worker.py
- **Commit:** 8f7652f14

## TODOS state

- `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED` is now closed on both readers (route by plan 01, job here). TODOS.md was not edited (ship step).
- `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` stays OPEN and unchanged: the fills read still trusts its cursor and the writer that put it ahead is untraced.

## Known Stubs

None.

## Self-Check: PASSED

- 035908b51 and 8f7652f14 are ancestors of HEAD; tests/test_sync_trades_resume_seed.py exists.
