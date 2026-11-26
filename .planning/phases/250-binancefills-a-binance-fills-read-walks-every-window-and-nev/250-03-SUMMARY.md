---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 03
subsystem: analytics-service/services/exchange.py (Binance fills read)
tags: [binance, ccxt, window-walk, R2-02, PROOF-01, SC-1, SC-3]
status: complete
requires: ["250-01"]
provides:
  - "the per-symbol Binance fills window walk: every request carries params={'until': window_end}, 7-day windows (linear, inverse), 24-hour windows (spot-resolved), oldest first"
  - "binance_fills_reach_clamped (non-holding) and a start that never lacks startTime"
  - "BinanceFillsOutOfWindow, _BinanceSymbolRead (cap and untimed stop kinds with read_through_ms), _binance_fills_window_ms, BINANCE_FILLS_* and a module-level per-window BINANCE_PAGE_CAP"
  - "binance_fill_cursor_advance_plus1 recorded by the parent, so it reaches the drain"
  - "R2-02 promoted from strict xfail to a passing end-to-end gate"
affects: [analytics-service/services/exchange.py, analytics-service/tests]
key-files:
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_binancefills_e2e.py
    - analytics-service/tests/test_exchange.py
key-decisions:
  - "since-aligned windows, no UTC-day floor (the venue's only rule is the span); 85-day reach (assumption A1)"
  - "the out-of-window self-check is included; a row outside [window_start, window_end] fails the symbol into the holding binance_partial_symbols"
  - "cap and untimed stops record nothing in this plan; they travel in _BinanceSymbolRead for 250-06 to record and 250-02 to consume"
requirements-completed: [SC-1, SC-3, SC-5]
plan_head_before: 1aaf9b1752348e1fa8ee062afd0e5e566daed7d8
plan_head_after: 7eb24cf2735e050fe139c9429235e52dbcc0a9f0
commits: 2
actuals:
  tokens: 11900
  tasks: 2
  commits: 2
---

# Phase 250 Plan 03: The Binance fills window walk Summary

`_fetch_raw_trades_binance` now reads each symbol as a since-aligned window walk with an explicit `until` on every request, so a quiet stretch no longer stalls the cursor: 250-01's strict-xfail R2-02 arm passes through the real `run_sync_trades_job` and the stamp moves to `2026-11-15T12:00:00+00:00`.

## What was built

- `services/exchange.py`, after `OVERLAP_WINDOW_MS`: `BINANCE_FILLS_WINDOW_DAYS = 7`, `BINANCE_SPOT_FILLS_WINDOW_HOURS = 24`, `BINANCE_FILLS_REACH_DAYS = 85`, `BINANCE_PAGE_CAP = 20` (now module level, per window), `BINANCE_FILLS_PAGE_LIMIT = 1000`, `_BinanceSymbolRead` (five fields), `_binance_fills_window_ms` (24 h when the resolved market is spot, else 7 d). Dated comment block quotes the venue rules; the two futures pages were read through a summarising fetch (RESEARCH Q1), the spot line was re-read verbatim on 2026-11-25 from binance-spot-api-docs `rest-api.md` ("The time between `startTime` and `endTime` can't be longer than 24 hours.").
- `BinanceFillsOutOfWindow(RuntimeError)` after `BinancePerSymbolFetchError`, one static message.
- `_fetch_raw_trades_binance`: one `_now_ms()` per read, the reach clamp (flag + one WARNING naming strategy id and two instants), `_fetch_one` rewritten as the window walk, the result loop unpacks `item.trades`, and the parent records `binance_fill_cursor_advance_plus1` once after the loop. Symbol discovery, cold start, reverse map, CancelledError scan, failed-symbol branch and the `binance_partial_symbols` recording are untouched.
- `tests/test_binancefills_e2e.py`: strict-xfail marker removed, request-shape assertions added (every call has `startTime` and `endTime`, `0 < endTime - startTime <= 604799999`).
- `tests/test_exchange.py`: 12 Binance tests migrated (see below).

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 04ec46970 | the walk, constants, helper, refusal class, promoted arm |
| 2 | 7eb24cf27 | 12 Binance fetch_raw_trades tests migrated |

## Tracer RED on pre-fix code (verbatim; unmodified `services/exchange.py`, marker removed, new assertions added)

```
E       AssertionError: assert '2026-10-21T12:00:00+00:00' == '2026-11-15T12:00:00+00:00'
E         
E         - 2026-11-15T12:00:00+00:00
E         ?        ---
E         + 2026-10-21T12:00:00+00:00
E         ?       +++
1 failed, 1 deselected in 26.93s
```

GREEN after the walk: `pytest tests/test_binancefills_e2e.py tests/test_binancefills_harness.py -q -p no:cacheprovider -rxX` -> `17 passed` (no xfailed, no XPASS).

## PROOF-01 N1 (verbatim)

Byte backup `exchange.py.n1.bak` in the session scratchpad (`cmp` against the tree: silent). Neuter: delete the line `params={"until": window_end},` from the `fetch_my_trades` call in `_fetch_one`. Run of `tests/test_binancefills_e2e.py -rxX`:

```
E           AssertionError: {'symbol': 'BTCUSDT', 'startTime': 1792580400000, 'endTime': 1793185200000, 'limit': 1000}
E           assert (1793185200000 - 1792580400000) <= 604799999
1 failed, 1 passed in 21.60s
```

(The arm is `test_tracer_a_quiet_stretch_is_walked_and_the_cursor_stamps_the_newer_fill`. Without `until` ccxt adds its own implicit `endTime = startTime + 7d`, which is exactly 604800000 ms: the request-shape assertion is the one that bites, the stamp still reaches the newer fill because the venue fake accepts a 7-day span. That is why the shape assertions are load-bearing.) Restore and re-run:

```
$ cp <scratchpad>/exchange.py.n1.bak services/exchange.py && cmp <scratchpad>/exchange.py.n1.bak services/exchange.py
cmp silent (exit 0)
17 passed in 22.92s
```

## Task 2: always-fails check (verbatim)

Byte backup `test_exchange.py.t2.bak`. Neuter: `_always_fail(symbol, since=None, limit=None, params=None)` -> `_always_fail(symbol, since=None, limit=None)` in `test_binance_per_symbol_total_failure_raises_typed`:

```
E       assert False
E        +  where False = isinstance(TypeError("TestG12BBinanceConcurrency.test_binance_per_symbol_total_failure_raises_typed.<locals>._always_fail() got an unexpected keyword argument 'params'"), RuntimeError)
FAILED tests/test_exchange.py::TestG12BBinanceConcurrency::test_binance_per_symbol_total_failure_raises_typed
1 failed, 220 deselected in 83.49s (0:01:23)
```

Restore: `cp <scratchpad>/test_exchange.py.t2.bak tests/test_exchange.py && cmp ...` -> `cmp silent (exit 0)`; re-run `1 passed, 220 deselected in 49.12s`.

## Migrated tests: old -> new notes

Every migrated test pins the clock at `1700030000000` (2023-11-15T06:33:20Z) via `monkeypatch.setattr("services.exchange._now_ms", ...)` and passes `since_ms=1700000000000` (2023-11-14T22:13:20Z), so each symbol walks ONE 7-day window (`1699996400000` to the clock) holding every fixture row; all rows with a numeric timestamp lie at or after `since_ms` (none in the overlap hour). Each docstring carries its own Old/New note.

- Hand fakes now accept `params=None` (8 fakes: 403, partial_failure_logs_and_continues, total_failure_raises_typed, partial_failure_does_not_raise, semaphore, paginates_past_1000, pagination_hits_page_cap, partial_failure_records_failed_symbols).
- `test_fetch_raw_trades_binance_per_symbol`: Old `await_count >= 1`; New also `== 2` (one window per symbol).
- `test_binance_pagination_hits_page_cap`: still exactly 20 calls, 20000 fills and the `page cap` + symbol WARNING; the cap is now per window and all 20 pages (rows up to 1700020000999) lie in the one window.
- `test_binance_paginates_past_1000_fills`: 1001 fills, 2 calls, page 2 `since` equals page 1's last timestamp (no +1), unchanged.
- `test_binance_per_symbol_cancellation_propagates`: NOT edited. It closes every per-symbol coroutine through a fake `gather` and makes no venue call, so the window pin changes nothing it measures.
- `AsyncMock(return_value=...)` tests (`..._per_symbol`, `..._uses_asyncio_gather`, `full_success_leaves_dq_buffer_clean`, `entry_seam_clears_stale_flags`): `since_ms` pinned, so canned rows are served once per symbol instead of once per about 13 windows.
- `test_ana_recon_audit.py`: no diff; `test_c13_03_binance_cursor_advances_without_plus_one` is green unchanged (`next_since == current_since` stays inside `_fetch_one`).

## Verification

- `pytest tests/test_exchange.py tests/test_ana_recon_audit.py tests/test_binancefills_e2e.py tests/test_binancefills_harness.py -q -p no:cacheprovider -k "inance or c13_03"`: `38 passed, 222 deselected` (plan floor 21). With the three extra test names added to `-k`: `39 passed`.
- Wave sampling: `tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py`: `174 passed, 1 skipped` (the skip is pre-existing in those files; not investigated here). `tests/test_exchange.py` was run in full only for the Binance subset above.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: `Success: no issues found in 143 source files`.
- Acceptance greps: `"until": window_end` 2 (the call and the docstring), `^BINANCE_FILLS_REACH_DAYS: int` 1, `^BINANCE_PAGE_CAP: int` 1, `^class BinanceFillsOutOfWindow` 1, in the function `_now_ms()` 2, `"untimed"` 2, `next_since == current_since` 2; constants print `20 1000 7 24 85 5`.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 13 claims, before Task 1.

## Deviations from Plan

- Test count: the plan names 13 tests; 12 were edited. The cancellation test needs no change (above). Acceptance `params=None` count: 16 (>= 8).
- No Rule 1-4 deviations. No `STATE.md` or `ROADMAP.md` change (orchestrator-owned).

## Notes for later plans

- 250-05: until markets load before the reverse map, an unmapped stored linear name on an unloaded-markets exchange gets a 7-day window sent to the spot endpoint (interim state recorded in the plan; the symbol lands in the holding `binance_partial_symbols`).
- 250-06: `_BinanceSymbolRead.stop` is `"cap"` or `"untimed"` with `read_through_ms` set (newest numeric timestamp read in the current window, else `window_start - 1`); nothing records a flag for them yet. The result loop only unpacks `item.trades`; read stops from the `_BinanceSymbolRead` items after the gather.
- 250-07: `deadline` is declared in the `stop` Literal but never set here; the semaphore is held per request, as at HEAD.
- Untimed branch: through real ccxt it is unreachable (ccxt drops rows with no timestamp when `since` is set); it is reached only by a test double.
- The first window starts at `since_ms` (which `fetch_raw_trades` has already reduced by `OVERLAP_WINDOW_MS`), so the walk start includes the overlap hour 250-06 exempts from the page cap.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: T-250-01 mitigated (out-of-window refusal implemented; pinned by 250-04), T-250-02 mitigated (the new clamp WARNING names only the strategy id and two instants; no venue text added).

## Self-Check: PASSED

- `analytics-service/services/exchange.py`, `tests/test_binancefills_e2e.py`, `tests/test_exchange.py`: FOUND, modified
- Commits 04ec46970 and 7eb24cf27: FOUND on HEAD; `git rev-list --count 1aaf9b17..HEAD` = 2
