---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
plan: 01
subsystem: testing
tags: [mt5, soak, btc-floors, account-unit, proof-01]

requires:
  - phase: 164.6.6.2
    provides: services.account_unit (UnitFloors, USD_FLOORS, BTC row, classify_account_currency) and combine_mt5_deal_ledger(floors=)
provides:
  - "The MT5 soak resolves the account unit once and judges a BTC account on BTC floors in all five USD-denominated reads"
  - "unit_unresolved INCONCLUSIVE record for a blank, malformed or unsupported account currency"
  - "account_unit {code, native} in the populated soak record"
affects: [226-02, 226-03, 226-04, 226-05]

actuals:
  tokens: 5100
  tasks: 3
  commits: 2
plan_head_before: 1600774fe60fe6f91a6852942c5fa7cc9eaa7a87
plan_head_after: c60915c3e33a527c3b36c49f56d2f8b719368d92
commits: 2

tech-stack:
  added: []
  patterns:
    - "Unit floors are configuration: the soak imports classify_account_currency and reads unit.floors for dust_nav and residual_abs_tol, never the USD row"
    - "Every floor read has one test whose FIRST assertion is that read's own verdict, so a single neuter reddens exactly that test"

key-files:
  created: []
  modified:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py

key-decisions:
  - "Unit failure is INCONCLUSIVE (observation unit_unresolved, parity_ok None, main exits 1); only the exception class name and, for an unsupported code, the classifier-validated upper-cased code enter the record"
  - "_parity_tolerance and _reconcile_published_returns keep a USD_FLOORS default so the existing $1 test and the 4-kwarg guard test stay untouched"
  - "The wedge gate reads unit.floors.dust_nav, mirroring production's anchor > floors.dust_nav; DUST_NAV_FLOOR is no longer imported by the soak"

requirements-completed: [SOAK-01]

coverage:
  - id: D1
    description: "A BTC-unit account reconciles green end to end on BTC floors, and the record names the unit as account_unit"
    requirement: SOAK-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_btc_account_reconciles_green_on_its_own_floors"
        status: pass
    human_judgment: false
  - id: D2
    description: "A BTC series the USD floors would pass fails on its own floors (ROADMAP SC1), helper level and end to end"
    requirement: SOAK-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_btc_series_usd_floors_would_pass_reds_on_btc_floors"
        status: pass
    human_judgment: false
  - id: D3
    description: "The inception read, level tolerance and wedge gate read the unit's floors"
    requirement: SOAK-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_btc_first_day_is_judged_on_the_btc_residual_floor"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_btc_level_tolerance_is_in_btc_not_one_dollar"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_material_btc_wedge_is_not_green"
        status: pass
    human_judgment: false
  - id: D4
    description: "A blank, malformed or unsupported account currency is INCONCLUSIVE and main exits 1, never a USD fallback and never the raw broker text"
    requirement: SOAK-01
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_an_unresolved_account_currency_is_inconclusive"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_an_unresolved_account_currency_exits_nonzero"
        status: pass
    human_judgment: false

duration: 75min
completed: 2026-11-23
status: complete
---

# Phase 226 Plan 01: SOAK-01 BTC floors Summary

**The MT5 soak now resolves the account unit once with `classify_account_currency` and judges a BTC account on BTC floors in all five USD-denominated reads (combiner call, inception, dust guard, level tolerance, wedge gate), with an unresolvable currency recorded INCONCLUSIVE as `unit_unresolved`.**

## Performance

- **Duration:** about 75 min (most of it the 647 s full-suite gate and the five PROOF-01 arms)
- **Started:** 2026-11-23T16:30:59Z
- **Tasks:** 3 (tracer, auto/tdd, PROOF-01)
- **Files modified:** 2 (`analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`)

## Accomplishments

- A BTC canonical ledger (1.105 BTC) reconciles through `reconcile_parity` with `checked 3, guarded 0`, `parity_ok True` and `account_unit == {"code": "BTC", "native": True}`. At the unmodified soak it read `checked 0, guarded 3` (vacuous), as RESEARCH measured.
- ROADMAP SC1: the same NaN on 2025-06-04 is guarded and green under `USD_FLOORS` (checked 2, guarded 1, mismatch_count 0) and red under the BTC row with `checked_day_not_finite`, both at helper level and end to end through `reconcile_parity`.
- A 0.4 BTC first day with a deposit is a checked day; a fold that drops 0.003 BTC is a level breach (`recon_tolerance` 1.105e-6, `recon_residual` -0.003, where the old floor was one whole unit); a 15% BTC wedge (equity 1.3, balance 1.105) is not green while `recon_ok` stays True.
- A blank, whitespace, malformed (`US$`) or unsupported (`EUR`) account currency returns `{"observation": "unit_unresolved", "parity_ok": None, "unit_error": <class name>}` (plus `unit_code` for the unsupported code only), `main` exits 1, and `US$` never appears in the dumped record.

## Tracer pre-fix RED (Task 1, taken from the unmodified soak)

`test_a_btc_account_reconciles_green_on_its_own_floors` against the soak before any edit:

```
>       assert check["checked"] == 3 and check["guarded"] == 0
E       assert (0 == 3)
```

The first assertion (`mismatch_count == 0`) passed pre-fix because every day was guarded (3 guarded, none checked), which is exactly RESEARCH's measured `vacuous` reading. The three `unit_unresolved` tests and the exit test were also RED pre-fix (`E       AssertionError: assert 'populated' == 'unit_unresolved'`, and `E       assert 0 == 1` for the exit code). Six failed before the soak edit; six passed after.

## PROOF-01

One row per arm, in the contract's row shape. Each neuter was applied one at a time to the working copy of `analytics-service/scripts/mt5_soak.py` from a byte backup kept in the session scratchpad, the named test was run from `analytics-service/`, the file was restored with `cp` and compared with `cmp` (printed nothing, exit 0), and the same command was re-run. `git diff --quiet -- analytics-service/scripts/mt5_soak.py` exits 0 after the last restore.

| arm | neuter edit | command | RED | restore | GREEN |
|---|---|---|---|---|---|
| SOAK01-a | combiner call: delete the line `floors=unit.floors,` from the `combine_mt5_deal_ledger(...)` call | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_btc_account_reconciles_green_on_its_own_floors" -x -q` | RED: `E       assert 3 == 0` (the `mismatch_count == 0` assertion; the message lists `'kind': 'checked_day_not_finite'` on 2025-06-02, 06-04 and 06-05) | cmp: exit 0, no output | GREEN: `1 passed in 19.01s` |
| SOAK01-b1 | guard read: `_guard_denominator(base, floors.dust_nav)` becomes `_guard_denominator(base, USD_FLOORS.dust_nav)` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_btc_series_usd_floors_would_pass_reds_on_btc_floors" -x -q` | RED: `E       assert True is False` (the BTC-floors helper call's `btc["ok"] is False`) | cmp: exit 0, no output | GREEN: `1 passed in 17.43s` |
| SOAK01-b2 | inception read: `and abs(base) <= floors.residual_abs_tol` becomes `and abs(base) <= USD_FLOORS.residual_abs_tol` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_btc_first_day_is_judged_on_the_btc_residual_floor" -x -q` | RED: `E       assert (1 == 0)` (the `check["guarded"] == 0` half of `guarded == 0 and checked == 2`) | cmp: exit 0, no output | GREEN: `1 passed in 17.85s` |
| SOAK01-c | level tolerance: `return max(floors.residual_abs_tol, 1e-6 * abs(anchor))` becomes `return max(1.0, 1e-6 * abs(anchor))` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_the_btc_level_tolerance_is_in_btc_not_one_dollar" -x -q` | RED: `E       assert True is False` (`parity["recon_level_ok"] is False`) | cmp: exit 0, no output | GREEN: `1 passed in 9.50s` |
| SOAK01-d | wedge gate: `abs(equity) > unit.floors.dust_nav` becomes `abs(equity) > 100.0` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_material_btc_wedge_is_not_green" -x -q` | RED: `E       assert True is False` (`parity["wedge_within_materiality"] is False`) | cmp: exit 0, no output | GREEN: `1 passed in 13.64s` |

Every RED failed on the arm's own first assertion, so no test needed reordering and Task 3 committed nothing.

## Gates

| Gate | HEAD (before) | After | Bound |
|---|---|---|---|
| `tests/test_mt5_soak.py` | 31 passed | `41 passed` | 41 |
| ruff on `scripts/mt5_soak.py` and `tests/test_mt5_soak.py` | 1 (F401 `Mt5DealClassificationError`, line 156 at HEAD) | 1 (same finding) | <= 1 |
| mypy strict on `scripts/mt5_soak.py` | 4 | 4 | <= 4 |
| full analytics suite (Phase contract gate, serial) | baseline `1 failed, 15235 passed, 93 skipped` (the plan's re-measured figure; +10 new tests lands on 15245) | `1 failed, 15245 passed, 93 skipped, 3663 warnings in 646.74s (0:10:46)`; gate exit 0 | no FAILED/ERROR line other than the tolerated one |

- The one failure is the tolerated `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: it launches a nested `-n 2` session and this machine's `python3` cannot import pytest-xdist. No package was installed.
- The mypy count is `scripts/` hygiene. `scripts/` is outside CI's mypy surface, so it is not a CI gate. The 4 remaining errors are the pre-existing ones (`dict` type args on `reconcile_parity` and `run_soak`, one untyped lambda call); their line numbers moved, their count did not.
- Acceptance greps: `classify_account_currency(` 1, `floors=unit.floors` 2, `"unit_unresolved"` 3, `unit.floors.dust_nav` 1; lines removed from the test file against `origin/main` 1 (the hard-coded `"currency": "USD"`); `git diff --stat origin/main...HEAD -- analytics-service/services` is empty.

## Task Commits

1. **Task 1: tracer, BTC account reconciles green on its own floors, unit failure INCONCLUSIVE** - `199733b46` (feat)
2. **Task 2: level tolerance and wedge gate move to the unit's floors, four discriminating tests** - `c60915c3e` (feat)
3. **Task 3: PROOF-01 for the five arms and the plan gates** - no commit (nothing needed reordering; the table above is its record)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `analytics-service/scripts/mt5_soak.py` - imports `classify_account_currency` and the three exceptions; unit resolved once in `reconcile_parity`; `floors=` threaded to the combiner, `_reconcile_published_returns` and `_parity_tolerance`; wedge gate on `unit.floors.dust_nav`; `unit_unresolved` return; `account_unit` in the populated record; `DUST_NAV_FLOOR` import removed.
- `analytics-service/tests/test_mt5_soak.py` - `_FakeMt5(currency=...)`, `_btc_canonical_deals`, the top-of-file `services.account_unit` import, and seven new tests (ten with the four-row parametrization).

## Decisions Made

- Unit failure is INCONCLUSIVE with no USD fallback (threat T-226-02); the record carries the class name and, only for an unsupported code, the validated upper-cased code (T-226-01). The exception message is never read.
- The `USD_FLOORS` defaults on `_parity_tolerance` and `_reconcile_published_returns` leave `test_fidelity_gate_has_teeth_vs_balance` and `test_guard_explained_nan_is_accepted_and_a_finite_value_there_is_not` unedited.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access; the new record keys (`account_unit`, `unit_error`, `unit_code`) avoid the sanitizer's deny substrings and keep values under 40 characters, and `test_written_record_is_sanitized` stays green.

## Notes for the phase REVIEW.md (LOW, not TODOS.md)

- Stale pointer: the docstring of `analytics-service/tests/test_account_unit.py::test_dust_nav_floor_name_is_an_alias_of_the_usd_row` lists `scripts/mt5_soak.py` among the importers of the USD dust alias. After this plan it no longer is one. That file is outside the phase boundary, so it is recorded and not edited.

## Issues Encountered

None.

## Next Phase Readiness

Ready for 226-02. The `floors` keyword and the `account_unit` key are in place for the walk plans to extend.

## Self-Check: PASSED

- `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`: FOUND
- Commits `199733b46` and `c60915c3e`: FOUND (ancestors of HEAD)
- Working-tree `mt5_soak.py` equals the committed one after the last restore (`git diff --quiet` exit 0)
