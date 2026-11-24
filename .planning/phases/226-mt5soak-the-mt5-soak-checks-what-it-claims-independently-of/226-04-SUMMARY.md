---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
plan: 04
subsystem: testing
tags: [mt5, soak, timed-days, cohort-walk, d-17, proof-01]

requires:
  - phase: 226-03
    provides: the soak's own timed-day set and per-day timing (_WalkDayTiming, _WalkLedger.timing)
provides:
  - "The MT5 soak recomputes every timed day with its own D-17 cohort walk (_walk_timed_return, _walk_day_guard) and compares it to the published return at 1e-9, with no production import"
  - "A timed day is now rejected for a NaN the walk does not explain, a non-finite value on a finite walk day, and any value off the walk (kinds timed_day_not_nan, timed_day_not_finite, timed_return_off_cohort_walk, timed_day_not_walked)"
  - "return_check carries timed_verified; a mismatch's expected value is written as None when NaN"
affects: [226-05]

actuals:
  tokens: 5600
  tasks: 3
  commits: 3
plan_head_before: 3e77c4d2d51de755cef9ec2e3d776ffd86925b14
plan_head_after: 3ca493124fadf582e96643656dcfd6e8924eb3f2
commits: 3

tech-stack:
  added: []
  patterns:
    - "The cohort return is a soak-owned reading: _walk_timed_return re-implements nav_twr._judged_cohorts and _timed_day_return from their spec, and _walk_day_guard owns the denominator guards with its own _WALK_PNL_DOM_RATIO, drift-pinned to production"
    - "A NaN on a timed day is accepted only where the walk's own guard reading is NaN; a timed day with no walk result is named, never a silent pass"

key-files:
  created: []
  modified:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py

key-decisions:
  - "OQ4 first half adopted: one soak-owned guard predicate _walk_day_guard with its own _WALK_PNL_DOM_RATIO = 10.0, pinned equal to nav_twr.PNL_DOM_RATIO. 226-05 moves the untimed branch onto it"
  - "The infinity-only timed kind is retired: infinity on a timed day is now timed_day_not_finite with the walk's value as expected"

requirements-completed: [SOAK-02]

coverage:
  - id: D1
    description: "A 1e-3 nudge on a timed day reds the gate as timed_return_off_cohort_walk with expected 0.01 (hand-derived from base 110_000 and P&L 1_100) and actual 0.011"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_small_nudge_on_a_timed_day_reddens_the_gate"
        status: pass
    human_judgment: false
  - id: D2
    description: "A published NaN or inf on a finite walk day is timed_day_not_finite, 7.0 and -0.99 are timed_return_off_cohort_walk, and a finite value where the walk reads NaN is timed_day_not_nan"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_an_implausible_or_missing_timed_return_reddens_the_gate"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_timed_day_the_walk_reads_as_nan_must_be_published_nan"
        status: pass
    human_judgment: false
  - id: D3
    description: "The real combiner on the timed fixture stays green with timed 2, timed_verified 1 and checked 1"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_real_combiner_timed_days_are_verified_against_the_walk"
        status: pass
    human_judgment: false
  - id: D4
    description: "Nine cohort shapes equal their hand-derived returns, the walk's dominance ratio equals production's, and the AST independence minimum set covers both new walk functions"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_cohort_walk_matches_hand_derived_returns"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_pnl_dominance_ratio_matches_production"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_imports_no_production_helper"
        status: pass
    human_judgment: false

duration: 34min
completed: 2026-11-23
status: complete
---

# Phase 226 Plan 04: SOAK-02 cohort walk Summary

**The MT5 soak now recomputes every timed day with its own D-17 cohort walk (`_walk_timed_return` over `_walk_day_guard`, no production import) and compares it to the published return at 1e-9, so a 1e-3 nudge, a NaN, an inf, 7.0 or -0.99 on a timed day reds the gate under a named kind.**

## Performance

- **Duration:** about 34 min (most of it two full-suite gate runs of about 12 minutes; the first was stopped, see Issues Encountered)
- **Started:** 2026-11-23T17:35Z
- **Completed:** 2026-11-23T18:10Z
- **Tasks:** 3 (auto/tdd, auto/tdd, PROOF-01)
- **Files modified:** 2 (`analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`)

## Accomplishments

- `_walk_day_guard(base, pnl, *, dust_nav)` reads the DQ-01 guards for one cohort (`base_guard`, `pnl_dominated`, else None). `_walk_timed_return(prev, timing, *, dust_nav, inception)` is the D-17 walk: zero flows dropped, cohort index by `bisect_right` (a flow at an open counts first, an overnight open is cohort 0), telescoping base, a P&L-free cohort skipped when `k > 0` or on an inception day, `(nan, "inception_no_pnl")` for an empty judged list, `(nan, reason)` on the first guard hit, else `prod(1 + P/B) - 1`. Both import nothing from `services.*`.
- The timed branch of `_reconcile_published_returns` takes a `timing` keyword (passed as `walk.timing` by `reconcile_parity`) and a `timed_verified` count. A day with no walk result is `timed_day_not_walked`; a walk NaN with a non-NaN published value is `timed_day_not_nan` and an accepted NaN never falls through; a non-finite published value on a finite walk day is `timed_day_not_finite`; otherwise `max_abs_err` is updated and the day is `timed_return_off_cohort_walk` above 1e-9 or `timed_verified`.
- `_mismatch` writes a NaN `expected` as None (Pitfall 2), so the evidence JSON stays strict-parser safe.
- Nine hand-derived cohort shapes (deposit before and after an open, withdrawal, overnight position, two flows at the open instant, zero-amount flow, BTC cohort, USD dust cohort, P&L-dominated cohort) equal the walk's value; the BTC case is also asserted NaN on the USD dust floor. `_WALK_PNL_DOM_RATIO` is pinned equal to `nav_twr.PNL_DOM_RATIO`, and the AST independence minimum set now includes `_walk_day_guard` and `_walk_timed_return`.
- The module docstring's FIDELITY (b) paragraph and the `_reconcile_published_returns` docstring no longer disown the timed days; `NOT by this gate` appears 0 times.

## Pre-change RED lines (Task 1, against the 226-03 soak before any soak edit)

The 226-03 timed branch rejected only infinity, so all seven new test cases failed:

```
test_a_small_nudge_on_a_timed_day_reddens_the_gate
E       AssertionError: []
E       assert []
test_an_implausible_or_missing_timed_return_reddens_the_gate[nan-timed_day_not_finite]
E       AssertionError: assert ('2025-10-17', 'timed_day_not_finite') in set()
test_an_implausible_or_missing_timed_return_reddens_the_gate[inf-timed_day_not_finite]
E       AssertionError: assert ('2025-10-17', 'timed_day_not_finite') in {('2025-10-17', 'timed_day_infinite')}
test_an_implausible_or_missing_timed_return_reddens_the_gate[7.0-timed_return_off_cohort_walk]
E       AssertionError: assert ('2025-10-17', 'timed_return_off_cohort_walk') in set()
test_an_implausible_or_missing_timed_return_reddens_the_gate[-0.99-timed_return_off_cohort_walk]
E       AssertionError: assert ('2025-10-17', 'timed_return_off_cohort_walk') in set()
test_a_timed_day_the_walk_reads_as_nan_must_be_published_nan
E       AssertionError: assert ('2025-10-16', 'timed_day_not_nan') in set()
test_the_real_combiner_timed_days_are_verified_against_the_walk
E       KeyError: 'timed_verified'
```

The nudge test's first assertion was `assert hits, <mismatches>`, so its RED line named an empty list and not the arm. After Task 2 it was tightened to `assert ("2025-10-17", "timed_return_off_cohort_walk") in _mismatch_pairs(parity)` (third task commit, below) and the SOAK02-cohort row was re-run on the tightened test. The `[inf-...]` line shows the retired infinity-only kind the 226-03 soak recorded; the pre-change line is kept as observed.

## PROOF-01

Three arms, one neuter at a time. Each neuter was applied to the working copy of `analytics-service/scripts/mt5_soak.py` from a byte backup kept in the session scratchpad. The named test was run from `analytics-service/`, the file was restored with `cp` and compared with `cmp` (no output, exit 0), and the same command was re-run. `git diff --quiet -- analytics-service/scripts/mt5_soak.py` exits 0 after the last restore. Each RED failed on the arm's own first assertion, and the nan and finite neuters keep the `continue`, so nothing else changes.

| arm | neuter edit | command | RED | restore | GREEN |
|---|---|---|---|---|---|
| SOAK02-cohort | in the timed branch of `_reconcile_published_returns`: `            if err > _RETURN_CHECK_TOL:` becomes `            if False:  # NEUTER SOAK02-cohort` (guards the `timed_return_off_cohort_walk` append) | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_small_nudge_on_a_timed_day_reddens_the_gate" -x -q` | RED: E       AssertionError: assert ('2025-10-17', 'timed_return_off_cohort_walk') in set() | cmp: exit 0, no output | GREEN: 1 passed in 18.81s |
| SOAK02-nan | in the timed branch, the two lines `if not math.isnan(actual):` and `_mismatch(day, "timed_day_not_nan", value, actual)` become `pass  # NEUTER SOAK02-nan`, the following `continue` kept | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_timed_day_the_walk_reads_as_nan_must_be_published_nan" -x -q` | RED: E       AssertionError: assert ('2025-10-16', 'timed_day_not_nan') in set() | cmp: exit 0, no output | GREEN: 1 passed in 16.34s |
| SOAK02-finite | in the timed branch, `_mismatch(day, "timed_day_not_finite", value, actual)` becomes `pass  # NEUTER SOAK02-finite`, the following `continue` kept | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_an_implausible_or_missing_timed_return_reddens_the_gate" -x -q` | RED: E       AssertionError: assert ('2025-10-17', 'timed_day_not_finite') in set() | cmp: exit 0, no output | GREEN: 4 passed in 11.41s |

The SOAK02-finite RED is the first parametrized case (`nan`), run with `-x`. The mypy guard mutation from Task 2's acceptance criteria was also run: appending an unannotated `def _guard_probe(x): return x` moved the strict count from 4 to 5; the file was restored from a byte backup (`cmp` exit 0) and the count read 4 again.

## Gates

| Gate | Before (HEAD at 226-03's close) | After | Bound |
|---|---|---|---|
| `tests/test_mt5_soak.py` | 73 passed | `90 passed` (80 after Task 1, 90 after Task 2) | 90 |
| ruff on `scripts/mt5_soak.py` and `tests/test_mt5_soak.py` | 0 | 0 | EXPECT==0 |
| mypy strict on `scripts/mt5_soak.py` | 4 | 4 | <= 4 |
| full analytics suite (Phase contract gate, serial, at the final HEAD) | 15277 passed after 226-03 | `1 failed, 15294 passed, 93 skipped, 3663 warnings in 734.82s (0:12:14)`; gate exit 0 (`GATE_OK`) | no FAILED/ERROR line other than the tolerated one |

- 15294 = 15277 + 17 new tests (7 in Task 1, 10 in Task 2).
- The one failure is the tolerated `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: it launches a nested `-n 2` session and this machine's `python3` cannot import pytest-xdist. No package was installed.
- The mypy count is `scripts/` hygiene, outside CI's mypy surface, so it is not a CI gate. The 4 errors are the pre-existing ones (`dict` type args on `reconcile_parity` and `run_soak`, one untyped lambda call); none was added.
- Acceptance greps: `def _walk_timed_return(` 1, `timed_return_off_cohort_walk` 2, `timing=walk.timing` 1, `NOT by this gate` 0. No file under `analytics-service/services` was touched.

## Task Commits

1. **Task 1: a timed day is recomputed by the soak's own D-17 cohort walk and compared exactly** - `0835d1eaf` (feat)
2. **Task 2: nine cohort shapes hand-derived, the dominance ratio drift-pinned, docstrings updated** - `b44f20dbf` (test)
3. **Task 3 (PROOF-01 follow-up): the nudge test's first assertion names the cohort-walk kind** - `3ca493124` (test)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `analytics-service/scripts/mt5_soak.py` - `_WALK_PNL_DOM_RATIO`, `_walk_day_guard`, `_walk_timed_return`, the timed branch of `_reconcile_published_returns` with its `timing` keyword and `timed_verified`, NaN-to-None for a mismatch's `expected`, `timing=walk.timing` in `reconcile_parity`, the module and function docstrings, and `import bisect`.
- `analytics-service/tests/test_mt5_soak.py` - the four Task 1 tests, nine hand-derived cohort cases, the dominance-ratio drift pin, the extended AST minimum set, `import math` and `import services.nav_twr as nav_twr` in the top import block.

## Decisions Made

- `_walk_day_guard` and `_WALK_PNL_DOM_RATIO` are soak-owned (RESEARCH OQ4); the pin test is the deliberate tripwire for a Phase 229 guard edit.
- The cohort-walk first-assertion tightening was committed as a separate task commit rather than amended into Task 1, so the history shows what the RED evidence rested on.

## Deviations from Plan

None - plan executed exactly as written. The one addition (a third commit tightening the nudge test's first assertion so the SOAK02-cohort RED line names the arm) is within Task 3's PROOF-01 scope: the contract asks for the assertion line that names the arm.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access. The new kind strings are all under 40 characters, no new key is named like a secret or an identity, and the NaN-to-None mapping keeps the record strict-JSON safe (T-226-10).

## Notes for the phase REVIEW.md (LOW, not TODOS.md)

- The cohort walk does not apply the tiny-base reading (RESEARCH finding, Phase 188); that is 226-05's `_walk_tiny_base_days`.
- A timed day's `timed_day_not_walked` branch is defensive: a day in `walk.timing` is always in the level roll, so it is unreachable with the real walk and is exercised only by a hand-built call.

## Issues Encountered

The first full-suite gate run was stopped by hand (killed with `pkill`) so it could be re-run bound to the final HEAD after the third commit. The `pkill -f` patterns were broad (the verbatim gate command and the wait loop), so an identical gate command or wait loop belonging to another agent's session on this machine may have been killed too; none was running afterwards. Nothing in this plan's tree was affected.

## Next Phase Readiness

Ready for 226-05. `_walk_day_guard` and `_WALK_PNL_DOM_RATIO` exist for the untimed branch to move onto, `return_check` carries `timed_verified` for the certified-share numerator, and `walk.timing` plus `_walk_timed_return` are in place for the tiny-base timed expectation.

## Self-Check: PASSED

- `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`: FOUND
- Commits `0835d1eaf`, `b44f20dbf` and `3ca493124`: FOUND (ancestors of HEAD)
- Working-tree `mt5_soak.py` equals the committed one after the last restore (`git diff --quiet` exit 0)
