---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 03
subsystem: analytics-service
tags: [tiny-base, nav-marks, t-gap, t-oq4, allocator-equity]
requires: ["188-01"]
provides:
  - "T-GAP: the days a withheld mark's return would have covered are left out with it"
  - "_pre_start_levels: the 30-day window reaches before the first mark (T-OQ4)"
affects: [key-mode-derive, allocator-equity-compose]
key-files:
  modified:
    - analytics-service/services/nav_marks_apply.py
    - analytics-service/tests/test_tiny_base_marks.py
key-decisions:
  - "T-GAP: gap days of a withheld mark (and, for a withheld first mark, covered_from through S-1) join tiny_base_days with writer_day_pnl 0.0, out of covered_days and mark_gap_days."
  - "T-OQ4: the pre-start levels are rolled back from level_s1 whether or not it is a usable base; the roll stops at an unknown day (KL-3), never raises."
status: complete
commits: 4
plan_head_before: 734fde535053e80b7da14f7b596ffe98cf313357
plan_head_after: bb748847207d76a08e13835b9222847a131cb3a1
actuals:
  tokens: 28000
  tasks: 2
  commits: 4
duration: single session
completed: 2026-11-03
---

# Phase 188 Plan 03: a withheld mark takes its gap days with it, and the 30-day window reaches before the first mark

**The days a withheld tiny mark's single return would have covered are now left out with it (listed, uncovered, P&L 0.0), so a multi-key book sits the key out of the whole withheld period, and the 30-day window sees a peak that sits before the first mark on the writer chain, the wallet roll and the day-P&L roll.**

## What was built

- `services/nav_marks_apply.py`, mark loop, tiny branch only: before appending the mark day to `tiny`, append every day of its `gap` (ascending) and `writer_day_pnl.setdefault(day, 0.0)`. `emitted` already holds `tiny`, so `covered_days` and `mark_gap_days` drop those days with no edit to those expressions. A withheld FIRST mark (`md == start`) takes the days from `covered_from` through S-1 instead, which required computing `covered_from` before the loop (same expression, moved up).
- `_pre_start_levels(start, level_s1, pre, flows, pnl, roll_basis, parsed_terminal, writer_flows)`: private, rolls the end-of-day levels of S-1-30 through S-2 backward from `level_s1` (writer chain `L(d-1) = L(d) - P_d - F_d`; wallet returns `(L(d) - F_d) / (1 + r_d)`, absent day r = 0, NaN day uses P&L if the day has one else stops, factor at or below 0 stops; day-P&L `L(d) - P_d - F_d`). Non-finite level stops. Merged into plan 01's level map before the one `window_peaks` call.
- Module docstring rule 15 extended with T-GAP, T-OQ4, T-LM and KL-3. `TINY_BASE_WINDOW_DAYS` imported from `services.tiny_base` (no new `0.05` or `30` literal in the module).
- `tests/test_tiny_base_marks.py`: 14 new arms (16 total).

## TDD record

### RED 1 (commit 219b3e555), log `/tmp/tinybase-03/red1.log`: 4 failed, 6 passed

Failing, each on the intended assertion: `test_gap_days_before_a_withheld_mark_are_left_out_with_it` (`('2026-03-09',) == ('2026-03-07', '2026-03-08', '2026-03-09')`), `test_a_gap_flow_before_a_withheld_mark_keeps_its_step` (same), `test_a_two_key_book_sits_the_key_out_of_the_whole_withheld_period` (stored `dropped_day_pnl` days `['2026-03-09']`), `test_the_composite_summary_names_none_of_the_withheld_days` (`covered_days=('2026-03-07', '2026-03-08')`). Regression pins that already passed on plan 01's code: key C's own dates on the writer chain with the compose replay, the 29-day roll-off ending 2026-11-24 with a row on 2026-11-25, the gap deposit that lifts the base, the no-marks default, and the two arms of plan 01.

### GREEN 1 (commit b1dd3413c)

`test_tiny_base_marks.py`, `test_tiny_base_roundtrip.py`, `test_nav_marks_apply.py`, `test_nav_marks_compose_roundtrip.py`, `test_nav_marks_derive_apply.py`, `test_stitch_composite_job.py`: 248 passed. mypy clean.

### Neuter drill 1 (backup `nma1.bak`, restored with `cp`, proved with `cmp`)

Gap-day append removed from the tiny branch: 4 failed, 6 passed (`/tmp/tinybase-03/neuter1.log`), the same four arms. Additional check on the money assertion (T-188-18): with the stored-`dropped_day_pnl` assertions cut out of a scratch copy of the two-key arm (deleted afterwards) and the append removed, the book return on 2026-03-07 was 0.000925720 instead of the sibling's 0.001 (the predicted 0.001 x 5000 / 5400), so the book-return assertion itself can fail.

### RED 2 (commit 0957ba024), log `/tmp/tinybase-03/red2.log`: 5 failed, 11 passed

Failing: pre-start peak on the writer chain, on the wallet roll, on the day-P&L roll (`() == (21 days from 2026-03-20)`), the unusable-S-1 arm (`2026-03-21` has a row), the withheld first mark (`() == ('2026-03-08' ... '2026-03-11')`). Regression pin that passed on Task 1's code: the KL-3 arm (the marks are measured with no pre-start peak).

### GREEN 2 (commit bb7488472)

All 16 module arms pass. Listed modules: 246 passed. mypy CI line verbatim: `Success: no issues found in 132 source files`.

### Neuter drill 2 (backup `nma2.bak`, restored, `cmp` clean)

`_pre_start_levels` returning an empty dict: 5 failed, 11 passed (`/tmp/tinybase-03/neuter2.log`), the same five arms. Two extra drills, each restored byte-identical: continuing the roll through a NaN day makes the KL-3 arm fail (1 failed); the first-mark half switched off makes the withheld-first-mark arm fail (1 failed).

## Verification

- Full CI pytest line, verbatim, from `analytics-service/` with the shared venv: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80 -q -p no:cacheprovider`: **13437 passed, 97 skipped** (pre-existing skips), coverage 94.50%, "Required test coverage of 80% reached" (`/tmp/tinybase-03/full.log`).
- CI mypy line, verbatim: no issues in 132 source files.
- Imported modules resolve to this checkout (`services.nav_marks_apply.__file__` under `quantalyze-188-p03`).
- Acceptance: `T-GAP` appears 2 times in `nav_marks_apply.py` (baseline 0); `def _pre_start_levels` 1; 16 test functions in `test_tiny_base_marks.py` (needs 14); `git diff --stat` against the plan base on `job_worker.py`, `allocator_equity_compose.py`, `allocator_equity_derive.py` prints nothing; `STATE.md` and `ROADMAP.md` untouched.
- Scratch: `/tmp/tinybase-03` (the plan's `/tmp/tinybase-01` naming was not used).

## Read-only check of the key-mode writer-basis join (Task 2 STOP rule)

`job_worker.py` concatenates `_pre_pnl` (writer P&L dated before `marks_since`) with `_post_pnl` (all of `writer_day_pnl`), and `writer_basis_payload`/`read_writer_basis` refuse a repeated day. The new pre-start entries are dated `covered_from` through S-1, which are by construction after the LAST INPUT day (a NaN day counts as an input day). The writer's NAV days are the days the stored returns are chained from, so every one of them is at or before the last input day, apart from the first NAV day, which sits before the first input day. A quiet day therefore holds no realized writer P&L and the two cannot share a day; no STOP, `job_worker.py` unedited. This is a reasoning check, not an end-to-end run on an MT5/Deribit derive; the first-mark half is only reachable through the wallet or writer pre-start peak, and no PROD key is known in that shape.

## Deviations from Plan

None. The plan executed as written. Two notes:

- The two-key arm fails on the stored `dropped_day_pnl` assertion before it reaches the book-return assertion on plan 01's code; the book-return assertion is covered by the extra drill above.
- The plan's verify command names `python3 -m pytest` / `pytest` / `mypy` bare; the shared venv's binaries were used (`.../analytics-service/.venv/bin`).

No existing test newly failed (the fixture-under-5% STOP rule did not trigger).

## Carried limit: KL-3

On a ccxt venue (OKX, Bybit, Binance: `roll_basis="returns"`, no day P&L) the pre-start roll stops at the first NaN input day, a guard day or, after plan 04, a quiet day the rule left out, so a peak before it is not seen by the first marks' windows. Pinned by `test_kl3_the_roll_stops_at_an_unknown_day_and_never_raises` as a recorded limit, never a refusal (rolling through an unknown day would invent a level, SC-5). RESEARCH "Blast radius" finds no PROD key in this shape.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; no migration; no package installed. T-188-04 (a derive that refuses forever) mitigated: `_pre_start_levels` stops instead of raising. T-188-18 (an invented flat day) mitigated: the two-key arm asserts the book return equals the sibling's exactly, and the drills show it can fail.

## Self-Check: PASSED

Files exist: `analytics-service/services/nav_marks_apply.py`, `analytics-service/tests/test_tiny_base_marks.py`. Commits 219b3e555, b1dd3413c, 0957ba024, bb7488472 are ancestors of HEAD (4 commits since the plan base `734fde535`).
