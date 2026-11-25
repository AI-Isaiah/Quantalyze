---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
plan: 03
subsystem: testing
tags: [mt5, soak, timed-days, independent-walk, proof-01]

requires:
  - phase: 226-02
    provides: the soak's own per-day walk (_WalkLedger, _walk_deal_ledger), the attribution compare and the AST independence test
provides:
  - "The MT5 soak derives its own timed-day set from the raw deals (flow and trading instants, position ids, entry codes, IN deals) with no production helper, and judges the published returns by set(walk.timing)"
  - "A day the fold timed and the walk cannot confirm is timed_day_unconfirmed; a day the walk times and the fold did not is timed_day_not_timed_by_fold; both are attribution_check mismatches and make parity_ok False"
  - "Seven untrusted instant and position shapes leave the day untimed on both the walk and the fold; six resolvable shapes are timed on both; the walk's position constants are drift-pinned to production"
affects: [226-04, 226-05]

actuals:
  tokens: 4970
  tasks: 3
  commits: 2
plan_head_before: a934c9b4ae7fe91c93ba0249a6429fa674f9a5ce
plan_head_after: eca9ca66c6b74daaac130b94d84fe5546159cc9a
commits: 2

tech-stack:
  added: []
  patterns:
    - "The timed-day set is a soak-owned reading: _walk_deal_ledger records flow deals, trading deals (position id, entry code, type, cash) and each position's IN deals in one pass, then _walk_day_timing resolves instants for flow days only"
    - "An untrusted instant is NO instant: _walk_instant_ms answers None and the whole day stays untimed, never a default"

key-files:
  created: []
  modified:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py

key-decisions:
  - "OQ2 resolved by RESEARCH's recommendation: the walk's own set is the authority, and both directions of disagreement with the fold are named mismatches"
  - "_WalkDayTiming.pnl keeps the contract's two fields (open instant, cash). Production's third field, the closing deal's own instant, is checked to resolve (an unresolvable one leaves the day untimed) but is not stored: the cohort walk reads only the open"

requirements-completed: [SOAK-02]

coverage:
  - id: D1
    description: "A flow day the fold failed to time is timed_day_not_timed_by_fold, and a day the fold timed that the walk cannot confirm is timed_day_unconfirmed; each makes attribution_ok and parity_ok False"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_flow_day_the_fold_failed_to_time_is_named"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_day_the_fold_timed_and_the_walk_cannot_is_named"
        status: pass
    human_judgment: false
  - id: D2
    description: "Seven untrusted instant and position shapes leave the day untimed and six resolvable shapes are timed, and on all 13 the production fold's timed set agrees with the walk's"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_degrades_an_untrusted_flow_day_to_untimed"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_times_known_entries_commissions_and_midnight_flows"
        status: pass
    human_judgment: false
  - id: D3
    description: "The walk's position types, entry IN and known entry codes equal production's, and the AST independence test's minimum walk set covers the four new walk functions"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_position_constants_match_production"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_imports_no_production_helper"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-11-23
status: complete
---

# Phase 226 Plan 03: SOAK-02 timed-day set Summary

**The MT5 soak now times flow days itself from the raw `time_msc`, `position_id` and `entry` fields with no production helper, judges the published returns by that set, and names every day it and the fold disagree on as `timed_day_unconfirmed` or `timed_day_not_timed_by_fold`.**

## Performance

- **Duration:** about 18 min (most of it the 660 s full-suite gate)
- **Started:** 2026-11-23T17:15:26Z
- **Completed:** 2026-11-23T17:33:39Z
- **Tasks:** 3 (auto/tdd, auto/tdd, PROOF-01)
- **Files modified:** 2 (`analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`)

## Accomplishments

- `_walk_position_id`, `_walk_entry_code`, `_walk_instant_ms` and `_walk_day_timing` re-implement the production instant and position rules from their SPEC (read, never imported). `_walk_deal_ledger` records flow deals, trading deals and each position's IN deals in its single pass and builds `_WalkLedger.timing` for every flow day whose instants all resolve.
- `_walk_attribution_check` takes a required `fold_timed_days` and names the two disagreement kinds over the union of both sets, with expected None and actual None. `reconcile_parity` passes `{ts.date().isoformat() for ts in _fold_timing}` and now calls `_reconcile_published_returns` with `timed_days=set(walk.timing)`: the soak judges by its own set. The timed branch itself is unchanged until 226-04.
- On the unpatched timed fixture `walk.timing` holds exactly the 10-16 and 10-17 flow days, so `(checked, timed) == (1, 2)`, the vacuous test and `parity_ok` True are unchanged; every existing timed test passes unedited.
- Thirteen hand-built shapes agree with production: untimed on both sides for time_msc off by one second, fractional, bool, a BUY without a position id, every IN deal on a later day, unknown entry code 7, and a commission-family deal with a position id and no entry code; timed on both for INOUT and OUT_BY closes, a commission without a position, a commission with a position and entry 1 (its open is the same-day IN instant, 10:00, not its own 15:00), `time_msc` absent, and a flow at exact UTC midnight.
- The minimum `_walk_*` name set in `test_the_walk_imports_no_production_helper` now includes the four new walk functions (the 226-02 hand-off note).

## Pre-change RED lines (Task 1, taken against the 226-02 soak before any soak edit)

Neither disagreement kind existed, so both new tests failed on their first assertion:

```
test_a_flow_day_the_fold_failed_to_time_is_named
E       assert ('2025-10-17', 'timed_day_not_timed_by_fold') in set()
test_a_day_the_fold_timed_and_the_walk_cannot_is_named
E       assert ('2025-10-18', 'timed_day_unconfirmed') in set()
```

Both runs read `attribution_check` `ok` True with `mismatch_count` 0 on the patched fold, which is the hole OQ2 describes: the soak took its timed set from the fold under test.

## PROOF-01

One row for the one arm, in the contract's row shape. The neuter was applied to the working copy of `analytics-service/scripts/mt5_soak.py` from a byte backup kept in the session scratchpad; the named test was run from `analytics-service/`; the file was restored with `cp` and compared with `cmp` (no output, exit 0); the same command was re-run. `git diff --quiet -- analytics-service/scripts/mt5_soak.py` exits 0 after the restore. The neuter replaces the loop header of the timed-set compare so it iterates nothing, which silences both disagreement kinds the loop records.

| arm | neuter edit | command | RED | restore | GREEN |
|---|---|---|---|---|---|
| SOAK02-timedset | in `_walk_attribution_check`: `    for day in sorted(walk_timed \| set(fold_timed_days)):` becomes `    for day in []:  # NEUTER SOAK02-timedset` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_flow_day_the_fold_failed_to_time_is_named" -x -q` | RED: E       assert ('2025-10-17', 'timed_day_not_timed_by_fold') in set() | cmp: exit 0, no output | GREEN: 1 passed in 9.61s |

The RED failed on the arm's own first assertion (the line above it reads `E       AssertionError: []`), so Task 3 needed no reordering and committed nothing.

The mypy guard mutation from Task 2's acceptance criteria was also run: appending an unannotated `def _guard_probe(x): return x` to `scripts/mt5_soak.py` moved the strict count from 4 to 5; the file was restored from a byte backup (`cmp` exit 0) and the count read 4 again. So the count can detect a new error.

## Gates

| Gate | HEAD (before, at 226-02's close) | After | Bound |
|---|---|---|---|
| `tests/test_mt5_soak.py` | 57 passed | `73 passed` (59 after Task 1, 73 after Task 2) | 73 |
| ruff on `scripts/mt5_soak.py` and `tests/test_mt5_soak.py` | 0 | 0 | EXPECT==0 |
| mypy strict on `scripts/mt5_soak.py` | 4 | 4 | <= 4 |
| full analytics suite (Phase contract gate, serial) | 15261 passed after 226-02 | `1 failed, 15277 passed, 93 skipped, 3663 warnings in 660.16s (0:11:00)`; gate exit 0 (`GATE_OK`) | no FAILED/ERROR line other than the tolerated one |

- 15277 = 15261 + 16 new tests (2 in Task 1, 14 in Task 2).
- The one failure is the tolerated `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: it launches a nested `-n 2` session and this machine's `python3` cannot import pytest-xdist. No package was installed.
- The mypy count is `scripts/` hygiene. `scripts/` is outside CI's mypy surface, so it is not a CI gate. The 4 errors are the pre-existing ones (`dict` type args on `reconcile_parity` and `run_soak`, one untyped lambda call); none was added.
- Acceptance greps: `def _walk_day_timing(` 1, `timed_day_not_timed_by_fold` 3, `fold_timed_days=` 1, `def test_the_walk_position_constants_match_production` 1. No file under `analytics-service/services` was touched.

## Task Commits

1. **Task 1: the soak times flow days itself and names every disagreement with the fold's timed set** - `6cc3e03c8` (feat)
2. **Task 2: instant and position shapes cross-checked against the fold, position constants drift-pinned** - `eca9ca66c` (test)
3. **Task 3: PROOF-01 for the timed-set compare, then the plan gates** - no commit (nothing needed reordering; the table above is its record)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `analytics-service/scripts/mt5_soak.py` - `_WalkDayTiming`, `_WalkLedger.timing`, `_walk_position_id`, `_walk_entry_code`, `_walk_instant_ms`, `_walk_day_timing`, the extended `_walk_deal_ledger` pass, constants `_WALK_POSITION_TYPES`, `_WALK_ENTRY_IN`, `_WALK_ENTRY_CODES`, `_WALK_EPOCH0`; the timed-set kinds in `_walk_attribution_check` and its `fold_timed_days` keyword; `timed_days=set(walk.timing)` in `reconcile_parity`; module and `reconcile_parity` docstrings.
- `analytics-service/tests/test_mt5_soak.py` - the two disagreement tests, the 13-shape parametrized timed/untimed tests cross-checked against the production fold, the position-constant drift pin, and the extended AST minimum set.

## Decisions Made

- OQ2: the walk's own timed set is the authority; both disagreement directions are named mismatches and count in `days_compared`.
- `_WalkDayTiming.pnl` stays at the contract's two fields. The closing deal's own instant must still resolve (production degrades the day otherwise, so the walk does too), but it is not carried.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access. The two new kind strings are under 40 characters, the new `timed_day_*` kinds use the existing record shape, and no new key was added to the record.

## Notes for the phase REVIEW.md (LOW, not TODOS.md)

- The walk handles a fixed integer offset only (RESEARCH A4); production's `Mt5ServerClock` is out of scope for the soak, and a DST-aware soak would need the walk extended and re-fuzzed.
- `_walk_instant_ms` is called more than once per deal inside `_walk_day_timing` (production memoizes by `id(deal)`). The cost is a few integer operations per deal and only on flow days, so it was left unmemoized.

## Issues Encountered

None.

## Next Phase Readiness

Ready for 226-04. `walk.timing` carries `_WalkDayTiming(flows, pnl)` for every day the soak times, ascending flows by instant and pnl in deal order with `None` for an overnight open, which is the exact input the D-17 cohort walk needs. `_reconcile_published_returns`'s timed branch still only rejects infinity.

## Self-Check: PASSED

- `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`: FOUND
- Commits `6cc3e03c8` and `eca9ca66c`: FOUND (ancestors of HEAD)
- Working-tree `mt5_soak.py` equals the committed one after the last restore (`git diff --quiet` exit 0)
