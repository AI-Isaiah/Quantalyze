---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 08
subsystem: analytics-service
tags: [deribit, options, smoothed-mtm, exercise, gap-closure, G252-PROBE-M3]
requires: [252-07]
provides:
  - "services/deribit_txn.py: replay_option_positions admits an option exercise row only when _row_field_shape reads zero for both change and position, and closes it to 0.0 on its UTC day"
  - "the nine-shape exercise refusal matrix, the cash-twin pin and the type-set pin"
affects: [252 re-run of the founder-gated PROD probe]
tech-stack:
  added: []
  patterns: ["admit by the same closed shape words that produced the PROD reading", "close via the existing generic position read, no dedicated branch"]
key-files:
  created: []
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/tests/test_deribit_assignment.py
    - analytics-service/tests/test_deribit_options_smoothed_probe.py
key-decisions:
  - "Founder decision 2026-11-27 (partial reversal of D-09): only change zero with a PRESENT position zero closes; absent and non-numeric change refuse because the decision accepts change zero only"
  - "No new close branch: the admitted row takes the generic position read, which yields 0.0 for every admitted row (a dedicated 0.0 branch would be unpinnable)"
  - "exercise stays out of CASH_BEARING_TYPES, INFORMATIONAL_TYPES, _OPTION_BOOK_EVENT_TYPES and _OPTION_BOOK_CLOSE_TYPES"
patterns-established:
  - "A byte-identity matrix on a stored refusal message beside the one shape that no longer refuses"
requirements-completed: []
duration: ~25m
completed: 2026-11-27
status: complete
commits: 2
plan_head_before: 828be2405ac3fa99f8baa617d0fb27ed5f1c3381
plan_head_after: 77eebbade9b346b6b531e92689a138d2affaef18
actuals:
  tokens: 4200
  tasks: 2
  commits: 2
---

# Phase 252 Plan 08: Accept the measured exercise shape as an option close Summary

`replay_option_positions` now closes an option position on its UTC day when an `exercise` row reads `change` zero and a present `position` zero (the exact words the 2026-11-27 PROD probe printed for m3), and every other exercise shape still raises `OptionExerciseRowError` with unchanged bytes.

## What changed

- `services/deribit_txn.py`, `replay_option_positions`: at the existing exercise branch the gate computes `_row_field_shape(row, "change")` and `_row_field_shape(row, "position")` and raises the HEAD `OptionExerciseRowError` (same message, same attributes, same census, same point in the first loop) unless both equal `ROW_FIELD_ZERO`. An admitted row falls through to `per_instr` and `ccy_of`, and the ordered per-instrument loop reads its own `position` (zero) as the day's end-of-day position. No branch added, `_expiry_close` not called.
- Comments updated with the literal text `Founder decision 2026-11-27` above `_OPTION_EXERCISE_TYPE`, in the `replay_option_positions` docstring, and at the exercise branch. The refusal message text is byte-identical.
- No change to `_OPTION_BOOK_CLOSE_TYPES`, `_OPTION_BOOK_EVENT_TYPES`, `CASH_BEARING_TYPES`, `INFORMATIONAL_TYPES`, `_expiry_close`, either cash twin or any other function.

## Commits

| Task | Commit | Content |
|---|---|---|
| 1 (tracer) | `3914d0716` | gate + comments + `test_d09_measured_shape_exercise_closes_in_the_replay`, `test_d09_smoothed_e2e_measured_shape_exercise_then_later_activity_ingests`, `test_a_measured_shape_exercise_member_passes_like_an_expiry_close` |
| 2 | `77eebbade` | nine-shape refusal matrix, cash-twin pin, type-set pin |

TDD: the three Task 1 cases were run first and failed at the plan-07 head with `OptionExerciseRowError`.

## Verification

Python environment: `python3 -m mypy --version` printed `mypy 2.0.0`, which is not the 2.4.0 pin, so every pytest and mypy command ran with the main checkout's analytics venv interpreter (`mypy 2.4.0 (compiled: yes)`) with cwd `analytics-service/` of this worktree.

- Pre-edit count of the Task 2 verify command at `828be2405`: `944 passed, 55 warnings in 32.46s`.
- Post-edit, same command: `959 passed, 55 warnings in 20.74s` (944 + 15 new: 3 task 1 cases, 9 matrix cases, 2 cash-twin cases, 1 type-set pin; 0 failures).
- mypy services/routers/models/main files: `Success: no issues found in 146 source files`.
- mypy `scripts/deribit_options_smoothed_probe.py`: `Success: no issues found in 1 source file`.
- `node scripts/verify-plan-anchors.mjs --pending`: exit 0.
- Acceptance greps: `grep -a -c 'frozenset({"expiry"})'` prints 1; the stored-message grep prints 1; removed test lines against `9cb2df6ae` (`grep -a -c '^-[^-]'`) prints 0; non-analytics files in the diff against `9cb2df6ae`: 0 (the three files above).

### Probe-level case

The probe ledger is the fixture plus a funding `deposit` row on BTC (change 1.0, 2026-01-14) with summaries equity 0.96. The expiry control reached `member_verdict: pass` on its own, so no STOP was needed. The exercise record equals the expiry control record on every key (`assert ex_records == control_records`), builds `ok`, `refusal_shape` null, c3 `pass`, c4 `pass`, `series_days > 0`, verdict line `pass`, and `_assert_no_row_text_in` holds for ids 7501 to 7505.

### Reader table (re-grepped with `git grep -n -E "_OPTION_BOOK_CLOSE_TYPES|_OPTION_EXERCISE_TYPE|_OPTION_BOOK_EVENT_TYPES" -- services scripts routers`, code lines, comment-only lines excluded)

Counts: `_OPTION_BOOK_CLOSE_TYPES` 5 lines, `_OPTION_EXERCISE_TYPE` 3 lines, `_OPTION_BOOK_EVENT_TYPES` 16 lines (definition, asserts, docstring mentions and readers). The executable readers match the planned table exactly; no unlisted reader sees an exercise row.

| Reader | Reads | Changes? |
|---|---|---|
| `replay_option_positions` (first-loop filter, exercise gate, ordered close read) | all three symbols | yes, the only change |
| `_pre_coverage_option_days` | `_OPTION_BOOK_EVENT_TYPES` | no |
| `_option_activity_after_coverage` | `_OPTION_BOOK_EVENT_TYPES` | no |
| `_assert_smoothed_summary_cross_check` | `_OPTION_BOOK_EVENT_TYPES` | no |
| `txn_rows_to_native_daily` mark_to_market arm | `_OPTION_BOOK_EVENT_TYPES` | no |
| both cash twins, unknown-type guard | type outside both cash sets | no |
| `scripts/deribit_acceptance.py` option-activity read | `_OPTION_BOOK_EVENT_TYPES` | no |

## PROOF-01 outputs (verbatim; each neuter on the file with a byte backup, restored by `cp`, `cmp` exit 0, then GREEN)

Backup: `deribit_txn.py.impl252-08` in the session scratchpad, `cmp` equal to the file before every neuter.

### Task 1: accepted exercise row `continue`s before it joins `per_instr`

```
=== NEUTERED (accepted exercise row continues before per_instr) ===
E       AssertionError: assert {'2026-01-15': 1.0} == {'2026-01-15'...6-01-17': 0.0}
E                   services.deribit_txn.OptionMarkHoleError: option daily-MTM hole: instrument=BTC-17JAN26-50000-P carries a nonzero position on 2026-01-18 but has NO daily mark (bar) — refusing to interpolate or fall back to the session lump (D-07: a missing bar inside a listed instrument's life is structural, fail loud)
E       AssertionError: assert 'build-error:...MarkHoleError' == 'ok'
E         + build-error:OptionMarkHoleError
FAILED tests/test_deribit_assignment.py::test_d09_measured_shape_exercise_closes_in_the_replay
FAILED tests/test_deribit_assignment.py::test_d09_smoothed_e2e_measured_shape_exercise_then_later_activity_ingests
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_measured_shape_exercise_member_passes_like_an_expiry_close
3 failed, 199 deselected in 17.23s
(restore) cmp exit 0
3 passed, 199 deselected in 13.01s
```

### Task 2, change check (gate accepts when only the position word is `zero`)

```
FAILED ...test_d09_every_exercise_shape_but_the_measured_one_still_refuses_byte_identically[nonzero_change]
FAILED ...[change_omitted]
FAILED ...[change_none]
FAILED ...[change_non_numeric]
4 failed, 210 passed in 13.93s
restore cmp exit 0
```

### Task 2, position presence (gate also accepts position word `absent`)

```
FAILED tests/test_deribit_assignment.py::test_d09_an_exercise_row_refuses_in_the_replay
FAILED tests/test_deribit_assignment.py::test_d09_exercise_refusal_is_its_own_class_with_the_same_instrument_census
FAILED tests/test_deribit_assignment.py::test_d09_every_exercise_shape_but_the_measured_one_still_refuses_byte_identically[position_omitted]
FAILED tests/test_deribit_assignment.py::test_d09_every_exercise_shape_but_the_measured_one_still_refuses_byte_identically[position_none]
FAILED tests/test_deribit_assignment.py::test_d09_every_exercise_shape_but_the_measured_one_still_refuses_byte_identically[position_blank]
FAILED tests/test_deribit_options_smoothed_probe.py::test_an_exercise_ledger_reads_its_own_class_and_the_row_shape
6 failed, 208 passed in 11.90s
restore cmp exit 0
```

(The two pre-existing exercise tests and the pre-existing probe case fail by name too: those unedited tests omit `position`.)

### Task 2, position zero (gate accepts any position word except `absent`)

```
FAILED ...[position_non_numeric]
FAILED ...[nonzero_position]
2 failed, 212 passed in 11.11s
restore cmp exit 0
```

### Task 2, cash twin (nonzero-change raise removed from `txn_rows_to_native_daily`'s unknown-type guard)

```
FAILED tests/test_deribit_assignment.py::test_d09_both_twins_agree_on_an_expiry_row[native_twin]
FAILED tests/test_deribit_assignment.py::test_d09_both_twins_ignore_a_measured_shape_exercise_and_refuse_one_with_cash[native_twin]
2 failed, 212 passed in 15.94s
restore cmp exit 0
```

### Plan-checker addendum: `exercise` added to `_OPTION_BOOK_CLOSE_TYPES`, then to `CASH_BEARING_TYPES`

```
=== close_types neuter ===
FAILED tests/test_deribit_assignment.py::test_d09_exercise_is_in_none_of_the_cash_event_informational_or_close_sets
1 failed, 213 passed in 12.06s
restore cmp exit 0
=== cash_types neuter ===
FAILED tests/test_deribit_assignment.py::test_d09_both_twins_ignore_a_measured_shape_exercise_and_refuse_one_with_cash[usd_twin]
FAILED tests/test_deribit_assignment.py::test_d09_both_twins_ignore_a_measured_shape_exercise_and_refuse_one_with_cash[native_twin]
FAILED tests/test_deribit_assignment.py::test_d09_exercise_is_in_none_of_the_cash_event_informational_or_close_sets
3 failed, 211 passed in 8.76s
restore cmp exit 0
=== GREEN after the last restore ===
214 passed in 11.65s
```

Honest reading of the addendum: adding `exercise` to the close set is behaviourally invisible (the exercise gate runs before the close read, so refused shapes still raise `OptionExerciseRowError` and an admitted row closes to 0.0 either way), so only the type-set pin can see it, and it does. The zero-change cash-twin cases fail under the CASH_BEARING_TYPES variant (both twins). The matrix cases are guarded by the three gate neuters above, not by a type-set neuter.

## Deviations from Plan

None. The plan executed as written; the addendum neuter was added as requested.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; T-252-22 to T-252-24 mitigations are the matrix, the three widening neuters, the type-set and twin pins, and the unedited stored-message bytes.

## Next step (restated for the verifier)

1. This plan ships in the next 252 ship PR. After the Railway worker deploys it, the orchestrator re-runs the probe, founder-gated as before. The strategy id is typed on the command line only, and only lines starting with `{"` are pasted into the phase record.
2. The probe names only the FIRST refusal per member (252-07). Clearing m3's exercise refusal can expose a later one, such as a mark hole. G252-PROBE-M3 closes only on a PROD re-run that reads verdict `pass`. Any new refusal is a new reading, routed as 252-07's "Next step" describes.
3. Honest limit: the close day's change in MTM is minus the option's last marked value. This plan does not measure whether the in-the-money payout lands as cash on the same day elsewhere in the log. The probe re-run's C4 and days-over-guard readings are where a mismatch would show.

## Self-Check: PASSED

- `analytics-service/services/deribit_txn.py`, the two test files: present, in commits `3914d0716` and `77eebbade` (both ancestors of HEAD).
- `git rev-list --count 828be2405..HEAD` = 2 at SUMMARY write.
