---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
plan: 02
subsystem: testing
tags: [mt5, soak, day-attribution, independent-walk, proof-01]

requires:
  - phase: 226-01
    provides: the account unit resolved once in reconcile_parity and unit.floors threaded through every USD-denominated read
provides:
  - "The MT5 soak accumulates its own per-UTC-day trading P&L and flows from the raw deal fields and compares them with the fold's, day by day (attribution_check, attribution_ok)"
  - "A deal or flow the fold buckets one UTC day off is a named day_attribution_mismatch / flow_attribution_mismatch and parity_ok False"
  - "An AST test that proves every _walk_* function references no services.* binding, no denylisted production helper and no non-walk soak helper, with a self-test that can fail"
affects: [226-03, 226-04, 226-05]

actuals:
  tokens: 8700
  tasks: 3
  commits: 2
plan_head_before: 191379329a2ecec891de8b4da4563e2c26ff666b
plan_head_after: 9914c7a35a425c9b00ee139e71e2864ba06c8177
commits: 2

tech-stack:
  added: []
  patterns:
    - "Soak-owned names by prefix: every function that must stay independent of the code under test is a module-level _walk_*, with _WALK_* constants and _Walk* types; an AST test pins it"
    - "The published-return reading uses the walk's P&L and flows; the level roll keeps the fold's P&L; initial comes from the walk's totals, so a mis-bucketed fold is seen by three detectors"

key-files:
  created: []
  modified:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py

key-decisions:
  - "The redundant pre-walk classify_deal pass is dropped: combine_mt5_deal_ledger runs first and already raises Mt5DealClassificationError on an unknown type, so the services.mt5_deals import block is gone and the ruff baseline finding (the unused Mt5DealClassificationError import) goes with it"
  - "The walk handles a fixed integer server offset only (RESEARCH A4); a DST-aware soak would need the walk extended and re-fuzzed"
  - "Walk errors are static ValueError text naming the field, never the value"

requirements-completed: [SOAK-03]

coverage:
  - id: D1
    description: "A deal the fold moves one UTC day (in both namespaces) is a day_attribution_mismatch on both days and parity_ok False; the same scenario read parity_ok True before this plan (ROADMAP SC3)"
    requirement: SOAK-03
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_deal_moved_one_utc_day_in_the_fold_reddens_attribution"
        status: pass
    human_judgment: false
  - id: D2
    description: "A flow the fold moves one UTC day is a flow_attribution_mismatch on both days; the real fold and the walk agree day by day on the canonical and the timed ledger"
    requirement: SOAK-03
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_flow_moved_one_utc_day_in_the_fold_reddens_flow_attribution"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_real_fold_and_the_walk_agree_day_by_day"
        status: pass
    human_judgment: false
  - id: D3
    description: "The walk provably imports no production helper, and its trading and flow type sets are pinned equal to services.mt5_deals' allow-lists"
    requirement: SOAK-03
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_imports_no_production_helper"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_type_sets_match_production"
        status: pass
    human_judgment: false
  - id: D4
    description: "The walk's raw-field reading is hand-derived: the commission-family cash, credit and bonus flows, the fixed server offset, datetime times and seven bad-field cases"
    requirement: SOAK-03
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_sums_swap_fee_and_commission_family_cash"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_books_credit_and_bonus_as_flows"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_buckets_on_the_fixed_server_offset"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_reads_a_datetime_time"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_rejects_bad_fields_naming_the_field_only"
        status: pass
    human_judgment: false

duration: 60min
completed: 2026-11-23
status: complete
---

# Phase 226 Plan 02: SOAK-03 day attribution Summary

**The MT5 soak now accumulates its own per-UTC-day trading P&L and flows from the raw deals with `_walk_deal_ledger` (no `services.*` import) and compares them with the fold's day by day, so a deal moved one UTC day in the fold is a named `day_attribution_mismatch` and `parity_ok` False.**

## Performance

- **Duration:** about 60 min (most of it the 696 s full-suite gate and the three PROOF-01 arms)
- **Completed:** 2026-11-23
- **Tasks:** 3 (auto/tdd, auto/tdd, PROOF-01)
- **Files modified:** 2 (`analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`)

## Accomplishments

- `_walk_money`, `_walk_epoch`, `_walk_utc_day`, `_walk_deal_ledger` re-bucket every raw deal by the soak's own arithmetic; `_walk_attribution_check` compares walk against fold over the union of days, per channel, with a relative 1e-9 and an absolute 1e-12 tolerance. A day booked on one side only is a mismatch with `None` for the missing side.
- Wiring in `reconcile_parity`: the published-return reading takes the walk's P&L and flows; the level roll keeps the fold's P&L with the walk's flows; `initial` comes from the walk's totals; `recon_ok = recon_level_ok and return_check["ok"] and attribution_check["ok"]`; the populated record carries `attribution_ok` and `attribution_check`.
- ROADMAP SC3: with the canonical SELL +300 moved from 2025-06-04 to 2025-06-05 in the fold's input (both the soak's and `broker_dailies`' namespaces), `attribution_check` carries `day_attribution_mismatch` on 2025-06-04 (expected 300.0, actual None) and on 2025-06-05 (expected -200.0, actual 100.0), and `attribution_ok`, `recon_ok` and `parity_ok` are all False. A moved deposit gives `flow_attribution_mismatch` on both days. On the unmodified fold `attribution_check` is `ok` with `days_compared` 3 and `mismatch_count` 0, on the canonical and on the timed ledger.
- `test_the_walk_imports_no_production_helper` walks the AST of every `_walk_*` def against the soak's `services.*` bindings, an explicit denylist and the non-walk soak helpers, and flags both a synthetic walk calling `deal_utc_day` and one calling `_forward_nav_levels`.

## Pre-change SC3 reading (taken on the unmodified soak, before any edit)

The scenario above, run through a throwaway `python3 -c` from `analytics-service/` (not committed), read:

```
parity_ok True recon_ok True return_check_ok True recon_level_ok True
```

That is RESEARCH's measured reading and the TODO's hole: every check stayed green while a deal sat on the wrong day. After this plan the same scenario is `parity_ok False`.

## PROOF-01

One row per arm, in the contract's row shape. Each neuter was applied to the working copy of `analytics-service/scripts/mt5_soak.py` from a byte backup kept in the session scratchpad; the named test was run from `analytics-service/`; the file was restored with `cp` and compared with `cmp` (no output, exit 0); the same command was re-run. `git diff --quiet -- analytics-service/scripts/mt5_soak.py` exits 0 after the last restore. The neuter for the two attribution arms replaces the walk and fold maps of the arm's own `_compare(...)` call with empty mappings, because the P&L and flow arms share one `_compare` helper and an `if False:` there would silence both.

| arm | neuter edit | command | RED | restore | GREEN |
|---|---|---|---|---|---|
| SOAK03-pnl | in `_walk_attribution_check`: `_compare("day_attribution_mismatch", walk.pnl_by_day, fold_pnl_by_day)` becomes `_compare("day_attribution_mismatch", {}, {})` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_deal_moved_one_utc_day_in_the_fold_reddens_attribution" -x -q` | RED: `E       assert {('2025-06-04...on_mismatch')} <= set()` (the first assertion, the `day_attribution_mismatch` pairs; the message line above it is `E       AssertionError: []`) | cmp: exit 0, no output | GREEN: `1 passed in 11.75s` |
| SOAK03-flow | in `_walk_attribution_check`: `_compare("flow_attribution_mismatch", walk.flows_by_day, fold_flows_by_day)` becomes `_compare("flow_attribution_mismatch", {}, {})` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_flow_moved_one_utc_day_in_the_fold_reddens_flow_attribution" -x -q` | RED: `E       assert {('2025-06-04...on_mismatch')} <= set()` (the first assertion, the `flow_attribution_mismatch` pairs; the message line above it is `E       AssertionError: []`) | cmp: exit 0, no output | GREEN: `1 passed in 10.68s` |
| SOAK03-indep | insert `assert _fold_mt5_deals is not None` as the first statement of `_walk_deal_ledger`'s body (behaviour unchanged, a production reference inside a walk) | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_the_walk_imports_no_production_helper" -x -q` | RED: `E       AssertionError: assert {'_walk_deal_...d_mt5_deals']} == {}` (the offender is named two lines below: `E         {'_walk_deal_ledger': ['_fold_mt5_deals']}`) | cmp: exit 0, no output | GREEN: `1 passed in 13.58s` |

Every RED failed on the arm's own first assertion, so no test needed reordering and Task 3 committed nothing.

## Gates

| Gate | HEAD (before, at 226-01's close) | After | Bound |
|---|---|---|---|
| `tests/test_mt5_soak.py` | 41 passed | `57 passed` | 57 |
| ruff on `scripts/mt5_soak.py` and `tests/test_mt5_soak.py` | 1 (F401 `Mt5DealClassificationError`) | 0 | EXPECT==0 |
| mypy strict on `scripts/mt5_soak.py` | 4 | 4 | <= 4 |
| full analytics suite (Phase contract gate, serial) | 15245 passed after 226-01 | `1 failed, 15261 passed, 93 skipped, 3663 warnings in 695.91s (0:11:35)`; gate exit 0 (`GATE_OK`) | no FAILED/ERROR line other than the tolerated one |

- 15261 = 15245 + 16 new tests (3 in Task 1, 13 in Task 2).
- The one failure is the tolerated `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: it launches a nested `-n 2` session and this machine's `python3` cannot import pytest-xdist. No package was installed.
- The mypy count is `scripts/` hygiene. `scripts/` is outside CI's mypy surface, so it is not a CI gate. The 4 errors are the pre-existing ones (`dict` type args on `reconcile_parity` and `run_soak`, one untyped lambda call); their count did not move.
- Acceptance greps: `def _walk_deal_ledger(` 1, `"attribution_check"` 1, `from services.mt5_deals import` 0, `def _independence_violations(` 1, `_walk_fake` 2. `git diff --stat` shows no file under `analytics-service/services` touched.

## Task Commits

1. **Task 1: walk, attribution compare, wiring, SC3** - `d9681a5d7` (feat)
2. **Task 2: independence AST test, type-set drift pin, hand-derived walk tests** - `9914c7a35` (test)
3. **Task 3: PROOF-01 for the two attribution arms and the independence test** - no commit (nothing needed reordering; the table above is its record)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `analytics-service/scripts/mt5_soak.py` - `_WalkLedger`, `_walk_*` functions and `_WALK_*` constants; `reconcile_parity` wiring and the `attribution_ok` / `attribution_check` keys; the `services.mt5_deals` import block removed; module, `reconcile_parity` and `_forward_terminal_nav` docstrings updated (COMPOSE bullet, FIDELITY (a), new (c) ATTRIBUTION).
- `analytics-service/tests/test_mt5_soak.py` - `_shift_in_fold`, `_independence_violations` and the walk-name helpers, three SOAK-03 attribution tests, the independence test, the type-set pin and five hand-derived walk tests (seven parametrized bad-field cases).

## Decisions Made

- The redundant pre-walk `classify_deal` pass is dropped (discretion choice recorded in the plan): `combine_mt5_deal_ledger` runs first and raises `Mt5DealClassificationError` on an unknown type, which `test_unclassifiable_deal_type_propagates` pins and which stayed green untouched.
- Walk error text avoids echoing any value and avoids the substrings the bad-field test checks for (`True`, `nan`, `abc`, `inf`, `5`).

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access. The new record keys (`attribution_ok`, `attribution_check`, `days_compared`, `mismatch_count`, `mismatches`) avoid the sanitizer's deny substrings and the new kind strings are under 40 characters; `test_written_record_is_sanitized` stays green.

## Notes for the phase REVIEW.md (LOW, not TODOS.md)

- Blind spot, stated in `_walk_attribution_check`'s docstring: a zero-cash deal moved onto a day that already holds another trading deal on both sides changes no per-day amount, so this compare cannot see it.
- Residual coupling: `_walk_attribution_check` and the level roll both compare against the fold's `pnl_by_day`, which the soak builds from `_fold_mt5_deals`; the independence rule covers the `_walk_*` defs only, by design (the fold is the code under test).

## Issues Encountered

None.

## Next Phase Readiness

Ready for 226-03. `_WalkLedger` is frozen with the four contract fields; 226-03 adds `timing` and the timed-day kinds, and extends the minimum `_walk_*` name set in `test_the_walk_imports_no_production_helper`.

## Self-Check: PASSED

- `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`: FOUND
- Commits `d9681a5d7` and `9914c7a35`: FOUND (ancestors of HEAD)
- Working-tree `mt5_soak.py` equals the committed one after the last restore (`git diff --quiet` exit 0)
