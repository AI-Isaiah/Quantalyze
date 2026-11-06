---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 05
subsystem: analytics-service / shared ccxt transfer read
tags: [bybit, pagination, nextPageCursor, transfers, data-integrity]
requires: ["180-03"]
provides:
  - "services/ccxt_flow_fetch.py: _BYBIT_TRANSFER_PAGE_LIMIT, _bybit_next_cursor, TransferPageStalled, _read_bybit_transfer_window, the cursor-paged Bybit branch of fetch_ccxt_transfers"
  - "tests/test_ccxt_flow_fetch.py: _NewestFirstBybitTransfers and five new tests"
affects: [180-06, 180-07]
tech-stack:
  added: []
  patterns: ["cursor-authoritative Bybit paging that raises on a stalled cursor", "a venue-faithful newest-first test double"]
key-files:
  modified:
    - analytics-service/services/ccxt_flow_fetch.py
    - analytics-service/tests/test_ccxt_flow_fetch.py
key-decisions:
  - "D-02 implemented as written: the Bybit branch follows nextPageCursor, 50 rows a page, since = the window start on every page, until = the window end. It never advances one millisecond past the newest row."
  - "The Bybit branch is a private helper (_read_bybit_transfer_window) called from the window loop behind an early continue, so the generic loop for every other venue is byte-identical and not re-indented (the plan's no-hunk acceptance)."
  - "A cursor equal to the one the page was asked with raises TransferPageStalled (static text: kind and window start only); a page with rows and no cursor ends the window; an empty page ends the window."
status: complete
commits: 2
plan_head_before: a6825d9d5d33609579184084d9ecd9c23723fbc8
plan_head_after: 8a83a9fee6cc9370229c98a0f96e71284fff2234
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
metrics:
  completed: 2026-10-29
requirements-completed: [SC-2]
---

# Phase 180 Plan 05: Page Bybit transfer windows by Bybit's cursor Summary

`fetch_ccxt_transfers` now reads every page of a Bybit deposit or withdrawal window by following the `nextPageCursor` ccxt leaves on a row's `info`, and raises `TransferPageStalled` on a cursor that does not advance, instead of advancing one millisecond past the newest row of a newest-first page and dropping every older row.

## What was built

- `services/ccxt_flow_fetch.py`: `_BYBIT_TRANSFER_PAGE_LIMIT = 50`; `_bybit_next_cursor(page)` (private copy of `equity_reconstruction._next_page_cursor`, tolerating non-dict rows and non-dict `info`); `TransferPageStalled(RuntimeError)`; `_read_bybit_transfer_window(...)`, dispatched from the window loop when `exchange_id == "bybit"`. It repeats the id-dedup idiom, sleeps `_rate_limit_sleep` between pages, keeps the loud 1000-page warning, and catches only `ccxt.NotSupported` (returning what was read, WR-04). The generic loop (Binance, OKX, every other venue) is untouched, including its `page_limit` of 500 and its one-millisecond advance. A dated "Phase 180 BYBITFUNDING (D-02)" paragraph is in the `fetch_ccxt_transfers` docstring.
- `tests/test_ccxt_flow_fetch.py`: `_NewestFirstBybitTransfers` (id "bybit"; rows in `[since, until]` newest first, 50 a page from an opaque cursor offset, page returned ascending with the cursor on the newest row; records `(since, until, limit, cursor)`; options `repeat_cursor`, `no_cursor`, `not_supported_on_call`) and five tests:
  `test_a_bybit_window_holding_more_than_one_page_returns_every_row` (120 rows, 120 distinct ids, exactly 3 calls, `since` unchanged and `limit` 50 and `until` the window end on each, cursors `None`, `off:50`, `off:100`),
  `test_a_repeated_bybit_cursor_raises_instead_of_truncating`,
  `test_a_bybit_page_without_a_cursor_ends_the_window`,
  `test_not_supported_on_a_later_bybit_page_returns_what_was_read`,
  `test_a_boundary_row_two_windows_return_is_kept_once`.

## Live-reader effect (for the CHANGELOG)

Every caller of `fetch_ccxt_transfers` inherits the fix (D-02, "for every caller"). The two callers in `services/job_worker.py`, `run_derive_broker_dailies_job` and `run_stitch_composite_job`, now return every Bybit transfer of a 30-day window: a Bybit key with more than 50 on-chain deposits or withdrawals in one window previously lost the older rows, so its broker-dailies and composite flow lists grow to include every row the venue holds, and no row is dropped. That is an intended, visible correction (T-180-16, accepted). A Bybit window whose cursor stalls now fails the job loudly (`TransferPageStalled`) where it previously returned a short list that read as "no more transfers". `okx_archive_job` reads OKX only; Binance and OKX windows read exactly as before. `services/job_worker.py`, `services/okx_archive_job.py` and `services/broker_dailies.py` were not touched.

## Tests

- New file tests: 5 new, 8 in `tests/test_ccxt_flow_fetch.py`, all passing.
- Callers: `tests/test_ccxt_flow_fetch.py tests/test_exchange_pagination.py tests/test_job_worker.py tests/test_stitch_composite_job.py tests/test_okx_archive_apply.py tests/test_nav_marks_composite.py tests/test_broker_dailies.py tests/test_derive_broker_dailies_dualmode.py tests/test_stitch_composite.py tests/test_equity_reconstruction.py` -> 719 passed, 1 skipped. The skip is `tests/test_job_worker.py:4204` (`TestDeriveBrokerDailies::test_marks_failed_on_insufficient_history`): "Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset)", a pre-existing live-DB test, not exercised here by rule (no TEST access).
- CI's mypy line, verbatim from `analytics-service/`: `Success: no issues found in 131 source files`.
- `grep -acE '^[[:space:]]*except ' services/ccxt_flow_fetch.py` prints 3 and the non-NotSupported/`TypeError, ValueError` count prints 0. `grep -ac '_bybit_next_cursor(' services/ccxt_flow_fetch.py` prints 2.
- The venv is the main checkout's (ccxt 4.5.85; the repo pins 4.5.88).

## Mutation checks

Each: byte backup with `cp -p`, neuter, named test RED, restore from the byte backup, `cmp` clean, whole file green (8 passed). Temp dir deleted.

- mutation-m1: red (test_a_bybit_window_holding_more_than_one_page_returns_every_row) neuter: the `exchange_id == "bybit"` dispatch made unreachable so the old one-millisecond advance runs; observed `AssertionError: assert 50 == 120`; restore: cmp clean
- mutation-m2: red (test_a_repeated_bybit_cursor_raises_instead_of_truncating) neuter: the `TransferPageStalled` raise replaced by `return True`; observed `Failed: DID NOT RAISE TransferPageStalled`; restore: cmp clean
- mutation-m3: red (test_a_boundary_row_two_windows_return_is_kept_once) neuter: the Bybit helper's `if _rid in seen_ids:` dedup disabled; observed the sorted ids list gaining a duplicate `boundary`; restore: cmp clean (extra check beyond the plan)

## Deviations from Plan

None - plan executed exactly as written. One structural choice inside the plan's latitude: the Bybit branch lives in a private helper behind an early `continue` rather than inline, to leave the generic loop byte-identical (diff against the merge base shows hunks only in the import block, the new helper, the docstring and the dispatch).

## Known Stubs

None.

## Threat Flags

None. `TransferPageStalled` text is static (kind and window start in ms; no venue text), per T-180-17.

## Self-Check: PASSED

- `analytics-service/services/ccxt_flow_fetch.py` and `analytics-service/tests/test_ccxt_flow_fetch.py` exist; commits f84c472cb and 8a83a9fee are on `feat/180-bybitfunding`.
- STATE.md and ROADMAP.md untouched; `VERSION`, `package.json`, `CHANGELOG.md`, `TODOS.md` untouched.
