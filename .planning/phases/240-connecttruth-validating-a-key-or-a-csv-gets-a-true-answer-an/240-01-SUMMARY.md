---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 01
subsystem: analytics-service/csv-validator
tags: [csv, dates, month-name, CONN-06, validator]
status: complete
requires: []
provides:
  - "a month-name date cell (12 Mar 2024, 12-Mar-2024, 12 March 2024, quoted Mar 12, 2024) is read inside a DD/MM/YYYY, MM/DD/YYYY or ISO date column"
  - "the date_format_normalized info flag names the month-name dates it read (UI-SPEC 1.3 forms)"
affects: [analytics-service/services/csv_validator.py]
tech-stack:
  added: []
  patterns: ["mask month-name cells out of both date readings and merge them back (same shape as the year_first merge)"]
key-files:
  created: []
  modified:
    - analytics-service/services/csv_validator.py
    - analytics-service/tests/test_csv_validator_date_format_2026_05_27.py
key-decisions:
  - "detected_format for the month-only flag is month_name (planner choice, UI-SPEC leaves it open)"
  - "trades fixtures are copied into the test file (a local _trades_csv), not imported from tests/test_csv_validator.py, to keep the file free of collection coupling"
  - "an out-of-order month-name cell is reported by monotonic_dates at row 0, exactly as an out-of-order numeric date is at HEAD (UI-SPEC's 'at its row' narrowed to the measured rule)"
requirements-completed: [CONN-06]
plan_head_before: c37593fa674a3d5a02a8cbf30ea8b03d69a03790
plan_head_after: 4fa5231d50106adca018e11356e8035c959fdccd
commits: 3
actuals:
  tokens: 4550
  tasks: 3
  commits: 3
---

# Phase 240 Plan 01: Month-name dates in a numeric-date CSV column Summary

A date written with an English month name now parses inside a numeric-date column (first, mid-file or last row; DD/MM/YYYY, MM/DD/YYYY or ISO; daily_returns, daily_nav and trades), and the existing `date_format_normalized` info flag says how many were read, in the UI-SPEC 1.3 wording.

## What was built

- `_MONTH_NUMBER`, `_MN_DMY`, `_MN_MDY` (ASCII regexes, four-digit year only, bounded classes, `fullmatch`), `_read_month_name_cell`, `_month_name_cells`, `_month_name_flag_sentence`, `_month_only_flag` in `services/csv_validator.py`, beside the other date-parse helpers, plus `import datetime`.
- In `_detect_and_normalize_date_column` only: month-name cells are masked out of both `_parse_dates` readings and filled back from their own parse (the year_first merge shape); the month-first "unchanged" branch no longer returns early when a month-name cell exists (`and not month_named.any()`); `n_month` is counted only when the column also holds a non-month, non-blank cell; the equal-parse and month-first-rewrite branches return `_month_only_flag(n_month)` when positive; the day-first branch appends the "Also read ..." sentence.
- `_maybe_auto_normalize_percent_form` (Phase 222) is byte-identical (sha256 prefix `c3d02261d1da544c`), `contact support` count stays 1, no new `"rule":` literal.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 60435fe80 | strict reader, mask, merge; tracer test |
| 2 | 1b2f40483 | US-branch guard, acceptance matrix, held rejections, edges, blank-cell fix |
| 3 | 4fa5231d5 | flag sentences, count scope, byte-identical day-first pin |

## Verification (all run from analytics-service/, Python 3.12.13)

- `pytest tests/test_csv_validator_date_format_2026_05_27.py tests/test_csv_validator.py tests/test_csv_hostile_inputs_170_1.py tests/test_csv_never_raises_170_1.py tests/test_csv_excel_quirks.py tests/test_csv_header_case.py tests/test_csv_rule_family_oracle.py` : `1189 passed`
- CI strict mypy command : `Success: no issues found in 143 source files`
- `git status --porcelain -- supabase/migrations` : empty
- Acceptance matrix: 4 spellings x 3 positions x 3 column formats = 36 daily_returns cases plus 12 preview-form cases, 3 daily_nav, 3 trades.
- Evidence is local (Python 3.12.13, the venv CI mirrors on version); CI is authoritative.

## Tracer RED at HEAD (before the change)

```
E       AssertionError: [{'rule': "coerce_dtype('datetime64[ns]')", 'row': 12, 'message': "Column 'date' failed rule 'coerce_dtype('datetime64...me64[ns]')", 'row': 12, 'message': "Column 'date' failed rule 'dtype('datetime64[ns]')' at row 12.", 'column': 'date'}]
E       assert False is True
1 failed, 13 deselected, 1 warning in 9.65s
```
After the change: `14 passed, 2 warnings in 12.99s`.

## PROOF-01 (verbatim; each neuter on the real file after `cp` to a byte backup in the scratchpad, restored with `cp`, `cmp` exit 0, then GREEN)

### 1. Task 1: `_month_name_cells` returns an all-False mask

```
--- RED (neutered: _month_name_cells all-False mask)
E       AssertionError: [{'rule': "coerce_dtype('datetime64[ns]')", 'row': 12, 'message': "Column 'date' failed rule 'coerce_dtype('datetime64...me64[ns]')", 'row': 12, 'message': "Column 'date' failed rule 'dtype('datetime64[ns]')' at row 12.", 'column': 'date'}]
FAILED tests/test_csv_validator_date_format_2026_05_27.py::test_month_name_cell_mid_file_in_day_first_column_is_read
1 failed, 13 passed, 2 warnings in 35.01s
cmp exit 0
--- GREEN
14 passed, 2 warnings in 38.09s
```

### 2. Task 2, first row: parse `s` instead of `s.where(~month_named)` in both readings

```
--- RED
10 failed, 67 passed, 2 warnings in 11.18s
FAILED test_month_name_cell_is_read_in_every_position_and_column_format[d_mon_hyphen_y-first-dmy]
FAILED test_month_name_cell_is_read_in_every_position_and_column_format[d_mon_hyphen_y-first-mdy]
FAILED test_month_name_cell_is_read_in_every_position_and_column_format[d_mon_y-first-dmy]
FAILED test_month_name_cell_is_read_in_every_position_and_column_format[d_mon_y-first-mdy]
cmp exit 0
--- GREEN
77 passed, 2 warnings in 10.44s
```

### 3. Task 2, US branch: delete `and not month_named.any()`

```
--- RED
18 failed, 59 passed, 2 warnings in 10.71s
FAILED test_month_name_cell_in_daily_nav_is_read[mdy]
FAILED test_month_name_cell_in_trades_is_read[mdy]
FAILED test_month_name_cell_is_read_in_every_position_and_column_format[d_mon_hyphen_y-first-mdy]
FAILED test_month_name_cell_is_read_in_every_position_and_column_format[d_mon_hyphen_y-last-mdy]
cmp exit 0
--- GREEN
77 passed, 2 warnings in 11.85s
```

### 4. Task 2, two-digit year held: `_MN_DMY` year group widened to `\d{2,4}`

```
--- RED
1 failed, 76 passed, 2 warnings in 11.82s
FAILED test_unreadable_month_spelling_is_still_a_row_error[12 Mar 24]
cmp exit 0
--- GREEN
77 passed, 2 warnings in 10.61s
```

### 5. Task 3, flag: `_month_name_flag_sentence` drops the count

```
--- RED
5 failed, 82 passed, 2 warnings in 10.39s
FAILED test_flag_count_prints_with_a_thousands_separator[iso]
FAILED test_flag_count_prints_with_a_thousands_separator[mdy]
FAILED test_flag_day_first_column_with_one_month_cell
FAILED test_flag_day_first_column_with_three_month_cells
FAILED test_flag_iso_column_with_two_month_cells
cmp exit 0
--- GREEN
87 passed, 2 warnings in 11.13s
```

### 6. Task 3, count scope: count month cells without the non-month-cell condition

```
--- RED
2 failed, 85 passed, 2 warnings in 10.17s
FAILED test_column_entirely_month_names_is_accepted_with_no_flag_as_at_head
FAILED test_single_row_month_name_file_is_accepted_with_no_flag_as_at_head
cmp exit 0
--- GREEN
87 passed, 2 warnings in 10.14s
```

## Measured at HEAD, pinned as-is

- Column entirely month names (5 rows) and a single-row month-name file: ok true, no flag, dates read, identical at HEAD (measured by swapping in the HEAD file via byte backup) and after.
- Blank date beside a month-name cell: HEAD reported `not_nullable` at row 2 plus `coerce_dtype`/`dtype` at the month cell's row; now only `not_nullable` at row 2 (the month cell is read). The plan's "still reports not_nullable at its row" holds.
- Out-of-order month-name cell: `monotonic_dates` at row 0, identical to the same file written numerically (pinned in one test by comparing both).

## Deviations from Plan

**1. [Rule 1 - Bug] `_read_month_name_cell` crashed on a blank date cell**
- **Found during:** Task 2 measurement of "a blank cell beside a month-name cell".
- **Issue:** with pandas 3 string dtype, a blank date cell reaches the detector as a missing value (a float NaN), not the string `"nan"`; `cell.strip()` raised `AttributeError`, which would have escaped `validate_csv` for any non-ISO column with a blank date.
- **Fix:** the reader takes `object`, returns None for a non-string. Pinned by `test_blank_date_beside_a_month_name_cell_still_reports_not_nullable`.
- **Files modified:** analytics-service/services/csv_validator.py
- **Commit:** 1b2f40483 (the bug was introduced in 60435fe80's helper and fixed here)

**2. Branch-name allow-list.** The task-commit protocol's agent-branch allow-list (`agent-*`) does not match the orchestrator-pinned branch `wt/240-p01`; the pin in the prompt names that branch explicitly and it is neither detached nor a protected/default branch, so I committed there.

**3. Plan-file accounting.** The Task 1 test fixture uses varied returns (the constant-return D-24 rule rejected the first draft), and `import pytest` was added to the test file for parametrization.

Otherwise the plan was executed as written; no other logic change was needed in Task 2 beyond the planned `and not month_named.any()`.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the reader is anchored `fullmatch` over bounded classes (T-240-01), four-digit year and own English table (T-240-02), and the flag text carries only a fixed example and a count (T-240-03, pinned by `test_flag_message_carries_no_cell_from_the_file`).

## TODOS closed (deleted at ship, not here)

`[170.1-CSV-ODD-SPELLING-REJECTED]`.

## Self-Check: PASSED

- analytics-service/services/csv_validator.py and analytics-service/tests/test_csv_validator_date_format_2026_05_27.py exist and carry the changes.
- Commits 60435fe80, 1b2f40483, 4fa5231d5 are ancestors of HEAD on wt/240-p01.
