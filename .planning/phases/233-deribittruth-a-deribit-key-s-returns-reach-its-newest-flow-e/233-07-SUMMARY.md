---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 07
subsystem: analytics
tags: [deribit, oracle, dbook-01, proof-01, zero-capital]
requires:
  - phase: 233-05
    provides: the oracle, its tests and fixtures, and the first (VACUOUS) PROD reading
provides:
  - the book oracle counts an emptied level as zero capital in both sums, as the compose does
  - a counted key with no stored basis is withheld no_stored_base_level or refused loudly
  - a loader that reads PROD's payload shapes, plus a sixth read-only statement key_return_days
affects: [233-07 Task 3 (orchestrator PROD re-reading), 185-BOOK-CUMULATIVE-UNEXPLAINED]
tech-stack:
  added: []
  patterns: [hand-derived fixtures, PROOF-01 byte-backup neuter and restore]
key-files:
  created:
    - analytics-service/tests/fixtures/deribit_book_oracle/emptied_zero_capital.json
    - analytics-service/tests/fixtures/deribit_book_oracle/emptied_sole_and_carried.json
    - analytics-service/tests/fixtures/deribit_book_oracle/counted_key_without_basis.json
    - analytics-service/tests/fixtures/deribit_book_oracle/production_shapes.json
  modified:
    - analytics-service/scripts/deribit_book_oracle.py
    - analytics-service/tests/test_deribit_book_oracle.py
    - analytics-service/tests/fixtures/deribit_book_oracle/withheld_emptied_stretch.json
key-decisions:
  - "No closed set changed: a no-basis counted key's days take the existing name no_stored_base_level (test_closed_sets_are_exact untouched and green)."
  - "emptied_stretch keeps a producer: withheld_emptied_stretch.json was re-derived so its published d7 and d8 are the values a book composed without the zero-capital rule would carry."
metrics:
  duration: "not measured (start time was not captured; most wall clock was machine-load-bound pytest runs)"
  completed: 2026-11-25
status: partial
estimate_actuals_note: "Task 3 is the orchestrator's PROD re-reading and is pending; status stays partial until it is appended."
plan_head_before: 0e13e10f2bc5b4ed395f4e3b55b5992b733c4c26
plan_head_after: 252e37c67d753c3149048fbf0997451ae5e1f0a7
commits: 2
actuals:
  tokens: 18000
  tasks: 2
  commits: 2
---

# Phase 233 Plan 07: the Deribit book oracle counts emptied levels as zero capital, withholds a no-basis key by name and reads PROD's shapes Summary

**The oracle now follows the compose's zero-capital rule for emptied levels (in both sums and as a carried level, the last day decided by the anchor band), withholds a counted key with no stored basis under the existing name `no_stored_base_level`, refuses a counted key with no day at all, and reads PROD's own payload shapes.** Tasks 1 and 2 are done and committed; Task 3 (the PROD re-reading) is pending at the orchestrator checkpoint. The `commits: 2` count is the two code commits measured from the persisted ledger at SUMMARY write; the commit that adds this file is not counted in it.

## What changed

- **Task 1 (commit 436c21754).** `roll_key_levels` runs the stamp identity and the emptied scan on the RAW writer-basis levels, then builds the BOOK levels: every emptied day 0.0, the last day decided by the SPEC's anchor block (emptied and the effective anchor, `anchor_usd` or the realized terminal when that is null, inside the two-sided band of the prior peak at that day stays 0.0, otherwise a positive anchor replaces it; a last day that is not emptied keeps today's rule). `KeyLevels` carries the `emptied` set; `emptied_days` became `emptied_scan` and also returns the prior peak at the last day. `reproduce_book` adds 0.0 to the numerator and the denominator for a participant whose previous book level is 0.0, and a day with a sat-out participant and a denominator of exactly 0.0 is omitted `missing_return_inside_coverage` before the non-positive skip names `skipped_nonpositive_denominator`. Docstring formula paragraph and known-limits sentence rewritten.
- **Task 2 (commit 252e37c67).** `stored_return_days` (a key field, accepted only on a key whose four writer-basis arrays are all absent) joins the level days; a counted key with no day anywhere exits 2 at `declared.counted[<i>]`. Absent (null field, or all-null year slices) is distinct from a present empty array. The loader reads `flags` as an array of tokens (object form still readable), the full `inputs` object, the three exit lists as objects with a k-label, a closed reason copied from production (`_FAILING_KEY_EXIT_REASONS`, `_NO_CAPITAL_EXIT_REASONS`) and a day or null, and checks the departure agreement (`_check_exit_agreement`). A sixth `--print-sql` statement, `key_return_days`. Docstring states the export format, the counted-key rule (including the null-anchor `dust` key that the compose omits silently and that is not counted), the per-list departure mapping and the MCP-first, psql-fallback recipe.

## RED before the fix

Task 1 (run on the oracle as plan 233-05 left it, new tests and fixtures in place; the rule fixtures read as the plan predicted):

- `FAILED tests/test_deribit_book_oracle.py::test_withheld_emptied_stretch` (`E       assert 0 == 1`: the old oracle reproduces the re-derived published d7 and d8 and reads CLEAN)
- `FAILED tests/test_deribit_book_oracle.py::test_emptied_level_is_zero_capital` (`E       assert 1 == 0`: STOP)
- `FAILED tests/test_deribit_book_oracle.py::test_emptied_sole_key_and_carried_zero` (`E       assert 3 == 0`: VACUOUS)
- `FAILED tests/test_deribit_book_oracle.py::test_emptied_last_day_anchor_decides` (`E           AttributeError: 'KeyLevels' object has no attribute 'emptied'`)

Task 2 (same method, 8 failed, 1 passed, 26 deselected in the selected run):

- `FAILED tests/test_deribit_book_oracle.py::test_counted_key_without_basis_is_withheld` (`E       assert 2 == 1`: unknown field `stored_return_days`, the plan's predicted exit 2)
- `FAILED tests/test_deribit_book_oracle.py::test_counted_key_with_no_day_is_refused` (`failed: ExportError (keys.k2.composed_day_pnl: expected an array)`, the null-array variant the plan predicted)
- `FAILED tests/test_deribit_book_oracle.py::test_production_shapes_load` (`E       assert 2 == 0`)
- `FAILED tests/test_deribit_book_oracle.py::test_null_field_and_null_slice_read_as_absent` (`failed: ExportError (keys.k1.dropped_day_pnl: expected an array)`)
- `FAILED tests/test_deribit_book_oracle.py::test_exit_lists_and_departures_must_agree` (the old loader exits 2 at `keys.k1.dropped_day_pnl` instead of the exit-list path)
- `FAILED tests/test_deribit_book_oracle.py::test_exit_reason_copies_match_production` (`AttributeError: module 'scripts.deribit_book_oracle' has no attribute '_FAILING_KEY_EXIT_REASONS'`)
- `FAILED tests/test_deribit_book_oracle.py::test_big_day_and_degrade_lines` and `FAILED tests/test_deribit_book_oracle.py::test_print_sql_is_read_only_and_id_free` (the two updated existing tests: object exit-list entry plus declared departure, and six labels with `key_id`)

## PROOF-01

Method: byte backup into the session scratchpad with `cp` and `cmp`, one neuter edit applied by an exact single-occurrence replacement, the named test run, the file restored by `cp` from the backup and `cmp` (exit 0, no output), then the named test re-run. No `git checkout`, `git restore` or `git stash` was used. Each row shows the neuter edit (before `->` after), the command, the first failing lines, the cmp result and the green line.

| arm | neuter edit | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| oracle-emptied-zero | in `roll_key_levels`: `book[day] = 0.0` -> `book[day] = level[day]` (keep the raw level on emptied days) | `pytest tests/test_deribit_book_oracle.py::test_emptied_level_is_zero_capital` | RED: `FAILED tests/test_deribit_book_oracle.py::test_emptied_level_is_zero_capital` (`E       assert 1 == 0`) | cmp: exit 0, no output | GREEN: 1 passed in 51.05s |
| oracle-emptied-numerator | in `reproduce_book`: `if prev_level == 0.0:` -> `if prev_level == -1.0:` (a zero-capital participant contributes its P to the numerator, the denominator-only version) | `pytest tests/test_deribit_book_oracle.py::test_emptied_level_is_zero_capital` | RED: `FAILED tests/test_deribit_book_oracle.py::test_emptied_level_is_zero_capital` (`E       assert 1 == 0`, the d4 dust P) | cmp: exit 0, no output | GREEN: 1 passed in 61.84s (0:01:01) |
| oracle-emptied-anchor | in `roll_key_levels`: `if not in_band and anchor > 0.0:` -> `if anchor > 0.0:` (an emptied last day always takes the effective anchor) | `pytest tests/test_deribit_book_oracle.py::test_emptied_last_day_anchor_decides` | RED: `FAILED tests/test_deribit_book_oracle.py::test_emptied_last_day_anchor_decides` (`E           assert 0.75 == 0.0`) | cmp: exit 0, no output | GREEN: 1 passed in 50.25s |
| oracle-sat-out-zero-denominator | in `reproduce_book`: `if sat_out and denom == 0.0:` -> `if False and sat_out and denom == 0.0:` (delete the sat-out zero-denominator branch) | `pytest tests/test_deribit_book_oracle.py::test_emptied_sole_key_and_carried_zero` | RED: `E         At index 2 diff: 'oracle-omitted: date=2025-01-07 reason=skipped_nonpositive_denominator' != 'oracle-omitted: date=2025-01-07 reason=missing_return_inside_coverage'` | cmp: exit 0, no output | GREEN: 1 passed in 55.95s |
| oracle-no-basis-key | in `roll_key_levels`: drop `\| set(key.stored_return_days)` from the level-day union (ignore `stored_return_days`) | `pytest tests/test_deribit_book_oracle.py::test_counted_key_without_basis_is_withheld` | RED: `E         At index 0 diff: 'oracle-withheld: date=2025-01-05 reason=attribution_mismatch' != 'oracle-withheld: date=2025-01-05 reason=no_stored_base_level'` | cmp: exit 0, no output | GREEN: 1 passed in 50.12s |
| oracle-silent-key-refused | in `_load_declared`: the counted-key refusal condition -> `if False:` (remove the refusal) | `pytest tests/test_deribit_book_oracle.py::test_counted_key_with_no_day_is_refused` | RED: `FAILED tests/test_deribit_book_oracle.py::test_counted_key_with_no_day_is_refused` (`E           assert 1 == 2`: the silent absence reads as a mismatch, exit 1) | cmp: exit 0, no output | GREEN: 1 passed in 30.15s |
| oracle-prod-shapes | in `_load_flags`: `if isinstance(raw, list):` -> `if False:` (refuse the flags array, object only) | `pytest tests/test_deribit_book_oracle.py::test_production_shapes_load` | RED: `FAILED tests/test_deribit_book_oracle.py::test_production_shapes_load - asser...` (`E       assert 2 == 0`) | cmp: exit 0, no output | GREEN: 1 passed in 27.38s |
| oracle-null-slice | in `_flatten`: `all(item is None or isinstance(item, list) ...)` -> `all(isinstance(item, list) ...)` (a null year slice raises as before) | `pytest tests/test_deribit_book_oracle.py::test_null_field_and_null_slice_read_as_absent` | RED: `FAILED tests/test_deribit_book_oracle.py::test_null_field_and_null_slice_read_as_absent` (`E       assert 2 == 0`) | cmp: exit 0, no output | GREEN: 1 passed in 20.72s |
| oracle-exit-departure | in `_check_exit_agreement`: the no-capital departure condition -> `if False:` (remove the departure check) | `pytest tests/test_deribit_book_oracle.py::test_exit_lists_and_departures_must_agree` | RED: `FAILED tests/test_deribit_book_oracle.py::test_exit_lists_and_departures_must_agree` (`E           assert 0 == 2`) | cmp: exit 0, no output | GREEN: 1 passed in 15.84s |

## Pre-push gates (final lines)

- Module: `35 passed in 33.51s` (Task 1 left 29, Task 2 adds six).
- Whole-suite collection (`pytest --collect-only -q`, tail 3): `16782 tests collected in 70.10s (0:01:10)`, exit 0.
- CI strict mypy command (from `analytics-service/`): `Success: no issues found in 143 source files`.
- Hygiene mypy on the script: `Success: no issues found in 1 source file`.
- Whole-tree vitest invariants: `Test Files  17 passed (17)` and `Tests  660 passed (660)`.
- `npm run lint`: `4 problems (0 errors, 4 warnings)`, all four unused-variable warnings in files this plan did not touch (`src/lib/factsheet/composite-read-path.ts`, `src/lib/queries.stale-analytics-detail.test.ts`); the repo hygiene checks all reported OK.
- `gitleaks dir` over the script, the test module and the fixture directory: `no leaks found` on each.
- `python3 analytics-service/scripts/deribit_book_oracle.py --print-sql | grep -ac '^-- oracle ('` prints `6`.

## Known limits

- A3, A4 and A5b as recorded in 233-05-SUMMARY.md `## Known limits` (carried unchanged: stitched child as its own key series, capital outside the base named and not nulled, A5b options-cash annotation).
- A no-basis key's event-time flow days outside its stored return days are not level days (the export carries no event-time flows).
- A no-capital exit whose end day was walked back before its stored terminal day (the job's A3 walk-back) is not modelled.
- A participant's zero previous level is compared with `== 0.0`; a non-emptied level of exactly 0.0 would also contribute nothing, which matches the compose (`equity_prev * ret`) but is untested by a fixture.
- An emptied last day whose effective anchor is out of band and non-positive stays 0.0 in the oracle, where the compose refuses; no real book can reach it.

## Deviations from Plan

None - plan executed as written. Two notes that are not deviations: (1) the PROOF-01 neuter edits were applied by an exact single-occurrence replacement through a scratchpad helper instead of the Edit tool, to stay inside the session's context budget; backup, `cmp`, restore by `cp` and the named-test run were as the procedure states. (2) Only `withheld_emptied_stretch.json` encoded the old rule among the pre-existing fixtures, as predicted; every other pre-existing test passed unchanged.

## Known Stubs

None.

## Threat Flags

None. The oracle still reads and writes nothing and imports no production module; the only new tracked text is synthetic fixtures with letters and low-entropy numbers.

## Task 3: pending at the orchestrator checkpoint

Task 3 is the PROD re-reading of the founder's Deribit book (marker query, `book_curve` first and last, `book_key_kinds`, `key_scalars`, `key_array_by_year`, `book_key_rows`, `key_return_days` per year for each counted key with no writer-basis array, export assembled in the scratchpad, `--input` run, residual diagnosis, STOP rule). It is not performed by an executor. The orchestrator appends `## DBOOK-01 reading` with the `dbook01-*` lines to this file; `status: partial` is flipped only after that.

## Self-Check: PASSED

Checked after writing: the four new fixtures and the three modified files exist, and commits 436c21754 and 252e37c67 are on `gsd/phase-233-deribittruth` (`git merge-base --is-ancestor` for both). No `services/` file, migration, STATE.md or ROADMAP.md is in the diff.

## Task 3: the PROD re-reading, 2026-11-25. STOP, all withheld days structural, waiting on the founder

The orchestrator took the reading read-only. The marker query ran first on MCP, and again on the psql connection before its first read. Every statement was the oracle's own `--print-sql` text, run one per call with values bound through psql variables. psql was the fallback because the per-key arrays are too large for MCP. `book_curve` was read first and last, and `inputs.composed_at` was the same both times, so no compose ran during the export. The export stayed in the session scratchpad.

**The key set.**
- Eight `key_inputs` rows sit under the book. One is a null-anchor `dust` key with no stored returns, which the compose omits silently, so it is not counted and gets no label.
- k4 departs on its no-capital exit day, 2026-10-09.
- k5 departs on its failing-exit day, 2026-11-23, with reason `read_incomplete`, because that day falls before the book's last day.
- k5 carries no writer-basis arrays, so its csv_daily_returns days come in as `stored_return_days`.

dbook01-marker: names PRODUCTION
dbook01-keys: declared=7 labels=k1..k7
dbook01-exit: 1

**Accounting (step 6).** No withheld day is named `attribution_mismatch` or `emptied_stretch`, so no `dbook01-residual:` line is owed. Every withheld published day is structural:
- `no_stored_base_level` covers 110 days, 2026-08-03 to 2026-11-22. These are the days k5 participates in with no stored basis.
- `key_set_not_reproducible` covers 3 days: 2026-10-09, 2026-10-10 and 2026-11-23. Each sits on a declared departure boundary, and `oracle-key-set:` reads `reproduced=yes`.
- `key_basis_not_reproducible` covers 1 day, 2026-01-13.

Of the 920 published days, 806 are explained. Every omitted day has a named reason, and `omission_unexplained` is 0. The 2025 compounding is k1's booked P&L on its own stored base, and all six big days are explained.

**Founder question (pending).** The phase agent cannot ask the founder, so the question goes back through the coordinator. Options:
- "Accept: these days stay published and are named withheld in the reading; DBOOK-01 closes as a reading."
- "Route: stopping publication of these days is a seam S2 change; book it to Phase 234 and keep DBOOK-01 open."

The recommendation is **Accept**, because every withheld day is structural and the key set reproduces. `q-dbook01:`, the CONTEXT and ROADMAP lines, and a closes-todos line on Accept are appended once the answer arrives. Until then this SUMMARY stays `status: partial`.

## DBOOK-01 reading

```
oracle-book: book=A published=920 explained=806 withheld=114 omitted=327 annotated=1246
oracle-key-set: declared=7 n_keys=7 reproduced=yes
oracle-withheld: date=2026-01-13 reason=key_basis_not_reproducible
oracle-withheld: date=2026-08-03 reason=no_stored_base_level
oracle-withheld: date=2026-08-04 reason=no_stored_base_level
oracle-withheld: date=2026-08-05 reason=no_stored_base_level
oracle-withheld: date=2026-08-06 reason=no_stored_base_level
oracle-withheld: date=2026-08-07 reason=no_stored_base_level
oracle-withheld: date=2026-08-08 reason=no_stored_base_level
oracle-withheld: date=2026-08-09 reason=no_stored_base_level
oracle-withheld: date=2026-08-10 reason=no_stored_base_level
oracle-withheld: date=2026-08-11 reason=no_stored_base_level
oracle-withheld: date=2026-08-12 reason=no_stored_base_level
oracle-withheld: date=2026-08-13 reason=no_stored_base_level
oracle-withheld: date=2026-08-14 reason=no_stored_base_level
oracle-withheld: date=2026-08-15 reason=no_stored_base_level
oracle-withheld: date=2026-08-16 reason=no_stored_base_level
oracle-withheld: date=2026-08-17 reason=no_stored_base_level
oracle-withheld: date=2026-08-18 reason=no_stored_base_level
oracle-withheld: date=2026-08-19 reason=no_stored_base_level
oracle-withheld: date=2026-08-20 reason=no_stored_base_level
oracle-withheld: date=2026-08-21 reason=no_stored_base_level
oracle-withheld: date=2026-08-22 reason=no_stored_base_level
oracle-withheld: date=2026-08-23 reason=no_stored_base_level
oracle-withheld: date=2026-08-24 reason=no_stored_base_level
oracle-withheld: date=2026-08-25 reason=no_stored_base_level
oracle-withheld: date=2026-08-26 reason=no_stored_base_level
oracle-withheld: date=2026-08-27 reason=no_stored_base_level
oracle-withheld: date=2026-08-28 reason=no_stored_base_level
oracle-withheld: date=2026-08-29 reason=no_stored_base_level
oracle-withheld: date=2026-08-30 reason=no_stored_base_level
oracle-withheld: date=2026-08-31 reason=no_stored_base_level
oracle-withheld: date=2026-09-01 reason=no_stored_base_level
oracle-withheld: date=2026-09-02 reason=no_stored_base_level
oracle-withheld: date=2026-09-03 reason=no_stored_base_level
oracle-withheld: date=2026-09-04 reason=no_stored_base_level
oracle-withheld: date=2026-09-05 reason=no_stored_base_level
oracle-withheld: date=2026-09-06 reason=no_stored_base_level
oracle-withheld: date=2026-09-07 reason=no_stored_base_level
oracle-withheld: date=2026-09-08 reason=no_stored_base_level
oracle-withheld: date=2026-09-09 reason=no_stored_base_level
oracle-withheld: date=2026-09-10 reason=no_stored_base_level
oracle-withheld: date=2026-09-11 reason=no_stored_base_level
oracle-withheld: date=2026-09-12 reason=no_stored_base_level
oracle-withheld: date=2026-09-13 reason=no_stored_base_level
oracle-withheld: date=2026-09-14 reason=no_stored_base_level
oracle-withheld: date=2026-09-15 reason=no_stored_base_level
oracle-withheld: date=2026-09-16 reason=no_stored_base_level
oracle-withheld: date=2026-09-17 reason=no_stored_base_level
oracle-withheld: date=2026-09-18 reason=no_stored_base_level
oracle-withheld: date=2026-09-19 reason=no_stored_base_level
oracle-withheld: date=2026-09-20 reason=no_stored_base_level
oracle-withheld: date=2026-09-21 reason=no_stored_base_level
oracle-withheld: date=2026-09-22 reason=no_stored_base_level
oracle-withheld: date=2026-09-23 reason=no_stored_base_level
oracle-withheld: date=2026-09-24 reason=no_stored_base_level
oracle-withheld: date=2026-09-25 reason=no_stored_base_level
oracle-withheld: date=2026-09-26 reason=no_stored_base_level
oracle-withheld: date=2026-09-27 reason=no_stored_base_level
oracle-withheld: date=2026-09-28 reason=no_stored_base_level
oracle-withheld: date=2026-09-29 reason=no_stored_base_level
oracle-withheld: date=2026-09-30 reason=no_stored_base_level
oracle-withheld: date=2026-10-01 reason=no_stored_base_level
oracle-withheld: date=2026-10-02 reason=no_stored_base_level
oracle-withheld: date=2026-10-03 reason=no_stored_base_level
oracle-withheld: date=2026-10-04 reason=no_stored_base_level
oracle-withheld: date=2026-10-05 reason=no_stored_base_level
oracle-withheld: date=2026-10-06 reason=no_stored_base_level
oracle-withheld: date=2026-10-07 reason=no_stored_base_level
oracle-withheld: date=2026-10-08 reason=no_stored_base_level
oracle-withheld: date=2026-10-09 reason=key_set_not_reproducible
oracle-withheld: date=2026-10-10 reason=key_set_not_reproducible
oracle-withheld: date=2026-10-11 reason=no_stored_base_level
oracle-withheld: date=2026-10-12 reason=no_stored_base_level
oracle-withheld: date=2026-10-13 reason=no_stored_base_level
oracle-withheld: date=2026-10-14 reason=no_stored_base_level
oracle-withheld: date=2026-10-15 reason=no_stored_base_level
oracle-withheld: date=2026-10-16 reason=no_stored_base_level
oracle-withheld: date=2026-10-17 reason=no_stored_base_level
oracle-withheld: date=2026-10-18 reason=no_stored_base_level
oracle-withheld: date=2026-10-19 reason=no_stored_base_level
oracle-withheld: date=2026-10-20 reason=no_stored_base_level
oracle-withheld: date=2026-10-21 reason=no_stored_base_level
oracle-withheld: date=2026-10-22 reason=no_stored_base_level
oracle-withheld: date=2026-10-23 reason=no_stored_base_level
oracle-withheld: date=2026-10-24 reason=no_stored_base_level
oracle-withheld: date=2026-10-25 reason=no_stored_base_level
oracle-withheld: date=2026-10-26 reason=no_stored_base_level
oracle-withheld: date=2026-10-27 reason=no_stored_base_level
oracle-withheld: date=2026-10-28 reason=no_stored_base_level
oracle-withheld: date=2026-10-29 reason=no_stored_base_level
oracle-withheld: date=2026-10-30 reason=no_stored_base_level
oracle-withheld: date=2026-10-31 reason=no_stored_base_level
oracle-withheld: date=2026-11-01 reason=no_stored_base_level
oracle-withheld: date=2026-11-02 reason=no_stored_base_level
oracle-withheld: date=2026-11-03 reason=no_stored_base_level
oracle-withheld: date=2026-11-04 reason=no_stored_base_level
oracle-withheld: date=2026-11-05 reason=no_stored_base_level
oracle-withheld: date=2026-11-06 reason=no_stored_base_level
oracle-withheld: date=2026-11-07 reason=no_stored_base_level
oracle-withheld: date=2026-11-08 reason=no_stored_base_level
oracle-withheld: date=2026-11-09 reason=no_stored_base_level
oracle-withheld: date=2026-11-10 reason=no_stored_base_level
oracle-withheld: date=2026-11-11 reason=no_stored_base_level
oracle-withheld: date=2026-11-12 reason=no_stored_base_level
oracle-withheld: date=2026-11-13 reason=no_stored_base_level
oracle-withheld: date=2026-11-14 reason=no_stored_base_level
oracle-withheld: date=2026-11-15 reason=no_stored_base_level
oracle-withheld: date=2026-11-16 reason=no_stored_base_level
oracle-withheld: date=2026-11-17 reason=no_stored_base_level
oracle-withheld: date=2026-11-18 reason=no_stored_base_level
oracle-withheld: date=2026-11-19 reason=no_stored_base_level
oracle-withheld: date=2026-11-20 reason=no_stored_base_level
oracle-withheld: date=2026-11-21 reason=no_stored_base_level
oracle-withheld: date=2026-11-22 reason=no_stored_base_level
oracle-withheld: date=2026-11-23 reason=key_set_not_reproducible
oracle-omitted: date=2023-06-27 reason=no_stored_base_level
oracle-omitted: date=2024-01-21 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-22 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-23 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-24 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-25 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-26 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-27 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-28 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-29 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-30 reason=missing_return_inside_coverage
oracle-omitted: date=2024-01-31 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-01 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-02 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-03 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-04 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-05 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-06 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-07 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-08 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-09 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-10 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-11 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-12 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-13 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-14 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-15 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-16 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-17 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-18 reason=missing_return_inside_coverage
oracle-omitted: date=2024-02-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-02-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-03-31 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-04-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-05-31 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-06-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-07-31 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-08-31 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-09-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-10-31 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-07 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-08 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-09 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-10 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-11 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-12 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-13 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-14 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-15 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-16 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-17 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-18 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-19 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-20 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-21 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-22 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-23 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-24 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-25 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-26 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-27 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-28 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-29 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-11-30 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-12-01 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-12-02 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-12-03 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-12-04 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-12-05 reason=skipped_nonpositive_denominator
oracle-omitted: date=2024-12-06 reason=skipped_nonpositive_denominator
oracle-omitted: date=2025-09-05 reason=missing_return_inside_coverage
oracle-omitted: date=2025-09-06 reason=missing_return_inside_coverage
oracle-omitted: date=2025-09-07 reason=missing_return_inside_coverage
oracle-omitted: date=2025-09-08 reason=missing_return_inside_coverage
oracle-omitted: date=2025-09-09 reason=missing_return_inside_coverage
oracle-annotation: name=capital_outside_base_options_cash days=1246 explained_days=806 explained_cumulative=x3390
oracle-annotation: name=capital_outside_base_flow_day days=198 explained_days=162 explained_cumulative=x152
oracle-annotation: name=key_sat_out days=147 explained_days=66 explained_cumulative=x3.59
oracle-cumulative: published=x3260 explained=x3390 explained_unannotated=x1 published_without_big_days=x298
oracle-big-day: date=2023-11-20 r=0.458 key=k2 share=1 annotations=capital_outside_base_options_cash,capital_outside_base_flow_day
oracle-big-day: date=2025-07-13 r=0.623 key=k1 share=1 annotations=capital_outside_base_options_cash,capital_outside_base_flow_day
oracle-big-day: date=2025-07-16 r=0.38 key=k1 share=1 annotations=capital_outside_base_options_cash,capital_outside_base_flow_day
oracle-big-day: date=2025-08-05 r=0.648 key=k1 share=1 annotations=capital_outside_base_options_cash
oracle-big-day: date=2025-08-20 r=0.36 key=k1 share=1 annotations=capital_outside_base_options_cash,capital_outside_base_flow_day
oracle-big-day: date=2025-08-27 r=0.496 key=k1 share=1 annotations=capital_outside_base_options_cash
oracle-degrade: kind=degrade_reason name=classified_rotation
oracle-degrade: kind=degrade_reason name=out_of_window_flow
oracle-degrade: kind=degrade_reason name=window_truncated
oracle-degrade: kind=flag name=degraded state=true
oracle-degrade: kind=flag name=departed_history_included state=true
oracle-degrade: kind=flag name=emptied_stretch state=true
oracle-degrade: kind=flag name=failing_key_exited state=true
oracle-degrade: kind=flag name=missing_return_inside_coverage state=true
oracle-degrade: kind=flag name=no_capital_key_exited state=true
oracle-degrade: kind=flag name=skipped_nonpositive_denominator state=true
oracle-degrade: kind=flag name=sole_key state=true
oracle-degrade: kind=flag name=window_truncated state=true
oracle-degrade: kind=flag name=writer_basis state=true
oracle-degrade: kind=exit_list name=no_capital_exited_keys count=1
oracle-degrade: kind=exit_list name=failing_key_exits count=1
oracle-verdict: verdict=STOP withheld_published=114 omission_unexplained=0 key_set=reproduced
```

