---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 05
subsystem: analytics-service
tags: [derivegaps, fetch_daily_pnl, page-caps, deadline, dq-flags, bybit]
requires: ["186-04"]
provides:
  - "OKX_BILLS_PAGE_CAP, OKX_ARCHIVE_PAGE_CAP, BYBIT_PNL_PAGE_CAP, BYBIT_CLOSED_PNL_LIMIT, DAILY_PNL_READ_DEADLINE_S, _monotonic as module constants in services/exchange.py"
  - "daily_pnl_read_verdict(flags) -> DailyPnlReadVerdict, DAILY_PNL_RATE_LIMIT_CLASSES: the derive's single reader of the realized DQ buffer"
affects: [186-09, 186-10, 186-13]
key-files:
  created:
    - analytics-service/tests/test_daily_pnl_read_verdict.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_exchange_harness.py
    - analytics-service/tests/test_derivegaps_probe.py
key-decisions:
  - "D-06: caps stay at the SC-1 values (g1-caps); the deadline ends the OKX bills, OKX archive and Bybit window walks with the same truncated flag a cap hit sets"
  - "D-05: daily_pnl_read_verdict is pinned to cron's _fetch_degradation and the OKX archive job's _check_live_realized_flags by a 96-combination parity test; neither older reader was touched"
  - "D-10: Bybit closed-pnl requests send 100 (g1-bybit-limit: set-100)"
status: complete
commits: 2
plan_head_before: f10dde76be73645a7c529ffb00c9c47916190f3b
plan_head_after: a7f2398aa14b729417f27438fc83c86c1660d35c
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 186 Plan 05: Sized caps, read deadline and the shared daily-pnl verdict Summary

The realized read's three page caps, a 397-second read deadline and the Bybit page size are now module constants in `services/exchange.py`, and `daily_pnl_read_verdict(flags)` is the derive's one reader of the DQ buffer, pinned by a 96-combination parity test to the trade sync's and the OKX archive job's readings.

## Values (copied from 186-04-SUMMARY `g1-caps` / `g1-bybit-limit`)

| Constant | Value |
|---|---|
| `OKX_BILLS_PAGE_CAP` | 100 |
| `OKX_ARCHIVE_PAGE_CAP` | 100 |
| `BYBIT_PNL_PAGE_CAP` | 50 (per 7-day window) |
| `DAILY_PNL_READ_DEADLINE_S` | 397.0 |
| `BYBIT_CLOSED_PNL_LIMIT` | 100 (was a literal 200) |

Parity test combination count: **96** (fetch_error 2 x error class 6 x truncated_okx 2 x truncated_bybit 2 x income fallback 2), each run through `daily_pnl_read_verdict`, `_fetch_degradation` and `_check_live_realized_flags`.

## Tasks

1. Tracer: OKX bills cap as a module constant read at call time, the entry-stamped deadline checked before every bills page, the shared verdict, and the parity test file. Commit `714d1ac97`.
2. Archive and Bybit walks: sized caps, the same deadline before every archive page and every Bybit page (a Bybit deadline also ends the remaining 7-day windows), `limit` sends `BYBIT_CLOSED_PNL_LIMIT`, and the "must propagate to _stamp_429 path" comment now says the outer handler swallows a Bybit rate limit and it reaches the caller only as `daily_pnl_fetch_error_class`. Commit `a7f2398aa`.

## RED before GREEN

- Task 1: the verdict file failed at collection (names did not exist); the two new harness tests FAILED (`red-05-1.log`). Deadline test neutered from a byte backup (`if False and ...`): FAILED, restored, `cmp` equal.
- Task 2: five new tests FAILED on the Task 1 tree (archive cap, archive deadline, Bybit cap, Bybit deadline, Bybit page size; `red-05-2.log`). All three deadline tests (OKX bills, archive, Bybit) neutered together: all three FAILED, restored, `cmp` equal.
- The exact-multiple-at-the-cap test is a pin of the ACCEPTED over-refusal from RESEARCH (a walk cannot tell a history that ends on the last full page from one that continues). It passes against the Task 1 code by construction; it is a behaviour pin, not a RED proof.

## Verification

- `pytest tests/test_daily_pnl_read_verdict.py tests/test_exchange_harness.py tests/test_cron_router.py tests/test_okx_archive_job.py`: 497 passed.
- Full suite `python -m pytest -q -n auto --dist loadgroup`: first run 1 failed, 13652 passed, 97 skipped (the failure is the deviation below); after the fix `tests/test_derivegaps_probe.py` is 115 passed and no other file changed.
- CI mypy line: `Success: no issues found in 131 source files`.
- `routers/cron.py` and `services/okx_archive_job.py` unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Probe continuation test asserted the retired page size**
- **Found during:** full-suite run after Task 2
- **Issue:** `tests/test_derivegaps_probe.py::test_continuation_sizes_a_bybit_window_past_its_page_cap` asserted `limit == 200`, observed from the production walk's own request, which D-10 changed to 100.
- **Fix:** the assertion now reads `BYBIT_CLOSED_PNL_LIMIT`. The probe's `measure_bybit_limit` (which sends both 200 and 100 on purpose) is untouched.
- **Files modified:** `analytics-service/tests/test_derivegaps_probe.py` (outside the plan's `files_modified`; a direct consequence of D-10)
- **Commit:** `a7f2398aa`

### Notes

- `import time` was added at the top of `services/exchange.py` as the plan says; the pre-existing mid-module `import time` (Phase 19 mark-price cache) was left alone, so the module now imports `time` twice. Harmless; not cleaned up (surgical-changes rule).
- `re`, `Callable`, `Mapping` and `NamedTuple` imports were added for the verdict and the clock.

## Known Stubs

None.

## Threat Flags

None. T-186-12 (deadline ends the walk with the truncated flag, no `TimeoutError`) and T-186-13 (class kept only when it matches the identifier regex) are both mitigated and tested.

## Self-Check: PASSED

- `analytics-service/tests/test_daily_pnl_read_verdict.py`: FOUND
- Commits `714d1ac97` and `a7f2398aa`: both ancestors of HEAD
