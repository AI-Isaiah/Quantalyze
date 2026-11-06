---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 04
subsystem: analytics-service
tags: [tiny-base, quiet-days, nav-combiners, d-08, sc-2, sc-5]
requires: ["188-02"]
provides:
  - "chain_linked_twr names a quiet day (absent from the sparse NAV index) on a near-empty account"
  - "_leave_out_tiny_base_days: the three NAV combiners leave a named quiet day NaN, never a flat 0.0"
affects: [key-mode-derive, allocator-equity-compose]
key-files:
  created:
    - analytics-service/tests/test_tiny_base_quiet_days.py
  modified:
    - analytics-service/services/nav_twr.py
    - analytics-service/services/broker_dailies.py
    - analytics-service/tests/test_tiny_base_realized.py
key-decisions:
  - "D-08 (founder 2026-11-03, 'Yes, leave them out too') is what ran: every calendar day under the threshold is treated the same, active or quiet."
  - "A quiet day is judged on the level carried into it (the earlier index day's NAV) and the same 30-day window peak, with one window_peaks call over index days and quiet days together."
  - "The helper runs after gap_fill_daily_returns because the fill only adds labels; a malformed or absent list changes nothing."
status: complete
commits: 5
plan_head_before: 906f03829e4aa309988179f87d22bb2d3be61f8d
plan_head_after: 337f706d92012ce84a43c43f807468462d7e1054
actuals:
  tokens: 70000
  tasks: 2
  commits: 5
duration: two sessions (a checkpoint between them)
completed: 2026-11-03
---

# Phase 188 Plan 04: a quiet day on a near-empty account is judged like every other day

**A day with no trade, funding or flow on a near-empty account is now named by the NAV core and left NaN by every NAV combiner (OKX, Bybit, Binance, Deribit, MT5), instead of being gap-filled to a flat 0.0 return.**

D-08 is what ran. In the realized era the NAV index is sparse, so `chain_linked_twr` never judged such a day and the combiners wrote it as r = 0.0, a flat day counted in the stats against a base under 5% of the 30-day peak.

## What was built

- `services/nav_twr.py`, `chain_linked_twr`: before plan 02's one `window_peaks` call, the calendar days strictly between two consecutive index entries are collected and passed to that same call with the index days (still one call). After the loop, each quiet day whose carried level `nav_vals[t - 1]` is finite and tiny is listed in `tiny_base_days` (merged ascending with the measured days), given 0.0 in `tiny_base_day_pnl`, and raises `tiny_base_guard`. The returned series keeps `nav.index` exactly; days before the first or after the last index day are never judged. One docstring paragraph added. The only deleted line is plan 02's `peaks = window_peaks(level_map, day_isos)` line.
- `services/broker_dailies.py`: private `_leave_out_tiny_base_days(returns, meta)` directly after `gap_fill_daily_returns` (returns a copy with every day in `meta["tiny_base_days"]` set to NaN), and ONE added line `returns = _leave_out_tiny_base_days(returns, meta)` after each of the three NAV-path gap fills: `combine_realized_and_funding`, `combine_native_ledger` (NAV path, return path 2), `combine_mt5_deal_ledger`. Additions only (0 deleted lines). The allocated-capital branch (`ac_returns`), the MT5 empty-ledger early return, `gap_fill_daily_returns` and `combine_sfox_balance_history` are untouched.
- `tests/test_tiny_base_quiet_days.py` (12 arms). Core: quiet days after a withdrawal named with 0.0 P&L, not-tiny partner unlisted, roll-off on a quiet stretch (29 days listed, 03-03 not), NaN carried level names nothing, edges and no duplicate. Venues (ids `ccxt`, `deribit`, `mt5`): the tiny shape through the REAL combiners gives NaN on the three quiet days, never 0.0, meta lists them, every unnamed day is exact-equal to the helper-disabled run; the not-tiny shape stays 0.0 and the whole series equals the helper-disabled run; one arm pins that the allocated-capital branch and sFOX never call the helper.
- How each venue's quiet-day ledger was built (the ledgers live in the test module because `_mt5_deals` asserts a trading deal every day and cannot build a quiet day): the same hand-integer account on all three (funding of 99950 and P&L entries through January, withdrawal on 02-01, nothing on 02-02..02-04, +4 on 02-05). ccxt: `daily_pnl` records for nonzero P&L days plus `external_flows` tuples. deribit: a `NativeLedger` with a P&L series only on entry days and `ExternalFlow` rows. mt5: type-2 balance deals for flows and type-1 trade deals for P&L only on entry days. A quiet day carries no entry at all on every venue.

## TDD record

- RED 1 (`fb9276b0c`, `/tmp/tinybase-04/red1.log`): 2 failed (quiet-day arm, roll-off arm), 3 passed. GREEN `07b91de82`. Neuter drill 1 (`/tmp/tinybase-04/neuter1.log`, quiet-day record no-op'd): the same 2 arms FAILED; restored with `cp`, `cmp` clean.
- RED 2 (`a00c5ebdb`, `/tmp/tinybase-04/red2.log`): 3 failed (`test_a_quiet_tiny_day_is_nan_never_zero_on_every_nav_combiner` for ccxt, deribit, mt5, each on `AssertionError: 2026-02-02`: the filled day was 0.0), 9 passed (the meta assertion before it already held from Task 1). GREEN `337f706d9`. Neuter drill 2 (`/tmp/tinybase-04/neuter2.log`, helper made `return returns` first): the same 3 arms FAILED, 9 passed; restored with `cp`, `cmp` clean.

## Verification

- Full CI pytest line (`-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`): 13488 passed, 97 skipped, coverage 94.51% (baseline 13476 passed, 97 skipped, 94.51%).
- CI mypy line: `Success: no issues found in 132 source files`.
- Acceptance: helper call sites `grep -ac` = 3 (baseline 0); `returns = gap_fill_daily_returns(returns)` still 3; `ac_returns = gap_fill_daily_returns(ac_returns)` still 1; `_leave_out_tiny_base_days(ac_returns` 0; `broker_dailies.py` deleted lines 0; `nav_twr.py` deleted lines outside plan 02's `window_peaks` call 0; no diff in `job_worker.py`, `allocator_equity_compose.py`, `allocator_equity_derive.py`.

## Deviations from Plan

### Approved by the orchestrator (the plan's STOP rule fired once)

**1. [STOP rule - existing test newly failed] `test_a_peak_that_sits_before_a_gap_in_the_nav_index_still_counts` lists the quiet day**
- **Found during:** Task 1 full-suite run (the only existing test that newly failed).
- **Issue:** the plan 02 fixture (index offsets 0, 1, 31, 33 from 2026-02-01; levels 100000, 100000, 400, 588) has a quiet day at offset 32 (2026-03-05) carried at 400, under 5% of the 100000 peak. After this plan that day is listed, so the exact-list expectation no longer held.
- **Fix:** edited only that test's exact-list expectations to `tiny_base_days == ["2026-03-05", "2026-03-06"]` and `tiny_base_day_pnl == {"2026-03-05": 0.0, "2026-03-06": 188.0}`, and added a docstring note that 2026-03-05 is a quiet day listed by plan 04 under 188 D-08. Its peak-across-the-gap intent and its NaN assertion on the offset-33 return are unchanged.
- **Why:** a direct consequence of the founder's recorded 188 D-08 on a test written in this phase by plan 02; approved by the orchestrator. No decision of an earlier phase conflicts.
- **Files modified:** `analytics-service/tests/test_tiny_base_realized.py`
- **Commit:** `45f274278`

No other existing test newly failed.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface.

## Self-Check: PASSED

- Files exist: `analytics-service/tests/test_tiny_base_quiet_days.py`, `analytics-service/services/nav_twr.py`, `analytics-service/services/broker_dailies.py`, `analytics-service/tests/test_tiny_base_realized.py`.
- Commits reachable from HEAD: `fb9276b0c`, `07b91de82`, `45f274278`, `a00c5ebdb`, `337f706d9`.
