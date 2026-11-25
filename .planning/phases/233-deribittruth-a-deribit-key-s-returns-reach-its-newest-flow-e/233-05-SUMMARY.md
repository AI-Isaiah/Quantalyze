---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 05
subsystem: analytics-service / Deribit book attribution oracle
tags: [oracle, money-math, DBOOK-01, PROOF-01, stdlib-only]
requires: [233-03]
provides:
  - the complete oracle (emptied_stretch, omitted reasons, annotations, carry and rotation, leak guards, --print-sql)
  - five more hand-derived fixtures (eleven in all)
affects: [233-05 Task 3 (orchestrator PROD reading, pending)]
tech-stack:
  added: []
  patterns: [literal copies of production constants pinned by a test-only parity check, coverage-handoff rotation re-implemented from the SPEC, closed-vocabulary emitter refusal test, placeholder-only read-only SQL printer]
key-files:
  created:
    - analytics-service/tests/fixtures/deribit_book_oracle/withheld_emptied_stretch.json
    - analytics-service/tests/fixtures/deribit_book_oracle/omitted_days.json
    - analytics-service/tests/fixtures/deribit_book_oracle/omission_unexplained.json
    - analytics-service/tests/fixtures/deribit_book_oracle/capital_outside_base.json
    - analytics-service/tests/fixtures/deribit_book_oracle/carry_and_rotation.json
  modified:
    - analytics-service/scripts/deribit_book_oracle.py
    - analytics-service/tests/test_deribit_book_oracle.py
decisions:
  - "annotations are computed over every day of the span for participating keys and never change a class or a value; the reading line per annotation carries the day count and the cumulative of its explained days"
  - "the emptied band is classified on each key's raw writer-basis levels (terminal level before the live anchor replaces it)"
  - "the loader refuses an id-shaped dict KEY as well as an id-shaped value, reporting it as <key>, so the refusal message can never echo an id"
metrics:
  tasks: 2 of 3 (Task 3 pending at the orchestrator checkpoint)
  files: 7
status: partial
actuals:
  tokens: 16200
  tasks: 2
  commits: 2
plan_head_before: 8bbe50e772d615e8e0057f43e39408586bb3cc74
plan_head_after: fea348007f97b44a149b2071a87db8342faf8b77
---

# Phase 233 Plan 05: the Deribit book attribution oracle, expanded Summary

Plan 233-03's oracle now names every class: `emptied_stretch` (oracle-owned literal copies of the three emptied constants, pinned to production by a test-only import), the full omitted set, the capital-outside-base and `key_sat_out` annotations (named, never nulled), early-end carry and disjoint-handoff rotation, a loader that refuses any id-shaped value, and `--print-sql` for the orchestrator's PROD reading. Tasks 1 and 2 are committed; Task 3 (the PROD reading) is the orchestrator's checkpoint and is NOT done.

## What was built

- Task 1 (commit `c8ed8216d`): `emptied_days` (the SPEC's chronological emptied scan over each key's raw writer-basis levels) and the `emptied_stretch` withheld reason at its priority slot; `_coverage_rotations` (a disjoint coverage handoff rotates the earlier key out, an overlapping key that ended early carries its last level with no P&L); omitted reasons `skipped_nonpositive_denominator`, `missing_return_inside_coverage`, `nonfinite_return`, `outside_published_window`, `omission_unexplained`; `_annotate` and one `oracle-annotation:` line per annotation. Five fixtures with hand derivations in `_comment`; nine tests (22 in the module with plan 233-03's 13), including `test_closed_sets_are_exact`, `test_every_day_has_exactly_one_class` over every fixture, `test_annotation_never_nulls_a_day` and `test_emptied_constants_match_production` (the only place production is imported).
- Task 2 (commit `fea348007`): `_refuse_id_shaped` in `load_export` (UUID shape anywhere, the `_comment` included, by field path only); `print_sql` and `--print-sql[=label,...]` printing five labelled statements (`book_curve`, `book_key_kinds`, `key_scalars`, `key_array_by_year`, `book_key_rows`), each a single SELECT, `;`-terminated, placeholders only, `venue_account_id` used only inside `dense_rank() ... AS account_group`; `--print-sql` with any other argument exits 2. Four tests (26 in the module).

## Verification (final lines)

- `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_book_oracle.py -q -p no:cacheprovider`: `26 passed in 18.25s`.
- `.venv/bin/python -m pytest --collect-only -q -p no:cacheprovider`: `16773 tests collected in 43.38s`.
- `.venv/bin/mypy --strict scripts/deribit_book_oracle.py`: `Success: no issues found in 1 source file`.
- CI's strict command, taken from the `python` job's `Type gate - mypy strict over the running-service surface` step (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`), run from `analytics-service/` with `.venv/bin/mypy`: `Success: no issues found in 143 source files`.
- Whole-tree invariants (`src/lib/*invariant*`, `src/__tests__/*invariant*`, `seam-log-coverage`, `critical-regressions`): `Test Files  17 passed (17)`, `Tests  660 passed (660)`.
- `npm run lint`: 0 errors (4 pre-existing warnings), planning-hygiene OK.
- `gitleaks dir` over the script, the test module and the fixture directory: `no leaks found` each.
- `node scripts/verify-plan-anchors.mjs` over this plan: `OK: 1 plan file(s), no stale claims.`
- `python3 analytics-service/scripts/deribit_book_oracle.py --print-sql` exits 0 and prints the five labels.
- The printed SQL was NOT executed against any engine here (no local Postgres binary); its syntax is checked structurally by the test only. The orchestrator will see any syntax error on the first run.

## PROOF-01

Each arm: byte backup into the executor's session scratchpad, neuter, RED, restore with `cp` then `cmp` (no output) and `git diff --quiet`, GREEN. Task 1 arms ran after the Task 1 commit, Task 2 arms after the Task 2 commit.

| arm-id | neuter edit | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| oracle-annotation-not-null | in `classify_days`: `elif value_ok and structural is None:` became `elif value_ok and structural is None and day not in _annotate(export, repro):` (annotated days dropped from the explained set) | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py::test_annotation_never_nulls_a_day -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_annotation_never_nulls_a_day | cmp: exit 0, no output | GREEN: 1 passed in 21.40s |
| oracle-omission | in `classify_days`: the final `reason = "omission_unexplained"` became `reason = "outside_published_window"` | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py::test_omission_unexplained_is_stop -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_omission_unexplained_is_stop | cmp: exit 0, no output | GREEN: 1 passed in 11.59s |
| oracle-parity | `_EMPTIED_FRACTION: Final[float] = 0.01` became `= 0.02` | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py::test_emptied_constants_match_production -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_emptied_constants_match_production | cmp: exit 0, no output | GREEN: 1 passed in 9.55s |
| oracle-redaction | in `_render_val`: inserted `return str(raw)` straight after `raw = val.raw` (the emitter accepts any value) | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py::test_emitter_refuses_values_outside_vocabulary -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_emitter_refuses_values_outside_vocabulary | cmp: exit 0, no output | GREEN: 1 passed in 26.04s |
| oracle-export-id | in `load_export`: removed the `_refuse_id_shaped("export", raw)` call | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py::test_export_with_id_shaped_value_is_refused -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_export_with_id_shaped_value_is_refused | cmp: exit 0, no output | GREEN: 1 passed in 19.38s |

## Deviations from Plan

1. **Resumed after a machine restart.** A previous executor was killed mid Task 1 with the script, tests and five fixtures uncommitted; its work was verified line by line against Task 1's behaviour and acceptance criteria (22 tests pass, mypy strict clean, fixture derivations re-read) and committed as found. Nothing was redone or discarded.
2. **[Rule 1 - test correction]** The emitter refusal test accepts `ExportError` as well as `ValueError`: a malformed date value raises `ExportError` (`emitter.date: expected an ISO day`) from the shared `_day` validator.
3. The existing 233-03 tests' `annotated=` counts and `explained_unannotated` values moved from the placeholder (`annotated=0`, `x1.05`) to the real annotation pass (the flow day of the base fixture is annotated); each moved value is re-derived by hand in the test comment.

## Known limits

- A3: the counted key set is a DECLARED input; the payload stores only `inputs.n_keys` and the exit lists, so the oracle checks that the declared set counts to `n_keys` and cannot prove it is the set the compose picked.
- A4: marked-era `composed_day_pnl` carries the marked P&L; a day that fails the per-key identity is named `key_basis_not_reproducible`, never guessed.
- A5b: the flow-day annotation is "a participating key has a non-zero composed flow on the day"; `capital_outside_base_options_cash` is "a participating key has `options_cash_basis` true". Neither nulls a day (CONTEXT Q4, option (a)); options (b) and (c) are not built.
- The emptied band is classified on raw writer-basis levels, so a live anchor inside the band is not itself classified; a stitched child is its own key series with its join day and the next day treated as boundary; `nonfinite_return` is named and produced by the loop but no fixture reaches it.

## Known Stubs

None.

## Threat Flags

None. The script holds no connection and no DSN; `--print-sql` prints statements and executes nothing (T-233-11 mitigations: single SELECT or WITH, tested; T-233-17: closed-vocabulary emitter with refusal test; T-233-10: loader refuses id-shaped values; T-233-18: constants are literal copies pinned by a test-only parity check).

## Task 3: PENDING at the orchestrator checkpoint

Task 3 (the PROD reading, `checkpoint:human-action`, `gate="blocking-human"`) is run by the orchestrator through the MCP read path and is not done here. `dbook01-marker:`, `dbook01-keys:`, `dbook01-exit:`, the verbatim `## DBOOK-01 reading` and, on a CLEAN exit or an Accept answer only, `closes-todos: 185-BOOK-CUMULATIVE-UNEXPLAINED (DBOOK-01)` are appended by the orchestrator.
