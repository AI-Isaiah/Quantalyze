---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 03
subsystem: analytics-service / Deribit book attribution oracle
tags: [oracle, money-math, DBOOK-01, PROOF-01, stdlib-only]
requires: []
provides:
  - analytics-service/scripts/deribit_book_oracle.py (independent per-day attribution oracle, closed sets, verdict order)
  - analytics-service/tests/test_deribit_book_oracle.py and six hand-derived fixtures
affects: [233-05 (wave 2: emptied_stretch, annotations, rotation, --print-sql, PROD reading)]
tech-stack:
  added: []
  patterns: [independent walk with vacuity floor, closed-vocabulary emitter, AST independence scan with self-test]
key-files:
  created:
    - analytics-service/scripts/deribit_book_oracle.py
    - analytics-service/tests/test_deribit_book_oracle.py
    - analytics-service/tests/fixtures/deribit_book_oracle/explained_two_keys.json
    - analytics-service/tests/fixtures/deribit_book_oracle/withheld_attribution_mismatch.json
    - analytics-service/tests/fixtures/deribit_book_oracle/withheld_no_base_level.json
    - analytics-service/tests/fixtures/deribit_book_oracle/withheld_key_basis.json
    - analytics-service/tests/fixtures/deribit_book_oracle/key_set_mismatch.json
    - analytics-service/tests/fixtures/deribit_book_oracle/vacuous.json
  modified: []
decisions:
  - "explained requires BOTH the value to reproduce AND every participating key's basis to hold (stamp identity, writer mode, no withheld token)"
  - "omission_unexplained is produced now (an unpublished day the oracle would publish), so no computable day goes unclassified"
metrics:
  tasks: 2
  files: 8
status: complete
actuals:
  tokens: 19800
  tasks: 2
  commits: 2
plan_head_before: 1b4725bf5dc5de6fe7516938227a6b4d7fcfbe72
plan_head_after: a97a78df10d54f8ea7fe557bbc2d5fcccc08dbe4
---

# Phase 233 Plan 03: the Deribit book attribution oracle Summary

A stdlib-only oracle that recomputes each published Deribit book return as booked P&L over the previous-day levels (rolled back from the realized terminal) and either explains a day or withholds it under one closed name, with the verdict order key set, vacuity, STOP, CLEAN.

## What was built

- `analytics-service/scripts/deribit_book_oracle.py`: strict loader (`load_export`, `ExportError` naming field paths only, year slices flattened, one optional string `_comment`), `roll_key_levels` (writer-basis backward roll, stamp identity, live-anchor step), `reproduce_book` (the SPEC's union-day loop with its own numbers), `classify_days`, a closed-vocabulary emitter behind `emit_reading`, `main`. Public closed sets `WITHHELD_REASONS`, `OMITTED_REASONS`, `ANNOTATIONS`; `_MIN_EXPLAINED_SHARE = 0.5`; `_BIG_DAY_ABS_RETURN = 0.30` (reporting only); numeric equality tolerances `_BOOK_RETURN_REL_TOL = 1e-9`, `_BOOK_RETURN_ABS_TOL = 1e-12` (not plausibility bounds).
- Verdict order: an unreproduced key set is STOP (exit 1); otherwise no explained day, or under half, is VACUOUS (exit 3); otherwise any withheld published day or `omission_unexplained` is STOP; else CLEAN (exit 0). Malformed export or usage is exit 2.
- Withheld ladder for a published day the oracle does not reproduce: `key_set_not_reproducible` (key set unreproduced, or a declared departure or stitch boundary day), `no_stored_base_level`, `key_basis_not_reproducible`, [slot for 233-05's `emptied_stretch`], `attribution_mismatch`.
- Tests: 13, in `tests/test_deribit_book_oracle.py` (tracer, AST independence scan with self-test and vacuity guard, one test per withheld class, key-set, vacuity, closed-set membership, hand-derived cumulative line, big-day and degrade lines, strict loader, year slices and comment).
- Six fixtures, each with its hand derivation in `_comment`; the two Task 2 variants of the base book were copied from the hand-derived base, then each edited by hand for one cause.

## Verification

- `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_book_oracle.py -q -p no:cacheprovider`: 13 passed.
- Plain `python3` run of the script on every fixture: exits 0 (explained), 1 (four withheld or key-set fixtures), 3 (vacuous); the tracer prints `oracle-verdict: verdict=CLEAN ...` and exit 0.
- `.venv/bin/mypy --strict scripts/deribit_book_oracle.py`: Success, no issues.
- Full analytics pytest in this worktree's venv (ccxt 4.5.89): run with `-x`, everything before `tests/test_process_key_anon_ip_tier.py::test_a_per_ip_refusal_leaks_no_identity_in_body_headers_or_the_handler_log` passed and that one test failed inside the full run (a log-capture assertion, `AssertionError: []`); it passes alone (`tests/test_process_key_anon_ip_tier.py`: 20 passed) and touches nothing this plan changed. The remaining 91 test files after it ran separately: 1945 passed, 20 skipped.
- `npm run lint`: exit 0. Invariant vitest (`src/lib/*invariant*`, `src/__tests__/*invariant*`, `seam-log-coverage`, `critical-regressions`): 17 files, 660 tests passed.
- `gitleaks dir` over the script, the test and the fixture directory: no leaks found.
- The independence grep `^[[:space:]]*(import|from)[[:space:]]+(services|routers|models|scripts)\b` over the script: 0.

## PROOF-01

Each arm: byte backup into the executor's session scratchpad (`<scratchpad>`), neuter, RED, restore with `cp` then `cmp` (no output) and `git diff --quiet`, GREEN. The two Task 1 arms ran right after the Task 1 commit, the three Task 2 arms after the Task 2 commit.

| arm-id | neuter edit | command | RED | cmp | GREEN |
|---|---|---|---|---|---|
| oracle-identity | in `reproduce_book`: `denom += lv.level[carry_prev]` became `denom += lv.level[_carry_day(lv, label in rotated, day) or carry_prev]` (the day's own level instead of the previous day's) | `.venv/bin/python -m pytest "tests/test_deribit_book_oracle.py::test_tracer_explained_book_reads_clean" -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_tracer_explained_book_reads_clean | cmp: exit 0, no output | GREEN: 1 passed in 49.07s |
| oracle-independence | added a module-level `import services.nav_twr` to the script | `.venv/bin/python -m pytest "tests/test_deribit_book_oracle.py::test_the_oracle_imports_no_production_helper" -q -p no:cacheprovider` | RED: E       AssertionError: the oracle imports what it judges or reaches out: ['import:services.nav_twr'] | cmp: exit 0, no output | GREEN: 1 passed in 17.65s |
| oracle-withheld-closed | in `classify_days`, right after `pub = published[day]`, inserted `out.append(DayClass(day, "explained", None, pub, oracle_value))` and `continue` (every published day explained) | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py -k "withheld" -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_withheld_attribution_mismatch | cmp: exit 0, no output | GREEN: 4 passed, 9 deselected in 10.17s |
| oracle-vacuity | in `decide_verdict`: `if not explained or len(explained) / published < _MIN_EXPLAINED_SHARE:` became `if False:` (VACUOUS check removed) | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py -k "vacuous" -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_a_run_that_explains_nothing_is_vacuous_not_green | cmp: exit 0, no output | GREEN: 1 passed, 12 deselected in 9.96s |
| oracle-key-set | in `check_key_set`: `len(parents) == export.book.n_keys` became `True` (the `n_keys` comparison removed) | `.venv/bin/python -m pytest tests/test_deribit_book_oracle.py -k "key_set" -q -p no:cacheprovider` | RED: FAILED tests/test_deribit_book_oracle.py::test_key_set_mismatch_withholds_every_published_day | cmp: exit 0, no output | GREEN: 1 passed, 12 deselected in 10.08s |

For the three Task 2 behaviour tests that were written before their implementation (TDD), the first run showed 7 failed and 6 passed before the script was extended. The Task 1 tracer's script was written ahead of its first test run, so its RED evidence is the PROOF-01 neuter above, not a missing-module failure.

## Deviations from Plan

Each is a choice inside the plan's words, recorded rather than silent.

1. **[Rule 2 - correctness] `explained` is gated by the per-key basis, not only by the value.** A day is explained only when the oracle's value matches AND every participating key has a basis, is in writer mode, carries no `writer_basis_withheld` token, has a stamp, and passes the stamp identity on that day. Without this a stamp that disagrees with P over the previous level would pass whenever the book value coincided. The `withheld_key_basis` fixture changes only a stamp and leaves every published value equal to the oracle's own, which proves the gate.
2. **`key_basis_not_reproducible` also fires on** a key whose row is not in writer mode (the SPEC's `writer_mode` conditions: flows on P&L days, unstamped days with a zero return, terminal day equal to the last P&L day, no level day after it) and on a key with no `returns_stamp` (the identity cannot be checked, so it is not claimed). The plan named the withheld token, a stamp mismatch and a terminal day mismatch.
3. **`omission_unexplained` is produced in this plan** (an unpublished day the oracle would publish), where the plan says 233-05 produces it with the rule already in place. Producing it now means no computable unpublished day is left unclassified.
4. **An extra reading line `oracle-annotation: state=not_computed`** is printed, because the annotation pass is 233-05's and `explained_unannotated` would otherwise read as "none annotated". 233-05 replaces it.
5. **Compose detail mirrored from the SPEC (found by reading):** the sit-out set is the key's dropped-P&L days that have NO stored return (`allocator_equity_compose.py` builds it as dropped days not in the key's returns), not every dropped-P&L day.
6. **`pathlib` is not used** in the script (it opens the file with `open`), keeping to the plan's stdlib list.

## Known limits and handoff to plan 233-05

- `emptied_stretch` rule, the emptied band and the live-anchor-in-band exception are not implemented; the slot between `key_basis_not_reproducible` and `attribution_mismatch` is commented in `classify_days`.
- A coverage-handoff rotation that is not declared in `declared.departed` is not detected; an undeclared early end carries its last level and the day is likely to read `attribution_mismatch`. A stitched child is modelled as its own key series, with its join day and the next day treated as boundary days.
- Annotations (`ANNOTATIONS` names exist, nothing computes them), the remaining omitted reasons (`outside_published_window` is named, never produced), the carry and rotation fixtures, `--print-sql`, the closed-set and one-class-per-day tests, the emitter and export-id refusal tests, the constant parity pin and the PROD reading are 233-05.
- The explained cumulative uses the oracle's own values on explained days; the "largest share" key in a big-day line is the key with the largest absolute booked P&L over the sum of absolute booked P&L of the counted keys.

## Known Stubs

None. No UI, no hardcoded empty data flowing to a surface.

## Threat Flags

None. The script holds no connection, reads one local file and prints a redacted reading (T-233-08, T-233-09 mitigations as planned: closed emitter with a final UUID and long-digit scan, AST scan with a self-test).

## Self-Check: PASSED

Created files exist and both task commits are in the branch history (verified below in the final run).
