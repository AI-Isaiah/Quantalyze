---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
plan: 05
subsystem: analytics-service
tags: [funding, sync_funding, FLOWK-02, job_worker]
requires: ["223-01", "223-02", "223-04"]
provides:
  - "recorded and pinned FLOWK-02 decision: run_sync_funding_job keeps on_malformed=drop for binance, okx and bybit"
affects: []
key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_job_worker_sync_funding.py
decisions:
  - "run_sync_funding_job keeps the default drop for every venue; revisit when a published reader of funding_fees appears"
status: complete
actuals:
  tokens: 9000
  tasks: 3
  commits: 1
plan_head_before: 323ff1c8d774ad6a0b15d15bb7a1749db5b1f3ec
plan_head_after: 0f098c6a9b3324e08b89822bbca019846eb2216d
requirements: [FLOWK-02]
---

# Phase 223 Plan 05: FLOWK-02 drop decision and phase gate Summary

`run_sync_funding_job` keeps dropping a malformed funding row (default `on_malformed="drop"`) for binance, okx and bybit by a recorded decision, pinned per venue through the real handler and real fetchers; the phase gate passes.

closes-todos: 186-OTHER-FUNDING-CALLERS-DROP (FLOWK-02: run_sync_funding_job keeps dropping by recorded decision, okx_archive_job stops by name per ruling 1; the composite caller is out of scope by founder ruling F-2, not fixed)

BASE (plan start): `323ff1c8d774ad6a0b15d15bb7a1749db5b1f3ec`. SUMMARY commit follows `plan_head_after`.

## Commits

- `0f098c6a9` test(223-05): `TestSyncFundingMalformedRowDecision` (all three venue arms) and the docstring paragraph in `run_sync_funding_job` (Tasks 1 and 2 in one commit, see Deviations).
- Task 3 (PROOF-01 and gate) makes no commit: `git status --porcelain -- analytics-service` is empty after the last cycle.

## What changed

- `services/job_worker.py`: 13 added lines, all in the `run_sync_funding_job` docstring (0 deleted lines; `git diff --numstat` `13 0`). It records the decision, the reason (readers measured at HEAD on 2026-11-24: `reconstruct_positions` with no non-test caller, the GDPR export, `sanitize_user`, `scripts/bybit_reconcile.py`; a refusal stores nothing, never moves the cursor, refuses daily), the revisit trigger, and that the composite read is out of scope by F-2.
- `tests/test_job_worker_sync_funding.py`: module-docstring branch (g) and `TestSyncFundingMalformedRowDecision` with local builders and `test_a_malformed_funding_row_is_dropped_and_the_good_row_is_still_stored[binance|okx|bybit]`. Real fetchers run against a fake endpoint serving one good and one blank-symbol row; only `services.funding_fetch.upsert_funding_rows` and `_exchange_preflight` are patched (upsert returns the result dict). Each arm asserts DONE, exactly one upserted row, its `Decimal("-0.01")` amount, its symbol and `match_key` equal to what the real fetcher returns for the good-only page, the `<venue> funding_fetch: dropped 1 malformed rows` WARNING, and the exchange closed. Cursor of now minus 1 day: one Bybit window, no OKX archive call.

## PROOF-01 (three per-venue neuters, byte backup outside the repo, restore by `cp`, `cmp`)

Backup: session scratchpad `p05/job_worker.py.bak`. Each block is the verbatim record (the RED and GREEN lines are the `grep -aE "^FAILED|^E .*FundingRowsMalformed|passed|failed"` filter of `.venv/bin/python -m pytest "tests/test_job_worker_sync_funding.py::TestSyncFundingMalformedRowDecision" -q -p no:cacheprovider`).

```
=== CYCLE B ===
--- diff
@@ -3126,7 +3126,7 @@
         if exchange_name == "binance":
-            rows = await fetch_funding_binance(ctx.exchange, strategy_id, since_ms)
+            rows = await fetch_funding_binance(ctx.exchange, strategy_id, since_ms, on_malformed="raise")
--- RED
E           services.funding_fetch.FundingRowsMalformed: binance funding read dropped 1 malformed row(s)
FAILED tests/test_job_worker_sync_funding.py::TestSyncFundingMalformedRowDecision::test_a_malformed_funding_row_is_dropped_and_the_good_row_is_still_stored[binance]
1 failed, 2 passed in 5.19s
--- cmp
cmp exit 0
--- GREEN
3 passed in 4.56s
=== CYCLE O ===
--- diff
@@ -3128,7 +3128,7 @@
         elif exchange_name == "okx":
-            rows = await fetch_funding_okx(ctx.exchange, strategy_id, since_ms)
+            rows = await fetch_funding_okx(ctx.exchange, strategy_id, since_ms, on_malformed="raise")
--- RED
E           services.funding_fetch.FundingRowsMalformed: okx funding read dropped 1 malformed row(s)
FAILED tests/test_job_worker_sync_funding.py::TestSyncFundingMalformedRowDecision::test_a_malformed_funding_row_is_dropped_and_the_good_row_is_still_stored[okx]
1 failed, 2 passed in 4.57s
--- cmp
cmp exit 0
--- GREEN
3 passed in 4.58s
=== CYCLE Y ===
--- diff
@@ -3136,7 +3136,7 @@
             for w_start, w_end in windows:
                 window_rows = await fetch_funding_bybit(
-                    ctx.exchange, strategy_id, w_start, until_ms=w_end
+                    ctx.exchange, strategy_id, w_start, until_ms=w_end, on_malformed="raise"
                 )
--- RED
E           services.funding_fetch.FundingRowsMalformed: bybit funding read dropped 1 malformed row(s)
FAILED tests/test_job_worker_sync_funding.py::TestSyncFundingMalformedRowDecision::test_a_malformed_funding_row_is_dropped_and_the_good_row_is_still_stored[bybit]
1 failed, 2 passed in 5.01s
--- cmp
cmp exit 0
--- GREEN
3 passed in 4.54s
```

Only the neutered venue's arm was RED in each cycle; the other two passed.

## Phase gate (final summary lines)

- Seven-file quick set (`test_job_worker_sync_funding`, `test_job_worker_funding_cursor`, `test_funding_fetch`, `test_bybitreads_census_pins`, `test_okx_archive_apply`, `test_okx_archive_job`, `test_daily_pnl_read_verdict`): `963 passed in 10.29s`.
- Full suite with the 80% floor: `Required test coverage of 80% reached. Total coverage: 94.79%` and `15608 passed, 93 skipped, 1189 warnings in 136.31s (0:02:16)`, exit 0. The 93 skips are the baseline.
- mypy strict (CI command, `.venv` ccxt 4.5.89): `Success: no issues found in 142 source files`.
- `node scripts/verify-plan-anchors.mjs` on this plan: `OK: 1 plan file(s), no stale claims.`

## Deviations from Plan

**1. Tasks 1 and 2 landed in one commit.** The tracer test is parametrized over all three venues and the builders are shared, so the bybit-only intermediate state was never committed. All three arms and the docstring are in `0f098c6a9`. No behavioural effect.

**2. [Rule 1 - test assumption] OKX normalizes the symbol.** The OKX fetcher turns `instId` `BTC-USDT-SWAP` into `BTCUSDTSWAP`, so the plan's literal `symbol == "BTCUSDT"` would fail for okx. The test asserts the stored symbol equals the symbol the real fetcher returns for the good-only page, for every arm. Row timestamps are relative to now (a fixed 2023 timestamp could fall outside the walk window).

## Known Stubs

None.

## Threat Flags

None. T-223-12 (accept) is recorded in the docstring and pinned per venue; T-223-13 (mitigate) is pinned by the three arms going RED under the raise neuter.

## Self-Check: PASSED

- `class TestSyncFundingMalformedRowDecision` present once; `FLOWK-02` present in `run_sync_funding_job`'s docstring.
- Commit `0f098c6a9` is an ancestor of HEAD.
- `git status --porcelain -- analytics-service` empty after the last cycle.
