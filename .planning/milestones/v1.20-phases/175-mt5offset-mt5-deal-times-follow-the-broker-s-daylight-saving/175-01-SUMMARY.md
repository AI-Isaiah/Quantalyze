---
phase: 175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving
plan: 01
subsystem: analytics-service
tags: [mt5, dst, server-clock, nav-marks, zoneinfo-oracle]
status: complete

requires:
  - phase: 167.2.1.1.1 NAVMTM
    provides: apply_marks rule 10 (D-23 flow placement against a mark's read)
  - phase: 164.6.6.2.3 FLOWTIMING
    provides: the one MT5 server-time seam (deal_utc_day, deal_utc_instant_ms)
provides:
  - "services/mt5_server_clock.py: Mt5ServerClock (eu, us, fixed), per-deal offset lookup, resolve_mt5_server_clock, Mt5ServerClockConfigError"
  - "the seam widened to int | Mt5ServerClock with one offset lookup per deal"
  - "the SC-2 anchor: the WR-02 winter deposit publishes +2% under the rule and 0.549804 under the fixed 10800"
affects: [175-03 derive wiring, 175-04 dry-run script, 175-05 backfill wiring, 175-06 post-deploy switch]

actuals:
  tokens: 11600
  tasks: 3
  commits: 3
plan_head_before: 9ca329b00983bf5b6f6d08d6ba637f314e7868dd
plan_head_after: 1a5d5a5357fbe8a7d1fb81032fc681be76dc042c

tech-stack:
  added: []
  patterns:
    - "candidate-based DST inversion: try both offsets, keep those consistent with the UTC transition window (one = ordinary, two = repeated hour, none = skipped hour)"
    - "stdlib-only leaf imported by the seam, pinned by an ast import test"

key-files:
  created:
    - analytics-service/services/mt5_server_clock.py
    - analytics-service/tests/test_mt5_server_clock.py
  modified:
    - analytics-service/services/mt5_deals.py
    - analytics-service/tests/test_mt5_deal_timing.py

key-decisions:
  - "Tie-break (D-07): repeated hour dates by the first occurrence (UTC+3), skipped hour by the pre-transition offset (UTC+2), instant None in both; the UTC day provably cannot differ between candidates (property 2007-2099)"
  - "Reading of RESEARCH Open Question 1: the fixed integer alone IS a configured clock; fail loud only for neither set, unknown id, both set, malformed or beyond 13 h"
  - "Rule years are 2007-2099; outside that the seam raises its existing out-of-range text"

requirements-completed: [SC-2, D-01]
---

# Phase 175 Plan 01: MT5 broker clock follows the DST rule Summary

A pure stdlib `Mt5ServerClock` (rules `eu`, `us`, and the fixed form) now sits behind the one MT5 deal seam, so a winter deposit made after a mark's read is filed on its own day with its true instant, and one fail-loud resolver turns the worker setting into that clock.

## What was built

- `services/mt5_server_clock.py` (new leaf, stdlib only): `Mt5ServerClock` with `candidates`, `day_offset_s`, `instant_offset_s`; `fixed_server_clock`, `server_clock_for_rule`, `resolve_mt5_server_clock`; `Mt5ServerClockConfigError` (a direct `Exception` subclass, never a `Mt5DealClassificationError`); `MT5_SERVER_CLOCK_CONFIG_MESSAGES` (closed set of four texts, variables and allowed ids only). Window per (rule, year) memoized with `lru_cache`; the environment read is never cached.
- `services/mt5_deals.py`: `_require_offset_seconds` replaced by `_server_clock` (int wrapped as the fixed form, clock passed through, bool/float/str/None rejected with one text naming both accepted forms); one private `_deal_offsets` helper looks the offset pair up once from the deal's own wall second and maps the clock's ValueError/OverflowError/OSError to the existing out-of-range text. `deal_utc_day` and `deal_utc_instant_ms` widened to `int | Mt5ServerClock`; the instant is None when the instant offset is None; the day-agreement oracle is kept. The WR-02 "exact either way" known-limit paragraph is rewritten and the module header names the new stdlib leaf.
- Tests: `tests/test_mt5_server_clock.py` (new, 56 cases) and 19 new seam cases in `tests/test_mt5_deal_timing.py`.

## Verification (measured)

- RED before GREEN (Task 1): with `services/mt5_server_clock.py` absent, `pytest tests/test_mt5_server_clock.py -k mark` stopped at collection with `ModuleNotFoundError: No module named 'services.mt5_server_clock'` (`1 error`, `ERROR tests/test_mt5_server_clock.py`; no test could be collected, so the failing tests are the four test functions the module was written to carry: `test_mark_placement_winter_deposit_follows_the_dst_rule`, `test_mark_placement_winter_rows_are_one_two_percent_step`, `test_mark_placement_fixed_10800_control_reproduces_wr02` and `test_mark_placement_summer_deposit_agrees_with_the_fixed_10800`).
- GREEN (Task 1 `-k mark` run): `7 passed`; with the int callers `tests/test_mt5_deal_timing.py tests/test_mt5_deal_reconstruction.py tests/test_mt5_soak.py tests/test_flowtiming_dry_run.py`: `408 passed`.
- Task 2/3 gate runs: `tests/test_mt5_server_clock.py tests/test_mt5_deal_timing.py`: `102 passed`; with `tests/test_mt5_deal_reconstruction.py`: `390 passed`; plus soak, dry-run and `test_mt5_derive_branch.py`: `534 passed`. No skips.
- Oracle: both rules matched `zoneinfo` (`Europe/Athens`; `America/New_York` plus 7 h) at every quarter-hour 2024-01-01 to 2029-12-31 (210,432 per rule, 420,864 total, floor asserted at 210,000 per rule), with exactly 48 repeated-or-skipped quarter-hours per rule. Day invariance asserted for 93 years x 4 transitions x 2 edges = 744 hour edges.
- RED drill (Task 3), neuter and restore from a byte backup: `_deal_offsets` forced to `(10800, 10800)` for any clock. Neutered `-k mark` run: `3 failed, 45 passed, 8 deselected`; the failures were `test_mark_placement_winter_deposit_follows_the_dst_rule[us]`, `test_mark_placement_winter_deposit_follows_the_dst_rule[eu]` and `test_mark_placement_winter_rows_are_one_two_percent_step` (rows 0.04 and 0.490196 instead of 0.02 and 0.0); the control and the summer cases passed. Restore by copying the backup back: `cmp` exit 0, `git status` showed `mt5_deals.py` unmodified, restored `-k mark` run: `48 passed, 8 deselected`; control and summer subset `6 passed`.
- mypy (CI line verbatim from `analytics-service/`): `Success: no issues found in 124 source files` (123 at planning time plus the new module).

## Deviations from Plan

None - plan executed as written. Notes that are not deviations:

- The first draft of the winter true-instant literal (epoch milliseconds) was mistyped; the first collection run failed on the missing module before it was exercised, and it was corrected against a computed value before any commit.
- The pre-commit branch allow-list in the executor protocol expects an `agent-*` branch name; the work ran on the caller-assigned `wt/175-p01` in a linked worktree (not a protected branch, never main or `feat/175-mt5offset`), as instructed.
- `-k mark` also selects pytest-marked cases of other names, so the Task 1 command counts 48 passing tests after Task 3 rather than only the four SC-2 functions.

## Known Stubs

None.

## Threat Flags

None. The resolver is a new read of an operator-set environment pair; T-175-03 and T-175-04 cover it (closed value-free messages, no caching, both-set refusal) and the tests pin each.

## Open items for later plans

- Plans 03 and 05 replace the seven `int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0"))` reads with `resolve_mt5_server_clock`, add the suite-wide autouse default for tests that leaned on the silent `"0"` (RESEARCH Pitfall 2), and add the single-reader source pin. Nothing in this plan reads the variable outside the resolver, and `broker_dailies.py` annotations are untouched (plan 03).
- `fixed_server_clock` accepts any int; the 13 h bound is enforced by the resolver only (the seam still takes any int, byte-identical to before).

## Self-Check: PASSED

- FOUND: analytics-service/services/mt5_server_clock.py, analytics-service/tests/test_mt5_server_clock.py (created); analytics-service/services/mt5_deals.py, analytics-service/tests/test_mt5_deal_timing.py (modified)
- FOUND commits: aa746f7a1, 83e8c99c7, 1a5d5a535 (all ancestors of HEAD)
