---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 04
subsystem: analytics-service tests (Binance fills window walk)
tags: [binance, ccxt, window-walk, PROOF-01, SC-1, SC-5]
status: complete
requires: ["250-03"]
provides:
  - "tests/test_binancefills_walk.py, class TestBinanceFillsWindowWalk: 11 collected arms pinning the seed, the reach clamp, the span, the window boundary, the spot window, the out-of-window refusal, the reconcile shape, the same-millisecond step and the walk constants"
  - "the reach clamp proven end to end through the real run_sync_trades_job (named, never held, stamp reaches the newer fill)"
  - "PROOF-01 records N1r, N2, N3, N4, N5, N17, N18, N19, N22"
affects: [analytics-service/tests]
key-files:
  created:
    - analytics-service/tests/test_binancefills_walk.py
  modified:
    - analytics-service/tests/test_binancefills_e2e.py
key-decisions:
  - "no walk defect was exposed, so services/exchange.py is untouched by this plan (every neuter was restored byte-equal)"
requirements-completed: [SC-1, SC-5]
plan_head_before: 70861fa6351089b228002ec644e9f605be53f4cd
plan_head_after: 0a30315b11bdb817047e5fddf825dfd565e6dee4
commits: 2
actuals:
  tokens: 9500
  tasks: 3
  commits: 2
---

# Phase 250 Plan 04: The Binance fills walk, arm by arm Summary

Eleven new walk arms plus one end-to-end arm pin every SC-1 row of the research table that belongs to the walk, and each one was seen going RED under a named neuter of `services/exchange.py` and GREEN after a byte restore. The walk itself needed no fix.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | e2bd08d17 | e2e arm `test_a_seed_older_than_the_reach_is_clamped_named_and_not_held`; new module with the seed-None arm and the parametrized clamp arm; N2 and N3 |
| 2 and 3 | 0a30315b1 | eight more arms in the same new file (they share it, so one commit): span, boundary, spot, out-of-window, reconcile, same-ms cluster, same-ms step, constants; N1r, N4, N5, N17, N18, N19, N22 |

## Where the job writes the drained flags (as the e2e arm reads them)

The job writes the merged flags through its `strategy_analytics` upsert, which `_make_supabase` records in `rec.analytics_upserts` (`rec.analytics_upserts[-1]["data_quality_flags"]`). A drained non-holding flag such as `binance_fills_reach_clamped` is enough for the job to write (`exchange_dq_flags_present`). The e2e arm asserts the stamp first (`_the_advance(rec)["p_last_fetched_ts"] == "2026-09-21T12:00:00+00:00"`), then reads the flags there.

## What each arm pins

| Arm | Pins |
|---|---|
| `test_a_missing_start_walks_from_the_reach_never_a_startless_request` | `since_ms=None` starts at 1787832000000; every request carries startTime and endTime; no clamp flag |
| `test_a_seed_older_than_the_reach_is_clamped_and_named[raise,empty]` | clamp flag True, no `binance_partial_symbols`, first startTime is the reach, none older, the fill past the clamp returned, under both unmeasured venue behaviours |
| `test_no_request_spans_more_than_one_window` | 0 < span <= 604799999 over a 30-day read of at least 4 windows |
| `test_a_fill_on_a_window_boundary_is_read_with_an_exclusive_end` | a fill on 1793185199999 (the first window's last ms) is read on an exclusive-end venue |
| `test_a_spot_only_symbol_walks_one_day_windows` | `ETHBTC` hits only the spot endpoint, spans <= 86399999, both fills 3 days apart read |
| `test_a_row_outside_its_window_is_refused_by_name` | `ignore_end_for` venue: `binance_partial_symbols == ["BTCUSDT"]`, none of its rows returned, ETHUSDT rows returned, WARNING names BTCUSDT |
| `test_a_reconcile_window_is_one_request_per_symbol_ending_now` | one request per symbol, startTime 1795086000000, endTime 1795176000000 |
| `test_a_same_millisecond_cluster_across_pages_is_read_in_full` | page limit 3, a cluster on T straddling the page boundary, all five ids read (no neuter run: not on the plan's list) |
| `test_a_full_page_on_one_millisecond_steps_past_it` | a full page on the window start takes the +1 step, all five ids read, the drained flags carry `binance_fill_cursor_advance_plus1` |
| `test_the_walk_constants_are_pinned` | 20, 1000, 7, 24, 85 |

## PROOF-01 records (verbatim)

Each neuter ran from a byte backup of `services/exchange.py` in the session scratchpad (`exchange.py.<N>.bak`; `cmp` against the tree silent before the neuter), was restored with `cp`, `cmp` silent, and the GREEN rerun is shown. The final `git diff -- analytics-service/services/exchange.py` is empty. Lines starting `WARNING`/`ERROR` are the captured log lines the filter let through. Long `E` lines are cut at 240 characters by the recording filter.

### N2: `since=None if since_ms is None else current_since` in the `fetch_my_trades` call (a request with no startTime when no seed)

```
backup n2 ok (cmp silent)
E           AssertionError: {'symbol': 'BTCUSDT', 'endTime': 1788436799999, 'limit': 1000}
E           assert ('startTime' in {'symbol': 'BTCUSDT', 'endTime': 1788436799999, 'limit': 1000})
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_missing_start_walks_from_the_reach_never_a_startless_request
1 failed, 2 passed in 18.24s
cmp silent (exit 0)
3 passed in 15.70s
```

(Run on the file as it stood after Task 1: three arms. The RED arm is the named one; the `1 failed, 2 passed` shows the other two stayed GREEN.)

### N3: `walk_start_ms = since_ms` in the reach-clamp branch (the start is no longer clamped; the flag is still recorded)

The first run (e2e arm asserting the flags first) showed the symbol turning partial and the flag missing; the arm was then reordered to assert the stamp first, and this is the second run. Backup `exchange.py.n3.bak`, `cmp` silent.

```
E               services.exchange.BinancePerSymbolFetchError: Binance per-symbol fetch failed for ALL 1 symbols (e.g. BTCUSDT); first error: BadRequest('binance linear: startTime 1784804400000 is older than the reach of 89 days')
E       assert 1784804400000 == 1787832000000
E       AssertionError: assert None == '2026-09-21T12:00:00+00:00'
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_seed_older_than_the_reach_is_clamped_and_named[raise]
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_seed_older_than_the_reach_is_clamped_and_named[empty]
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_a_seed_older_than_the_reach_is_clamped_named_and_not_held
3 failed, 3 passed in 21.58s
cmp silent (exit 0)
6 passed in 17.89s
```

The `assert 1784804400000 == 1787832000000` line is the `[empty]` arm (first startTime is the seed, not the reach); the `[raise]` arm and the e2e arm fail on the strict venue's refusal, and the e2e arm's stamp is `None` instead of `'2026-09-21T12:00:00+00:00'`.

### N4: `window_end = min(window_start + window_ms + 1, read_now)`

```
backup n4 ok (cmp silent)
E               services.exchange.BinancePerSymbolFetchError: Binance per-symbol fetch failed for ALL 1 symbols (e.g. BTCUSDT); first error: BadRequest('binance linear: the time between startTime and endTime cannot be longer than 604800000 
WARNING  quantalyze.analytics:exchange.py:2820 Binance fetch_my_trades failed for BTCUSDT: binance linear: the time between startTime and endTime cannot be longer than 604800000 ms (got 604800001)
WARNING  quantalyze.analytics:exchange.py:2841 Binance per-symbol fetch: 1/1 symbols failed
ERROR    quantalyze.analytics:exchange.py:2535 fetch_raw_trades failed for binance: exc_class=BinancePerSymbolFetchError scrubbed=Binance per-symbol fetch failed for ALL 1 symbols (e.g. BTCUSDT); first error: BadRequest('binance linear: the
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_no_request_spans_more_than_one_window
1 failed, 6 deselected in 28.02s
cmp silent (exit 0)
1 passed, 6 deselected in 70.04s (0:01:10)
```

(An earlier unfiltered run of the whole file under the same neuter: `7 failed`, then `7 passed` after the restore. The venue refuses any span over 7 days, so every walk arm fails under N4 and the arm named here fails by the venue's own refusal.)

### N5: `window_start = window_end + 1` (no 1 ms overlap between windows)

```
backup n5 ok (cmp silent)
E       AssertionError: the fill on the first window's end was never read
E       assert '7' in set()
E        +  where set() = _ids([])
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_fill_on_a_window_boundary_is_read_with_an_exclusive_end
1 failed, 6 deselected in 28.98s
cmp silent (exit 0)
1 passed, 6 deselected in 28.81s
```

### N17: `_binance_fills_window_ms` returns `BINANCE_FILLS_WINDOW_DAYS * 86_400_000` for a spot market

```
backup n17 ok (cmp silent)
E               services.exchange.BinancePerSymbolFetchError: Binance per-symbol fetch failed for ALL 1 symbols (e.g. ETHBTC); first error: BadRequest('binance spot: the time between startTime and endTime cannot be longer than 86400000 ms (
WARNING  quantalyze.analytics:exchange.py:2820 Binance fetch_my_trades failed for ETHBTC: binance spot: the time between startTime and endTime cannot be longer than 86400000 ms (got 522000000)
WARNING  quantalyze.analytics:exchange.py:2841 Binance per-symbol fetch: 1/1 symbols failed
ERROR    quantalyze.analytics:exchange.py:2535 fetch_raw_trades failed for binance: exc_class=BinancePerSymbolFetchError scrubbed=Binance per-symbol fetch failed for ALL 1 symbols (e.g. ETHBTC); first error: BadRequest('binance spot: the ti
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_spot_only_symbol_walks_one_day_windows
1 failed, 6 deselected in 31.48s
cmp silent (exit 0)
1 passed, 10 deselected in 28.50s
```

### N18: delete the two-line out-of-window check (`if row_ts < window_start or row_ts > window_end: raise BinanceFillsOutOfWindow()`)

```
backup n18 ok (cmp silent)
E       KeyError: 'binance_partial_symbols'
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_row_outside_its_window_is_refused_by_name
1 failed, 10 deselected in 26.09s
cmp silent (exit 0)
1 passed, 10 deselected in 22.26s
```

### N1r: delete `params={"until": window_end},` from the `fetch_my_trades` call

```
backup n1r ok (cmp silent)
E           KeyError: 'endTime'
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_reconcile_window_is_one_request_per_symbol_ending_now
1 failed, 10 deselected in 21.31s
cmp silent (exit 0)
1 passed, 10 deselected in 23.85s
```

(Without `until`, ccxt sends no `endTime` on a 25-hour-old start, so the request has no end at all.)

### N19: delete `next_since = current_since + 1` inside the same-millisecond block

```
backup n19 ok (cmp silent)
E       AssertionError: assert {'41', '42', '43'} == {'41', '42', '43', '44', '45'}
E         
E         Extra items in the right set:
E         '45'
E         '44'
E         Use -v to get more diff
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_full_page_on_one_millisecond_steps_past_it
1 failed, 10 deselected in 28.10s
cmp silent (exit 0)
1 passed, 10 deselected in 32.30s
```

(Without the step the cursor re-asks for the same page until the 20-page cap, so the two later fills are never read.)

### N22: record `binance_fill_cursor_advance_plus1` with `_record_dq_flag` inside `_fetch_one` and drop the parent-side recording (`r.advanced_plus1` replaced by `False`)

```
backup n22 ok (cmp silent)
E       AssertionError: assert None is True
E        +  where None = <built-in method get of dict object at 0x11dbc1440>('binance_fill_cursor_advance_plus1')
E        +    where <built-in method get of dict object at 0x11dbc1440> = {}.get
FAILED tests/test_binancefills_walk.py::TestBinanceFillsWindowWalk::test_a_full_page_on_one_millisecond_steps_past_it
1 failed, 10 deselected in 31.94s
cmp silent (exit 0)
1 passed, 10 deselected in 22.35s
```

The drain is `{}`: a flag recorded inside a gathered task never reaches it. All fills were read (the ids assertion passed), so the arm fails on its flag assertion alone.

## Verification

- `pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_harness.py tests/test_exchange.py tests/test_ana_recon_audit.py tests/test_okxtrades_cursor.py tests/test_sync_trades_resume_seed.py -q -p no:cacheprovider`: `295 passed, 5 warnings in 46.52s`.
- Task 1 gate `tests/test_binancefills_walk.py tests/test_binancefills_e2e.py`: `6 passed` (plan floor 6); the walk file alone: `11 passed`.
- `tests/test_job_worker.py`: `129 passed, 1 skipped` (the skip is pre-existing, not investigated here).
- CI mypy strict command: `Success: no issues found in 143 source files`, exit 0.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, before Task 1.
- Acceptance greps: `binance_fills_reach_clamped` in the e2e file >= 1, `^class TestBinanceFillsWindowWalk` in the walk file == 1.

## Deviations from Plan

None. No walk defect was exposed, so `services/exchange.py` has no diff from this plan (every neuter was restored from backup with `cmp` silent, and `git diff -- analytics-service/services/exchange.py` is empty).

- Tasks 2 and 3 share the new test file, so their arms landed in one commit (0a30315b1) rather than two.
- The e2e arm asserts the stamp before the flags, so N3's record shows the stamp `None` as the plan asks (the first ordering failed on the missing flag first).
- `test_a_same_millisecond_cluster_across_pages_is_read_in_full` has no neuter on the plan's list; it is a GREEN guard for NEW-C13-03.

## Notes for later plans

- 250-05 through 250-08 need nothing from this plan's tests; the walk file's `_read` helper and `open_exchanges` fixture are module-local.
- N4 and N17 fail by the venue fake's refusal of an over-long span (a total-failure `BinancePerSymbolFetchError`), not by an assertion line; the arm is still the one named in the `FAILED` line.

## Known Stubs

None.

## Threat Flags

None. T-250-03 is pinned by `test_a_reconcile_window_is_one_request_per_symbol_ending_now`; T-250-01's refusal by `test_a_row_outside_its_window_is_refused_by_name`.

## Self-Check: PASSED

- `analytics-service/tests/test_binancefills_walk.py`: FOUND, created
- `analytics-service/tests/test_binancefills_e2e.py`: FOUND, modified
- Commits e2bd08d17 and 0a30315b1: FOUND on HEAD; `git rev-list --count 70861fa63..HEAD` = 2 before this SUMMARY commit
