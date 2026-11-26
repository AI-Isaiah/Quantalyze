---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 05
subsystem: analytics-service/services/exchange.py (Binance fills read, symbol classification and map)
tags: [binance, ccxt, unlisted-symbols, symbol-map, onboarding-adapter, PROOF-01, SC-1, SC-2, SC-5]
status: complete
requires: ["250-02", "250-04"]
provides:
  - "binance_unlisted_symbols: a ccxt.BadSymbol is named on every run and never holds the cursor; every other exception keeps the holding binance_partial_symbols"
  - "the all-symbols-failed raise counts unlisted symbols (BinancePerSymbolFetchError names both)"
  - "markets are loaded before the reverse map; a spot market never replaces a non-spot entry (derivative wins by rule)"
  - "the LIVE onboarding caller BinanceAdapter.fetch_raw (no since_ms) walks from the reach and returns a fill older than 7 days, driven unedited"
  - "tests/_binance_fills.py: BinanceFillsVenue.effects, real_binance(markets_loaded=, market_order=)"
affects: [analytics-service/services/exchange.py, analytics-service/tests]
key-files:
  created:
    - analytics-service/tests/test_binancefills_adapter.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/_binance_fills.py
    - analytics-service/tests/test_binancefills_walk.py
    - analytics-service/tests/test_binancefills_e2e.py
key-decisions:
  - "No local BadSymbol raise for an unmapped name (plan decision): ccxt's own market() raises it client-side once markets are loaded"
  - "market_order re-indexes ex.markets AFTER set_markets (ccxt key-sorts markets by symbol, so spot always precedes its swap by iteration order alone)"
requirements-completed: [SC-1, SC-2, SC-5]
plan_head_before: 6b07b223d20a92bc123f96cca83662bb956b50a7
plan_head_after: 8a6509218469fc3f3756b117b97457c3d78ec9bc
commits: 2
actuals:
  tokens: 6700
  tasks: 2
  commits: 2
---

# Phase 250 Plan 05: Unlisted symbols are named, markets load before the map Summary

A venue-unlisted Binance symbol is now named in the non-holding `binance_unlisted_symbols` while the healthy symbols are stored and stamped through the real sync job, a transiently failed symbol still holds and is re-read on the next clean run, and a stored name can reach the non-holding flag only when the loaded venue metadata does not list it. The live onboarding adapter read is proven to walk from the reach.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 98a40cff1 | BadSymbol classification, unlisted flag, total-failure raise counting unlisted; tracer e2e plus two walk arms; N6, N8b |
| 2 | 8a6509218 | `load_markets()` before the map, derivative-over-spot precedence, venue switches, transient and adapter arms; N14, N15, N23, N30 |

## Tracer RED on the 250-04 code (verbatim, unmodified `services/exchange.py`)

```
E       AssertionError: assert None == ['DELISTEDUSDT']
E        +  where None = <built-in method get of dict object at 0x11d855e40>('binance_unlisted_symbols')
E        +    where <built-in method get of dict object at 0x11d855e40> = {'binance_partial_symbols': ['DELISTEDUSDT']}.get
WARNING  quantalyze.analytics:exchange.py:2820 Binance fetch_my_trades failed for DELISTEDUSDT: binance does not have market symbol DELISTEDUSDT
WARNING  quantalyze.analytics:exchange.py:2841 Binance per-symbol fetch: 1/2 symbols failed
E       AssertionError: assert None == '2026-11-15T12:00:00+00:00'
FAILED tests/test_binancefills_walk.py::TestBinanceFillsSymbols::test_an_unlisted_symbol_is_named_and_not_held
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_tracer_an_unlisted_symbol_is_named_and_the_healthy_symbol_stamps
2 failed, 1 passed, 14 deselected in 15.64s
```

(The third arm, `test_every_symbol_unlisted_still_raises`, passed: on the 250-04 code every symbol failing already raised. Its N8b neuter is below.) GREEN after the edit: `35 passed` on walk + e2e + cursor.

## Task 2 arms on the Task 1 code (before the map edit)

RED: `test_unloaded_markets_are_loaded_before_the_map`, the adapter `[unloaded]` case (spot answered a 7-day window: `BadRequest('binance spot: the time between startTime and endTime cannot be longer than 86400000 ms (got 604799999)')`) and the `[spot-listed-after-linear]` collision case. GREEN guards: both transient arms, the adapter `[loaded]` case, the `[recorded-order]` collision case, every `test_each_stored_shape_resolves_to_its_endpoint` case.

## Adapter arm, RED on the phase base (Step 2b, verbatim)

`services/exchange.py` byte-backed up outside the worktree (`cmp` silent), the phase base's file (`git show 21b9ad929c9176b4e80d95fe369df14ce39d7858:analytics-service/services/exchange.py`) written over it, only `tests/test_binancefills_adapter.py` run:

```
E       assert [datetime.dat...timezone.utc)] == [datetime.dat...timezone.utc)]
E         At index 0 diff: datetime.datetime(2026, 11, 18, 12, 0, tzinfo=datetime.timezone.utc) != datetime.datetime(2026, 10, 21, 12, 0, tzinfo=datetime.timezone.utc)
E         Right contains one more item: datetime.datetime(2026, 11, 18, 12, 0, tzinfo=datetime.timezone.utc)
E       assert [] == [datetime.dat...timezone.utc)]
E         Right contains 2 more items, first extra item: datetime.datetime(2026, 10, 21, 12, 0, tzinfo=datetime.timezone.utc)
FAILED ...::test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days[loaded]
FAILED ...::test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days[unloaded]
2 failed in 46.09s
cmp silent            (cp of the backup back; cmp <backup> services/exchange.py)
1 failed, 1 passed in 57.23s   (module re-run on the restored Task 1 code: `[loaded]` GREEN, `[unloaded]` RED with the spot BadRequest above, the unloaded-markets defect Task 2's map fix closes)
```

Markets loaded on the base: only the 2026-11-18 fill comes back (one startless request: the 2026-10-21 fill is lost). Markets not loaded on the base: nothing is returned (the spot endpoint answered). The module collected against the base file unchanged (its module imports name no phase-new symbol).

## PROOF-01 records (verbatim)

Every neuter ran from a byte backup of `services/exchange.py` in the session scratchpad (outside the worktree): `exchange.250-05.t1` (N6, N8b) and `exchange.250-05.t2` (N14, N15, N23, N30). Each was applied with an asserted single-occurrence replace, restored with `cp`, and checked with `cmp <backup> services/exchange.py` (silent = identical) before the GREEN re-run. Final tree is byte-equal to the `t2` backup (`cmp` silent).

### N6: `if isinstance(item, ccxt.BadSymbol):` -> `if False and isinstance(item, ccxt.BadSymbol):`

```
WARNING  quantalyze.analytics:exchange.py:2837 Binance fetch_my_trades failed for DELISTEDUSDT: binance does not have market symbol DELISTEDUSDT
WARNING  quantalyze.analytics:exchange.py:2858 Binance per-symbol fetch: 1/2 symbols failed
FAILED tests/test_binancefills_walk.py::TestBinanceFillsSymbols::test_an_unlisted_symbol_is_named_and_not_held
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_tracer_an_unlisted_symbol_is_named_and_the_healthy_symbol_stamps
2 failed, 1 passed, 14 deselected in 16.81s
cmp silent
3 passed, 14 deselected in 15.21s
```

### N8b: total-failure raise compares `len(failed_symbols) == len(symbols)` alone

```
E       Failed: DID NOT RAISE BinancePerSymbolFetchError
FAILED tests/test_binancefills_walk.py::TestBinanceFillsSymbols::test_every_symbol_unlisted_still_raises
1 failed, 1 passed, 11 deselected in 9.34s
cmp silent
35 passed in 14.34s
```

### N14: remove the `load_markets()` call (`if not getattr(exchange, "markets", None): await exchange.load_markets()` -> `if False:`)

```
E           services.exchange.BinancePerSymbolFetchError: Binance per-symbol fetch failed for ALL 1 symbols (e.g. BTCUSDT); first error: BadRequest('binance spot: the time between startTime and endTime cannot be longer than 86400000 ms (got 435600000)
E           services.exchange.BinancePerSymbolFetchError: Binance per-symbol fetch failed for ALL 1 symbols (e.g. BTCUSDT); first error: BadRequest('binance spot: the time between startTime and endTime cannot be longer than 86400000 ms (got 604799999)
FAILED tests/test_binancefills_walk.py::TestBinanceFillsSymbols::test_unloaded_markets_are_loaded_before_the_map
FAILED tests/test_binancefills_adapter.py::TestBinanceFillsThroughTheOnboardingAdapter::test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days[unloaded]
2 failed, 10 passed, 12 deselected in 50.95s
cmp silent
12 passed, 12 deselected in 69.21s (0:01:09)
```

(The adapter arm's `markets_loaded=False` case goes RED beside the walk arm, as the plan requires.)

### N30: walk start `read_now - BINANCE_FILLS_WINDOW_DAYS * 86_400_000` instead of the reach when `since_ms` is None

```
FAILED tests/test_binancefills_adapter.py::TestBinanceFillsThroughTheOnboardingAdapter::test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days[loaded]
FAILED tests/test_binancefills_adapter.py::TestBinanceFillsThroughTheOnboardingAdapter::test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days[unloaded]
2 failed in 45.70s
cmp silent
2 passed in 41.18s
```

### N15: remove the spot precedence (`if existing is not None and _binance_market_is_spot(mkt):` -> `if False and ...`, last write wins)

```
FAILED tests/test_binancefills_walk.py::TestBinanceFillsSymbols::test_a_strip_collision_resolves_to_the_derivative_whatever_the_order[spot-listed-after-linear]
1 failed, 3 passed, 20 deselected in 42.86s
cmp silent
4 passed, 20 deselected in 19.91s
```

(Run with `-k "collision or onboarding"`: the `[recorded-order]` case and both onboarding cases stay GREEN under the neuter, by design; only the spot-listed-last order bites.)

### N23: widen the unlisted branch to `isinstance(item, BaseException)`

```
FAILED tests/test_binancefills_walk.py::TestBinanceFillsSymbols::test_a_transient_failure_keeps_the_hold
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_a_transient_symbol_is_reread_on_the_next_clean_run
2 failed, 25 deselected in 10.47s
cmp silent
2 passed, 25 deselected in 23.28s
```

## Verification

- Plan's Task 2 command: `pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_adapter.py tests/test_binancefills_harness.py tests/test_binancefills_cursor.py tests/test_exchange.py tests/test_ana_recon_audit.py -q -p no:cacheprovider -k "inance or c13_03"`: `83 passed, 222 deselected`.
- Wave sampling: `tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py`: `395 passed, 1 skipped` (the skip is pre-existing; not investigated here).
- mypy (CI command): `Success: no issues found in 143 source files`.
- Acceptance greps: `ccxt.BadSymbol` and `binance_unlisted_symbols` in `_fetch_raw_trades_binance` both present; `"Binance fetch_my_trades failed for %s` still present; `load_markets()` count in the function: 2 (the call and its comment mention); `git diff --quiet 21b9ad929 -- analytics-service/services/ingestion/binance.py` exits 0 (the adapter is driven, never edited).

## For the ship CHANGELOG

1. Unlisted-span recovery (known limit, not a Fixed line): a span skipped while a symbol was unlisted is recovered by a reconcile or a backfill with an explicit since; `binance_unlisted_symbols` names the symbol on every run and does not hold the cursor.
2. For the `### Fixed` section, on its OWN line, never folded into the known limits (250-CONTEXT founder ruling section): The nightly reconcile of a Binance key now loads markets before it maps stored symbols, so a stored linear symbol such as BTCUSDT is read from the USDⓈ-M futures endpoint instead of the spot endpoint and its diff compares the account's real fills. The reconcile is not gated by `USE_RAW_TRADE_INGESTION`, so this changes live behaviour on merge; PROD held 0 Binance keys on 2026-11-25 (RESEARCH Q4).
3. For 250-08's separate onboarding line (T-250-22): the live onboarding read (`BinanceAdapter.fetch_raw`, no `since_ms`) now walks from the 85-day reach instead of the venue's last 7 days; it is proven by `tests/test_binancefills_adapter.py` (RED on the base: only the newer fill returns with markets loaded, nothing with them unloaded). The adapter drains none of the read's flags (known limit, 250-08).

## Deviations from Plan

**1. [Test helper, minor] `market_order` reorders `ex.markets` after `set_markets`, not the list `set_markets` receives.** The plan said `set_markets` receives the recorded markets in that order. Measured: ccxt 4.5.89 `set_markets` key-sorts `markets` by symbol, so the spot market (`BTC/USDT`) always precedes `BTC/USDT:USDT` whatever list order is passed, and an order-only switch could never put spot last. The switch now re-indexes `ex.markets` after `set_markets` and `load_markets()`. Consequence recorded for later plans: in real ccxt a last-write-wins map is right by iteration order alone, so the precedence rule is defence in depth, and its arm bites only through this switch.

**2. [Test shape] The collision arm is parametrized over two orders** (`recorded-order`, `spot-listed-after-linear`) instead of a single arm. The plan's text expects the arm "GREEN by iteration order until its neuter" yet also asks for spot listed after linear (which is RED on a last-write-wins map). Both cases are collected: the first is the GREEN guard, the second is the one N15 turns RED (verbatim above).

**3. [Test shape] The adapter arm's HEAD reading needed no extra arm**: the module was run unchanged against the base file (Step 2b above).

**4. [Own-test fix] The transient e2e arm's final stamp is BTCUSDT's fill 3 days before now (2026-11-17T12:00:00Z)**, the newest fill of the run; the first draft expected the NOW - 5 days instant and failed on its own arithmetic, fixed before any commit. Its flag check after run 2 is `for upsert in rec2.analytics_upserts: assert "binance_partial_symbols" not in ...` because a clean run with nothing to name writes no flags at all.

No Rule 1-4 deviations in production code. No `STATE.md` or `ROADMAP.md` change (orchestrator-owned). Write scope held: `services/exchange.py` hunks only in `_fetch_raw_trades_binance` (reverse-map build, result loop, flag recording, total-failure raise) plus one new module-level helper `_binance_market_is_spot` placed before `_binance_fills_window_ms`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-250-09 (only BadSymbol is non-holding; pinned by `test_a_transient_failure_keeps_the_hold`, the transient e2e arm, N23), T-250-12 (N14, N15), T-250-13 (the new WARNING passes the exception text through `scrub_freeform_string`) and T-250-22 (N30) are mitigated and pinned. T-250-14 accepted: the new list flag inherits `_DQ_LIST_MERGE_CAP` in `_record_dq_flag`.

## Notes for later plans

- 250-06/250-07: `_fetch_raw_trades_binance` now awaits `exchange.load_markets()` when `exchange.markets` is empty, before the map and before `read_now`. A test double on a plain `MagicMock` (not an AsyncMock) with empty `markets` would now fail on the await; every existing test in the wave-sampling set passes.
- The result loop now has a BadSymbol branch ahead of the generic `BaseException` branch; 250-06's cap/untimed stop recording reads `_BinanceSymbolRead` items after the gather and should sit after both.
- `BinancePerSymbolFetchError.failed_symbols` now also lists unlisted names.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_binancefills_adapter.py, analytics-service/services/exchange.py, analytics-service/tests/_binance_fills.py
- FOUND commits: 98a40cff1, 8a6509218 (both ancestors of HEAD); `git rev-list --count 6b07b223d..HEAD` = 2 before this SUMMARY
- `git diff --quiet 21b9ad929 -- analytics-service/services/ingestion/binance.py` exits 0
