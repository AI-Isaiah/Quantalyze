---
phase: 232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co
plan: 02
subsystem: analytics-service
tags: [okx, fetch_daily_pnl, window-walk, vread-07, proof-01]
status: complete
requires: []
provides:
  - "window-major OKX bills walk in services/exchange.py (7-day UTC-day-aligned windows, oldest first, begin+end on every request)"
  - "OkxBillsWindowIncomplete (out_of_window, order_drift), _okx_bills_window_read, _now_ms seam, OKX_BILLS_WINDOW_DAYS / OKX_BILLS_REACH_DAYS / OKX_LIVE_BILLS_DAYS"
affects: [232-03 (aggregation loop, ccy refusal), 232-04 (cron stores the prefix)]
key-files:
  created:
    - analytics-service/tests/test_okxtrades_walk.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/_okx_bills.py
    - analytics-service/tests/test_exchange_harness.py
    - analytics-service/tests/test_exchange.py
    - analytics-service/tests/test_walletoffset_probe.py
    - analytics-service/tests/test_derivegaps_probe.py
decisions:
  - "Window 7 days, reach 93 days, live reach 7 days (module constants, not Final); both page caps unchanged at 100"
  - "Stops (deadline, cap) drop the in-progress window and stop: result is a contiguous oldest prefix; deadline reuses daily_pnl_deadline_okx (Q2)"
  - "A since_ms start is floored to the UTC day, so the first window re-reads its whole start day (idempotent: sync_trades deletes the payload day span)"
metrics:
  tasks: 3
  completed: 2026-11-24
actuals:
  tokens: 18500
  tasks: 3
  commits: 3
plan_head_before: 5e9524f7ef181f83cb9cf1ceb85c4277f9b2ff1e
plan_head_after: 969f413c5bdb8939d5564adcd78eb9824da870ac
---

# Phase 232 Plan 02: window-major OKX bills walk Summary

An OKX first window longer than the page cap now completes: `fetch_daily_pnl`'s OKX branch walks UTC-day-aligned 7-day windows oldest first (`begin`/`end` on every request), the 100-page caps are per (window, instType, endpoint) and unchanged, every stop returns a contiguous oldest prefix, and venue drift is refused by name.

`commits: 3` is measured from the ledger at SUMMARY write (the three task commits below); the SUMMARY commit follows it.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | cdf4e87c4 | tracer + the walk in `services/exchange.py`, `reach_floor_ms` on `OkxBillsArchive`, tracer/cap-pin/alignment tests |
| 2 | 80c8f2911 | the other 11 behaviour arms (14 test names, 18 collected items) |
| 3 | 969f413c5 | re-fixtures of the OKX tests the walk breaks, walletoffset calendar rot |

## Environment

`analytics-service/.venv` bootstrapped in this worktree (git-ignored) from the main checkout's Python 3.12.13: ccxt **4.5.89** (CI pin), pytest 9.1.1, pytest-asyncio 1.5.0, mypy 2.4.0. mypy strict (CI command): `Success: no issues found in 142 source files`. Baseline before any edit: 725 passed over the five OKX-touching files.

## VREAD-07 evidence: OKXHISTORY did not close the truncation

At `5e9524f7e` `fetch_daily_pnl` ran one `for page in range(OKX_BILLS_PAGE_CAP)` loop per (endpoint, instType) over the whole range with `begin` only and no `end`, so the cap was spent on the newest bills and the oldest days were dropped (RESEARCH "Did OKXHISTORY close it?"; the TODOS entry says "measured, not fixed, stays open"). Re-measured here by the tracer going RED on the pre-fix code (record below). This plan does not close `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]` alone: the cron must store the prefix (plan 232-04 carries `closes-todos:`).

### Tracer RED line on pre-fix code (verbatim)

```
E       AssertionError: the long first window was refused as truncated (first missing day index 0)
E       assert 'daily_pnl_truncated_okx' not in {'daily_pnl_truncated_okx': True}
FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_tracer_a_long_first_window_completes_with_the_caps_unchanged
FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_windows_are_day_aligned_oldest_first_and_carry_begin_and_end
2 failed, 1 passed in 5.10s
```

Task 2's tests were additionally run against the byte-identical pre-fix `exchange.py` (backup, `git show 5e9524f7e:...`, `cp` back, `cmp` identical): 16 failed, 2 passed (the cap pin and the non-digit-ts arm pass on old code by design).

## Design as built

- `OKX_BILLS_WINDOW_DAYS = 7`, `OKX_BILLS_REACH_DAYS = 93`, `OKX_LIVE_BILLS_DAYS = 7` beside `OKX_BILLS_PAGE_CAP`; `_now_ms` (via `_wall_clock_ms`) beside `_monotonic`; `OkxBillsWindowIncomplete` beside `BybitTradeWindowIncomplete`; `_okx_bills_window_read` + `_okx_utc_date` before `fetch_daily_pnl`.
- Start = UTC-day floor of the later of `since_ms` and now minus 93 days (the reach when `since_ms` is None; INFO line with the day count when clamped). Window end of the last window is now.
- Per window, per instType (the literal `["SWAP", "FUTURES", "SPOT", "MARGIN"]` loop stays in `fetch_daily_pnl`, `TestLiveInstTypePin` green): `/account/bills` if the window ends after `live_floor` (UTC day of now minus 6 days), `/account/bills-archive` if it starts before it, both for a straddle (union deduplicated by the existing billId dedup). The 90-day gate is gone.
- Window bills join the result only when complete. Deadline: window dropped, `daily_pnl_deadline_okx`, stop. Cap: window dropped, `daily_pnl_truncated_okx`, stop. Exceptions propagate to the existing outer handler (`daily_pnl_fetch_error` + class name, rows `[]`).
- Self-checks: a digit `ts` outside `[start-1, end]` raises `OkxBillsWindowIncomplete("out_of_window")`; numeric billIds not strictly descending, or a page's first not below the cursor, raise `"order_drift"`; the 1 ms edge rows are dropped silently; non-digit `ts` / non-numeric billId pass through (the aggregator's malformed path still names them).

## PROOF-01 records (verbatim from the run, scratch `proof.log`)

Neuter edits applied to a copy of the final `services/exchange.py`, `cp` back from the byte backup, `cmp` (identical, exit 0, no output), then GREEN. Command per block: `cd analytics-service && .venv/bin/python -m pytest tests/test_okxtrades_walk.py -q -p no:cacheprovider -k <test>`.

```
### N1: set OKX_BILLS_WINDOW_DAYS: int = 7 -> 400 (one window for the whole range)
  cmd: pytest tests/test_okxtrades_walk.py -k test_tracer_a_long_first_window
  neuter exit=1
  RED> E       AssertionError: the long first window was refused as truncated (first missing day index 0)
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_tracer_a_long_first_window_completes_with_the_caps_unchanged
  RED> 1 failed, 17 deselected in 4.99s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.40s
### N2: keep the in-progress window's rows on a deadline stop
  (edit: all_bills.extend(_okx_window_bills) added in the deadline branch)
  cmd: pytest tests/test_okxtrades_walk.py -k test_a_deadline_returns_whole_windows_only
  neuter exit=1
  RED> E       AssertionError: assert ['2026-10-21'...6-10-26', ...] == ['2026-10-21'...6-10-26', ...]
  RED> WARNING  quantalyze.analytics:exchange.py:1822 OKX: read deadline (10s) passed in window 2026-11-11..2026-11-18 (SWAP) — returning the 21 bills of the earlier whole windows only
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_a_deadline_returns_whole_windows_only
  RED> 1 failed, 17 deselected in 4.45s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.37s
### N3: continue to later windows after a cap breach
  (edit: the cap branch advances _okx_window_start and `continue`s instead of `break`)
  cmd: pytest tests/test_okxtrades_walk.py -k test_a_cap_breach_returns_a_contiguous_oldest_prefix
  neuter exit=1
  RED> E       AssertionError: assert ['2026-10-21'...6-10-26', ...] == ['2026-10-21'...6-10-26', ...]
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_a_cap_breach_returns_a_contiguous_oldest_prefix
  RED> 1 failed, 17 deselected in 4.42s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.39s
### N4: delete the billId order check (condition made unsatisfiable: `... and False`)
  cmd: pytest tests/test_okxtrades_walk.py -k test_a_venue_serving_oldest_first_under_begin_is_refused_by_name
  neuter exit=1
  RED> E       AssertionError: assert [{'exchange':...e': 5.0, ...}] == []
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_a_venue_serving_oldest_first_under_begin_is_refused_by_name
  RED> 1 failed, 17 deselected in 4.40s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.43s
### N5: delete the ts window check (`if ts < start_ms - 1 or ts > end_ms:` -> `if False:`)
  cmd: pytest tests/test_okxtrades_walk.py -k test_a_row_outside_its_window_is_refused_by_name
  neuter exit=1
  RED> E       AssertionError: assert [{'exchange':....0, ...}, ...] == []
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_a_row_outside_its_window_is_refused_by_name
  RED> 1 failed, 17 deselected in 4.55s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.50s
### N6: route a window to the archive only when since_ms is older than 90 days
  cmd: pytest tests/test_okxtrades_walk.py -k test_an_eight_to_eighty_nine_day_window_reads_the_archive
  neuter exit=1
  RED> E       AssertionError: assert {'2026-11-14': 2.0} == {'2026-10-31'...6-11-14': 2.0}
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_an_eight_to_eighty_nine_day_window_reads_the_archive
  RED> 1 failed, 17 deselected in 4.50s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.61s
### N7: raise OKX_BILLS_PAGE_CAP from 100 to 101
  cmd: pytest tests/test_okxtrades_walk.py -k test_the_page_caps_are_unchanged
  neuter exit=1
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_the_page_caps_are_unchanged
  RED> 1 failed, 17 deselected in 4.46s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.42s
### N8: treat a row at exactly start minus 1 or end as out of window (`if ts < start_ms or ts >= end_ms:` as the refusal)
  cmd: pytest tests/test_okxtrades_walk.py -k test_a_bill_on_a_window_edge_is_counted_once
  neuter exit=1
  RED> E       AssertionError: assert {'daily_pnl_f...owIncomplete'} == {}
  RED> ERROR    quantalyze.analytics:exchange.py:2358 fetch_daily_pnl failed: exc_class=OkxBillsWindowIncomplete scrubbed=OKX bills read refused: the venue served a bill outside the requested window
  RED> FAILED tests/test_okxtrades_walk.py::TestOkxBillsWindowWalk::test_a_bill_on_a_window_edge_is_counted_once
  RED> 1 failed, 17 deselected in 4.44s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 17 deselected in 4.45s
```

(The N2 block's parenthetical edit line and the N4/N5/N8 edit notes are descriptive; the RED/GREEN lines are the run's own output. The N3 RED names the first differing days list; the two lists differ because windows 4 and 5 were read after the breach.)

## Re-fixtured tests (old to new expectation; none deleted)

Full census run (the plan's 23 files plus the new walk file, 24 total, all in the plan's command): `2608 passed, 1 skipped`.

| File / test | Old | New |
|---|---|---|
| `test_exchange_harness.py` `_WindowedBills`, `OKX_NOW_MS`, class clock pin (new helpers) | canned page ignoring begin/end, fixed 2024 ts | a fake honouring begin/end/instType, numeric ids newest first and `after`; clock pinned to 2026-11-20T12:00Z |
| `TestOKXFetchDailyPnl::test_basic_bill_aggregation`, `test_output_format`, `test_multiple_instrument_types`, `test_bill_id_deduplication`, `test_pagination` | 2024 ts, one canned page on call 1, since = now minus N days | bills dated 2026-11-10/11/14 through `_WindowedBills`, since_ms = 2026-11-10; same sums, schema, dedup, instType coverage, 130-bill two-page read; pagination ids now rise with ts (served newest first) |
| `test_since_ms_passed_to_recent_and_archive` | every request `begin == str(since_ms)` | every request on both endpoints carries a day-aligned `begin`/`end` window; first archive `begin == str(reach start - 1)`; still all four instTypes on both endpoints |
| `test_90_day_gate_skips_archive` (name kept) | archive `assert_not_awaited` for a 30-day since_ms | FLIPPED: `assert_awaited` (ruling Q6, the gate is gone) |
| `TestPageCapsStampTheTruncationFlag._full_pages` | rows at a fixed 2024 ts | rows at `begin + 1000` of the requested window; cap tests keep their 100/3/2 request counts |
| the two deadline tests (live, archive) | `assert rows` | `assert rows == []` (the in-progress window is dropped whole) |
| `test_okx_archive_that_ends_on_a_short_page_is_not_truncated` | non-window-aware stub, `calls == 100` | 9,901 SWAP bills in the first archive window through `OkxBillsArchive`; 100 requests for that window, no truncation flag |
| `test_history_that_is_an_exact_multiple_at_the_cap_still_reports_truncated`, malformed-flag test, `test_a_caller_that_passes_no_deadline_...` | fixed-ts canned pages | ts inside the requested window; the no-deadline test expects 3 requests (two windows: 2 pages + 1) instead of 2 |
| `test_exchange.py::test_okx_funding_bills_excluded_from_daily_pnl` | canned page with ts 2023 | ts inside the first live window, `ccy` USDT (as every real bill carries); same asserted contract |
| `test_exchange.py::test_okx_bill_dropped_on_non_digit_ts_logs_warning` | warning only | additionally pins `daily_pnl_malformed_okx` True and no `daily_pnl_fetch_error` (not refused) |
| `test_walletoffset_probe.py::test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx` | real clock, rots after about 2027-01-28 | `_now_ms` pinned two days after the read day, inside this test only; `_B_MS` untouched |
| `test_derivegaps_probe.py` | fake ignored begin/end; real clock | `_serve` honours begin/end; autouse pin of `_now_ms` to `_RUN_AT`; `OKX_BILLS_WINDOW_DAYS = 400` for the file so the probe's page arithmetic keeps its one-read meaning; rows above 1,000 spaced one minute (not one hour) to stay inside the 93-day reach |
| derivegaps re-pins | `realized_oldest_age "365-546"`, `pages_needed_okx_archive == 1`, `past_cap_oldest_age "547-729"`, ceiling 110 gives 102, at-cap field-absent tests with a 15,000-bill history | `"none"` (a capped window keeps no rows), `0` (the cap stops the walk before the archive is asked), `"0-29"`, ceiling 103 gives 102 (measured relation), history of 250 (a cap now stops the walk, so the archive dies part-way only under the cap) |

## Request floor and callers (record, not reopened)

A no-start read goes from about 8 to about 60 requests (12 archive-only windows x 4 + one straddling x 8 + one live x 4, pinned by `test_no_start_walks_the_whole_reach`): 24 s at the archive's documented 2.5 requests a second. A daily cron tick (since about 1 day old) is 4 requests, as before. Callers of `fetch_daily_pnl(okx, None)`: the derive (397 s deadline), `okx_archive_job._live_reference` (Phase 223's crawl cap), the composite member read and the legacy Python `/verify-strategy` route. The public teaser reaches `/process-key`, which does not call `fetch_daily_pnl`; `POST /fetch-trades` is reached only from the debug key-flow route.

## Deviations from Plan

**1. [Process] Task 2 tests written after the code they gate.** The walk's self-checks, age routing and whole-window stops were built in the Task 1 rewrite (they are one function), so Task 2's tests passed on first run. The RED evidence for them is the pre-fix run above (16 failed) plus the eight PROOF-01 neuters, which are the stronger proof each arm can fail.

**2. [Rule 1/3 - signature change] Two test functions were renamed in signature only.** `git diff -U0` shows two `-def test_` lines (`test_okx_archive_that_ends_on_a_short_page_is_not_truncated`, `test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx`): each gained a `monkeypatch` parameter and is re-added under the same name. No test was deleted; the acceptance grep for removed `def test_` lines reads 2 for that reason.

**3. [Rule 3 - recorded] derivegaps probe fixtures use one 400-day window.** The probe measures pages per instType and the cap over one read of the whole range; under 7-day windows those figures multiply by the window count. The fixtures keep that shape instead of re-deriving the probe's arithmetic. The probe's own source is untouched (outside write scope); a probe run against PROD under the new walk will report page counts per window-instType request, not per instType. Worth a note for whoever next reads `okx_bills_pages_max`.

**3b.** A capped window now stops the walk before the archive is asked; the old walk kept going. The two derivegaps tests that relied on "cap hit, then the archive dies" were re-fixtured to a history under the cap.

**4. Not run:** `node scripts/verify-plan-anchors.mjs` on this plan (the plan's verification line); the executor ran out of room for it. Run it from the orchestrator.

## Behaviour notes for plans 232-03 and 232-04

- `since_ms` is now floored to its UTC day: the first window re-reads its whole start day (the old `begin` was the exact `since_ms`). Idempotent for the `sync_trades` window-scoped delete.
- The aggregation loop is untouched (type 8 drop, `_finite_float`, per-day sums). Plan 03 inserts the ccy check after the type-8 `continue`. Note `fetch_daily_pnl` returns `[]` after the walk only through the outer handler on an exception; a ccy refusal must `return []` itself.
- The cron passes no deadline today; plan 04 owns that. The deadline flag now means "whole days of earlier windows, a contiguous oldest prefix".
- `test_okx_funding_bills_excluded_from_daily_pnl` fixture now carries `ccy`; the other `test_exchange.py` fixture without `ccy` (`B1..B3`, `billType` 8 not `type`) still has none and plan 03 must handle it.

## Known Stubs

None.

## Threat Flags

None. `OkxBillsWindowIncomplete` texts hold no digit and no venue text (`test_the_refusal_text_carries_no_digits`); page errors keep `scrub_freeform_string`.

## Self-Check: PASSED

- Files exist: `analytics-service/tests/test_okxtrades_walk.py`, `analytics-service/services/exchange.py` (class `OkxBillsWindowIncomplete` count 1), `analytics-service/tests/_okx_bills.py` (`reach_floor_ms` count 6).
- Commits are ancestors of HEAD: cdf4e87c4, 80c8f2911, 969f413c5.
- `services/job_worker.py` and `routers/cron.py` unchanged against the base (`git diff --quiet` exit 0); STATE.md and ROADMAP.md untouched.
- Acceptance greps: `should_fetch_archive` and `three_months_ago_ms` outside comments 0; `OKX_BILLS_PAGE_CAP: int = 100` and `OKX_ARCHIVE_PAGE_CAP: int = 100` 1 each; `OKX_BILLS_WINDOW_DAYS: int = 7` 1; `_okx_bills_window_read(` 2; flipped test has no `assert_not_awaited`.
- Final `services/exchange.py` byte-identical to the pre-neuter backup after N8 (`cmp` exit 0); mypy strict clean; census 2608 passed, 1 skipped.
