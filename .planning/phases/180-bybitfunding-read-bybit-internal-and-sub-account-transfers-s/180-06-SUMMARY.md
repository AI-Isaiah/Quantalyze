---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 06
subsystem: analytics-service / allocator history rebuild
tags: [bybit, unified-transaction-log, flows, rebuild, data-integrity]
requires: ["180-04", "180-05"]
provides:
  - "services/equity_reconstruction.py: _refuse_bybit_start_past_terminus(since_ms, now_ms); the Bybit branch of _fetch_and_price_window (guard, then fetch_bybit_unified_flows before the trades)"
  - "tests/test_trade_pages.py: test_the_bybit_replay_takes_only_the_unified_flows, test_the_bybit_flows_are_read_before_the_trades, test_only_the_rebuild_reads_the_unified_flows"
affects: [180-07, 180-08]
tech-stack:
  added: []
  patterns: ["one source per venue: the Unified rows replace, never join, the on-chain pair", "flow read before the long trade crawl"]
key-files:
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_trade_pages.py
    - analytics-service/tests/test_reconstruct_marker_writer.py
    - analytics-service/tests/test_equity_reconstruction.py
key-decisions:
  - "D-01: a Bybit window's deposits and withdrawals are built ONLY from fetch_bybit_unified_flows; fetch_deposits and fetch_withdrawals are never awaited for Bybit. Every other venue reads fetch_ccxt_transfers after the trades exactly as before."
  - "Orchestrator reading 1: the Unified flows are read after the two-year guard and before the first trade request."
  - "D-02: only the rebuild calls the reader; a test reads services/*.py from disk and pins the scope."
status: complete
commits: 1
plan_head_before: 88b2b53f49dbd72cf1b474ff67e7ff1b451c3835
plan_head_after: 1d600ce832d1e71270f4fa7af1d7cd577bcdceca
actuals:
  tokens: 14000
  tasks: 1
  commits: 1
metrics:
  completed: 2026-10-29
requirements-completed: [SC-2]
---

# Phase 180 Plan 06: The Bybit rebuild replays the Unified-edge flows Summary

A Bybit rebuild (forced and unforced) now replays only the money that crossed the Unified account's edge, read from the transaction log before the trade crawl, and the on-chain deposit and withdraw pair is no longer consulted for Bybit.

## What was built

- `_refuse_bybit_start_past_terminus(since_ms, now_ms)`: the two-year guard extracted from `_fetch_bybit_trades` unchanged (same condition, same single WARNING with `window_age_days`, same `ccxt.BadRequest` text, same comment). `_fetch_bybit_trades` calls it where the block was.
- `_fetch_and_price_window`, Bybit branch: after `now_ms`, call the guard, then `deposits, withdrawals = await fetch_bybit_unified_flows(exchange, start_ms, now_ms)`, then the trade crawl. The OKX-terminus clamp and the two `fetch_ccxt_transfers` calls now run only for non-Bybit venues, after the trades, as before. The signature is unchanged. Dated "Phase 180 BYBITFUNDING" comments carry D-01's reason, why the flows come first, the per-claim cost, why the guard runs first, and the Earn limitation (pointing at the reader's docstring).
- Per-claim cost: an unforced job that takes several claims re-reads the Unified flows (about 210 requests, about 90 s) on every claim against the 900 s soft claim budget `_TRADE_READ_CLAIM_BUDGET_S`, because the trade windows are stored and the flows are not.

## Tests

- New in `tests/test_trade_pages.py`: `test_the_bybit_replay_takes_only_the_unified_flows` (exact id sets {"fake-unified-in-1"} and {"fake-unified-out-1"}, both on-chain fetchers awaited 0 times, every log request `accountType` UNIFIED, both types asked), `test_the_bybit_flows_are_read_before_the_trades` (every log request precedes the first trade request), `test_only_the_rebuild_reads_the_unified_flows` (D-02 scope pin; `job_worker.py` checked line by line so plan 07's single `BybitUnifiedFlowReadError` import passes and any call fails).
- Focused run (the ten files of the plan's verify): 424 passed, 0 failed.
- FULL analytics corpus, once, from `analytics-service/` (`-n auto --dist loadgroup -q`): **13898 passed, 102 skipped, 0 failed** (the 102 skips are existing skips; none was added by this plan). Every Bybit AsyncMock double across the corpus is green.
- CI's mypy line, verbatim from `analytics-service/`: `Success: no issues found in 131 source files`.

## Test-double sweep (the three expected files, no more)

- `tests/test_reconstruct_marker_writer.py`: `_crawl_exchange` calls `install_unified_log(exchange)` (empty book; the other venues never ask). This covers the 83 tests that share the builder.
- `tests/test_equity_reconstruction.py`: `test_history_depth_months_per_venue` installs an empty Unified log on its `mock_exchange`.
- `tests/test_trade_pages.py`: the quiet-first-week test installs an empty Unified log.

No further file needed a sweep. The strict reader was not loosened.

## Mutation checks

All on `services/equity_reconstruction.py`: byte backup with `cp -p`, neuter, named test RED, restore from the backup, `cmp` clean, whole `tests/test_trade_pages.py` green (44 passed).

mutation-m1: red (`test_the_bybit_replay_takes_only_the_unified_flows`: `assert {'fake-onchain-1'} == {'fake-unified-in-1'}` with the Bybit branch reading the two `fetch_ccxt_transfers` calls). restore: cmp clean
mutation-m2: red (`test_the_bybit_replay_takes_only_the_unified_flows`: the deposit ids held `fake-onchain-1` beside the Unified id with the generic transfers block also run for Bybit and concatenated). restore: cmp clean
mutation-m3: red (`test_the_bybit_flows_are_read_before_the_trades`: order `['trade', 'trade', 'log', 'log', 'log', 'log']` with the Unified read moved below the trade crawl). restore: cmp clean

## Deviations from Plan

None. The plan's premise held at HEAD: the sweep needed exactly the three measured edits, and the full corpus is green.

## Known Stubs

None.

## Threat Flags

None. T-180-18 is mitigated by m1 and m2 seen RED; T-180-30 is accepted and its cost is stated above and in the code comment.

## Self-Check: PASSED

- FOUND: the four modified files; commit 1d600ce83 is an ancestor of HEAD.
- `grep -acE '^mutation-m[0-9]+: red \('` on this file prints 3.
- `fetch_bybit_unified_flows(` appears in `equity_reconstruction.py`; `_refuse_bybit_start_past_terminus(` appears 3 times (definition and two calls).
- STATE.md, ROADMAP.md, VERSION, package.json, CHANGELOG.md, TODOS.md, `job_worker.py`, `broker_dailies.py` and `okx_archive_job.py` untouched.
