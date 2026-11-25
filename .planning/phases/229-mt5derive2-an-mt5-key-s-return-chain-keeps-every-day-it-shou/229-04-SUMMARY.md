---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 04
subsystem: analytics-service
tags: [mt5, soak, cohort-walk, independent-oracle, knife-edge]
requires: [229-01]
provides:
  - "mt5_soak._walk_cohorts on the founder-ruled cohort-0 rule, written from the CONTEXT rule text"
  - "a re-fund-from-zero day is verified by the soak's own walk (timed_verified), not reported as timed_day_not_nan"
  - "the CR-04 knife-edge family on a fixture whose judged cohort base is on the knife edge"
affects: [226 soak, 229-06 soak entry check]
tech-stack:
  added: []
  patterns: ["oracle re-derived from rule text, checked against a hand Fraction walk"]
key-files:
  created: []
  modified:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py
key-decisions:
  - "The walk skips a zero-P&L cohort when k > 0, on an inception day, or when a later cohort holds P&L; a cohort with P&L is always judged; a day nothing else tests keeps its empty cohort 0"
  - "The old knife-edge builder was removed (nothing else used it) and replaced by one that opens each sweep position before the morning deposit"
requirements-completed: [MT5D-04]
duration: 40min
completed: 2026-11-24
status: complete
actuals:
  tokens: 15000
  tasks: 2
  commits: 2
commits: 2
plan_head_before: 728296d9924a8c60b485cb33436d090b7be1890a
plan_head_after: bc004deba2aec30aaf55acc8e80bb8d0410dece7
---

# Phase 229 Plan 04: the soak judges the changed derive with its own cohort-0 rule (MT5D-04)

The soak's `_walk_cohorts` was re-derived from the CONTEXT rule text ("Empty cohort 0", 2026-11-24) without opening `services/nav_twr.py` or plan 229-01's diff of it. A re-fund day into an emptied account is now verified by value under `timed_verified`, and the knife-edge family still refuses to certify days whose judged cohort base sits on the knife edge.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 (tracer) | end to end, the soak verifies a re-fund day into an emptied account with its own walk | `cca03f6e0` feat(229-04): the soak's cohort walk skips an empty cohort 0 whenever a later cohort holds P&L |
| 2 | the knife-edge family on a judged knife-edge base, every moved test accounted for | `bc004deba` test(229-04): knife-edge family on a judged knife-edge base |

## What changed

- `mt5_soak.py`: `_walk_cohorts` computes `later_cohort_has_pnl` (any non-zero P&L in the cohorts after this one) and skips a zero-P&L cohort when `k > 0`, on an inception day, or when a later cohort holds P&L. The docstring's "the one exception is the first cohort of a non-inception day" sentence is gone and states the rule with its 2026-11-24 CONTEXT citation. The `indeterminate` paragraph of `_reconcile_published_returns` matches. Nothing is imported from the production cohort code (`from services.nav_twr import UNREALIZED_MATERIALITY_RATIO` is the pre-existing constant import and is untouched).
- `test_mt5_soak.py`: tracer `test_a_refund_day_into_an_emptied_account_is_verified_by_the_soaks_own_walk` (day 3 re-fund, mismatch_count 0, `timed_verified == 2`, `parity_ok True`), `test_the_soak_walk_matches_a_hand_fraction_walk_on_the_refund_day` (three direct arms, expected bases and returns as `Fraction`), and `_opened_before_each_morning_deposit_and_swept_each_evening`.
- Measured on the new fixture, both params: `checked 1, indeterminate 6, flow_only 2, mismatch_count 0, certified_share 0.1429, ok False`.

## RED reading before the edit (tracer on the tree as it stood, plan 229-01 merged, `_walk_cohorts` unedited)

```
E       AssertionError: [{'day': '2025-10-03', 'kind': 'timed_day_not_nan', 'expected': None, 'actual': 0.050000000000000044}]
E       assert 1 == 0
E       assert [(Fraction(0,...ction(50, 1))] == [(Fraction(10...ction(50, 1))]
E         At index 0 diff: (Fraction(0, 1), Fraction(0, 1)) != (Fraction(1000, 1), Fraction(50, 1))
E         Left contains one more item: (Fraction(1000, 1), Fraction(50, 1))
FAILED tests/test_mt5_soak.py::test_a_refund_day_into_an_emptied_account_is_verified_by_the_soaks_own_walk
FAILED tests/test_mt5_soak.py::test_the_soak_walk_matches_a_hand_fraction_walk_on_the_refund_day
2 failed, 158 deselected in 5.40s
```

## PROOF-01 (Task 1): revert the skip decision in a byte-backed copy

Backup `cp scripts/mt5_soak.py "$BAK"`, `cmp` silent ("backup byte-equal"), then `if not (pnl == 0.0 and (k > 0 or inception or later_cohort_has_pnl)):` reverted to `if not (pnl == 0.0 and (k > 0 or inception)):` (line 618 of the neutered file). Tracer, verbatim:

```
E       AssertionError: [{'day': '2025-10-03', 'kind': 'timed_day_not_nan', 'expected': None, 'actual': 0.050000000000000044}]
E       assert 1 == 0
E       assert [(Fraction(0,...ction(50, 1))] == [(Fraction(10...ction(50, 1))]
E         
E         At index 0 diff: (Fraction(0, 1), Fraction(0, 1)) != (Fraction(1000, 1), Fraction(50, 1))
E         Left contains one more item: (Fraction(1000, 1), Fraction(50, 1))
E         Use -v to get more diff
FAILED tests/test_mt5_soak.py::test_a_refund_day_into_an_emptied_account_is_verified_by_the_soaks_own_walk
FAILED tests/test_mt5_soak.py::test_the_soak_walk_matches_a_hand_fraction_walk_on_the_refund_day
2 failed, 159 deselected in 6.22s
```

Restore and re-run:

```
cmp silent: restored
618:        if not (pnl == 0.0 and (k > 0 or inception or later_cohort_has_pnl)):
2 passed, 159 deselected in 6.47s
```

`timed_day_not_nan` is the first mismatch named.

## PROOF-01 (Task 2, the family)

A. Under the Task 1 neuter (old skip decision), the new-fixture family passes for BOTH params, as the plan predicts for the zero-base param: a cohort 0 that carries P&L is judged under either rule, and a judged knife-edge base is indeterminate under either.

```
618:        if not (pnl == 0.0 and (k > 0 or inception)):
4 passed, 157 deselected in 4.79s
cmp silent: restored
```

B. The family can fail. The band is neutered in a byte-backed copy (`_near` made `return False`, so a base within noise of zero or of the dust floor is no longer indeterminate):

```
859-    def _near(level: float) -> bool:
860:        return False
E       assert 0 >= 5
E       assert 0 >= 5
E       assert 0 != 0
FAILED tests/test_mt5_soak.py::test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]
FAILED tests/test_mt5_soak.py::test_one_checked_day_among_knife_edge_sweep_days_is_not_green[1000.0-950.0]
FAILED tests/test_mt5_soak.py::test_one_checked_day_among_knife_edge_sweep_days_cannot_exit_zero[1000.0-950.0]
3 failed, 1 passed, 157 deselected in 6.21s
cmp silent: restored
4 passed, 157 deselected in 5.87s
```

`..._is_not_green` fails first on its `indeterminate >= 5` assertion (`mismatch_count == 0` and `checked == 1` held before it). `..._cannot_exit_zero[10000.0-10050.0]` still exits non-zero with the band neutered because the zero-base day then reads as a mismatch rather than a pass; it is red for a different reason and still not green.

## Moved-test ledger

Seven tests moved when the walk changed, all for the cohort-0 rule and no other cause. Three are walk-semantics tests (fixed in the Task 1 commit), four are the knife-edge family (Task 2 commit). The Task 1 commit therefore leaves the four knife-edge tests red until the Task 2 commit.

1. `test_an_inception_day_skips_its_empty_cohort_zero`. Old: `assert math.isnan(off_value) and off_reason == "base_guard"` for the same day with `inception=False` ("the flag decides"). Premise changed: the empty cohort 0 is now skipped on every day whose later cohort holds P&L, so both readings are 0.01. Now pins: the off-inception reading is 0.01 with no reason; and what the flag still decides is a day nothing tests (a deposit plus an opening that books no cash): `inception_no_pnl` on an inception day, `base_guard` off it.
2. `test_the_cohort_walk_matches_hand_derived_returns[usd_dust_cohort]`. Old: prev 50, deposit 1,000 at 09:00, trade 10:00 to 15:00 for +10, expected NaN `base_guard`. Premise changed: cohort 0 (50, 0) is empty and now skipped, the day is measured on 1,050. Now pins: the same `base_guard` on a JUDGED dust base (the position opened at 08:00, before the deposit, so cohort 0 is (50, 10)), plus a new case `usd_dust_refund_is_measured` for the old ledger, expecting 10/1,050.
3. `test_a_timed_first_day_is_judged_on_the_account_units_residual_floor`. Old: published NaN, `timed == 1`, `as_inception == 0.01`, `as_ordinary` NaN `base_guard`, on base -0.4 with a +0.006 trade after the deposit. Premise changed: both readings now skip the empty cohort 0 and read 0.01, so the BTC and USD floors no longer differ on that ledger. Now pins the same invariant (the inception test uses the ACCOUNT UNIT's residual floor) on a day nothing tests, base +0.4 BTC: BTC floors read 0.0 and accept a published 0.0 (`flow_only == 1`), USD floors read NaN (`inception_no_pnl`) and name `timed_day_not_nan` on the same published 0.0.
4. to 7. `test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]`, `[1000.0-950.0]` and `test_one_checked_day_among_knife_edge_sweep_days_cannot_exit_zero[10000.0-10050.0]`, `[1000.0-950.0]`. Old assertions: `indeterminate >= 5`, `certified_share < min_certified_share`, `ok is False`, `rc != 0`, on sweep days that opened at 09:00 after the 08:00 deposit. Premise changed: their cohort 0 is empty and now skipped, so the days are measured on the deposit's base and certify, and the run turned green. Both params moved, including the dust-floor param (229-PATTERNS expected only the zero-base param to move; measured otherwise). Now pin: the same assertions, unchanged, on `_opened_before_each_morning_deposit_and_swept_each_evening`, whose P&L sits in a judged cohort 0 on the evening level (0, or the 100 dust floor).

The hundred-days test did not move (it drives `timed_days=set()`). No assertion was loosened and no number was re-pinned without a stated invariant.

## Verification

- `tests/test_mt5_soak.py tests/test_mt5_deal_reconstruction.py tests/test_broker_dailies.py -n 4 --dist loadgroup`: 472 passed.
- `tests/test_mt5_soak.py` alone: 161 passed (158 at plan start, plus the two tracer tests and the new `usd_dust_refund_is_measured` case).
- CI mypy command from 229-VALIDATION.md (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 142 source files`. `scripts/` is not in that scope. `mypy --strict` on `scripts/mt5_soak.py` alone reports 4 `type-arg` errors at lines near 1307, none in code this plan touched, so they are pre-existing and out of scope.
- Acceptance greps: `the one exception is the first cohort` 0; `def test_a_refund_day_into_an_emptied_account_is_verified_by_the_soaks_own_walk` 1; the production-cohort-import pattern 0; `def _opened_before_each_morning_deposit_and_swept_each_evening` 1; `_KNIFE_EDGE_SWEEPS` 3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Premise change] Three non-knife-edge soak tests moved**
- **Found during:** Task 1, first full run of `test_mt5_soak.py` after the edit.
- **Issue:** the plan expected only the knife-edge family to move. `test_an_inception_day_skips_its_empty_cohort_zero`, `usd_dust_cohort` and `test_a_timed_first_day_is_judged_on_the_account_units_residual_floor` also assert the old reading of an empty cohort 0.
- **Fix:** each is caused by the cohort-0 rule (so the plan's stop condition for other causes does not apply), measured, then restated with its invariant; see the ledger above.
- **Files modified:** `analytics-service/tests/test_mt5_soak.py`
- **Commit:** `cca03f6e0`

**2. [Plan note] The dust-floor knife-edge param moved too** (ledger items 4 to 7). Not a defect; recorded because 229-PATTERNS said it would not.

## Known Stubs

None.

## Threat Flags

None. The change is confined to an offline soak script and its tests; no endpoint, auth path or schema is touched.

## Self-Check: PASSED

Both commits are ancestors of HEAD (`cca03f6e0`, `bc004deba`); `mt5_soak.py` and `test_mt5_soak.py` are the only code files changed; STATE.md and ROADMAP.md are untouched.
