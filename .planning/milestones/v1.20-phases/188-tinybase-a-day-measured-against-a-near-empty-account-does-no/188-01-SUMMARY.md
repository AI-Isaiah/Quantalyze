---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 01
subsystem: analytics-service
tags: [tiny-base, nav-marks, allocator-equity, tracer]
requires: []
provides:
  - "services/tiny_base.py: TINY_BASE_FRACTION, TINY_BASE_WINDOW_DAYS, window_peaks, is_tiny_base"
  - "apply_marks rule 15 and MarkedSeries.tiny_base_days"
  - "key_inputs.dropped_day_pnl rows for marked-era tiny days on every venue"
affects: [allocator-equity-compose, key-mode-derive]
tech-stack:
  added: []
  patterns: ["pure stdlib definition module (nav_twr voice)", "dropped_day_pnl as the derive-to-compose hand-off"]
key-files:
  created:
    - analytics-service/services/tiny_base.py
    - analytics-service/tests/test_tiny_base_roundtrip.py
    - analytics-service/tests/test_tiny_base_marks.py
    - analytics-service/tests/test_tiny_base.py
  modified:
    - analytics-service/services/nav_marks_apply.py
    - analytics-service/services/job_worker.py
key-decisions:
  - "T-LM: the level map is built from every mark's level always, plus the S-1 level whenever computed and finite (level_s1 kept before usable(base0) nulls it)."
  - "T-OQ5: the compose is not edited; it follows the derive's stored dropped_day_pnl decision."
status: complete
commits: 3
plan_head_before: 0d323df1085e738a050dfa4df1fc9773a11ad86e
plan_head_after: 89afadc1aa3bd9e77c984436d7eb503da0fbff88
actuals:
  tokens: 30000
  tasks: 2
  commits: 3
duration: single session
completed: 2026-11-03
---

# Phase 188 Plan 01: the tiny-base rule, applied at the marked seam, handed to the book through dropped_day_pnl

**A mark whose base is under 5% of the 30-day peak (and positive) gets no return row, keeps its real P&L in `writer_day_pnl` and `key_inputs.dropped_day_pnl`, and the real allocator compose leaves the key out of that day's book return with no compose edit.**

## What was built

- `analytics-service/services/tiny_base.py` (new, stdlib only): the only home of 0.05 and 30. `window_peaks(levels, days)` (window t-30 through t-1 inclusive, last entry carried into the window, static-text `ValueError` on a non-finite level or a non-canonical day) and `is_tiny_base(base, peak)` (`0 < base < 0.05 * peak`, strict; D-05: a base at or below zero, a `None` peak and a non-finite base are never tiny).
- `nav_marks_apply.py`: `MarkedSeries.tiny_base_days` appended as the LAST field with a default; `level_s1` kept before `usable(base0)` nulls it; the level map (every mark's level plus the finite S-1 level) is built always, never gated on `base0`; a usable-but-tiny base emits no row, keeps `writer_day_pnl[d] = nav - base - flow`, pins its level, and is left out of `covered_days` and `mark_gap_days`. Module docstring rule 15 added.
- `job_worker.py`: one hunk after the `if _day_pnl_usd is not None:` block, extending `key_inputs.dropped_day_pnl` with the tiny days (NaN returns series on the tiny days against the `writer_day_pnl` series through the existing `dropped_day_pnl_payload`), sorted by day, a repeated day raises `NavReconstructionError` with static text, one counts-only log line.

## TDD record

### RED (commit 4d370def6, `test(188-01): RED - a tiny-base marked day is measured today`)

Command (from `analytics-service/`): `pytest tests/test_tiny_base_roundtrip.py tests/test_tiny_base_marks.py -q -p no:cacheprovider`, log `/tmp/tinybase-01/red1.log`. 6 failed in 7.11s. Every failure was an assertion on the planned behaviour (semantic assessment: the target tests executed and failed for the intended reason, none is an import, fixture or collection fault):

- `test_key_c_shape_tiny_days_have_no_row`: `'2026-03-07' not in {...}` (the row exists today).
- `test_key_c_shape_pnl_reaches_key_inputs`: `KeyError: 'dropped_day_pnl'` (OKX key mode stores none today).
- `test_sole_key_book_leaves_the_tiny_days_out_and_keeps_the_curve`: the book holds a return on 2026-03-07.
- `test_two_key_book_tiny_key_sits_out`: book return 0.0358373 instead of the sibling's 0.001 (the blend of +0.47 and 0.001).
- `test_a_marks_only_series_is_judged_against_its_marks`: `'2026-03-09' not in {... '2026-03-09': 0.47}`.
- `test_an_unusable_first_base_still_judges_the_later_marks`: `'2026-03-10' not in rows`.

The pytest report format is not one the repo's `check tdd-red-evidence` classifier supports, so the machine check was not run; the semantic assessment above stands in for it.

### GREEN (commit 9a94475d2)

All 6 pass; 196 tests across `test_nav_marks_apply`, `test_nav_marks_compose_roundtrip`, `test_nav_marks_derive_apply`, `test_nav_marks_runner`, `test_allocator_equity_dropped_day_returns`, `test_allocator_equity_dropped_day_pnl` pass. mypy (CI line): `Success: no issues found in 132 source files`.

### Task 2 (commit 89afadc1a, `test(188-01): the tiny-base definition at its edges`)

`tests/test_tiny_base.py`: 8 tests (constants pin, strict 5% boundary, D-05 exclusions, t-30/t-31 window edges, sparse carry, short history, 30-day roll-off with days 2..30 tiny and day 31 counting, refusals with no digit in the text). Written after the module, so there is no separate RED commit for it.

## Neuter drills (restored with `cp`, proved with `cmp`)

1. Task 1: `is_tiny_base` made `return False`. `tests/test_tiny_base_roundtrip.py` and `tests/test_tiny_base_marks.py`: 6 failed (log `/tmp/tinybase-01/neuter1.log`).
2. Task 2: `<` changed to `<=` in `is_tiny_base`: `test_boundary_is_strictly_under_five_percent` failed, 1 failed 7 passed (`neuter2.log`).
3. Extra, found by the drill: with `window_first` shifted one day late (t-29), my first draft of the t-30 test still passed, because the t-30 entry is carried into a t-29 window. I strengthened that test (a peak ON t-30 followed by a drop on t-29) and re-ran the drill: `test_window_includes_day_t_minus_30_and_excludes_t_minus_31` and `test_roll_off_after_a_near_total_withdrawal` now fail (`neuter2b.log`). `tiny_base.py` was restored byte-identical each time. No fix to `tiny_base.py` was forced by Task 2.

## Verification

- Full CI pytest line from `analytics-service/`: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`: 13423 passed, 97 skipped (pre-existing skips), coverage 94.50%, "Required test coverage of 80% reached".
- CI mypy line, verbatim: no issues in 132 source files.
- Imported modules resolve to this checkout (`services.tiny_base.__file__` is under `quantalyze-188-p01`).
- Acceptance greps: `TINY_BASE_FRACTION: Final[float] = 0.05` 1; `0.05` / `= 30` absent from `nav_marks_apply.py`; `tiny_base_days` in `job_worker.py` 4; `level_s1 = base0` 1; the existing `if base0 is not None and not usable(base0):` still 1; `job_worker.py` diff vs plan base has exactly 1 hunk; `allocator_equity_compose.py` and `allocator_equity_derive.py` have no diff vs the plan base; `STATE.md` and `ROADMAP.md` untouched. `test_tiny_base.py` has 8 tests and no module-level `services.tiny_base` import.

## Deviations from Plan

None. The plan executed as written. The tracer did not surface the architectural finding the plan told me to watch for: the real compose accepts a key whose last three days carry no return row (`degrade_reasons == []`, `is_trustworthy is True`), so no compose patch was needed.

No existing test newly failed (the STOP rule for a fixture under 5% of its 30-day peak did not trigger).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; no migration; no package installed.

## Notes for later plans

- The pre-start part of the 30-day window (days before S-1) is plan 03's (T-OQ4); today the map holds only marks plus the S-1 level.
- Plan 05 adds the tiny-day list helpers to `tiny_base.py`; Plan 02 adds the realized era.

## Self-Check: PASSED

Files: `services/tiny_base.py`, the three test modules, both modified services files exist. Commits 4d370def6, 9a94475d2, 89afadc1a are ancestors of HEAD (3 commits since the plan base `0d323df10`).
