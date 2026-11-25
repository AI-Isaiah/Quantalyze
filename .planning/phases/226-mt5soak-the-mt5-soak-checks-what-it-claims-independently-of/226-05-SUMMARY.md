---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
plan: 05
subsystem: testing
tags: [mt5, soak, checked-share, tiny-base, proof-01]

requires:
  - phase: 226-04
    provides: the soak's own cohort walk (_walk_timed_return, _walk_day_guard) and the timed_verified count
provides:
  - "return_check ok also requires certified_share = (checked + timed_verified) / (checked + timed + guarded) >= _MIN_CHECKED_SHARE (0.5); one certified day among two hundred is not green"
  - "A tiny-base day (base positive and under 5% of the previous-30-day peak, read by the soak's own _walk_tiny_base_days) must be published NaN on every day class; the kind tiny_base_day_not_nan names a quiet one"
  - "The untimed branch judges guards with the soak-owned _walk_day_guard, so the published-return reading references no nav_twr, broker_dailies or mt5_deals name"
affects: [229-mt5derive2, ship]

actuals:
  tokens: 4900
  tasks: 3
  commits: 2
plan_head_before: 978ec8b7c39354e113d81ebe24453edb8467025e
plan_head_after: 94d694114eb96c7272a6fefc2835e57bee35f51b
commits: 2

tech-stack:
  added: []
  patterns:
    - "The tiny-base reading is a soak-owned re-implementation from spec (_walk_tiny_base_days over bisect and datetime); its two constants are drift-pinned to services.tiny_base"
    - "The share floor is one reversible named constant, set from fixture shares because no live soak record exists"

key-files:
  created: []
  modified:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py

key-decisions:
  - "_MIN_CHECKED_SHARE = 0.5, set from fixture shares (timed fixture 2/3, young account 4/7, the TODO's case 1/200), not from a live soak record"
  - "Timed days that pass the exact cohort compare count as certified; quiet tiny-base days stay in flat, outside the denominator; vacuous keeps meaning checked == 0 (RESEARCH OQ3)"
  - "OQ4 completed: the untimed branch moved onto _walk_day_guard, and the nav_twr import shrank to UNREALIZED_MATERIALITY_RATIO"

requirements-completed: [SOAK-02]

coverage:
  - id: D1
    description: "A run that certified 1 of 5 certifiable days (0.2), or 1 of 201, reads not green with zero mismatches; exactly 0.5 is green and 0.4 is not; a zero denominator gives None and not green"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_run_certifying_under_half_its_days_is_not_green"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_one_checked_day_among_two_hundred_is_not_green"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_checked_share_boundary"
        status: pass
    human_judgment: false
  - id: D2
    description: "The real combiner on a 96% withdrawal followed by trading, a quiet day and a deposit reconciles green with tiny_base 4 and certified_share 4/7; a finite value on a tiny quiet, active or timed day reds under its own kind"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_tiny_base_day_the_real_combiner_leaves_out_is_explained"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_a_finite_value_on_a_tiny_base_day_reddens_the_gate"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_tiny_base_reading_is_hand_derived"
        status: pass
    human_judgment: false
  - id: D3
    description: "The tiny constants equal services.tiny_base's, the return reading references no production guard name, and the AST minimum set covers _walk_tiny_base_days"
    requirement: SOAK-02
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_tiny_base_constants_match_production"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_return_reading_uses_no_production_guard"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_mt5_soak.py#test_the_walk_imports_no_production_helper"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-23
status: complete
---

# Phase 226 Plan 05: SOAK-02 checked share and tiny-base reading Summary

**The MT5 soak now refuses green when it certified under half of its certifiable days (`_MIN_CHECKED_SHARE = 0.5`), and explains a tiny-base NaN with its own `_walk_tiny_base_days` reading (never production's meta), with the untimed guards on the soak-owned `_walk_day_guard`.**

## Performance

- **Duration:** about 20 min (about 10 of them the full-suite gate)
- **Completed:** 2026-11-23
- **Tasks:** 3 (auto/tdd, auto/tdd, PROOF-01 and gates)
- **Files modified:** 2 (`analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`)

## Accomplishments

- `return_check` gains `certified_share`, `min_certified_share` and `tiny_base`. `ok` is `not mismatches and not vacuous and certified_share is not None and certified_share >= _MIN_CHECKED_SHARE`; `vacuous` still means `checked == 0`. The constant's comment carries the rationale (fixture shares 2/3, 4/7, 1/200; timed days that pass the cohort compare count as certified; flat days excluded; one reversible number).
- `_walk_tiny_base_days(levels, *, initial, days)` re-implements the 5%-of-30-day-peak rule (window `d-30 .. d-1`, carry-in, base positive) from `services.tiny_base` as spec only, with `bisect`, `date` and `timedelta`. `_WALK_TINY_BASE_FRACTION` and `_WALK_TINY_BASE_WINDOW_DAYS` are pinned to production's constants by a test.
- `_reconcile_published_returns` computes the tiny set once and applies it to all three day classes: a timed day expects NaN (reason `tiny_base`), an untimed active day is guarded, and a quiet day stays in `flat` but must be NaN (`tiny_base_day_not_nan`). A non-tiny quiet day must still be exactly 0.0.
- The untimed branch judges guards with `_walk_day_guard`; `_guard_denominator` and `PNL_DOM_RATIO` left the import list (only `UNREALIZED_MATERIALITY_RATIO` remains), and no docstring or comment names the removed helper. The module docstring (FIDELITY (b)) and the function docstring describe the share floor, the soak-owned guard and the tiny-base reading.

## Pre-change RED lines

Task 1 (against the 226-04 soak, before any soak edit). The end-to-end share test reads `ok True` there, because no share floor exists:

```
test_a_run_certifying_under_half_its_days_is_not_green
E       assert (True is False)
test_one_checked_day_among_two_hundred_is_not_green
E       assert (True is False)
test_the_checked_share_boundary
E       KeyError: 'certified_share'
```

Task 2 (against the Task 1 soak). The tiny days read as the three kinds the plan predicted:

```
test_a_tiny_base_day_the_real_combiner_leaves_out_is_explained
E       assert 4 == 0
        (mismatches: checked_day_not_finite on 2025-05-30 and 2025-06-02, plus flat_day_not_zero on 05-31 and timed_day_not_finite on 06-01)
test_a_finite_value_on_a_tiny_base_day_reddens_the_gate[2025-05-31-tiny_base_day_not_nan]
E       AssertionError: assert ('2025-05-31', 'tiny_base_day_not_nan') in {('2025-05-30', 'checked_day_not_finite'), ('2025-06-01', 'timed_day_not_finite'), ('2025-06-02', 'checked_day_not_finite')}
test_a_finite_value_on_a_tiny_base_day_reddens_the_gate[2025-05-30-guarded_day_not_nan]
E       AssertionError: assert ('2025-05-30', 'guarded_day_not_nan') in {('2025-05-30', 'return_off_ledger'), ('2025-05-31', 'flat_day_not_zero'), ('2025-06-01', 'timed_day_not_finite'), ('2025-06-02', 'checked_day_not_finite')}
test_a_finite_value_on_a_tiny_base_day_reddens_the_gate[2025-06-01-timed_day_not_nan]
E       AssertionError: assert ('2025-06-01', 'timed_day_not_nan') in {('2025-05-30', 'checked_day_not_finite'), ('2025-05-31', 'flat_day_not_zero'), ('2025-06-02', 'checked_day_not_finite')}
test_the_tiny_base_reading_is_hand_derived / test_the_walk_tiny_base_constants_match_production
E       AttributeError: module 'scripts.mt5_soak' has no attribute '_walk_tiny_base_days' (and '_WALK_TINY_BASE_FRACTION')
test_the_return_reading_uses_no_production_guard
E       assert {'PNL_DOM_RATIO', '_guard_denominator'} == set()
test_the_walk_imports_no_production_helper
E       AssertionError: '_walk_tiny_base_days' missing from the walk set
```

The tiny-base end-to-end ledger (hand-derived in the test): initial 100_000; three checked days to 102_500; a -98_000 timed withdrawal day (0.0, verified); then four tiny days on bases 4_500, 4_530, 4_530 and 4_540 under a 102_500 peak (5% is 5_125). Counts: checked 3, timed 2 (verified 1), guarded 2, flat 1, tiny_base 4, share 4/7.

## PROOF-01

Two arms, one neuter at a time, on the working copy of `analytics-service/scripts/mt5_soak.py` from a byte backup in the session scratchpad. The named test was run from `analytics-service/`, the file restored with `cp` and compared with `cmp` (no output, exit 0), and the same command re-run. `git diff --quiet -- analytics-service/scripts/mt5_soak.py` exits 0 after the last restore. SOAK02-share goes RED on the test's first assertion (`check["ok"] is False`); SOAK02-tiny on its first assertion (`mismatch_count == 0`).

| arm | neuter edit | command | RED | restore | GREEN |
|---|---|---|---|---|---|
| SOAK02-share | in `_reconcile_published_returns`, the four-line `"ok": (not mismatches and not vacuous and certified_share is not None and certified_share >= _MIN_CHECKED_SHARE),` becomes `"ok": not mismatches and not vacuous,  # NEUTER SOAK02-share` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_run_certifying_under_half_its_days_is_not_green" -x -q` | RED: E       assert (True is False) | cmp: exit 0, no output | GREEN: 1 passed in 10.10s |
| SOAK02-tiny | in `_walk_tiny_base_days`, `return set()  # NEUTER SOAK02-tiny` inserted as the first statement, ahead of `if not levels:` | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_tiny_base_day_the_real_combiner_leaves_out_is_explained" -x -q` | RED: E       assert 4 == 0 | cmp: exit 0, no output | GREEN: 1 passed in 9.71s |

The SOAK02-tiny RED is the last `E` line of the failure; the line above it carries the four mismatches (`checked_day_not_finite` on 05-30 and 06-02, `flat_day_not_zero` on 05-31, `timed_day_not_finite` on 06-01). The mypy guard mutation from Task 2's acceptance criteria was also run: appending an unannotated `def _guard_probe(x): return x` moved the strict count from 4 to 5; the file was restored from a byte backup (`cmp` exit 0) and the count read 4 again.

### Phase-level PROOF-01 index (all 14 arms, ROADMAP SC4)

Each arm's complete row (neuter edit, command, RED line, `cmp: exit 0`, GREEN line) is in the SUMMARY named beside it.

- SOAK01-a: 226-01-SUMMARY.md
- SOAK01-b1: 226-01-SUMMARY.md
- SOAK01-b2: 226-01-SUMMARY.md
- SOAK01-c: 226-01-SUMMARY.md
- SOAK01-d: 226-01-SUMMARY.md
- SOAK03-pnl: 226-02-SUMMARY.md
- SOAK03-flow: 226-02-SUMMARY.md
- SOAK03-indep: 226-02-SUMMARY.md
- SOAK02-timedset: 226-03-SUMMARY.md
- SOAK02-cohort: 226-04-SUMMARY.md
- SOAK02-nan: 226-04-SUMMARY.md
- SOAK02-finite: 226-04-SUMMARY.md
- SOAK02-share: 226-05-SUMMARY.md (this file)
- SOAK02-tiny: 226-05-SUMMARY.md (this file)

## Gates

| Gate | Before (HEAD at 226-04's close) | After | Bound |
|---|---|---|---|
| `tests/test_mt5_soak.py` | 90 passed | `100 passed` (93 after Task 1, 100 after Task 2) | 100 |
| ruff on `scripts/mt5_soak.py` and `tests/test_mt5_soak.py` | 0 | 0 | EXPECT==0 |
| mypy strict on `scripts/mt5_soak.py` | 4 | 4 | <= 4 |
| full analytics suite (Phase contract gate, serial, at the final code HEAD `94d694114`) | 15294 passed after 226-04 | `1 failed, 15304 passed, 93 skipped, 3663 warnings in 582.89s (0:09:42)`; gate exit 0 | no FAILED/ERROR line other than the tolerated one |

- 15304 = 15294 + 10 new tests (3 in Task 1, 7 in Task 2: the parametrized tiny-day test counts as 3).
- The one failure is the tolerated `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: it launches a nested `-n 2` session and this machine's `python3` cannot import pytest-xdist. No package was installed.
- The mypy count is `scripts/` hygiene, outside CI's mypy surface, so it is not a CI gate. The 4 errors are the pre-existing ones (`dict` type args on `reconcile_parity` and `run_soak`, one untyped lambda call); none was added.
- Acceptance greps: `_MIN_CHECKED_SHARE` 5, `"certified_share"` 1, `def _walk_tiny_base_days(` 1, `tiny_base_day_not_nan` 2.
- Phase boundary: `git diff --name-only origin/main...HEAD -- analytics-service/services supabase/migrations` is empty.

## Task Commits

1. **Task 1: a run that certified under half of its certifiable days is not green** - `b39ea6e70` (feat)
2. **Task 2: a tiny-base day production leaves out is explained by the soak's own reading** - `94d694114` (feat)
3. **Task 3: PROOF-01 and the gates** - no code commit; both neuters were restored byte-identical, so the tree equals `94d694114`.

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `analytics-service/scripts/mt5_soak.py` - `_MIN_CHECKED_SHARE`, `_WALK_TINY_BASE_FRACTION`, `_WALK_TINY_BASE_WINDOW_DAYS`, `_walk_tiny_base_days`, the share floor and the `certified_share`, `min_certified_share` and `tiny_base` keys, the tiny-base branches, the untimed branch on `_walk_day_guard`, the shrunken `nav_twr` import, the module and function docstrings, and the `Iterable` and `date` imports.
- `analytics-service/tests/test_mt5_soak.py` - the three share tests, the five tiny-base tests, the extended AST minimum set, and `import services.tiny_base as tiny_base` in the top import block.

## Decisions Made

- 0.5 rests on fixture shares only. Moving it is a one-line change with no data effect.
- Vacuity is unchanged; its cost is stated in the docstring (an account whose every active day is a flow day stays not green).

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access. The new key names (`certified_share`, `min_certified_share`, `tiny_base`) and the kind `tiny_base_day_not_nan` (21 characters) contain no secret-like or identity-like name and stay under 40 characters.

## Notes for the phase REVIEW.md (LOW, not TODOS.md)

- `tests/test_account_unit.py::test_dust_nav_floor_name_is_an_alias_of_the_usd_row`'s docstring still names `scripts/mt5_soak.py` as an importer of the USD dust alias.
- `_walk_tiny_base_days` parses every key with `date.fromisoformat`, which accepts compact and week forms; the soak's days always come from `isoformat()`, so this is not reachable today.

## Ship note (carry into /gsd-ship; CLAUDE.md "TODOS.md holds open work only", rule b)

- The ship PR deletes these three `TODOS.md` entries, which this phase closes: `[164.6.6.2.3-SOAK-BTC-FLOORS]` (226-01), `[164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED]` (226-03, 226-04 and 226-05) and `[164.6.6.2.3-SOAK-DAY-ATTRIBUTION]` (226-02). The CHANGELOG entry names all three.
- Grepped at plan time, nothing outside `TODOS.md` and historical `CHANGELOG.md` lines cites them, so no other pointer needs a fix. Re-grep at ship time to confirm.
- The CHANGELOG entry must also say the first live soak after this merge is a fresh-oracle run. Expect new named mismatches on a real account, and read them before calling the soak broken (RESEARCH "What Pitfall 12 asks for").
- `_MIN_CHECKED_SHARE = 0.5` rests on fixture shares, not on a live soak record.
- Phase 229 MT5DERIVE2 must merge after this phase. Its `nav_twr.py` guard edits will turn the drift pins red on purpose, forcing a conscious soak update.
- LOW, for REVIEW.md only: the `test_account_unit.py` docstring note above.
- The ship branch changes nothing under `.planning`, and its commits carry no attribution trailer and no CI skip token. SOAK-02 closes with this plan.

## Issues Encountered

None. The full-suite gate ran once, in background mode, bound to the final code commit; no process was killed.

## Next Phase Readiness

Plan 05 is the last plan of Phase 226. All 14 PROOF-01 arms have a complete row. Ready for phase verification and the ship step.

## Self-Check: PASSED

- `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`: FOUND
- Commits `b39ea6e70` and `94d694114`: FOUND (ancestors of HEAD)
- Working-tree `mt5_soak.py` equals the committed one after the last restore (`git diff --quiet` exit 0)
