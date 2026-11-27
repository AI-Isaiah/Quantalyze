---
phase: 252-deribitoptions
reviewed: 2026-11-27T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_assignment.py
  - analytics-service/tests/test_deribit_options_smoothed_probe.py
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 252 plan 08: Code Review (diff 9cb2df6ae..4165f58cd, analytics-service)

**Verdict: no CRITICAL, HIGH or MEDIUM. One LOW and two INFO.** Under this repo's rule they are recorded here only and are not fixed.

- **Close:** the gate at `deribit_txn.py:2601-2615` admits the row only when `_row_field_shape` gives `zero` for both change and position. The row then goes through the generic read (`:2643-2662`): `float(0.0)` makes `positions[day] = 0.0`. It does not go through `_expiry_close`. `exercise` is in none of the cash, event, informational or close sets (`:2474`, `:728`). Same-day order uses the existing `(instant, len(id), id)` sort (`:2626-2633`), the same as for every other row.
- **Scope:** the gate's other branch raises the old message unchanged (`:2606-2614`), with the same shape and census attributes. No `from` clause was added, as before. The diff changes only that block plus comments. The twins, the summary cross-check, `_pre_coverage_option_days` and `_option_activity_after_coverage` (`:2007`, `:2050`), `_expiry_close` and every `_OPTION_BOOK_*` set are unchanged.
- **Tests:** 558 passed across assignment, smoothed_probe, smoothed_mtm_core, navbreach_anchor_probe and deribit_txn. Mutations were run on a copy in the scratchpad:
  - Always raise: 3 new close tests go red.
  - Accept an absent position: 9 tests go red.
  - Accept an absent change: 2 tests go red (`change_omitted` and `change_none`).
  - Accept any position: 11 tests go red.
  - Skip the row with `continue`: 3 tests go red.

### LOW-01: the "zero" reading is wider than JSON zero
`deribit_txn.py:224-230` (used at `:2603-2605`) reads `False`, `"0"`, `" -0.0 "` and `"0e0"` as `zero` for change and for position, so such an exercise row is accepted. Deribit sends JSON numbers, so the practical impact is nil. The decision names `_row_field_shape` as the reader, so this follows it. **Fix (only if the founder wants it narrower):** also require `type(v) in (int, float)` at the gate, and add a param row for `position=False`.

### INFO-01: no test covers same-day or out-of-order input for an exercise row
`test_deribit_assignment.py:1289-1316` passes the rows already in order, with the opening on a different day. Close-wins-the-day is safe only because of the sort at `deribit_txn.py:2626-2633`. **Fix:** add a case that puts the exercise row first in the input list, after a trade earlier the same UTC day, and assert the position on that day is `0.0`.

### INFO-02: the class docstring still says every exercise shape is unmeasured
`deribit_txn.py:179-180` (`OptionExerciseRowError`). The message bytes must stay. **Fix:** change the docstring only, to "every exercise shape except the measured one (founder decision 2026-11-27)".

_Reviewer: Claude (gsd-code-reviewer), depth standard_
