---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 06
subsystem: analytics-service
tags: [deribit, options, smoothed-mtm, probe, measurement, redaction]
requires: []
provides:
  - "scripts/deribit_options_smoothed_probe.py: the wave-2 read-only measurement (C1-C4 pass criteria, C5 report-only counts)"
  - "tests/test_deribit_options_smoothed_probe.py: the criteria, redaction and read-only contract a promotion plan must keep green"
affects: [252 wave-2 promotion gap plan (written only if the post-ship run passes)]
tech-stack:
  added: []
  patterns: ["navbreach probe shape: closed-vocabulary emitter, refusal before decrypt, type-only failure output"]
key-files:
  created:
    - analytics-service/scripts/deribit_options_smoothed_probe.py
    - analytics-service/tests/test_deribit_options_smoothed_probe.py
  modified: []
key-decisions:
  - "Every pass criterion is structural (the code's own raises and completeness report); no magnitude bound (D-05)"
  - "Class names that the emitter does not know read 'other' (build) or the base class (C4) instead of making the emitter refuse the record"
  - "A verdict over zero judged members is a fail, never a vacuous pass"
patterns-established:
  - "Numeric TYPE discipline of an emitter lives in one place (_refuse_floats) so PROOF-01 can neuter it and see a named case go RED"
requirements-completed: []
duration: ~1h
completed: 2026-11-25
status: complete
commits: 2
plan_head_before: 89a9e3d9713dc6ac0d6e5f0382d4ff0d66146001
plan_head_after: 77bc4b49f37ee48d36cef3a0c628e47b1b7845b8
actuals:
  tokens: 13000
  tasks: 2
  commits: 2
---

# Phase 252 Plan 06: Smoothed-valuation probe Summary

A read-only probe that measures whether the existing smoothed mark-to-market reconstruction computes for a composite's Deribit member keys, against structural pass criteria fixed in its docstring before any run, and prints only ordinals, counts, verdict words and class names.

## What shipped

- `analytics-service/scripts/deribit_options_smoothed_probe.py`: `run`, `main`, `measure_member_live`, `measure_member`, `verdict_record`, `refusal_reason`, `emit_record`, `validate_record`, plus the vocabulary constants. It mirrors the composite member arm's `_reconstruct_deribit` closure (strategy config parsed, `exclude_spot_extraction_for`, one `fetch_deribit_native_account_state`, `build_deribit_native_ledger`, `assert_ledger_complete`, `combine_native_ledger` with the strategy's own config). It deliberately omits the allocated member's NAV twin; the docstring records why.
- `analytics-service/tests/test_deribit_options_smoothed_probe.py`: 53 tests (stubbed exchange, stubbed read-only database, the Phase 185 round-trip fixture pair as the build seam's results).
- Reused, not copied: `RecordingProxy`, `classify_ledger_error`, `_BUILD_ERRORS` and the allow-list sets from `scripts.navbreach_anchor_probe`; `assert_sanitized` from `scripts.deribit_ground_truth`; `PNL_DOM_RATIO` from `services.nav_twr`.

### Criteria as implemented (judged on the smoothed basis; cash is printed as `contrast`)

| Criterion | Observation | Fails when |
|---|---|---|
| C1, C2 | the smoothed build outcome | any build error (including `DeribitTransientReadError`, never retried), or `LedgerCompletenessError` |
| C3 | `len(report.pre_mark_retention_option_days)` | non-empty |
| C4 | `combine_native_ledger(..., denominator_config=strategy's)` | any `NavReconstructionError` |
| C5 | report only | never gates: counts at or above `PNL_DOM_RATIO`, days above one half, up to five largest-|return| ordinals |

The verdict line is `pass` only when at least one member was judged and every member passes C1 to C4.

## Sequencing (recorded; not executor tasks)

1. This plan ships the probe and its tests in the phase PR.
2. After the ship and the Railway worker deploy, the orchestrator runs it once per trigger composite: `railway ssh "cd /app && python -m scripts.deribit_options_smoothed_probe --strategy-id <id>"`. Founder-gated. The id is typed on the command line only. Only the lines starting with `{"` are pasted into the phase record. No PROD run was made here.
3. On `pass`, a later gap-closure plan (`/gsd-plan-phase 252 --gaps`) plans the promotion (smoothed series as the composite headline inside the stitch job, the predicate reading the stored headline basis, a re-stitch through the product's job and never an UPDATE, a byte-identical MT5-only pytest, and a `git diff` against the Phase 233 branch before editing `job_worker.py`). On `fail`, the withhold stays and the reading is recorded. Neither path is planned here.

## Verification

Environment: the analytics venv of the main checkout (Python 3.12.13, `mypy 2.4.0`, the version `requirements-dev.txt` pins) run with cwd `analytics-service/` of this worktree; `pythonpath = .` makes the worktree's code the code under test. Nothing was installed or committed for it.

RED (Task 1, before the script existed): `ERROR tests/test_deribit_options_smoothed_probe.py` / `Interrupted: 1 error during collection` (the module was absent).

pytest, `cd analytics-service && python -m pytest tests/test_deribit_options_smoothed_probe.py tests/test_navbreach_anchor_probe.py -q`:

```
96 passed
```

mypy strict on the new script (outside the CI surface, a standalone floor):

```
$ mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/deribit_options_smoothed_probe.py
Success: no issues found in 1 source file
```

The CI mypy command, verbatim from `.github/workflows/ci.yml`:

```
$ mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 143 source files
```

`node scripts/verify-plan-anchors.mjs --pending`: `claims: 84 checked` / `OK: 20 plan file(s), no stale claims.`

Acceptance greps at HEAD: `run_stitch_composite_job` 0, `SMOOTHED_MTM_ENABLED` 0, `PNL_DOM_RATIO` 3, `pre_mark_retention_option_days` and `PNL_BASIS_SMOOTHED_MTM` both at least 1.

## PROOF-01 (neuter, see RED with the arm named, restore by cp, cmp, GREEN)

`$SCRATCH` is the session scratchpad directory; each backup was taken with `cp` and verified with `cmp` before neutering.

**C3 gate** (`c3 = PASS if outcome.bucketed == 0 else FAIL` replaced by `c3 = PASS`):

```
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_bucketed_option_day_fails_c3_and_the_member
1 failed, 12 passed
$ cp $SCRATCH/probe.c3.bak scripts/deribit_options_smoothed_probe.py; cmp scripts/deribit_options_smoothed_probe.py $SCRATCH/probe.c3.bak
cmp exit 0
13 passed
```

**C4 gate** (the combine raise mapped to `c4 = PASS`):

```
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_series_that_does_not_reconcile_fails_c4[inception-reconciliation]
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_series_that_does_not_reconcile_fails_c4[off-list-subclass]
2 failed, 51 passed
$ cp $SCRATCH/probe.p2.bak scripts/deribit_options_smoothed_probe.py; cmp scripts/deribit_options_smoothed_probe.py $SCRATCH/probe.p2.bak
cmp exit 0
53 passed
```

**Redaction, float refusal** (`_refuse_floats(record)` removed from `validate_record`):

```
FAILED tests/test_deribit_options_smoothed_probe.py::test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary[days_over_half=2.0]
FAILED tests/test_deribit_options_smoothed_probe.py::test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary[top_ordinals=[3, 2.0]]
FAILED tests/test_deribit_options_smoothed_probe.py::test_the_emitter_refuses_a_missing_key_and_a_malformed_verdict_line
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_refusal_names_the_path_and_never_the_value
4 failed, 49 passed
$ cp $SCRATCH/probe.p2.bak scripts/deribit_options_smoothed_probe.py; cmp scripts/deribit_options_smoothed_probe.py $SCRATCH/probe.p2.bak
cmp exit 0
53 passed
```

**Source pins** (appending a comment naming the stitch job, then the kill switch, to a byte-backed copy; grep count 1 each):

```
FAILED tests/test_deribit_options_smoothed_probe.py::test_the_probe_never_names_the_stitch_job_or_the_switch_or_the_environment
1 failed, 52 passed      (stitch job named)
cmp exit 0
FAILED tests/test_deribit_options_smoothed_probe.py::test_the_probe_never_names_the_stitch_job_or_the_switch_or_the_environment
1 failed, 52 passed      (kill switch named)
cmp exit 0
```

After the last restore `git diff --quiet` on the script printed no difference from the committed file, and the suite was 96 passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Off-list exception classes could make the emitter refuse the whole record**
- **Found during:** Task 1 design
- **Issue:** the navbreach class allow-list holds seven names. A `LedgerValuationError` subclass, or a `NavReconstructionError` subclass other than the named ones, would have produced a `build-error:<Class>` or `fail:<Class>` word the emitter rejects, so the PROD run would exit 1 with no record.
- **Fix:** a build error off the list reads `build-error:other`; a C4 refusal off the list reads `fail:NavReconstructionError`. Both have cases (`test_a_build_error_class_off_the_allow_list_is_emitted_as_other`, `test_a_series_that_does_not_reconcile_fails_c4[off-list-subclass]`).
- **Files modified:** the probe and its tests
- **Commit:** e4bdab3aa, 77bc4b49f

**2. [Rule 2 - Missing critical functionality] A verdict over zero judged members**
- **Issue:** a vacuous `pass` is possible if no member record reaches the verdict function.
- **Fix:** `verdict_record` returns `fail` unless at least one member was judged; `run` also refuses an unknown strategy and a composite with no members before any decrypt.
- **Commit:** e4bdab3aa

### Plan details settled by the executor (not deviations of intent)

- The plan's Task 2 bucketed-days case sits in Task 1, so the C3 PROOF-01 has a durable named test.
- `top_ordinals` needs the cap 5, so there are two numeric constants, `SC4_HALF_DAY_RETURN` (0.5, the 185 SC-4 reading, the only threshold-like value) and `MAX_TOP_ORDINALS` (5, a list cap named so it cannot read as a ratio or guard). The source pin forbids any ratio, tolerance, guard, threshold, dust or floor name taking a literal and requires the half constant to be the single 0.5 assignment.
- The per-field count validators check range only; the float refusal is the single numeric-type rule (`_refuse_floats`), so PROOF-01 can neuter it and see a named case fail.
- One extra record key, `series_days`, so a reader can tell an ordinal's frame of reference (and that 0 means no series was produced).

## Auth gates

None. No credentials, database or exchange were touched; every test uses stubs.

## Known Stubs

None. (The tests stub the venue and the database by design; the probe itself has no stub path.)

## Threat Flags

None beyond the plan's register (T-252-14 to T-252-17 mitigated as planned: closed-vocabulary emitter with float refusal and `assert_sanitized`; source pins forbidding write verbs, the stitch job and the breaker preflight; the switch and the environment never named or read, with an environment-unchanged case; refusal before any decrypt, with a decrypt stub that records calls).

## Self-Check: PASSED

- `analytics-service/scripts/deribit_options_smoothed_probe.py`: FOUND
- `analytics-service/tests/test_deribit_options_smoothed_probe.py`: FOUND
- commit e4bdab3aa: FOUND (ancestor of HEAD)
- commit 77bc4b49f: FOUND (ancestor of HEAD)
- STATE.md, state.json and ROADMAP.md: untouched
