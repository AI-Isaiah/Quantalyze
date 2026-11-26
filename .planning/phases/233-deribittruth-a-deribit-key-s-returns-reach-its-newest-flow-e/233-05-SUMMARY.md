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

## Task 3: first PROD reading taken 2026-11-25, VACUOUS, routed to replan (step 7)

Task 3 (the PROD reading, `checkpoint:human-action`, `gate="blocking-human"`) is run by the orchestrator through the MCP read path and is not done here. `dbook01-marker:`, `dbook01-keys:`, `dbook01-exit:`, the verbatim `## DBOOK-01 reading` and, on a CLEAN exit or an Accept answer only, `closes-todos: 185-BOOK-CUMULATIVE-UNEXPLAINED (DBOOK-01)` are appended by the orchestrator.

The orchestrator took the reading on 2026-11-25. Nothing was written to PROD, and the export stayed in the orchestrator's session scratchpad.

dbook01-marker: names PRODUCTION
dbook01-keys: declared=7 labels=k1..k7
dbook01-exit: 3

**Routing (Task 3 step 7).** The run is VACUOUS: 437 of 920 published days explained, under the 0.5 share. The withheld and omitted reasons point at oracle defects, not at the book, so this goes to replan with no founder question and no closes-todos line. DBOOK-01 stays open. The diagnosis, measured on the same export in the scratchpad:

1. **`emptied_stretch` (385 withheld days, 2024-12-07 to 2025-12) is an oracle defect.** On those days k2 sits idle, carried at a dust level inside its emptied band. The compose counts an emptied stretch as zero capital (DERIBITWEDGE D-01). The oracle keeps the dust level in the denominator, so its value misses the published one by a few parts in 10^5. k1's stored return stamp equals the published book return on every sampled day, including the big days 2025-07-13 and 2025-08-05. In a scratch what-if with emptied-band levels set to zero, these days are explained.
2. **`omission_unexplained` (297 days, 2024-02 to 2024-12) is the same defect.** k2 is the only participant, and it is inside its emptied band, so the compose skips the day on a non-positive denominator. In the what-if, all 297 become `skipped_nonpositive_denominator`.
3. **`attribution_mismatch` (91 days, 2026-08-22 to 2026-11-22) is an export and model gap.** k5 is a counted key that exited on 2026-11-23 with reason `read_incomplete`. Its `key_inputs` row carries none of `composed_day_pnl`, `composed_flows`, `dropped_day_pnl` and `returns_stamp`. The compose still blends its stored returns, which start 2026-08-02. The oracle gives a counted key with no writer-basis arrays zero level days, so it never participates, and its days read as a plain mismatch. They should be a named structural withhold.

With fix 1 alone, the what-if gives explained=806, withheld=114, omitted=327. Its verdict is STOP, because of the 91 k5 days and 16 residual `emptied_stretch` days. The 2025 compounding is k1's booked P&L on its own stored base.

**Gaps in the recipe that the export had to work around**, all to be fixed by the replan:
- PROD stores `equity_curve.flags` as a sorted array of tokens, but the loader wants an object. The export mapped each token to `true`.
- The exit lists are objects carrying a key id, a reason and a day, but the loader wants labels. The export mapped them to labels and declared each exit day as `departed`.
- psql prints a SQL NULL slice as an empty CSV line. An absent array field was treated as absent.
- The loader has no representation for a counted key without writer-basis arrays.

**How the reading was taken.** Deviation: the marker query and the probe reads went through MCP. The 116 export statements went through psql against the pooler, one statement per call, with the marker re-checked on that connection first, because the per-key arrays are too large to pass through MCP. Each statement was the oracle's own `--print-sql` text, with values bound through psql variables.

## DBOOK-01 reading

```
oracle-book: book=A published=920 explained=437 withheld=483 omitted=327 annotated=1246
oracle-key-set: declared=7 n_keys=7 reproduced=yes
oracle-withheld: date=2024-12-07 reason=emptied_stretch
oracle-withheld: date=2024-12-08 reason=emptied_stretch
oracle-withheld: date=2024-12-09 reason=emptied_stretch
oracle-withheld: date=2024-12-10 reason=emptied_stretch
oracle-withheld: date=2024-12-11 reason=emptied_stretch
oracle-withheld: date=2024-12-12 reason=emptied_stretch
oracle-withheld: date=2024-12-13 reason=emptied_stretch
oracle-withheld: date=2024-12-14 reason=emptied_stretch
oracle-withheld: date=2024-12-15 reason=emptied_stretch
oracle-withheld: date=2024-12-16 reason=emptied_stretch
oracle-withheld: date=2024-12-17 reason=emptied_stretch
oracle-withheld: date=2024-12-18 reason=emptied_stretch
oracle-withheld: date=2024-12-19 reason=emptied_stretch
oracle-withheld: date=2024-12-20 reason=emptied_stretch
oracle-withheld: date=2024-12-21 reason=emptied_stretch
oracle-withheld: date=2024-12-22 reason=emptied_stretch
oracle-withheld: date=2024-12-23 reason=emptied_stretch
oracle-withheld: date=2024-12-24 reason=emptied_stretch
oracle-withheld: date=2024-12-25 reason=emptied_stretch
oracle-withheld: date=2024-12-26 reason=emptied_stretch
oracle-withheld: date=2024-12-27 reason=emptied_stretch
oracle-withheld: date=2024-12-28 reason=emptied_stretch
oracle-withheld: date=2024-12-29 reason=emptied_stretch
oracle-withheld: date=2024-12-30 reason=emptied_stretch
oracle-withheld: date=2024-12-31 reason=emptied_stretch
oracle-withheld: date=2025-01-01 reason=emptied_stretch
oracle-withheld: date=2025-01-02 reason=emptied_stretch
oracle-withheld: date=2025-01-03 reason=emptied_stretch
oracle-withheld: date=2025-01-04 reason=emptied_stretch
oracle-withheld: date=2025-01-05 reason=emptied_stretch
oracle-withheld: date=2025-01-06 reason=emptied_stretch
oracle-withheld: date=2025-01-07 reason=emptied_stretch
oracle-withheld: date=2025-01-08 reason=emptied_stretch
oracle-withheld: date=2025-01-09 reason=emptied_stretch
oracle-withheld: date=2025-01-10 reason=emptied_stretch
oracle-withheld: date=2025-01-11 reason=emptied_stretch
oracle-withheld: date=2025-01-12 reason=emptied_stretch
oracle-withheld: date=2025-01-13 reason=emptied_stretch
oracle-withheld: date=2025-01-14 reason=emptied_stretch
oracle-withheld: date=2025-01-15 reason=emptied_stretch
oracle-withheld: date=2025-01-16 reason=emptied_stretch
oracle-withheld: date=2025-01-17 reason=emptied_stretch
oracle-withheld: date=2025-01-18 reason=emptied_stretch
oracle-withheld: date=2025-01-19 reason=emptied_stretch
oracle-withheld: date=2025-01-20 reason=emptied_stretch
oracle-withheld: date=2025-01-21 reason=emptied_stretch
oracle-withheld: date=2025-01-22 reason=emptied_stretch
oracle-withheld: date=2025-01-23 reason=emptied_stretch
oracle-withheld: date=2025-01-24 reason=emptied_stretch
oracle-withheld: date=2025-01-25 reason=emptied_stretch
oracle-withheld: date=2025-01-26 reason=emptied_stretch
oracle-withheld: date=2025-01-27 reason=emptied_stretch
oracle-withheld: date=2025-01-28 reason=emptied_stretch
oracle-withheld: date=2025-01-29 reason=emptied_stretch
oracle-withheld: date=2025-01-30 reason=emptied_stretch
oracle-withheld: date=2025-01-31 reason=emptied_stretch
oracle-withheld: date=2025-02-01 reason=emptied_stretch
oracle-withheld: date=2025-02-02 reason=emptied_stretch
oracle-withheld: date=2025-02-03 reason=emptied_stretch
oracle-withheld: date=2025-02-04 reason=emptied_stretch
oracle-withheld: date=2025-02-05 reason=emptied_stretch
oracle-withheld: date=2025-02-06 reason=emptied_stretch
oracle-withheld: date=2025-02-07 reason=emptied_stretch
oracle-withheld: date=2025-02-08 reason=emptied_stretch
oracle-withheld: date=2025-02-09 reason=emptied_stretch
oracle-withheld: date=2025-02-10 reason=emptied_stretch
oracle-withheld: date=2025-02-11 reason=emptied_stretch
oracle-withheld: date=2025-02-12 reason=emptied_stretch
oracle-withheld: date=2025-02-13 reason=emptied_stretch
oracle-withheld: date=2025-02-14 reason=emptied_stretch
oracle-withheld: date=2025-02-15 reason=emptied_stretch
oracle-withheld: date=2025-02-16 reason=emptied_stretch
oracle-withheld: date=2025-02-17 reason=emptied_stretch
oracle-withheld: date=2025-02-18 reason=emptied_stretch
oracle-withheld: date=2025-02-19 reason=emptied_stretch
oracle-withheld: date=2025-02-20 reason=emptied_stretch
oracle-withheld: date=2025-02-21 reason=emptied_stretch
oracle-withheld: date=2025-02-22 reason=emptied_stretch
oracle-withheld: date=2025-02-23 reason=emptied_stretch
oracle-withheld: date=2025-02-24 reason=emptied_stretch
oracle-withheld: date=2025-02-25 reason=emptied_stretch
oracle-withheld: date=2025-02-26 reason=emptied_stretch
oracle-withheld: date=2025-02-27 reason=emptied_stretch
oracle-withheld: date=2025-02-28 reason=emptied_stretch
oracle-withheld: date=2025-03-01 reason=emptied_stretch
oracle-withheld: date=2025-03-02 reason=emptied_stretch
oracle-withheld: date=2025-03-03 reason=emptied_stretch
oracle-withheld: date=2025-03-04 reason=emptied_stretch
oracle-withheld: date=2025-03-05 reason=emptied_stretch
oracle-withheld: date=2025-03-06 reason=emptied_stretch
oracle-withheld: date=2025-03-07 reason=emptied_stretch
oracle-withheld: date=2025-03-08 reason=emptied_stretch
oracle-withheld: date=2025-03-09 reason=emptied_stretch
oracle-withheld: date=2025-03-10 reason=emptied_stretch
oracle-withheld: date=2025-03-11 reason=emptied_stretch
oracle-withheld: date=2025-03-12 reason=emptied_stretch
oracle-withheld: date=2025-03-13 reason=emptied_stretch
oracle-withheld: date=2025-03-14 reason=emptied_stretch
oracle-withheld: date=2025-03-15 reason=emptied_stretch
oracle-withheld: date=2025-03-16 reason=emptied_stretch
oracle-withheld: date=2025-03-17 reason=emptied_stretch
oracle-withheld: date=2025-03-18 reason=emptied_stretch
oracle-withheld: date=2025-03-19 reason=emptied_stretch
oracle-withheld: date=2025-03-20 reason=emptied_stretch
oracle-withheld: date=2025-03-21 reason=emptied_stretch
oracle-withheld: date=2025-03-22 reason=emptied_stretch
oracle-withheld: date=2025-03-23 reason=emptied_stretch
oracle-withheld: date=2025-03-24 reason=emptied_stretch
oracle-withheld: date=2025-03-25 reason=emptied_stretch
oracle-withheld: date=2025-03-26 reason=emptied_stretch
oracle-withheld: date=2025-03-27 reason=emptied_stretch
oracle-withheld: date=2025-03-28 reason=emptied_stretch
oracle-withheld: date=2025-03-29 reason=emptied_stretch
oracle-withheld: date=2025-03-30 reason=emptied_stretch
oracle-withheld: date=2025-03-31 reason=emptied_stretch
oracle-withheld: date=2025-04-01 reason=emptied_stretch
oracle-withheld: date=2025-04-02 reason=emptied_stretch
oracle-withheld: date=2025-04-03 reason=emptied_stretch
oracle-withheld: date=2025-04-04 reason=emptied_stretch
oracle-withheld: date=2025-04-05 reason=emptied_stretch
oracle-withheld: date=2025-04-06 reason=emptied_stretch
oracle-withheld: date=2025-04-07 reason=emptied_stretch
oracle-withheld: date=2025-04-08 reason=emptied_stretch
oracle-withheld: date=2025-04-09 reason=emptied_stretch
oracle-withheld: date=2025-04-10 reason=emptied_stretch
oracle-withheld: date=2025-04-11 reason=emptied_stretch
oracle-withheld: date=2025-04-12 reason=emptied_stretch
oracle-withheld: date=2025-04-13 reason=emptied_stretch
oracle-withheld: date=2025-04-14 reason=emptied_stretch
oracle-withheld: date=2025-04-15 reason=emptied_stretch
oracle-withheld: date=2025-04-16 reason=emptied_stretch
oracle-withheld: date=2025-04-17 reason=emptied_stretch
oracle-withheld: date=2025-04-18 reason=emptied_stretch
oracle-withheld: date=2025-04-19 reason=emptied_stretch
oracle-withheld: date=2025-04-20 reason=emptied_stretch
oracle-withheld: date=2025-04-21 reason=emptied_stretch
oracle-withheld: date=2025-04-22 reason=emptied_stretch
oracle-withheld: date=2025-04-23 reason=emptied_stretch
oracle-withheld: date=2025-04-24 reason=emptied_stretch
oracle-withheld: date=2025-04-25 reason=emptied_stretch
oracle-withheld: date=2025-04-26 reason=emptied_stretch
oracle-withheld: date=2025-04-27 reason=emptied_stretch
oracle-withheld: date=2025-04-28 reason=emptied_stretch
oracle-withheld: date=2025-04-29 reason=emptied_stretch
oracle-withheld: date=2025-04-30 reason=emptied_stretch
oracle-withheld: date=2025-05-01 reason=emptied_stretch
oracle-withheld: date=2025-05-02 reason=emptied_stretch
oracle-withheld: date=2025-05-03 reason=emptied_stretch
oracle-withheld: date=2025-05-04 reason=emptied_stretch
oracle-withheld: date=2025-05-05 reason=emptied_stretch
oracle-withheld: date=2025-05-06 reason=emptied_stretch
oracle-withheld: date=2025-05-07 reason=emptied_stretch
oracle-withheld: date=2025-05-08 reason=emptied_stretch
oracle-withheld: date=2025-05-09 reason=emptied_stretch
oracle-withheld: date=2025-05-10 reason=emptied_stretch
oracle-withheld: date=2025-05-11 reason=emptied_stretch
oracle-withheld: date=2025-05-12 reason=emptied_stretch
oracle-withheld: date=2025-05-13 reason=emptied_stretch
oracle-withheld: date=2025-05-14 reason=emptied_stretch
oracle-withheld: date=2025-05-15 reason=emptied_stretch
oracle-withheld: date=2025-05-16 reason=emptied_stretch
oracle-withheld: date=2025-05-17 reason=emptied_stretch
oracle-withheld: date=2025-05-18 reason=emptied_stretch
oracle-withheld: date=2025-05-19 reason=emptied_stretch
oracle-withheld: date=2025-05-20 reason=emptied_stretch
oracle-withheld: date=2025-05-21 reason=emptied_stretch
oracle-withheld: date=2025-05-22 reason=emptied_stretch
oracle-withheld: date=2025-05-23 reason=emptied_stretch
oracle-withheld: date=2025-05-24 reason=emptied_stretch
oracle-withheld: date=2025-05-25 reason=emptied_stretch
oracle-withheld: date=2025-05-26 reason=emptied_stretch
oracle-withheld: date=2025-05-27 reason=emptied_stretch
oracle-withheld: date=2025-05-28 reason=emptied_stretch
oracle-withheld: date=2025-05-29 reason=emptied_stretch
oracle-withheld: date=2025-05-30 reason=emptied_stretch
oracle-withheld: date=2025-05-31 reason=emptied_stretch
oracle-withheld: date=2025-06-01 reason=emptied_stretch
oracle-withheld: date=2025-06-02 reason=emptied_stretch
oracle-withheld: date=2025-06-03 reason=emptied_stretch
oracle-withheld: date=2025-06-04 reason=emptied_stretch
oracle-withheld: date=2025-06-05 reason=emptied_stretch
oracle-withheld: date=2025-06-06 reason=emptied_stretch
oracle-withheld: date=2025-06-07 reason=emptied_stretch
oracle-withheld: date=2025-06-09 reason=emptied_stretch
oracle-withheld: date=2025-06-10 reason=emptied_stretch
oracle-withheld: date=2025-06-11 reason=emptied_stretch
oracle-withheld: date=2025-06-12 reason=emptied_stretch
oracle-withheld: date=2025-06-13 reason=emptied_stretch
oracle-withheld: date=2025-06-16 reason=emptied_stretch
oracle-withheld: date=2025-06-17 reason=emptied_stretch
oracle-withheld: date=2025-06-19 reason=emptied_stretch
oracle-withheld: date=2025-06-20 reason=emptied_stretch
oracle-withheld: date=2025-06-21 reason=emptied_stretch
oracle-withheld: date=2025-06-23 reason=emptied_stretch
oracle-withheld: date=2025-06-24 reason=emptied_stretch
oracle-withheld: date=2025-06-25 reason=emptied_stretch
oracle-withheld: date=2025-06-26 reason=emptied_stretch
oracle-withheld: date=2025-06-27 reason=emptied_stretch
oracle-withheld: date=2025-06-28 reason=emptied_stretch
oracle-withheld: date=2025-06-29 reason=emptied_stretch
oracle-withheld: date=2025-06-30 reason=emptied_stretch
oracle-withheld: date=2025-07-01 reason=emptied_stretch
oracle-withheld: date=2025-07-02 reason=emptied_stretch
oracle-withheld: date=2025-07-03 reason=emptied_stretch
oracle-withheld: date=2025-07-04 reason=emptied_stretch
oracle-withheld: date=2025-07-05 reason=emptied_stretch
oracle-withheld: date=2025-07-06 reason=emptied_stretch
oracle-withheld: date=2025-07-07 reason=emptied_stretch
oracle-withheld: date=2025-07-08 reason=emptied_stretch
oracle-withheld: date=2025-07-09 reason=emptied_stretch
oracle-withheld: date=2025-07-10 reason=emptied_stretch
oracle-withheld: date=2025-07-11 reason=emptied_stretch
oracle-withheld: date=2025-07-12 reason=emptied_stretch
oracle-withheld: date=2025-07-13 reason=emptied_stretch
oracle-withheld: date=2025-07-14 reason=emptied_stretch
oracle-withheld: date=2025-07-15 reason=emptied_stretch
oracle-withheld: date=2025-07-16 reason=emptied_stretch
oracle-withheld: date=2025-07-17 reason=emptied_stretch
oracle-withheld: date=2025-07-18 reason=emptied_stretch
oracle-withheld: date=2025-07-19 reason=emptied_stretch
oracle-withheld: date=2025-07-21 reason=emptied_stretch
oracle-withheld: date=2025-07-22 reason=emptied_stretch
oracle-withheld: date=2025-07-23 reason=emptied_stretch
oracle-withheld: date=2025-07-24 reason=emptied_stretch
oracle-withheld: date=2025-07-25 reason=emptied_stretch
oracle-withheld: date=2025-07-26 reason=emptied_stretch
oracle-withheld: date=2025-07-27 reason=emptied_stretch
oracle-withheld: date=2025-07-28 reason=emptied_stretch
oracle-withheld: date=2025-07-29 reason=emptied_stretch
oracle-withheld: date=2025-07-30 reason=emptied_stretch
oracle-withheld: date=2025-07-31 reason=emptied_stretch
oracle-withheld: date=2025-08-03 reason=emptied_stretch
oracle-withheld: date=2025-08-04 reason=emptied_stretch
oracle-withheld: date=2025-08-05 reason=emptied_stretch
oracle-withheld: date=2025-08-06 reason=emptied_stretch
oracle-withheld: date=2025-08-07 reason=emptied_stretch
oracle-withheld: date=2025-08-08 reason=emptied_stretch
oracle-withheld: date=2025-08-09 reason=emptied_stretch
oracle-withheld: date=2025-08-10 reason=emptied_stretch
oracle-withheld: date=2025-08-11 reason=emptied_stretch
oracle-withheld: date=2025-08-12 reason=emptied_stretch
oracle-withheld: date=2025-08-13 reason=emptied_stretch
oracle-withheld: date=2025-08-14 reason=emptied_stretch
oracle-withheld: date=2025-08-15 reason=emptied_stretch
oracle-withheld: date=2025-08-16 reason=emptied_stretch
oracle-withheld: date=2025-08-17 reason=emptied_stretch
oracle-withheld: date=2025-08-18 reason=emptied_stretch
oracle-withheld: date=2025-08-19 reason=emptied_stretch
oracle-withheld: date=2025-08-20 reason=emptied_stretch
oracle-withheld: date=2025-08-21 reason=emptied_stretch
oracle-withheld: date=2025-08-22 reason=emptied_stretch
oracle-withheld: date=2025-08-23 reason=emptied_stretch
oracle-withheld: date=2025-08-24 reason=emptied_stretch
oracle-withheld: date=2025-08-25 reason=emptied_stretch
oracle-withheld: date=2025-08-26 reason=emptied_stretch
oracle-withheld: date=2025-08-27 reason=emptied_stretch
oracle-withheld: date=2025-08-28 reason=emptied_stretch
oracle-withheld: date=2025-08-29 reason=emptied_stretch
oracle-withheld: date=2025-08-30 reason=emptied_stretch
oracle-withheld: date=2025-08-31 reason=emptied_stretch
oracle-withheld: date=2025-09-01 reason=emptied_stretch
oracle-withheld: date=2025-09-02 reason=emptied_stretch
oracle-withheld: date=2025-09-03 reason=emptied_stretch
oracle-withheld: date=2025-09-04 reason=emptied_stretch
oracle-withheld: date=2025-09-10 reason=emptied_stretch
oracle-withheld: date=2025-09-11 reason=emptied_stretch
oracle-withheld: date=2025-09-12 reason=emptied_stretch
oracle-withheld: date=2025-09-13 reason=emptied_stretch
oracle-withheld: date=2025-09-14 reason=emptied_stretch
oracle-withheld: date=2025-09-15 reason=emptied_stretch
oracle-withheld: date=2025-09-16 reason=emptied_stretch
oracle-withheld: date=2025-09-17 reason=emptied_stretch
oracle-withheld: date=2025-09-18 reason=emptied_stretch
oracle-withheld: date=2025-09-19 reason=emptied_stretch
oracle-withheld: date=2025-09-20 reason=emptied_stretch
oracle-withheld: date=2025-09-21 reason=emptied_stretch
oracle-withheld: date=2025-09-22 reason=emptied_stretch
oracle-withheld: date=2025-09-23 reason=emptied_stretch
oracle-withheld: date=2025-09-24 reason=emptied_stretch
oracle-withheld: date=2025-09-26 reason=emptied_stretch
oracle-withheld: date=2025-09-27 reason=emptied_stretch
oracle-withheld: date=2025-09-28 reason=emptied_stretch
oracle-withheld: date=2025-09-29 reason=emptied_stretch
oracle-withheld: date=2025-09-30 reason=emptied_stretch
oracle-withheld: date=2025-10-01 reason=emptied_stretch
oracle-withheld: date=2025-10-02 reason=emptied_stretch
oracle-withheld: date=2025-10-03 reason=emptied_stretch
oracle-withheld: date=2025-10-04 reason=emptied_stretch
oracle-withheld: date=2025-10-05 reason=emptied_stretch
oracle-withheld: date=2025-10-06 reason=emptied_stretch
oracle-withheld: date=2025-10-07 reason=emptied_stretch
oracle-withheld: date=2025-10-08 reason=emptied_stretch
oracle-withheld: date=2025-10-09 reason=emptied_stretch
oracle-withheld: date=2025-10-10 reason=emptied_stretch
oracle-withheld: date=2025-10-11 reason=emptied_stretch
oracle-withheld: date=2025-10-12 reason=emptied_stretch
oracle-withheld: date=2025-10-13 reason=emptied_stretch
oracle-withheld: date=2025-10-14 reason=emptied_stretch
oracle-withheld: date=2025-10-15 reason=emptied_stretch
oracle-withheld: date=2025-10-16 reason=emptied_stretch
oracle-withheld: date=2025-10-17 reason=emptied_stretch
oracle-withheld: date=2025-10-18 reason=emptied_stretch
oracle-withheld: date=2025-10-19 reason=emptied_stretch
oracle-withheld: date=2025-10-20 reason=emptied_stretch
oracle-withheld: date=2025-10-21 reason=emptied_stretch
oracle-withheld: date=2025-10-22 reason=emptied_stretch
oracle-withheld: date=2025-10-23 reason=emptied_stretch
oracle-withheld: date=2025-10-24 reason=emptied_stretch
oracle-withheld: date=2025-10-25 reason=emptied_stretch
oracle-withheld: date=2025-10-26 reason=emptied_stretch
oracle-withheld: date=2025-10-27 reason=emptied_stretch
oracle-withheld: date=2025-10-28 reason=emptied_stretch
oracle-withheld: date=2025-10-29 reason=emptied_stretch
oracle-withheld: date=2025-10-30 reason=emptied_stretch
oracle-withheld: date=2025-10-31 reason=emptied_stretch
oracle-withheld: date=2025-11-01 reason=emptied_stretch
oracle-withheld: date=2025-11-02 reason=emptied_stretch
oracle-withheld: date=2025-11-03 reason=emptied_stretch
oracle-withheld: date=2025-11-04 reason=emptied_stretch
oracle-withheld: date=2025-11-05 reason=emptied_stretch
oracle-withheld: date=2025-11-06 reason=emptied_stretch
oracle-withheld: date=2025-11-07 reason=emptied_stretch
oracle-withheld: date=2025-11-08 reason=emptied_stretch
oracle-withheld: date=2025-11-09 reason=emptied_stretch
oracle-withheld: date=2025-11-11 reason=emptied_stretch
oracle-withheld: date=2025-11-12 reason=emptied_stretch
oracle-withheld: date=2025-11-13 reason=emptied_stretch
oracle-withheld: date=2025-11-14 reason=emptied_stretch
oracle-withheld: date=2025-11-15 reason=emptied_stretch
oracle-withheld: date=2025-11-16 reason=emptied_stretch
oracle-withheld: date=2025-11-17 reason=emptied_stretch
oracle-withheld: date=2025-11-18 reason=emptied_stretch
oracle-withheld: date=2025-11-19 reason=emptied_stretch
oracle-withheld: date=2025-11-20 reason=emptied_stretch
oracle-withheld: date=2025-11-21 reason=emptied_stretch
oracle-withheld: date=2025-11-22 reason=emptied_stretch
oracle-withheld: date=2025-11-25 reason=emptied_stretch
oracle-withheld: date=2025-11-26 reason=emptied_stretch
oracle-withheld: date=2025-12-01 reason=emptied_stretch
oracle-withheld: date=2025-12-02 reason=emptied_stretch
oracle-withheld: date=2025-12-03 reason=emptied_stretch
oracle-withheld: date=2025-12-04 reason=emptied_stretch
oracle-withheld: date=2025-12-06 reason=emptied_stretch
oracle-withheld: date=2025-12-09 reason=emptied_stretch
oracle-withheld: date=2025-12-10 reason=emptied_stretch
oracle-withheld: date=2025-12-11 reason=emptied_stretch
oracle-withheld: date=2025-12-12 reason=emptied_stretch
oracle-withheld: date=2025-12-13 reason=emptied_stretch
oracle-withheld: date=2026-01-13 reason=key_basis_not_reproducible
oracle-withheld: date=2026-05-16 reason=emptied_stretch
oracle-withheld: date=2026-05-17 reason=emptied_stretch
oracle-withheld: date=2026-05-18 reason=emptied_stretch
oracle-withheld: date=2026-05-19 reason=emptied_stretch
oracle-withheld: date=2026-05-21 reason=emptied_stretch
oracle-withheld: date=2026-05-23 reason=emptied_stretch
oracle-withheld: date=2026-05-26 reason=emptied_stretch
oracle-withheld: date=2026-05-27 reason=emptied_stretch
oracle-withheld: date=2026-05-28 reason=emptied_stretch
oracle-withheld: date=2026-05-29 reason=emptied_stretch
oracle-withheld: date=2026-06-01 reason=emptied_stretch
oracle-withheld: date=2026-06-02 reason=emptied_stretch
oracle-withheld: date=2026-06-03 reason=emptied_stretch
oracle-withheld: date=2026-06-04 reason=emptied_stretch
oracle-withheld: date=2026-06-05 reason=emptied_stretch
oracle-withheld: date=2026-06-07 reason=emptied_stretch
oracle-withheld: date=2026-06-09 reason=emptied_stretch
oracle-withheld: date=2026-06-10 reason=emptied_stretch
oracle-withheld: date=2026-06-11 reason=emptied_stretch
oracle-withheld: date=2026-06-12 reason=emptied_stretch
oracle-withheld: date=2026-06-14 reason=emptied_stretch
oracle-withheld: date=2026-08-03 reason=emptied_stretch
oracle-withheld: date=2026-08-04 reason=emptied_stretch
oracle-withheld: date=2026-08-05 reason=emptied_stretch
oracle-withheld: date=2026-08-06 reason=emptied_stretch
oracle-withheld: date=2026-08-07 reason=key_basis_not_reproducible
oracle-withheld: date=2026-08-08 reason=emptied_stretch
oracle-withheld: date=2026-08-09 reason=emptied_stretch
oracle-withheld: date=2026-08-10 reason=emptied_stretch
oracle-withheld: date=2026-08-11 reason=emptied_stretch
oracle-withheld: date=2026-08-12 reason=key_basis_not_reproducible
oracle-withheld: date=2026-08-13 reason=emptied_stretch
oracle-withheld: date=2026-08-14 reason=emptied_stretch
oracle-withheld: date=2026-08-15 reason=emptied_stretch
oracle-withheld: date=2026-08-16 reason=emptied_stretch
oracle-withheld: date=2026-08-17 reason=emptied_stretch
oracle-withheld: date=2026-08-18 reason=emptied_stretch
oracle-withheld: date=2026-08-19 reason=emptied_stretch
oracle-withheld: date=2026-08-20 reason=emptied_stretch
oracle-withheld: date=2026-08-21 reason=key_basis_not_reproducible
oracle-withheld: date=2026-08-22 reason=attribution_mismatch
oracle-withheld: date=2026-08-23 reason=attribution_mismatch
oracle-withheld: date=2026-08-24 reason=attribution_mismatch
oracle-withheld: date=2026-08-25 reason=attribution_mismatch
oracle-withheld: date=2026-08-26 reason=attribution_mismatch
oracle-withheld: date=2026-08-27 reason=attribution_mismatch
oracle-withheld: date=2026-08-28 reason=attribution_mismatch
oracle-withheld: date=2026-08-29 reason=attribution_mismatch
oracle-withheld: date=2026-08-30 reason=attribution_mismatch
oracle-withheld: date=2026-08-31 reason=attribution_mismatch
oracle-withheld: date=2026-09-01 reason=attribution_mismatch
oracle-withheld: date=2026-09-02 reason=attribution_mismatch
oracle-withheld: date=2026-09-03 reason=attribution_mismatch
oracle-withheld: date=2026-09-04 reason=attribution_mismatch
oracle-withheld: date=2026-09-05 reason=attribution_mismatch
oracle-withheld: date=2026-09-06 reason=attribution_mismatch
oracle-withheld: date=2026-09-07 reason=attribution_mismatch
oracle-withheld: date=2026-09-08 reason=attribution_mismatch
oracle-withheld: date=2026-09-09 reason=attribution_mismatch
oracle-withheld: date=2026-09-10 reason=attribution_mismatch
oracle-withheld: date=2026-09-11 reason=attribution_mismatch
oracle-withheld: date=2026-09-12 reason=attribution_mismatch
oracle-withheld: date=2026-09-13 reason=attribution_mismatch
oracle-withheld: date=2026-09-14 reason=attribution_mismatch
oracle-withheld: date=2026-09-15 reason=attribution_mismatch
oracle-withheld: date=2026-09-16 reason=attribution_mismatch
oracle-withheld: date=2026-09-17 reason=attribution_mismatch
oracle-withheld: date=2026-09-18 reason=attribution_mismatch
oracle-withheld: date=2026-09-19 reason=attribution_mismatch
oracle-withheld: date=2026-09-20 reason=attribution_mismatch
oracle-withheld: date=2026-09-21 reason=attribution_mismatch
oracle-withheld: date=2026-09-22 reason=attribution_mismatch
oracle-withheld: date=2026-09-23 reason=attribution_mismatch
oracle-withheld: date=2026-09-24 reason=attribution_mismatch
oracle-withheld: date=2026-09-25 reason=attribution_mismatch
oracle-withheld: date=2026-09-26 reason=attribution_mismatch
oracle-withheld: date=2026-09-27 reason=attribution_mismatch
oracle-withheld: date=2026-09-28 reason=attribution_mismatch
oracle-withheld: date=2026-09-29 reason=attribution_mismatch
oracle-withheld: date=2026-09-30 reason=attribution_mismatch
oracle-withheld: date=2026-10-01 reason=attribution_mismatch
oracle-withheld: date=2026-10-02 reason=attribution_mismatch
oracle-withheld: date=2026-10-03 reason=attribution_mismatch
oracle-withheld: date=2026-10-04 reason=attribution_mismatch
oracle-withheld: date=2026-10-05 reason=attribution_mismatch
oracle-withheld: date=2026-10-06 reason=attribution_mismatch
oracle-withheld: date=2026-10-07 reason=attribution_mismatch
oracle-withheld: date=2026-10-08 reason=attribution_mismatch
oracle-withheld: date=2026-10-09 reason=key_set_not_reproducible
oracle-withheld: date=2026-10-10 reason=key_set_not_reproducible
oracle-withheld: date=2026-10-11 reason=attribution_mismatch
oracle-withheld: date=2026-10-12 reason=attribution_mismatch
oracle-withheld: date=2026-10-13 reason=attribution_mismatch
oracle-withheld: date=2026-10-14 reason=attribution_mismatch
oracle-withheld: date=2026-10-15 reason=attribution_mismatch
oracle-withheld: date=2026-10-16 reason=attribution_mismatch
oracle-withheld: date=2026-10-17 reason=attribution_mismatch
oracle-withheld: date=2026-10-18 reason=attribution_mismatch
oracle-withheld: date=2026-10-19 reason=attribution_mismatch
oracle-withheld: date=2026-10-20 reason=attribution_mismatch
oracle-withheld: date=2026-10-21 reason=attribution_mismatch
oracle-withheld: date=2026-10-22 reason=attribution_mismatch
oracle-withheld: date=2026-10-23 reason=attribution_mismatch
oracle-withheld: date=2026-10-24 reason=attribution_mismatch
oracle-withheld: date=2026-10-25 reason=attribution_mismatch
oracle-withheld: date=2026-10-26 reason=attribution_mismatch
oracle-withheld: date=2026-10-27 reason=attribution_mismatch
oracle-withheld: date=2026-10-28 reason=attribution_mismatch
oracle-withheld: date=2026-10-29 reason=attribution_mismatch
oracle-withheld: date=2026-10-30 reason=attribution_mismatch
oracle-withheld: date=2026-10-31 reason=attribution_mismatch
oracle-withheld: date=2026-11-01 reason=attribution_mismatch
oracle-withheld: date=2026-11-02 reason=attribution_mismatch
oracle-withheld: date=2026-11-03 reason=attribution_mismatch
oracle-withheld: date=2026-11-04 reason=attribution_mismatch
oracle-withheld: date=2026-11-05 reason=attribution_mismatch
oracle-withheld: date=2026-11-06 reason=attribution_mismatch
oracle-withheld: date=2026-11-07 reason=attribution_mismatch
oracle-withheld: date=2026-11-08 reason=attribution_mismatch
oracle-withheld: date=2026-11-09 reason=attribution_mismatch
oracle-withheld: date=2026-11-10 reason=attribution_mismatch
oracle-withheld: date=2026-11-11 reason=attribution_mismatch
oracle-withheld: date=2026-11-12 reason=attribution_mismatch
oracle-withheld: date=2026-11-13 reason=attribution_mismatch
oracle-withheld: date=2026-11-14 reason=attribution_mismatch
oracle-withheld: date=2026-11-15 reason=attribution_mismatch
oracle-withheld: date=2026-11-16 reason=attribution_mismatch
oracle-withheld: date=2026-11-17 reason=attribution_mismatch
oracle-withheld: date=2026-11-18 reason=attribution_mismatch
oracle-withheld: date=2026-11-19 reason=attribution_mismatch
oracle-withheld: date=2026-11-20 reason=attribution_mismatch
oracle-withheld: date=2026-11-21 reason=attribution_mismatch
oracle-withheld: date=2026-11-22 reason=attribution_mismatch
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
oracle-omitted: date=2024-02-19 reason=omission_unexplained
oracle-omitted: date=2024-02-20 reason=omission_unexplained
oracle-omitted: date=2024-02-21 reason=omission_unexplained
oracle-omitted: date=2024-02-22 reason=omission_unexplained
oracle-omitted: date=2024-02-23 reason=omission_unexplained
oracle-omitted: date=2024-02-24 reason=omission_unexplained
oracle-omitted: date=2024-02-25 reason=omission_unexplained
oracle-omitted: date=2024-02-26 reason=omission_unexplained
oracle-omitted: date=2024-02-27 reason=omission_unexplained
oracle-omitted: date=2024-02-28 reason=omission_unexplained
oracle-omitted: date=2024-02-29 reason=omission_unexplained
oracle-omitted: date=2024-03-01 reason=omission_unexplained
oracle-omitted: date=2024-03-02 reason=omission_unexplained
oracle-omitted: date=2024-03-03 reason=omission_unexplained
oracle-omitted: date=2024-03-04 reason=omission_unexplained
oracle-omitted: date=2024-03-05 reason=omission_unexplained
oracle-omitted: date=2024-03-06 reason=omission_unexplained
oracle-omitted: date=2024-03-07 reason=omission_unexplained
oracle-omitted: date=2024-03-08 reason=omission_unexplained
oracle-omitted: date=2024-03-09 reason=omission_unexplained
oracle-omitted: date=2024-03-10 reason=omission_unexplained
oracle-omitted: date=2024-03-11 reason=omission_unexplained
oracle-omitted: date=2024-03-12 reason=omission_unexplained
oracle-omitted: date=2024-03-13 reason=omission_unexplained
oracle-omitted: date=2024-03-14 reason=omission_unexplained
oracle-omitted: date=2024-03-15 reason=omission_unexplained
oracle-omitted: date=2024-03-16 reason=omission_unexplained
oracle-omitted: date=2024-03-17 reason=omission_unexplained
oracle-omitted: date=2024-03-18 reason=omission_unexplained
oracle-omitted: date=2024-03-19 reason=omission_unexplained
oracle-omitted: date=2024-03-20 reason=omission_unexplained
oracle-omitted: date=2024-03-21 reason=omission_unexplained
oracle-omitted: date=2024-03-22 reason=omission_unexplained
oracle-omitted: date=2024-03-23 reason=omission_unexplained
oracle-omitted: date=2024-03-24 reason=omission_unexplained
oracle-omitted: date=2024-03-25 reason=omission_unexplained
oracle-omitted: date=2024-03-26 reason=omission_unexplained
oracle-omitted: date=2024-03-27 reason=omission_unexplained
oracle-omitted: date=2024-03-28 reason=omission_unexplained
oracle-omitted: date=2024-03-29 reason=omission_unexplained
oracle-omitted: date=2024-03-30 reason=omission_unexplained
oracle-omitted: date=2024-03-31 reason=omission_unexplained
oracle-omitted: date=2024-04-01 reason=omission_unexplained
oracle-omitted: date=2024-04-02 reason=omission_unexplained
oracle-omitted: date=2024-04-03 reason=omission_unexplained
oracle-omitted: date=2024-04-04 reason=omission_unexplained
oracle-omitted: date=2024-04-05 reason=omission_unexplained
oracle-omitted: date=2024-04-06 reason=omission_unexplained
oracle-omitted: date=2024-04-07 reason=omission_unexplained
oracle-omitted: date=2024-04-08 reason=omission_unexplained
oracle-omitted: date=2024-04-09 reason=omission_unexplained
oracle-omitted: date=2024-04-10 reason=omission_unexplained
oracle-omitted: date=2024-04-11 reason=omission_unexplained
oracle-omitted: date=2024-04-12 reason=omission_unexplained
oracle-omitted: date=2024-04-13 reason=omission_unexplained
oracle-omitted: date=2024-04-14 reason=omission_unexplained
oracle-omitted: date=2024-04-15 reason=omission_unexplained
oracle-omitted: date=2024-04-16 reason=omission_unexplained
oracle-omitted: date=2024-04-17 reason=omission_unexplained
oracle-omitted: date=2024-04-18 reason=omission_unexplained
oracle-omitted: date=2024-04-19 reason=omission_unexplained
oracle-omitted: date=2024-04-20 reason=omission_unexplained
oracle-omitted: date=2024-04-21 reason=omission_unexplained
oracle-omitted: date=2024-04-22 reason=omission_unexplained
oracle-omitted: date=2024-04-23 reason=omission_unexplained
oracle-omitted: date=2024-04-24 reason=omission_unexplained
oracle-omitted: date=2024-04-25 reason=omission_unexplained
oracle-omitted: date=2024-04-26 reason=omission_unexplained
oracle-omitted: date=2024-04-27 reason=omission_unexplained
oracle-omitted: date=2024-04-28 reason=omission_unexplained
oracle-omitted: date=2024-04-29 reason=omission_unexplained
oracle-omitted: date=2024-04-30 reason=omission_unexplained
oracle-omitted: date=2024-05-01 reason=omission_unexplained
oracle-omitted: date=2024-05-02 reason=omission_unexplained
oracle-omitted: date=2024-05-03 reason=omission_unexplained
oracle-omitted: date=2024-05-04 reason=omission_unexplained
oracle-omitted: date=2024-05-05 reason=omission_unexplained
oracle-omitted: date=2024-05-06 reason=omission_unexplained
oracle-omitted: date=2024-05-07 reason=omission_unexplained
oracle-omitted: date=2024-05-08 reason=omission_unexplained
oracle-omitted: date=2024-05-09 reason=omission_unexplained
oracle-omitted: date=2024-05-10 reason=omission_unexplained
oracle-omitted: date=2024-05-11 reason=omission_unexplained
oracle-omitted: date=2024-05-12 reason=omission_unexplained
oracle-omitted: date=2024-05-13 reason=omission_unexplained
oracle-omitted: date=2024-05-14 reason=omission_unexplained
oracle-omitted: date=2024-05-15 reason=omission_unexplained
oracle-omitted: date=2024-05-16 reason=omission_unexplained
oracle-omitted: date=2024-05-17 reason=omission_unexplained
oracle-omitted: date=2024-05-18 reason=omission_unexplained
oracle-omitted: date=2024-05-19 reason=omission_unexplained
oracle-omitted: date=2024-05-20 reason=omission_unexplained
oracle-omitted: date=2024-05-21 reason=omission_unexplained
oracle-omitted: date=2024-05-22 reason=omission_unexplained
oracle-omitted: date=2024-05-23 reason=omission_unexplained
oracle-omitted: date=2024-05-24 reason=omission_unexplained
oracle-omitted: date=2024-05-25 reason=omission_unexplained
oracle-omitted: date=2024-05-26 reason=omission_unexplained
oracle-omitted: date=2024-05-27 reason=omission_unexplained
oracle-omitted: date=2024-05-28 reason=omission_unexplained
oracle-omitted: date=2024-05-29 reason=omission_unexplained
oracle-omitted: date=2024-05-30 reason=omission_unexplained
oracle-omitted: date=2024-05-31 reason=omission_unexplained
oracle-omitted: date=2024-06-01 reason=omission_unexplained
oracle-omitted: date=2024-06-02 reason=omission_unexplained
oracle-omitted: date=2024-06-03 reason=omission_unexplained
oracle-omitted: date=2024-06-04 reason=omission_unexplained
oracle-omitted: date=2024-06-05 reason=omission_unexplained
oracle-omitted: date=2024-06-06 reason=omission_unexplained
oracle-omitted: date=2024-06-07 reason=omission_unexplained
oracle-omitted: date=2024-06-08 reason=omission_unexplained
oracle-omitted: date=2024-06-09 reason=omission_unexplained
oracle-omitted: date=2024-06-10 reason=omission_unexplained
oracle-omitted: date=2024-06-11 reason=omission_unexplained
oracle-omitted: date=2024-06-12 reason=omission_unexplained
oracle-omitted: date=2024-06-13 reason=omission_unexplained
oracle-omitted: date=2024-06-14 reason=omission_unexplained
oracle-omitted: date=2024-06-15 reason=omission_unexplained
oracle-omitted: date=2024-06-16 reason=omission_unexplained
oracle-omitted: date=2024-06-17 reason=omission_unexplained
oracle-omitted: date=2024-06-18 reason=omission_unexplained
oracle-omitted: date=2024-06-19 reason=omission_unexplained
oracle-omitted: date=2024-06-20 reason=omission_unexplained
oracle-omitted: date=2024-06-21 reason=omission_unexplained
oracle-omitted: date=2024-06-22 reason=omission_unexplained
oracle-omitted: date=2024-06-23 reason=omission_unexplained
oracle-omitted: date=2024-06-24 reason=omission_unexplained
oracle-omitted: date=2024-06-25 reason=omission_unexplained
oracle-omitted: date=2024-06-26 reason=omission_unexplained
oracle-omitted: date=2024-06-27 reason=omission_unexplained
oracle-omitted: date=2024-06-28 reason=omission_unexplained
oracle-omitted: date=2024-06-29 reason=omission_unexplained
oracle-omitted: date=2024-06-30 reason=omission_unexplained
oracle-omitted: date=2024-07-01 reason=omission_unexplained
oracle-omitted: date=2024-07-02 reason=omission_unexplained
oracle-omitted: date=2024-07-03 reason=omission_unexplained
oracle-omitted: date=2024-07-04 reason=omission_unexplained
oracle-omitted: date=2024-07-05 reason=omission_unexplained
oracle-omitted: date=2024-07-06 reason=omission_unexplained
oracle-omitted: date=2024-07-07 reason=omission_unexplained
oracle-omitted: date=2024-07-08 reason=omission_unexplained
oracle-omitted: date=2024-07-09 reason=omission_unexplained
oracle-omitted: date=2024-07-10 reason=omission_unexplained
oracle-omitted: date=2024-07-11 reason=omission_unexplained
oracle-omitted: date=2024-07-12 reason=omission_unexplained
oracle-omitted: date=2024-07-13 reason=omission_unexplained
oracle-omitted: date=2024-07-14 reason=omission_unexplained
oracle-omitted: date=2024-07-15 reason=omission_unexplained
oracle-omitted: date=2024-07-16 reason=omission_unexplained
oracle-omitted: date=2024-07-17 reason=omission_unexplained
oracle-omitted: date=2024-07-18 reason=omission_unexplained
oracle-omitted: date=2024-07-19 reason=omission_unexplained
oracle-omitted: date=2024-07-20 reason=omission_unexplained
oracle-omitted: date=2024-07-21 reason=omission_unexplained
oracle-omitted: date=2024-07-22 reason=omission_unexplained
oracle-omitted: date=2024-07-23 reason=omission_unexplained
oracle-omitted: date=2024-07-24 reason=omission_unexplained
oracle-omitted: date=2024-07-25 reason=omission_unexplained
oracle-omitted: date=2024-07-26 reason=omission_unexplained
oracle-omitted: date=2024-07-27 reason=omission_unexplained
oracle-omitted: date=2024-07-28 reason=omission_unexplained
oracle-omitted: date=2024-07-29 reason=omission_unexplained
oracle-omitted: date=2024-07-30 reason=omission_unexplained
oracle-omitted: date=2024-07-31 reason=omission_unexplained
oracle-omitted: date=2024-08-01 reason=omission_unexplained
oracle-omitted: date=2024-08-02 reason=omission_unexplained
oracle-omitted: date=2024-08-03 reason=omission_unexplained
oracle-omitted: date=2024-08-04 reason=omission_unexplained
oracle-omitted: date=2024-08-05 reason=omission_unexplained
oracle-omitted: date=2024-08-06 reason=omission_unexplained
oracle-omitted: date=2024-08-07 reason=omission_unexplained
oracle-omitted: date=2024-08-08 reason=omission_unexplained
oracle-omitted: date=2024-08-09 reason=omission_unexplained
oracle-omitted: date=2024-08-10 reason=omission_unexplained
oracle-omitted: date=2024-08-11 reason=omission_unexplained
oracle-omitted: date=2024-08-12 reason=omission_unexplained
oracle-omitted: date=2024-08-13 reason=omission_unexplained
oracle-omitted: date=2024-08-14 reason=omission_unexplained
oracle-omitted: date=2024-08-15 reason=omission_unexplained
oracle-omitted: date=2024-08-16 reason=omission_unexplained
oracle-omitted: date=2024-08-17 reason=omission_unexplained
oracle-omitted: date=2024-08-18 reason=omission_unexplained
oracle-omitted: date=2024-08-19 reason=omission_unexplained
oracle-omitted: date=2024-08-20 reason=omission_unexplained
oracle-omitted: date=2024-08-21 reason=omission_unexplained
oracle-omitted: date=2024-08-22 reason=omission_unexplained
oracle-omitted: date=2024-08-23 reason=omission_unexplained
oracle-omitted: date=2024-08-24 reason=omission_unexplained
oracle-omitted: date=2024-08-25 reason=omission_unexplained
oracle-omitted: date=2024-08-26 reason=omission_unexplained
oracle-omitted: date=2024-08-27 reason=omission_unexplained
oracle-omitted: date=2024-08-28 reason=omission_unexplained
oracle-omitted: date=2024-08-29 reason=omission_unexplained
oracle-omitted: date=2024-08-30 reason=omission_unexplained
oracle-omitted: date=2024-08-31 reason=omission_unexplained
oracle-omitted: date=2024-09-01 reason=omission_unexplained
oracle-omitted: date=2024-09-02 reason=omission_unexplained
oracle-omitted: date=2024-09-03 reason=omission_unexplained
oracle-omitted: date=2024-09-04 reason=omission_unexplained
oracle-omitted: date=2024-09-05 reason=omission_unexplained
oracle-omitted: date=2024-09-06 reason=omission_unexplained
oracle-omitted: date=2024-09-07 reason=omission_unexplained
oracle-omitted: date=2024-09-08 reason=omission_unexplained
oracle-omitted: date=2024-09-09 reason=omission_unexplained
oracle-omitted: date=2024-09-10 reason=omission_unexplained
oracle-omitted: date=2024-09-11 reason=omission_unexplained
oracle-omitted: date=2024-09-12 reason=omission_unexplained
oracle-omitted: date=2024-09-13 reason=omission_unexplained
oracle-omitted: date=2024-09-14 reason=omission_unexplained
oracle-omitted: date=2024-09-15 reason=omission_unexplained
oracle-omitted: date=2024-09-16 reason=omission_unexplained
oracle-omitted: date=2024-09-17 reason=omission_unexplained
oracle-omitted: date=2024-09-18 reason=omission_unexplained
oracle-omitted: date=2024-09-19 reason=omission_unexplained
oracle-omitted: date=2024-09-20 reason=omission_unexplained
oracle-omitted: date=2024-09-21 reason=omission_unexplained
oracle-omitted: date=2024-09-22 reason=omission_unexplained
oracle-omitted: date=2024-09-23 reason=omission_unexplained
oracle-omitted: date=2024-09-24 reason=omission_unexplained
oracle-omitted: date=2024-09-25 reason=omission_unexplained
oracle-omitted: date=2024-09-26 reason=omission_unexplained
oracle-omitted: date=2024-09-27 reason=omission_unexplained
oracle-omitted: date=2024-09-28 reason=omission_unexplained
oracle-omitted: date=2024-09-29 reason=omission_unexplained
oracle-omitted: date=2024-09-30 reason=omission_unexplained
oracle-omitted: date=2024-10-01 reason=omission_unexplained
oracle-omitted: date=2024-10-02 reason=omission_unexplained
oracle-omitted: date=2024-10-03 reason=omission_unexplained
oracle-omitted: date=2024-10-04 reason=omission_unexplained
oracle-omitted: date=2024-10-05 reason=omission_unexplained
oracle-omitted: date=2024-10-06 reason=omission_unexplained
oracle-omitted: date=2024-10-07 reason=omission_unexplained
oracle-omitted: date=2024-10-08 reason=omission_unexplained
oracle-omitted: date=2024-10-09 reason=omission_unexplained
oracle-omitted: date=2024-10-10 reason=omission_unexplained
oracle-omitted: date=2024-10-11 reason=omission_unexplained
oracle-omitted: date=2024-10-12 reason=omission_unexplained
oracle-omitted: date=2024-10-13 reason=omission_unexplained
oracle-omitted: date=2024-10-14 reason=omission_unexplained
oracle-omitted: date=2024-10-15 reason=omission_unexplained
oracle-omitted: date=2024-10-16 reason=omission_unexplained
oracle-omitted: date=2024-10-17 reason=omission_unexplained
oracle-omitted: date=2024-10-18 reason=omission_unexplained
oracle-omitted: date=2024-10-19 reason=omission_unexplained
oracle-omitted: date=2024-10-20 reason=omission_unexplained
oracle-omitted: date=2024-10-21 reason=omission_unexplained
oracle-omitted: date=2024-10-22 reason=omission_unexplained
oracle-omitted: date=2024-10-23 reason=omission_unexplained
oracle-omitted: date=2024-10-24 reason=omission_unexplained
oracle-omitted: date=2024-10-25 reason=omission_unexplained
oracle-omitted: date=2024-10-26 reason=omission_unexplained
oracle-omitted: date=2024-10-27 reason=omission_unexplained
oracle-omitted: date=2024-10-28 reason=omission_unexplained
oracle-omitted: date=2024-10-29 reason=omission_unexplained
oracle-omitted: date=2024-10-30 reason=omission_unexplained
oracle-omitted: date=2024-10-31 reason=omission_unexplained
oracle-omitted: date=2024-11-01 reason=omission_unexplained
oracle-omitted: date=2024-11-02 reason=omission_unexplained
oracle-omitted: date=2024-11-03 reason=omission_unexplained
oracle-omitted: date=2024-11-04 reason=omission_unexplained
oracle-omitted: date=2024-11-05 reason=omission_unexplained
oracle-omitted: date=2024-11-06 reason=omission_unexplained
oracle-omitted: date=2024-11-07 reason=omission_unexplained
oracle-omitted: date=2024-11-08 reason=omission_unexplained
oracle-omitted: date=2024-11-09 reason=omission_unexplained
oracle-omitted: date=2024-11-10 reason=omission_unexplained
oracle-omitted: date=2024-11-11 reason=omission_unexplained
oracle-omitted: date=2024-11-12 reason=omission_unexplained
oracle-omitted: date=2024-11-13 reason=omission_unexplained
oracle-omitted: date=2024-11-14 reason=omission_unexplained
oracle-omitted: date=2024-11-15 reason=omission_unexplained
oracle-omitted: date=2024-11-16 reason=omission_unexplained
oracle-omitted: date=2024-11-17 reason=omission_unexplained
oracle-omitted: date=2024-11-18 reason=omission_unexplained
oracle-omitted: date=2024-11-19 reason=omission_unexplained
oracle-omitted: date=2024-11-20 reason=omission_unexplained
oracle-omitted: date=2024-11-21 reason=omission_unexplained
oracle-omitted: date=2024-11-22 reason=omission_unexplained
oracle-omitted: date=2024-11-23 reason=omission_unexplained
oracle-omitted: date=2024-11-24 reason=omission_unexplained
oracle-omitted: date=2024-11-25 reason=omission_unexplained
oracle-omitted: date=2024-11-26 reason=omission_unexplained
oracle-omitted: date=2024-11-27 reason=omission_unexplained
oracle-omitted: date=2024-11-28 reason=omission_unexplained
oracle-omitted: date=2024-11-29 reason=omission_unexplained
oracle-omitted: date=2024-11-30 reason=omission_unexplained
oracle-omitted: date=2024-12-01 reason=omission_unexplained
oracle-omitted: date=2024-12-02 reason=omission_unexplained
oracle-omitted: date=2024-12-03 reason=omission_unexplained
oracle-omitted: date=2024-12-04 reason=omission_unexplained
oracle-omitted: date=2024-12-05 reason=omission_unexplained
oracle-omitted: date=2024-12-06 reason=omission_unexplained
oracle-omitted: date=2025-09-05 reason=omission_unexplained
oracle-omitted: date=2025-09-06 reason=omission_unexplained
oracle-omitted: date=2025-09-07 reason=omission_unexplained
oracle-omitted: date=2025-09-08 reason=omission_unexplained
oracle-omitted: date=2025-09-09 reason=omission_unexplained
oracle-annotation: name=capital_outside_base_options_cash days=1246 explained_days=437 explained_cumulative=x2.13
oracle-annotation: name=capital_outside_base_flow_day days=198 explained_days=70 explained_cumulative=x1.64
oracle-annotation: name=key_sat_out days=147 explained_days=37 explained_cumulative=x0.995
oracle-cumulative: published=x3260 explained=x2.13 explained_unannotated=x1 published_without_big_days=x298
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
oracle-verdict: verdict=VACUOUS withheld_published=483 omission_unexplained=297 key_set=reproduced
```
