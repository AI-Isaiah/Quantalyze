---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 02
subsystem: analytics-service
tags: [tiny-base, nav-twr, realized-era, venues, exact-oracle]
requires: ["188-01"]
provides:
  - "chain_linked_twr tiny_base_guard: the fourth guard, checked last, day-level and timed paths"
  - "NAV_TWR_GUARD_KEYS gains tiny_base_guard; tiny_base_days and tiny_base_day_pnl are annotation keys"
  - "tiny_base_days / tiny_base_day_pnl present-only carries in _build_nav_meta and transforms._merge_status_meta"
  - "the exact-Fraction oracle book restates the rule (0 < prev < 1/20 * 30-day peak) as literals"
affects: [allocator-equity-compose, key-mode-derive, mt5-deal-reconstruction]
tech-stack:
  added: []
  patterns: ["guard family member checked last", "annotations separate from guard keys (amounts stay in-process)"]
key-files:
  created:
    - analytics-service/tests/test_tiny_base_realized.py
    - analytics-service/tests/test_tiny_base_venues.py
    - analytics-service/tests/test_tiny_base_book.py
  modified:
    - analytics-service/services/nav_twr.py
    - analytics-service/services/transforms.py
    - analytics-service/tests/test_nav_twr.py
    - analytics-service/tests/test_allocator_equity_dropped_day_pnl.py
    - analytics-service/tests/test_mt5_deal_reconstruction.py
key-decisions:
  - "188 D-09 (founder 2026-11-03, 'New rule everywhere'): BTC-unit accounts follow the tiny-base rule; 164.6.6.2 D-25 is superseded for days under the threshold, still holds above it; D-24's 1e-7 floor unchanged."
status: complete
commits: 5
plan_head_before: 734fde535053e80b7da14f7b596ffe98cf313357
plan_head_after: 949d063ed4d951023f0895c15471e71c94e38bcd
actuals:
  tokens: 60000
  tasks: 2
  commits: 5
duration: two sessions (one stop for the founder decision)
completed: 2026-11-03
---

# Phase 188 Plan 02: the tiny-base guard in the realized era, on every venue

**In the realized era (every day before a key's first stored mark) a day whose starting NAV is positive and under 5% of the previous 30 calendar days' peak has no return on any venue: NaN, chain broken like every guard day, real P&L kept in `tiny_base_day_pnl`.**

## What was built

- `services/nav_twr.py`: `chain_linked_twr` computes the 30-day peaks once (`services.tiny_base.window_peaks`, day-0 base as the level the day before the first index entry) and applies `is_tiny_base(prev, peak)` as the fourth guard, checked LAST (negative and dust, then P&L-dominated, then tiny base). On a timed day it runs after `_timed_day_return`'s cohort guards and is judged on `prev`, never a cohort base (T-A1). Flags: `tiny_base_guard` (bool, joins `NAV_TWR_GUARD_KEYS`, promotes to `complete_with_warnings`), `tiny_base_days` and `tiny_base_day_pnl` (annotations, amounts in-process only, T-188-06).
- `services/transforms.py`: present-only carry of the two lists in `_merge_status_meta`, so OKX/Bybit/Binance (`combine_realized_and_funding`), Deribit (`combine_native_ledger`), sFOX (`combine_sfox_balance_history`) and MT5 (`combine_mt5_deal_ledger`) all reach the combiner meta.
- Tests: `test_tiny_base_realized.py` and `test_tiny_base_venues.py` (key C's realized shape through `chain_linked_twr` and all four venue combiners, NaN never 0.0); `test_tiny_base_book.py` (sole key and two keys leave the tiny days out, every level stays exact); the exact-Fraction oracle book restates the rule as independent literals and agrees with the real writer day for day on all six fixtures; registry pins updated (`test_nav_twr.py`: ten guard keys).

## Commits

| Commit | Message |
|---|---|
| 40677d5ee | test(188-02): RED - a realized-era day on a near-empty account is measured today |
| 04a862a60 | feat(188-02): a realized-era day on a near-empty account has no return, on every venue |
| bb716bffb | test(188-02): RED - the oracle book does not yet restate the tiny-base rule |
| 60062763e | test(188-02): the exact oracle restates the tiny-base rule and the book follows it |
| 949d063ed | test(188-02): the four D-25 tests restate the tiny-base rule (188 D-09) |

## Deviations from Plan

### Founder-resolved: [Rule 4 - architectural/decision] four 164.6.6.2 D-25 tests contradicted the new rule

- **Found during:** Task 1 full-suite run (the plan's designed STOP: "an existing test newly fails because its fixture sits under 5% of its 30-day peak").
- **Issue:** `test_mm2x_shape_every_small_balance_day_is_measured_and_exact` (x3 scale variants) and `test_wr01_post_withdrawal_tiny_base_is_measured_exactly_and_flagged` encoded 164.6.6.2 D-25 ("a day measured on a tiny base is kept exact and flagged, never breaks the chain, never drops the day") for BTC-unit accounts. The new rule leaves those days out.
- **Resolution:** the founder decided 2026-11-03 "New rule everywhere (Recommended)", recorded as 188-CONTEXT D-09 (feat/188-tinybase, commit ba72db824). Production code is unchanged; only the tests moved.
- **Fix (commit 949d063ed, `analytics-service/tests/test_mt5_deal_reconstruction.py`):**
  - mm2x (all three scales): the ten small-balance days 2025-10-25..2025-11-03 are asserted NaN and named in `tiny_base_days`, `tiny_base_guard` is True, NaN count is 1 + 10. Every OTHER day (including the 2025-10-24 near-total-withdrawal day, which starts on a large base) keeps its exact-Fraction assertion to 1e-12, unchanged. No measured day sits under 1e-4, so the `small_base_measured` branch is kept (still required for a measured day under 1e-4) and the flag is asserted absent.
  - wr01 (renamed `..._tiny_base_day_is_left_out_and_the_rest_measured_exactly`): 2025-06-04 (+500% on 1e-5) is NaN, `tiny_base_days == ["2025-06-04"]`, its P&L 5e-5 kept in `tiny_base_day_pnl`; days 2 and 3 stay exact (1/100 and 0).
  - Comments cite 188 D-09 and the superseded D-25; `test_small_base_flag_follows_the_material_equity_threshold` is untouched and still passes (D-25 holds for small-balance days above the threshold).
- **Follow-up owed outside this plan:** the dated "superseded" notes in 164.6.6.2 CONTEXT (D-24/D-25) and the ROADMAP, which D-09's option text promises.

Otherwise the plan executed as written.

## Verification

- `pytest -n auto --dist loadgroup` from `analytics-service/`: 13462 passed, 97 skipped (the same pre-existing skips as plan 01), 0 failed.
- mypy, CI line verbatim: `Success: no issues found in 132 source files`.
- `test_mt5_deal_reconstruction.py` alone: 264 passed.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; `tiny_base_day_pnl` holds amounts and stays in-process.

## Self-Check: PASSED

All five commits are ancestors of HEAD (`git rev-list --count 734fde535..HEAD` = 5); created test files exist; the working tree changes are limited to the plan's files plus this SUMMARY.
