---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 01
subsystem: analytics-service money math (MT5 timed-day cohorts)
tags: [mt5, twr, nav_twr, cohort, MT5D-04, MT5D-06]
requires: []
provides:
  - "_judged_cohorts skips an empty cohort 0 whenever a later cohort of the same timed day holds P&L (MT5D-04)"
  - "D-15 band acceptance recorded (MT5D-06), ratio unchanged"
affects: [analytics-service/services/nav_twr.py, analytics-service/tests/test_nav_twr.py, plan 229-04 soak oracle]
key-files:
  modified:
    - analytics-service/services/nav_twr.py
    - analytics-service/tests/test_nav_twr.py
decisions:
  - "An empty cohort 0 is skipped on every day when a later cohort holds P&L (CONTEXT 2026-11-24, Empty cohort 0)"
  - "FLOW_TIMING_LARGE_RATIO stays exactly 1.0 (founder ruling 2026-11-24, Keep 1.0, accept band)"
metrics:
  tasks: 3
  completed: 2026-11-24
status: complete
actuals:
  tokens: 14000
  tasks: 3
  commits: 2
plan_head_before: 13872bbc0ab2258927b3c100d92c004ab2095825
plan_head_after: cdb45a91a3d169616ca62c68468eacbc5eb0edd2
requirements: [MT5D-04, MT5D-06]
---

# Phase 229 Plan 01: Empty cohort 0 and the D-15 band Summary

A timed re-funding day into an emptied MT5 account is now measured on its re-fund cohort (50 / 1,000 = 0.05 on the tracer ledger) instead of being dropped as `negative_nav_guard` and cutting the headline chain; the D-15 band is recorded as accepted with `FLOW_TIMING_LARGE_RATIO` still exactly 1.0.

`commits: 2` and `plan_head_after` are measured at SUMMARY write and exclude the docs commit that carries this file.

## What changed

- `_judged_cohorts` (services/nav_twr.py): a local `later_judged` is true when any cohort with index 1 or more holds non-zero P&L. A cohort with zero P&L is skipped when `k > 0`, or the day is an inception day, or `later_judged` is true. A cohort 0 with P&L is always judged on the start-of-day base; a day with no later P&L is judged exactly as before. Docstring and inline comment rewritten to state the rule, that it applies on every day, and that 188's tiny-base test still runs afterwards on the day's starting NAV at the `chain_linked_twr` call site (not edited).
- Tests (tests/test_nav_twr.py): the end-to-end tracer through `combine_mt5_deal_ledger`, three direct `_timed_day_return` arms, an 8-row chain-level table (re-fund classes plus 188 precedence), and `test_an_empty_cohort_zero_is_skipped_with_or_without_full_history` replacing the moved half of the inception pin. Expected values are typed from `Fraction` arithmetic; no `nav_twr` helper is imported into any oracle.
- No edit to `_timed_day_return`, the tiny-base block, the D-25 recomputation, either soak file, `FLOW_TIMING_LARGE_RATIO`, or anything under `analytics-service/tests/fixtures` (verified: `git diff --quiet` on fixtures exits 0, soak files unchanged, `regen_golden.py` never run).

## Commits

- 017362d23 feat(229-01): publish a re-fund day into an emptied MT5 account (MT5D-04)
- cdb45a91a test(229-01): pin every re-fund class, 188 precedence, and the moved inception arm (MT5D-04)

## HEAD RED reading of the tracer (before any source edit, base 13872bbc0)

```
tests/test_nav_twr.py:2306: in test_a_refund_into_an_emptied_mt5_account_is_published_end_to_end
    assert by_day[d3] == pytest.approx(float(Fraction(50, 1000)), abs=1e-12)
E   assert nan == 0.05 ± 1.0e-12
E     comparison failed
E     Obtained: nan
E     Expected: 0.05 ± 1.0e-12
1 failed in 4.61s
```

Scratch probe of the same ledger at HEAD: returns `2026-10-01 0.01 / 2026-10-02 0.00 / 2026-10-03 NaN / 2026-10-04 0.02`; guard and break meta keys `['negative_nav_guard', 'twr_chain_broken']`. Day 4 reads 0.02 (the suffix) at HEAD and 21/1050 after the fix.

## PROOF-01 (neuter, RED, restore by cp and cmp, GREEN), all verbatim

Method: the fixed `nav_twr.py` was copied byte for byte to a backup outside the repository, `or later_judged` was removed from the skip test in place (`sed`), the gate was run, the file was restored with `cp`, `cmp` was run (silent, exit 0), then the gate was rerun.

### Task 1 tracer

Neutered, RED on the day-3 arm first:
```
tests/test_nav_twr.py:2306: in test_a_refund_into_an_emptied_mt5_account_is_published_end_to_end
    assert by_day[d3] == pytest.approx(float(Fraction(50, 1000)), abs=1e-12)
E   assert nan == 0.05 ± 1.0e-12
E     comparison failed
E     Obtained: nan
E     Expected: 0.05 ± 1.0e-12
FAILED tests/test_nav_twr.py::test_a_refund_into_an_emptied_mt5_account_is_published_end_to_end
1 failed in 4.56s
```
After `cp` restore: `cmp services/nav_twr.py <backup>` printed nothing, `cmp exit 0`. GREEN:
```
.                                                                        [100%]
1 passed in 4.51s
```

### Task 2 class arms (neutered, then GREEN)

Neutered:
```
test_a_refund_into_an_emptied_mt5_account_is_published_end_to_end FAILED
test_timed_empty_cohort_zero_is_skipped_when_a_later_cohort_is_judged[0.0-expected0] FAILED
test_timed_empty_cohort_zero_is_skipped_when_a_later_cohort_is_judged[-0.5-expected1] FAILED
test_timed_empty_cohort_zero_is_skipped_when_a_later_cohort_is_judged[5.0-expected2] FAILED
test_timed_cohort_zero_with_pnl_is_still_judged PASSED
test_timed_flow_only_day_on_an_emptied_account_keeps_its_guard PASSED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[0.0-10100.0-expected0-None] FAILED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[-0.5-10100.0-expected1-None] FAILED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[5.0-10100.0-None-tiny_base_guard] FAILED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[150.0-10100.0-None-tiny_base_guard] PASSED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[400.0-10100.0-None-tiny_base_guard] PASSED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[50.0-100.0-expected5-None] FAILED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[5.0-100.0-expected6-None] FAILED
test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[4.0-100.0-None-tiny_base_guard] FAILED
test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit PASSED
test_an_empty_cohort_zero_is_skipped_with_or_without_full_history FAILED
11 failed, 5 passed, 156 deselected in 4.99s
```
After restore: `cmp` silent, `cmp exit 0`. GREEN: `16 passed, 156 deselected in 4.46s` (every node above PASSED).

The prev-0 direct arm, the prev-50/peak-100 chain arm and the without-full-history arm each fail first, as required. Cohort-0-with-P&L, flow-only and the mover's first half stay green under the neuter because they pin the UNCHANGED behaviour.

### Task 3 band pin (`FLOW_TIMING_LARGE_RATIO` set to 0.5 in place)

Neutered, the 999.99 arm fails (and -999.99):
```
test_f1_large_flow_boundary_is_the_retired_dominance_condition[1000.0-True] PASSED
test_f1_large_flow_boundary_is_the_retired_dominance_condition[-1000.0-True] PASSED
test_f1_large_flow_boundary_is_the_retired_dominance_condition[5000.0-True] PASSED
test_f1_large_flow_boundary_is_the_retired_dominance_condition[999.99-False] FAILED
test_f1_large_flow_boundary_is_the_retired_dominance_condition[-999.99-False] FAILED
test_f1_large_flow_boundary_is_the_retired_dominance_condition[50.0-False] PASSED
test_f1_large_flow_boundary_is_the_retired_dominance_condition[0.0-False] PASSED
E   AssertionError: assert ('flow_timing_day_level_large' in {'flow_timing_day_level': True, 'flow_timing_day_level_days': 1, 'flow_timing_day_level_large': True, 'flow_timing_day_level_large_days': 1}) is False
2 failed, 5 passed in 4.49s
```
After restore: `cmp` silent, `cmp exit 0`. GREEN: `7 passed in 4.42s`. `grep -a -c '^FLOW_TIMING_LARGE_RATIO = 1.0$'` on nav_twr.py prints 1.

## MT5D-06 acceptance record (D-15 band)

- Ruling: founder, 2026-11-24, quoted from CONTEXT: "Keep 1.0, accept band (Recommended)".
- Reason: the root fix for a day-level venue is intraday timing, which stays open as `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`; a lower ratio had no measured fleet rationale.
- `FLOW_TIMING_LARGE_RATIO` stays exactly 1.0; `nav_twr.py` received no code, comment or copy change for MT5D-06; the factsheet copy is unchanged. The comparison is the exact float test `abs(flow) >= FLOW_TIMING_LARGE_RATIO * prev` with no tolerance, so equality (1,000.0 on 1,000) is annotated and 999.99 is not; the pin proves it can fail.
- `[164.6.6.2.3-D15-THRESHOLD-BAND]` closes on this record at ship.

## The moved pin (deleted assertions, quoted verbatim)

`test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit` previously ended with:
```python
    off, off_meta = reconstruct_nav_and_twr(_pnl([0.011, 0.002]), **kwargs)
    assert np.isnan(off.loc[day0])
    assert "dust_nav_guard" in off_meta or "negative_nav_guard" in off_meta
```
and its docstring said that without `full_history` the record "is judged on a base of (about) zero and keeps its guard - the rule is opt-in". Moved by the ruling in CONTEXT "Decided autonomously", Empty cohort 0 (founder-ruled, recorded 2026-11-24), and ROADMAP SC-1: an empty cohort 0 is skipped whenever a later cohort holds P&L, on every day. The replacement is `test_an_empty_cohort_zero_is_skipped_with_or_without_full_history`, which asserts day 0 is about 0.011 (abs 1e-9) with no guard key in BOTH runs. It is a new invariant, not a re-pinned value, and it is RED under the neuter above.

## Second-order effect (D-25)

The `small_base_measured` recomputation at the `chain_linked_twr` call site calls `_judged_cohorts` again and follows the new rule by construction. An empty cohort 0 no longer contributes its start-of-day base to `small_base_measured_min_nav`, which is intended: that base was never measured. Not edited.

## Neighbour suites, soak, mypy

Selected neighbours (test_nav_twr, test_broker_dailies, test_mt5_deal_reconstruction, test_native_nav, test_mt5_derive_branch, test_golden_parity, test_mt5_golden_fixtures), `-n 4 --dist loadgroup`:
```
647 passed, 53 warnings in 12.38s
```

Soak (`tests/test_mt5_soak.py`), the one expected node, handed to plan 229-04:
```
    def test_one_checked_day_among_knife_edge_sweep_days_is_not_green(first_deposit, drain):
        deals, balance = _funded_each_morning_and_swept_each_evening(first_deposit, drain, 5)
        parity = _reconcile(_make_factory(equity=balance, balance=balance, deals=deals))
        check = parity["return_check"]
        # The series is honest, so nothing is a mismatch; the run is red on its coverage alone.
>       assert check["mismatch_count"] == 0, check["mismatches"]
E       AssertionError: [{'day': '2025-10-04', 'kind': 'timed_day_not_nan', 'expected': None, 'actual': 0.014000000000000012}, {'day': '2025-1...999999999999904}, {'day': '2025-10-08', 'kind': 'timed_day_not_nan', 'expected': None, 'actual': 0.018000000000000016}]
E       assert 5 == 0

tests/test_mt5_soak.py:2752: AssertionError
FAILED tests/test_mt5_soak.py::test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]
1 failed, 157 passed in 5.02s
```
Exactly one node fails, with `timed_day_not_nan`. The soak's own oracle still encodes the old rule, which is evidence it is independent. Neither soak file was edited; plan 229-04 owns that node.

mypy strict (CI command from 229-VALIDATION.md): `Success: no issues found in 142 source files`.

## Deviations from Plan

### Measured differences (no code deviation)

**1. [Plan claim corrected] The prev 4 / peak 100 arm does not stay green under the neuter.**
- **Found during:** Task 2 PROOF-01
- **Issue:** The plan said the tiny-precedence arms (prev 150, 400, 4) stay green under the neuter. Only 150 and 400 do. At prev 4 against a 100 peak, the pre-fix rule reads `dust_nav_guard` (4 is under the USD dust floor 100) and the new rule reads `tiny_base_guard`, the same label change as prev 5 against a 10,100 peak. The day is left out under both rules, so the arm pins that 188 still wins after the fix and that the label is `tiny_base_guard`.
- **Fix:** none needed; the test is correct under the new rule. Recorded here so the neuter table above is not misread.
- **Files modified:** none

Otherwise, plan executed as written. No auto-fixes (Rules 1-3), no auth gates, no architectural changes.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file access or schema surface.

## Assumptions carried (from the plan)

- A-01-1: "empty" means the cohort's summed P&L is exactly 0.0; a later cohort whose positions cancel exactly counts as holding no P&L.
- A-01-2: `later_judged` reads P&L only, not the guards; a later cohort that holds P&L but whose own base is guarded still makes cohort 0 skippable, and the day breaks on that cohort's own guard.
- A-01-3: which live MT5 days move is not measured here; the post-deploy recompute and the live soak (plan 229-06) are the evidence.

## Self-Check: PASSED

- analytics-service/services/nav_twr.py (`later_judged` count 2), analytics-service/tests/test_nav_twr.py (all five new tests present, `off_meta` count 0): found.
- Commits 017362d23 and cdb45a91a are ancestors of HEAD.
