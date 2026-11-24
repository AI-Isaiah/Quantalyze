---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 04
subsystem: analytics-service Bybit strategy trade read (execution list)
tags: [bybit, executions, vread-03, proof-01, windowed-walk, ccxt]

requires:
  - phase: 231
    provides: 231-CENSUS.md rows C14-C17, 231-PROBE-RESULT.md (trade-verdict, trade-sweep), plan 02's install_execution_list venue-rule book
provides:
  - "services/exchange.py: _fetch_raw_trades_bybit on walk_paginated (seven-day windows, startTime and endTime on every request), BybitTradeWindowIncomplete (page_cap, cursor_stuck, start_too_old), four BYBIT_EXECUTION_* constants, keyword now_ms clock seam"
  - "tests/test_exchange.py::TestBybitExecutionWindowWalk: the VREAD-03 gates against the venue-rule execution book, plus four flipped legacy-shape tests"
affects: [231-05, 231-06, 232, 222]

tech-stack:
  added: []
  patterns:
    - "page callback + ProviderPaginationContract + walk_paginated + dedupe by id (the fetch_bybit_unified_flows template)"
    - "walker ceiling error caught and re-raised as a closed-reason named error with a static, digit-free text"

key-files:
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_exchange.py

key-decisions:
  - "A page with rows that answers the cursor it was sent now REFUSES (cursor_stuck); the legacy silent stop is retired (PATTERNS conflict note: the unified-flows reader, the most recent and the only one pinned to never a short list, wins)"
  - "The walker's ceiling error is a private _BybitWindowPageCap that the reader catches, so the driver's message (cap and window bounds) never reaches stored text; BybitTradeWindowIncomplete is not a PaginationCeilingExceeded"
  - "A start older than 730 days is refused before any request and never clamped"

requirements-completed: [VREAD-03, PROOF-01]

status: complete
completed: 2026-11-23
actuals:
  tokens: 8700
  tasks: 3
  commits: 4
plan_head_before: 071305164ef78a1c9794b28d55e127a2535b217a
plan_head_after: ca02202784c1e8285f0ba4fd04490278aa6b77be
---

closes-todos: 167.2.1.1.2.1-STRATEGY-BYBIT-7DAY (VREAD-03)

# Phase 231 Plan 04: BYBITREADS execution windows (VREAD-03) Summary

A Bybit strategy trade read whose start is more than seven days back now returns every linear execution in `[start, now]`, or raises `BybitTradeWindowIncomplete` by name. It walks seven-day windows with both `startTime` and `endTime`, pages each window by cursor through `walk_paginated`, and keeps the first of any repeated `execId`.

## What changed

- `services/exchange.py`:
  - `_fetch_raw_trades_bybit` rewritten on `walk_paginated`. The category guard (C17) runs first and is unchanged; the per-fill validation block (`execTime` digits, `_finite_positive_decimal`, fee sign, maker flag, fee-currency flag) moved unchanged into the page callback.
  - New `BybitTradeWindowIncomplete(RuntimeError)` with a closed `reason` and a static text per reason (no digit, names Bybit), placed beside `BinancePerSymbolFetchError`. A private `_BybitWindowPageCap` is the walker's ceiling error; the reader catches it, records the two cap flags and raises the named error `from None`.
  - New constants beside `BYBIT_PNL_PAGE_CAP`: `BYBIT_EXECUTION_WINDOW_PAGE_CAP` (200), `BYBIT_EXECUTION_PAGE_SIZE` (100), `BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS` (365), `BYBIT_EXECUTION_HISTORY_DAYS` (730). Not `Final`, so a test can lower them.
  - Keyword-only `now_ms` clock seam on `_fetch_raw_trades_bybit`. `fetch_raw_trades`, `OVERLAP_WINDOW_MS` and every symbol of `services/job_worker.py` are untouched.
- `tests/test_exchange.py`: `TestBybitExecutionWindowWalk` (10 tests, the tracer plus the nine of Task 2) and the four flips below.

## Records

```
cap-rule: input=field-absent cap=200
trade-verdict: truncated
oq2-timing: sweep_read_s_max=600 sync_trades_budget_s=900
dependency-232: run_sync_trades_job advances last_fetched_trade_timestamp when a raised fetch left raw_fills empty; Phase 232 VREAD-08 / 222 must gate advance_fetched_cursor on not phase2_failed (ruling OQ5)
```

- **cap-rule.** The probe's trade sweep did not finish (`trade-sweep: complete=false read_s_max=600`), so it gave no cap input (`trade-cap-input: field-absent`) and the rule's floor applies. The sweep's own maximum, 121 pages in one window of the one measured key, is a LOWER bound (the sweep was incomplete); 200 is above it and is not proven sufficient. The comment on the constant names the reading and the rule.
- **trade-verdict.** The probe read `truncated`; the walk ships either way (ruling OQ3).
- **oq2-timing, for the phase report.** The sweep read 34 windows in the 600 s deadline (about 18 s a window on the one busy key), so a first sync with no start (a 53-window, 365-day walk) may not fit the 900-second `sync_trades` budget (the census C27 shape). This plan makes the first sync complete or refuse; it does not make it fit the budget. Anything about resuming a long first walk is outside this plan.
- **dependency-232 (recorded, not fixed).** `services/job_worker.py` is not edited here and `advance_fetched_cursor` is not touched (ruling OQ5).
- **Where the refusal lands.** `BybitTradeWindowIncomplete` falls through `run_sync_trades_job`'s generic phase-2 arm, which stores `str(e)[:200]` and discards the drained DQ flags, and through `run_reconcile_strategy_job`'s generic arm. The static text is what is stored. The two cap flags are recorded for any caller that drains them; no criterion expects them in storage on a refusal.

## Flips (flipped, never deleted; old and new expectation)

| Test | Old | New |
|---|---|---|
| `TestFetchRawTrades::test_fetch_raw_trades_bybit_cursor` | `since_ms=None`, two canned pages, 2 calls, no start sent | explicit start 24 h back (one window), 2 calls, both carry `startTime` and `endTime` |
| `TestG12BPaginationGuards::test_fetch_raw_trades_bybit_stuck_cursor_terminates` | a repeated cursor ended the walk silently and returned the first page's fill (`len(result) >= 1`), under 100 requests | `BybitTradeWindowIncomplete` reason `cursor_stuck` after exactly 2 requests; the "Pagination stuck ... bybit" warning is still logged |
| `TestClusterIBybitPageCapTruncationFlag::test_bybit_page_cap_records_dq_flag` | `since_ms=None`, 100 pages returned 100 x 100 fills, `sync_truncated_bybit_pages == 100` | explicit one-window start, cap lowered to 4 with `patch.object`, refusal reason `page_cap` after 4 requests, flags `sync_truncated_bybit` True and `sync_truncated_bybit_pages` 4 |
| `TestG12BUnparseableTimestampDrops::test_bybit_unparseable_execTime_dropped` (other Bybit execution test the walk broke) | `since_ms=None`, one canned page, one bad row logged once | explicit one-window start; with a missing start the canned page is served once per window (53 windows) and the bad row logged 53 times. The contract is unchanged |

Run `tests/test_exchange.py` whole after the flips; every other canned-page Bybit test passes unchanged because a repeated canned page is deduplicated by `execId` (and `len(result) == 1` style assertions hold).

## Task 1 tracer: RED on the pre-fix reader, verbatim

The new test could not run on today's code as written (the legacy reader has no `now_ms`), so the RED was taken on a scratch copy of the legacy reader with only the `now_ms` keyword added, restored by `cp` and `cmp` before any real edit:

```
E       AssertionError: first missing execId d09-00000: the read returned 1 of 4 fills for a start 22 days back (a start-only request is answered with seven days)
1 failed in 12.57s
CMP-OK
```

After the rewrite: `1 passed`.

## PROOF-01 records (verbatim)

Byte backup of the final `services/exchange.py` kept in the scratchpad (outside the repo); each neuter is restored with `cp`, checked with `cmp`, then the file is run GREEN. Never `git checkout`, `restore` or `stash`.

**Window gate**, three neuters. 1c reproduces the original defect (the legacy single start-only window) and is the one that names the first missing execId; 1a pins the `endTime` part.

```
--- neuter 1a: delete the line  "endTime": str(req.window_end),  from the page callback
$ python -m pytest tests/test_exchange.py::TestBybitExecutionWindowWalk -x -q -p no:cacheprovider
E           KeyError: 'endTime'
FAILED tests/test_exchange.py::TestBybitExecutionWindowWalk::test_tracer_a_start_twenty_two_days_back_returns_every_fill
1 failed in 17.31s
cmp: restored byte-equal
--- neuter 1c: the legacy shape, a single start-only window: contract window_max_days=7 -> None AND the endTime param sent only when the window has an end
$ python -m pytest tests/test_exchange.py::TestBybitExecutionWindowWalk -x -q -p no:cacheprovider
E       AssertionError: first missing execId d09-00000: the read returned 1 of 4 fills for a start 22 days back (a start-only request is answered with seven days)
FAILED tests/test_exchange.py::TestBybitExecutionWindowWalk::test_tracer_a_start_twenty_two_days_back_returns_every_fill
1 failed in 15.63s
cmp: restored byte-equal
$ python -m pytest tests/test_exchange.py::TestBybitExecutionWindowWalk -q -p no:cacheprovider
10 passed in 20.79s
```

Note on neuter 1a: with the book's own rule (a start-only request answers start to start plus seven days) a windowed walk that drops `endTime` still happens to tile the same seven days, so the missing-fill assertion cannot catch it; the tracer's `endTime` assertion does, by `KeyError`. A neuter 1b (`window_max_days=None` alone) also failed the tracer, but through a `ValueError` on the string `'None'` sent as `endTime`, not through the venue rule, so it is not offered as evidence; 1c is the clean one.

**Cap gate**:

```
neuter: in the ProviderPaginationContract of _fetch_raw_trades_bybit, on_ceiling="raise" -> on_ceiling="flag" (a cap hit returns the rows read so far instead of raising)
$ python -m pytest tests/test_exchange.py::TestBybitExecutionWindowWalk -x -q -p no:cacheprovider
E           Failed: DID NOT RAISE BybitTradeWindowIncomplete
FAILED tests/test_exchange.py::TestBybitExecutionWindowWalk::test_a_window_past_the_page_cap_refuses_by_name
1 failed, 5 passed in 18.11s
cmp: restored byte-equal
$ python -m pytest tests/test_exchange.py::TestBybitExecutionWindowWalk -q -p no:cacheprovider
10 passed in 26.40s
```

Extra neuters, each restored and `cmp`-checked, each RED on its own named test (dedupe loop, two-year guard, stuck-cursor check, 365-day lookback, a digit in the page_cap text): `test_a_fill_served_twice_is_kept_once`, `test_a_start_older_than_two_years_refuses_before_any_request`, `test_a_cursor_that_does_not_advance_refuses_by_name`, `test_a_missing_start_walks_three_hundred_sixty_five_days`, `test_the_refusal_text_carries_no_digits`.

## Verification run

- `tests/test_exchange.py tests/test_job_worker.py tests/test_exchange_pagination.py`: 321 passed, 1 skipped (the live-DB lane test, `LANE_DB_URL` unset locally).
- The other test files that name `fetch_raw_trades` (reconcile audit, resume seed, preserves-fills, trade-read, legacy merge, deribit, cron router): 411 passed, 2 skipped (lane tests).
- Full analytics suite (`pytest tests -n 4`): 15394 passed, 93 skipped, 0 failed.
- CI's mypy strict command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): no issues in 142 source files.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 15 claims.
- `git diff --quiet 071305164ef78a1c9794b28d55e127a2535b217a HEAD -- analytics-service/services/job_worker.py` exits 0. No test deleted: `grep -cE '^-\s*(async )?def test_'` over the zero-context diff of `tests/test_exchange.py` prints 0.
- The three NEW(plan 04) node ids in `231-CENSUS.md` (C14/C15a tracer, C15b 24-hour, C16 missing start) collect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The RED for the tracer needed a scratch `now_ms`**
- **Found during:** Task 1
- **Issue:** the first run of the new test on today's code died with `TypeError: unexpected keyword argument 'now_ms'`, which is not the venue's reason.
- **Fix:** took the RED on a byte-backed scratch copy of the legacy reader with only the keyword added (above), then restored it by `cp` and `cmp`.

**2. [Rule 1 - Bug] Four more tests flipped, one unnamed by the plan**
- **Found during:** Task 3 whole-file run
- **Issue:** `test_bybit_unparseable_execTime_dropped` asserted one logged error on a canned page and broke under the 53-window default walk.
- **Fix:** explicit one-window start (the plan allows "any other Bybit execution test the walk breaks"). Recorded in the flips table.

**3. [Rule 3 - Blocking] The TDD order for Task 2 was not strictly red-first**
- **Issue:** Task 1's rewrite already implements every Task 2 behaviour (the guard, the refusals and the dedupe are one function), so the nine Task 2 tests passed on first run.
- **Fix:** each load-bearing line was neutered afterwards and the named test went RED (five neuters above, plus the PROOF-01 pair), each restored byte-equal.

**4. [Rule 3 - Blocking] The flipped page-cap test kept its original `def` line**
- **Issue:** the acceptance criterion counts removed `def test_` lines, and adding a `monkeypatch` parameter edits that line.
- **Fix:** the cap is lowered with `patch.object` inside the test, so the signature line is byte-identical. The count prints 0.

### Notes for the phase report (not deviations)

- `services/ingestion/bybit.py::fetch_raw` also calls `_fetch_raw_trades_bybit` (the ingestion adapter, `since_ms` from the creds file, usually None). It now walks 365 days instead of seven; the plan did not name it and no test of it changed. The same first-walk length caveat as `oq2-timing` applies.
- For a stale cursor, `fetch_raw_trades` now returns the whole stale span or a refusal (the job still advances its cursor on a refusal, see `dependency-232`).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; the refusal text is static (T-231-10) and the walk adds no secret handling.

## Ship note

`closes-todos: 167.2.1.1.2.1-STRATEGY-BYBIT-7DAY (VREAD-03)` is the line above. The ship PR that carries this plan deletes that `TODOS.md` entry and names it in its CHANGELOG entry (this plan does not edit `TODOS.md`).

## Self-Check: PASSED

- Files: `analytics-service/services/exchange.py` and `analytics-service/tests/test_exchange.py` present; `class BybitTradeWindowIncomplete` count 1; `walk_paginated(` present; `BYBIT_EXECUTION_HISTORY_DAYS` count 2.
- Commits on the branch (`git rev-list --count 071305164ef78a1c9794b28d55e127a2535b217a..HEAD` = 4 before this file): 8bfa65a1f (tracer and rewrite), eefc4a653 (Task 2 gates), 8102f56ed (four flips), ca0220278 (flipped test keeps its signature).
