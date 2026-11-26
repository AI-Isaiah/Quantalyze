---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 01
subsystem: analytics-service/tests (Binance fills harness)
tags: [binance, ccxt, venue-fake, strict-xfail, R2-02, PROOF-01]
status: complete
requires: []
provides:
  - "a real ccxt.binance (4.5.89) on twelve recorded markets whose three fills endpoints are a venue-faithful fake (BinanceFillsVenue)"
  - "R2-02 reproduced through the real run_sync_trades_job and the real fetch_raw_trades on HEAD code, committed as a strict xfail for plan 250-03 to promote"
  - "the harness's own gates and neuter N0: the forbidden fake (serve everything after startTime) turns them RED"
affects: [analytics-service/tests]
tech-stack:
  added: []
  patterns: ["replace ccxt's HTTP-method layer, never fetch_my_trades", "strict xfail as the RED-on-pre-fix arm a later plan must promote"]
key-files:
  created:
    - analytics-service/tests/cassettes/binance/markets.json
    - analytics-service/tests/_binance_fills.py
    - analytics-service/tests/test_binancefills_harness.py
    - analytics-service/tests/test_binancefills_e2e.py
  modified: []
key-decisions:
  - "The venue fake models the VENUE: window 7 days (linear, inverse) and 24 hours (spot), span over the window raises ccxt.BadRequest, no start and no end serves the last window, start-only serves one forward window, oldest first, min(limit or 500, 1000); no default path serves everything after startTime"
  - "Out-of-reach and inclusive-end behaviour are UNMEASURED at the venue, so they are switches (out_of_reach raise|empty, exclusive_end) with the strict reading as the default"
  - "The R2-02 reproduction is a strict xfail; 250-03 removes the marker"
requirements-completed: [SC-1, SC-5]
plan_head_before: dfa5447335799e5c4e4d6152f3a42942bbc68b88
plan_head_after: 19668bcb4b6af16143cf3b0217a470b962008f9c
commits: 2
actuals:
  tokens: 21462
  tasks: 2
  commits: 2
---

# Phase 250 Plan 01: Venue-faithful Binance fills harness and the R2-02 reproduction Summary

A real `ccxt.async_support.binance` on recorded markets talks only to `BinanceFillsVenue`, and R2-02 (ccxt caps a since-only linear request at since + 7 days, so a fill past a quiet stretch is never read and the cursor stamps the stale fill) is visible on HEAD code through the real `run_sync_trades_job` as a strict xfail. No production file changed.

## What was built

- `tests/cassettes/binance/markets.json`: twelve unified markets from a public `load_markets()` at ccxt 4.5.89, no credentials. `recorded_at` 2026-11-25T19:05:37Z. The dated future it selected by kind (nearest-expiry BTC/USDT linear future) is `BTC/USDT:USDT-261225` (market id `BTCUSDT_261225`, expiry 1798185600000). The other eleven: `ETH/BTC`, `BTC/USDT`, `BTC/USDC` (spot), `BTC/USDT:USDT`, `ETH/USDT:USDT`, `BCH/USDT:USDT`, `XRP/USDT:USDT`, `LTC/USDT:USDT`, `TRX/USDT:USDT`, `BTC/USDC:USDC` (linear swaps), `BTC/USD:BTC` (inverse swap). One-off recorder lived in the session scratchpad, never in the tree.
- `tests/_binance_fills.py`: `NOW_MS`, `HOUR_MS`, `DAY_MS`, `WEEK_MS`, `recorded_markets()`, `venue_fill()`, `BinanceFillsVenue` (switches `reach_days`, `out_of_reach`, `exclusive_end`, `ignore_end_for`; `calls` log; `calls_for(kind)`), `real_binance()` (markets set, `milliseconds` pinned, `fetch` raises, the three endpoints replaced, `load_markets()` pre-warmed), `symbols_supabase()`.
- `tests/test_binancefills_e2e.py`: driver `_run_live` (real job, real `fetch_raw_trades`, `get_and_clear_last_dq_flags` unpatched), the guard arm (green, stays green through the walk) and the strict-xfail reproduction.
- `tests/test_binancefills_harness.py`: `TestBinanceFillsVenueIsFaithful`, seven arms (fifteen collected cases with parametrization).

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | f007e0705 | cassette, helper, e2e driver, guard arm, strict-xfail reproduction |
| 2 | 19668bcb4 | harness gates; also two typing fixes in the e2e file so mypy stays clean |

## Verification (all from analytics-service/, worktree venv, ccxt 4.5.89)

- `pytest tests/test_binancefills_harness.py tests/test_binancefills_e2e.py -q -p no:cacheprovider -rxX`: `16 passed, 1 xfailed`.
- `mypy tests/_binance_fills.py tests/test_binancefills_harness.py tests/test_binancefills_e2e.py`: `Success: no issues found in 3 source files`.
- `git diff --quiet -- analytics-service/services/`: exit 0 (no production change).
- `markets.json` holds 12 markets; `grep -c 'xfail(strict=True' tests/test_binancefills_e2e.py` is 1.

## The reproduction through `--runxfail` (verbatim, RED for the stated reason)

Command: `cd analytics-service && .venv/bin/pytest tests/test_binancefills_e2e.py -q -p no:cacheprovider --runxfail -k tracer`

```
E       AssertionError: assert '2026-10-21T12:00:00+00:00' == '2026-11-15T12:00:00+00:00'
E         
E         - 2026-11-15T12:00:00+00:00
E         ?        ---
E         + 2026-10-21T12:00:00+00:00
E         ?       +++
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_tracer_a_quiet_stretch_is_walked_and_the_cursor_stamps_the_newer_fill
1 failed, 1 deselected in 6.97s
```

The preceding assertion (`fetch.await_args.kwargs["since_ms"] == 1792584000000`) passed, so the failing line is the stamp, and the actual stamp is the stale `2026-10-21T12:00:00+00:00`.

## PROOF-01: neuter N0 (verbatim)

Byte backup of `tests/_binance_fills.py` in the session scratchpad. Neuter inserted in `BinanceFillsVenue._serve`, right after the `limit` line:

```python
        if start is not None:  # N0 NEUTER: serve [startTime, now]
            end = None
            window = 10**18
```

Run of `tests/test_binancefills_harness.py tests/test_binancefills_e2e.py -rfxX` under the neuter:

```
[XPASS(strict)] R2-02: ccxt caps a since-only linear request at since + 7 days, so a fill past a 20-day quiet stretch is never read and the cursor stamps the stale fill. Plan 250-03 (the window walk) removes this marker; strict mo
FAILED tests/test_binancefills_harness.py::TestBinanceFillsVenueIsFaithful::test_a_since_only_linear_request_is_capped_at_seven_days_by_ccxt
FAILED tests/test_binancefills_harness.py::TestBinanceFillsVenueIsFaithful::test_a_span_longer_than_the_window_is_refused[BTC/USDT:USDT-linear-604800000]
FAILED tests/test_binancefills_harness.py::TestBinanceFillsVenueIsFaithful::test_a_span_longer_than_the_window_is_refused[ETH/BTC-spot-86400000]
FAILED tests/test_binancefills_harness.py::TestBinanceFillsVenueIsFaithful::test_a_since_only_inverse_request_serves_one_forward_window
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_tracer_a_quiet_stretch_is_walked_and_the_cursor_stamps_the_newer_fill
5 failed, 12 passed in 29.17s
```

The strict XPASS is what pytest reports as the FAILED line for the e2e reproduction (an XPASS under `strict=True` fails the test). Restore and re-run:

```
$ cp <scratchpad>/_binance_fills.py.bak tests/_binance_fills.py && cmp <scratchpad>/_binance_fills.py.bak tests/_binance_fills.py
cmp silent (exit 0)
tracked file clean   (git diff --quiet -- tests/_binance_fills.py)
XFAIL tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_tracer_a_quiet_stretch_is_walked_and_the_c
16 passed, 1 xfailed in 24.09s
```

## Deviations from Plan

None of Rules 1-4. Two small notes:

- `symbols_supabase` honours the `range(start, end)` window instead of the one-shot "called" flag of `_attach_paginated_chain`, so a second symbol-discovery drain answers the same rows. Same idiom, stateless.
- N0 turns three harness arms RED rather than one (`test_a_span_longer_than_the_window_is_refused` both cases and the inverse forward-window arm also depend on `endTime` and the window rule). The plan required the since-only arm RED and the strict XPASS; both hold.
- The e2e file received two typing fixes (a `list[Any]` annotation and an `await_args is not None` assertion) in the Task 2 commit, because CI runs strict mypy on analytics code.

## Authentication Gates

None. The markets were recorded from public endpoints without keys.

## Known Stubs

None.

## Venue docs consulted

The cassette recording read only public metadata. The venue rules the fake models are the ones RESEARCH Q1 quotes from developers.binance.com (USD-M and COIN-M Account Trade List) and the spot `myTrades` section of binance-spot-api-docs rest-api.md; this plan re-read ccxt 4.5.89's own `fetch_my_trades` (the `until` handling, the linear-only implicit cap, the three routes) rather than re-fetching the docs pages, which RESEARCH recorded as only reachable through a summarising fetch. UNMEASURED items (result order, out-of-reach behaviour, inclusive `endTime`, lone `startTime` on COIN-M and spot, the exact reach rule) remain assumptions, documented in the helper's docstring.

## Threat Flags

None. The cassette holds public market metadata only (T-250-04, accepted); no package was installed (T-250-SC).

## Self-Check: PASSED

- `analytics-service/tests/cassettes/binance/markets.json`, `tests/_binance_fills.py`, `tests/test_binancefills_harness.py`, `tests/test_binancefills_e2e.py`: FOUND
- Commits f007e0705 and 19668bcb4: FOUND on HEAD.
