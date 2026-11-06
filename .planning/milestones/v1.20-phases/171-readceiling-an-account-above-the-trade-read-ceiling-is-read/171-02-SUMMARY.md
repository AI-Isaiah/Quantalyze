---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 02
subsystem: analytics-service
tags: [bybit, trade-read, continuation-by-time, truncated-read, typed-site]
status: complete

requires:
  - phase: 167.2.1.1.2.1-tradepages
    provides: the paged trade read, TruncatedTradeRead, the loud-stop discipline (WR-04, WR-06)
provides:
  - "_read_bybit_window: a Bybit window above one segment (100 pages) is continued by time, no cursor relied on across segments"
  - "TRUNCATED_READ_SITES (nine closed tokens) and TruncatedTradeRead.site, literal at all nine raise sites"
  - "_BYBIT_WINDOW_SEGMENT_CEILING (100): a venue whose timestamps fall forever still ends loudly"
affects: [171-01 probe (reads site), 171-04, 171-07 to 171-10 (reuse _read_bybit_window per window), 171-12]

actuals:
  tokens: 7277
  tasks: 3
  commits: 2
commits: 2
plan_head_before: dc161d9a6651ae50cbba5b6b43a198ee62453692
plan_head_after: 05782d2ab7b5da5a83c50a4ed878b642f24b794f

tech-stack:
  added: []
  patterns:
    - "continue a paged window by time (end = oldest + 1, one-time retry at oldest on proof of an inclusive end), dedupe by id"
    - "closed-set typed site on a truncation exception, pinned by an AST scan of the raise sites"

key-files:
  created:
    - analytics-service/tests/test_trade_read_resume.py
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_trade_pages.py
    - analytics-service/tests/test_allocator_history_probe.py

key-decisions:
  - "TruncatedTradeRead.site is a REQUIRED keyword (plan text); a site outside TRUNCATED_READ_SITES is a ValueError at construction"
  - "A stalled page no longer ends a window quietly when short: it ends the SEGMENT and the continuation rules decide (louder than the deployed code, per the plan's contract and T-171-04)"
  - "NotSupported before any row propagates out of _read_bybit_window and _fetch_bybit_trades returns the empty book, keeping the deployed behaviour with a None-returning helper"

requirements-completed: [SC-1, SC-2]
---

# Phase 171 Plan 02: Bybit window continued by time, truncations typed Summary

A Bybit window holding more than 100 pages is now read whole inside one run by continuing it by time (end bound lowered to one millisecond past the oldest trade read, a new cursor-less segment, id dedupe absorbing the overlap), and every way a trade read can still stop loudly now carries a typed `site` from a closed set of nine tokens.

PLAN_BASE `dc161d9a6651ae50cbba5b6b43a198ee62453692`.

## What was built

- `services/equity_reconstruction.py`
  - `_read_bybit_window(exchange, w_start, w_end, now_ms, trades, seen)`: the per-window segment loop. `_fetch_bybit_trades` keeps its signature, two-year guard, window tiling and empty-book-on-NotSupported; it calls the helper once per window (plan 07 reuses it per window).
  - `_BYBIT_WINDOW_SEGMENT_CEILING = 100`; `_BYBIT_WINDOW_PAGE_CEILING` keeps its name and value (plan 01's probe reads it).
  - `TRUNCATED_READ_SITES` (nine tokens), `TruncatedTradeRead.__init__(message, *, site)`, `self.site`. Literal `site=` at the three Bybit, three OKX and three generic raise sites. No OKX or generic stop rule changed.
- Tests: new `tests/test_trade_read_resume.py` (SC-2, typed-site, a6-shaped oracle); `tests/test_trade_pages.py` (re-pinned never-runs-out test, segment-edge, one-millisecond and segment-ceiling tests, site assertions on the existing stop tests, the AST raise-site pin).

## RED and GREEN records

- SC-2 RED at PLAN_BASE (`/tmp/readceiling-02/red.log`): `test_an_over_ceiling_window_is_read_whole` FAILED on `TruncatedTradeRead`, raised after exactly **100** calls (`bybit trade window hit the page ceiling ... pages=100 rows=10000`).
- SC-2 GREEN: 10,500 distinct ids read, 106 calls (100 for segment 1, 6 for segment 2), no WARNING.
- Task 2 tests against the PLAN_BASE module (`red-task2.log`): 17 failed in the trade-page and resume files at the first run, plus the a6-shaped test FAILED on `TruncatedTradeRead` (appended). All new behaviour is RED at base for a real reason (the walk raised, or no `.site` existed); none were already green.

## Moved pins (RED before, GREEN after; none weakened)

| Test | Old expectation | New expectation |
|---|---|---|
| `test_a_bybit_window_that_never_runs_out_hits_the_page_ceiling_loudly` renamed `..._stops_loudly_when_its_end_cannot_be_lowered` | `calls == 100`, a "ceiling" WARNING | `calls == 3 * 100` (two segments plus the one retry at the oldest timestamp), one WARNING containing "did not advance", `site == "bybit_no_advance"`, planted signature absent from every record |
| `test_a_venue_that_repeats_its_page_ends_the_read_with_one_warning[bybit, binance]` | one WARNING with venue and "100" | unchanged, plus `site` `bybit_no_advance` / `generic_no_advance` |
| `test_not_supported_after_rows_were_read_fails_the_read` | permanent class | plus `site` `bybit_/okx_/generic_not_supported` |
| OKX repeats / never-runs-out / single-millisecond refusal, generic never-runs-out | raise only | plus `okx_no_advance`, `okx_page_ceiling`, `okx_no_advance`, `generic_page_ceiling` |

`test_a_venue_that_repeats_its_page...[bybit]` now takes three segments (the repeated cursor ends each; the second cannot lower the end; the one retry at the oldest is spent; the third stops). Still exactly one WARNING.

## Drills (file backed up byte for byte to `/tmp/readceiling-02/er.fixed`, restored and `cmp` exit 0 after each)

| Drill | Edit | FAILED line |
|---|---|---|
| A | page loop `else:` raises no-advance instead of continuing | `FAILED tests/test_trade_read_resume.py::test_an_over_ceiling_window_is_read_whole` (TruncatedTradeRead) |
| B | the cannot-lower branch `continue`s instead of raising | `FAILED tests/test_trade_pages.py::test_more_than_a_segment_of_executions_at_one_millisecond_stops_loudly` (`'bybit_segment_ceiling' == 'bybit_no_advance'`) |
| C | segment-ceiling literal changed to `bybit_no_advance` | `FAILED tests/test_trade_pages.py::test_a_bybit_window_whose_timestamps_never_run_out_stops_at_the_segment_ceiling` |
| D | one OKX raise loses `site=`, `__init__` gets a default | `FAILED tests/test_trade_pages.py::test_every_truncated_read_names_a_closed_site` (`assert [] == ['site']`, line 956) |
| E | the one-time retry at the oldest timestamp disabled | `FAILED tests/test_trade_pages.py::test_a_same_millisecond_group_across_a_segment_edge_is_read_whole` (TruncatedTradeRead) |

## Gates

- Full analytics suite from `analytics-service/`: **12932 passed, 96 skipped** (the skips are existing; none in the files this plan touches), exit 0.
- CI mypy line verbatim: `Success: no issues found in 123 source files`.
- `git diff --stat PLAN_BASE HEAD -- analytics-service/services/` names `equity_reconstruction.py` only. Nine `TruncatedTradeRead(_TRUNCATED_READ_MESSAGE, site="...")` literals.

## Deviations from Plan

**1. [Rule 3 - Blocking] One-line edit in `tests/test_allocator_history_probe.py` (a file outside this plan's `files_modified`).**
`test_a_truncated_read_is_told_apart_from_a_venue_rejection` builds `er.TruncatedTradeRead(er._TRUNCATED_READ_MESSAGE)` with no site; the required keyword made the full suite fail. Added `site="generic_no_advance"` to that call (the test only asserts `failure_class == "truncated"`). Commit 779915bb9.
**The orchestrator must know:** plan 01's new probe test (171-01-PLAN, `test_a_truncated_bybit_read_names_the_window_ceiling_from_the_call_log`) is specified to raise `er.TruncatedTradeRead(...)` "message only, no `site`". After `wt/171-p01` and `wt/171-p02` merge that call raises `TypeError`. It needs `site=` (any member of `TRUNCATED_READ_SITES`, and the test then expects the probe's call-log derivation to apply only when the exception has no site, so it should probably build the exception by bypassing `__init__` or use a stub class; plan 01's author decides). A merge conflict on the one edited line in `test_allocator_history_probe.py` is also possible.

**2. [Test numbers] Segment-edge test uses 15 rows at T+1, not 12 (58 distinct ids, not 55).** With 12 at T+1 and 18 at T the 30-row first segment ends exactly at the group edge instead of inside it, which would not test the stated case. 15 at T+1 cuts the T group at 15 of 18.

**3. [Structure] The falling-timestamps fake lives in `tests/test_trade_pages.py` (`_falling_timestamps_exchange`) and `test_trade_read_resume.py` imports it** (the resume file already imports helpers from the pages file, so the reverse import would be circular).

**4. [Behaviour, per the plan's contract] A short stalled page in a segment now ends the segment, not the window.** Deployed code ended the window quietly on a short stalled page; the plan's contract and T-171-04 ("a window ends only on an empty page or a page with no cursor") make the continuation rules decide. A page without timestamps never lowers the end bound (the helper tracks timestamps only from rows that have one; with none it falls to the no-advance stop).

## Known limits

- More than one segment of executions (100 pages x 100 rows) at a SINGLE millisecond is still the loud `bybit_no_advance` stop, by design.
- The retry at `oldest` (no +1) is justified only by observing a row newer than `oldest` in the segment that just ended. Against a venue whose end bound is exclusive, `VenueTradeBook` is inclusive for Bybit, so the exclusive case is covered by contract reasoning and the OKX-style exclusive tests, not by a Bybit exclusive fake.
- Peak memory was not measured here (no persistence in this plan).

## Known Stubs

None.

## Threat Flags

None. New WARNINGs carry class names and integers only; planted-signature assertions are on every new stop test.

## Self-Check: PASSED

- FOUND: `analytics-service/tests/test_trade_read_resume.py`, `analytics-service/services/equity_reconstruction.py` (`_read_bybit_window`, `TRUNCATED_READ_SITES`)
- FOUND commits: 779915bb9, 05782d2ab (ancestors of HEAD)
