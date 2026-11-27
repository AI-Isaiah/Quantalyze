---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 07
subsystem: analytics-service
tags: [deribit, options, smoothed-mtm, probe, diagnostics, gap-closure, G252-PROBE-M3]
requires: [252-06]
provides:
  - "services/deribit_txn.py: OptionMarkHoleError, OptionExerciseRowError, OptionExpiryRowError (direct subclasses of LedgerValuationError) and the closed vocabularies they carry"
  - "option_mtm_daily keyword-only retention_cutoff; _build_smoothed_option_mtm hands down its existing hard cutoff"
  - "scripts/deribit_options_smoothed_probe.py: the refusal_shape record key (closed validator, unreadable fallback)"
affects: [252 re-run of the founder-gated PROD probe, any later G252-PROBE-M3 gap plan]
tech-stack:
  added: []
  patterns: ["diagnostic subclass: message and args byte-identical, closed attributes computed at the raise", "degrade to unreadable, never refuse the record"]
key-files:
  created: []
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/scripts/navbreach_anchor_probe.py
    - analytics-service/scripts/deribit_options_smoothed_probe.py
    - analytics-service/tests/test_deribit_options_smoothed_probe.py
    - analytics-service/tests/test_deribit_assignment.py
    - analytics-service/tests/test_smoothed_mtm_core.py
    - analytics-service/tests/test_navbreach_anchor_probe.py
key-decisions:
  - "Refusals unchanged (founder decision 2026-11-26): same rows refuse at the same point, str(exc) and exc.args byte-identical, no interpolation, no head-trim, no horizon change, no newly accepted row shape"
  - "The three classes subclass LedgerValuationError directly and never OptionRowFieldMissingError, so the mark_to_market degrade reason cannot move"
  - "Attributes are closed words and non-negative ints; an off-set attribute prints unreadable and the record still emits"
patterns-established:
  - "A byte-identity pin on an exception message beside the subclass that carries diagnostics"
requirements-completed: []
duration: ~1h
completed: 2026-11-27
status: complete
commits: 3
plan_head_before: b9d4e4d9e158839e5e65b6f3b5deb7847c3a3c96
plan_head_after: c3e7c0c8f7fa271f94c54f92f83023d55978f6f7
actuals:
  tokens: 12100
  tasks: 3
  commits: 3
---

# Phase 252 Plan 07: Name which smoothed-only refusal fired Summary

The three smoothed-only refusals that printed the same `build-error:LedgerValuationError` / `LedgerValuationError:position` pair for member m3 now each raise their own `LedgerValuationError` subclass with closed attributes, and the probe prints which one fired and where, in closed vocabulary. No refusal changed. This is the diagnostic half of gap G252-PROBE-M3 only: the cause is still unmeasured and no fix is chosen here.

## What shipped

Commits (single-repo, measured from the plan ledger): `61f19e17c` (Task 1, tracer), `08d404aa0` (Task 2), `c3e7c0c8f` (Task 3).

- `services/deribit_txn.py`: `OptionMarkHoleError` (`vs_marks`, `vs_retention`), `OptionExerciseRowError` and `OptionExpiryRowError` (`change_shape`, `position_shape`, `siblings`), the closed vocabulary constants (`HOLE_VS_MARKS_WORDS`, `HOLE_VS_RETENTION_WORDS`, `ROW_FIELD_SHAPE_WORDS`, `ROW_SIBLING_KEYS`) the probe imports, a never-raising `_row_field_shape`, a per-instrument `_same_instrument_census`, `_expiry_refusal`, and `option_mtm_daily(..., retention_cutoff=None)`. `_expiry_close` now takes the replay's `rows`; the two `_coerce_float` paths inside it catch only `LedgerValuationError`, keep `_coerce_float`'s exact text and re-raise the subclass chained (an `OverflowError` still escapes exactly as at HEAD).
- `services/deribit_ingest.py`: one keyword argument, `retention_cutoff=retention_cutoff`, the existing hard cutoff local.
- `scripts/navbreach_anchor_probe.py`: the three names join the tuple `LEDGER_ERROR_CLASSES` derives from.
- `scripts/deribit_options_smoothed_probe.py`: `refusal_shape` in `RECORD_KEYS`, `_is_refusal_shape` (exactly `null`, `"unreadable"`, the hole shape, the exercise/expiry shape), `_refusal_shape(exc)` (never raises), `BasisOutcome.refusal_shape`, docstring updates (C2 paragraph, redaction contract with the closed words, the first-refusal-only limit).
- Tests: 86 new test cases across four files, additions only (the guards show 0 removed lines against the plan base).

Hole rule: `vs_marks` is the side of the instrument's fetched marks the missing day falls on; `vs_retention` is `older` only when that day is strictly earlier than the hard cutoff, `unknown` with no cutoff.

## What the reading can and cannot say

The probe names the FIRST refusal per member only. `replay_option_positions` refuses before any mark is fetched, and the hole guard stops at the earliest missing day of the first holed instrument in grid order. So a hole reading does not rule out a D-09 row later in the ledger, and an exercise reading says nothing about marks.

## Deviations from Plan

None of substance. Notes:

- **Task boundaries.** The closed vocabulary constants for the D-09 rows (`ROW_*`) were written in Task 1, because the plan has Task 1 write the full `_is_refusal_shape` validator and it imports them. The two D-09 classes, helpers, raises and the probe/navbreach wiring are in Task 2, as planned.
- **Emitter cases.** The emitter-refusal cases for a siblings key outside the census set, a negative, a bool and a float count were added in Task 1 with the validator, not Task 2.
- **Real build used, no fallback.** `RecordingProxy` did not block the real `build_deribit_native_ledger` path: the probe tests monkeypatch the same five `services.deribit_ingest` crawl seams as `_run_options_ledger` on a `_OptionsAdapterStub`. No `_install_seam` fallback was needed for the hole, exercise or expiry cases. A control test proves the real hole message carries the instrument and the day, so the no-leak assertions are not vacuous.
- **Exercise detail word.** The real exercise message names `position` once, so its detail reads `OptionExerciseRowError:position`; the hand-written expectation was corrected to that after the first run.
- **Tracer gate.** `auto_advance` is on; Task 1's verify was re-run after its commit (`387 passed`) before Task 2 started.
- **STATE.md was not touched** (orchestrator instruction). Only the 252-07 row and the Plans count in the ROADMAP `### Phase 252` section were changed (`git diff` shows exactly 2 lines).

## Verification

Environment: the main checkout's analytics venv interpreter (Python 3.12), run with cwd `analytics-service/` of this worktree, so the worktree's code is the code under test. The system `python3 -m mypy --version` is 2.0.0, so the CI pin was taken from the venv.

**mypy version used: `mypy 2.4.0 (compiled: yes)`** (the `requirements-dev.txt` pin).

```
$ python -m pytest tests/test_deribit_options_smoothed_probe.py tests/test_navbreach_anchor_probe.py tests/test_deribit_txn.py tests/test_deribit_assignment.py tests/test_smoothed_mtm_core.py tests/test_deribit_ingest.py tests/test_deribit_nav_twin.py tests/test_deribit_key_mode_options_basis.py tests/test_stitch_composite_job.py tests/test_broker_dailies.py tests/test_deribit_account_summary_capture.py -q
930 passed, 55 warnings
```

Baseline before any edit, same command: `844 passed` (so +86 cases, 0 failures).

```
$ mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 146 source files
$ mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/deribit_options_smoothed_probe.py
Success: no issues found in 1 source file
$ mypy --strict ... scripts/navbreach_anchor_probe.py | grep -c "error:"
1        (pre-existing, unchanged: RecordingProxy.private_get_get_transaction_log)
$ node scripts/verify-plan-anchors.mjs --pending
claims: 33 checked
OK: 9 plan file(s), no stale claims.
```

Acceptance greps and guards: `class OptionMarkHoleError(LedgerValuationError)` 1, `class OptionExerciseRowError(LedgerValuationError)` 1, `class OptionExpiryRowError(LedgerValuationError)` 1, `retention_cutoff=retention_cutoff` in `deribit_ingest.py` 1, `OptionMarkHoleError` in `navbreach_anchor_probe.py` 2, `OptionExpiryRowError` there 2, `refusal_shape` in the probe 11. `git diff --quiet 553ee35c8 -- analytics-service/tests/test_deribit_txn.py` exit 0 (not edited). Removed lines against `553ee35c8` in `test_deribit_assignment.py`: 0; in `test_smoothed_mtm_core.py` plus `test_navbreach_anchor_probe.py`: 0. Callers of the three raise sites under `services`, `routers`, `scripts`: 2 files (`deribit_txn.py`, `deribit_ingest.py`).

## Consumer audit (re-grepped in Task 3)

Greps: `type(<exc>).__name__` under `services` and `scripts`: 253 occurrences (mostly logging; the stores are listed below); `isinstance(<exc>, ... OptionRowFieldMissingError)`: 1 site (`job_worker.py` mark_to_market second pass); `except ... LedgerValuationError` or `_PERMANENT_LEDGER_ERRORS` lines across `services`, `scripts`, `routers`: 21; `LedgerValuationError` mentions in `job_worker.py`: 19. The plan's table held; no consumer was missed.

| Consumer | Keyed on | Why behaviour is unchanged | Pin |
|---|---|---|---|
| `job_worker.py` mark_to_market second pass degrade (`isinstance OptionRowFieldMissingError` -> `mtm_gated_reason`) | isinstance `OptionRowFieldMissingError` | the three raises run only under the smoothed basis; none subclasses `OptionRowFieldMissingError` | `test_the_new_refusals_are_ledger_valuation_errors_but_not_field_missing_errors`; `test_only_the_smoothed_basis_can_raise_the_new_refusals` |
| single-key smoothed third pass, key-mode options basis, composite smoothed fan-out (GLB-3a re-raise) | except tuples naming `LedgerValuationError` / `_PERMANENT_LEDGER_ERRORS`; logs scrubbed `str(exc)` | a direct subclass is caught by the same tuple; message bytes unchanged | `test_the_row_refusals_keep_their_exact_message_bytes`, `test_the_hole_keeps_its_exact_message_bytes_through_the_real_build`; stitch and key-mode suites green |
| outer permanent arm: `_record_refusal(type(exc).__name__)`, `_stamp_strategy_analytics_failed(detail=scrubbed)` | class NAME, message | `_record_refusal` persists only when `is_key_mode and denominator_config is None`; with no config `pnl_basis` is `DEFAULT_PNL_BASIS` (re-read at `pnl_basis = ... else DEFAULT_PNL_BASIS`), so the smoothed raises cannot run; detail is the unchanged message | cross-basis pin; `tests/test_deribit_account_summary_capture.py` green |
| composite cash/MTM member arm `_stamp_failed(detail=scrubbed)` | message | bytes unchanged | exact-message pins; `tests/test_stitch_composite_job.py` green |
| `deribit_ingest.py` nav twin wrapper `report.nav_twin_error = type(exc).__name__` | class NAME | its try block covers only the twin's native daily and balance identity; the smoothed delta is computed once before it | cross-basis pin; `tests/test_deribit_nav_twin.py` green |
| `scripts/navbreach_anchor_probe.py` `classify_ledger_error`, `build-error:<Type>` | class NAME | intended change: the three names join the allow-list | `test_each_smoothed_only_refusal_emits_its_own_class` |
| `scripts/deribit_options_smoothed_probe.py` | class NAME and attributes | intended change (this plan) | Tasks 1 and 2 tests |
| `job_worker.py` `_read_failure_text` (`ClassName: scrubbed message`) | class NAME | wraps database marker reads and publish-state reads (`_read_refresh_marker_state`, the entry and heal reads), never a ledger build, so it cannot see a new class (checked, not in the plan's table) | n/a (reachability, read in place) |

No STOP condition: no consumer maps a class name to a stored string and can see a new class.

## PROOF-01 (neuter a byte copy, see RED with the arm named, restore by cp, cmp, GREEN)

Each backup was taken with `cp` into the session scratchpad and verified with `cmp` before neutering. `$SCRATCH` is the session scratchpad. Output below is the recorded run, verbatim, in order: Task 1 (subclass, cutoff, allow-list), Task 2 (exercise subclass, census scope, non-numeric expiry path), Task 3 (hierarchy, cross-basis gate, side rule, exact message, strict-earlier). After each block `cmp exit 0` is the restore check and the next line is the GREEN run.

```
=== PROOF-01 subclass (neutered services/deribit_txn.py)
E       AssertionError: assert 'build-error:...aluationError' == 'build-error:...MarkHoleError'
E         - build-error:OptionMarkHoleError
E         + build-error:LedgerValuationError
E       AssertionError: assert 'build-error:...aluationError' == 'build-error:...MarkHoleError'
E         - build-error:OptionMarkHoleError
E         + build-error:LedgerValuationError
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_retention_straddlers_hole_is_named_by_side_and_retention
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_wholly_empty_in_retention_instrument_reads_no_marks_and_not_older
2 failed, 84 deselected in 34.66s
cmp exit 0
2 passed, 84 deselected in 27.42s
backup cmp exit 0
=== PROOF-01 cutoff (neutered services/deribit_ingest.py)
E       AssertionError: assert {'kind': 'hol...n': 'unknown'} == {'kind': 'hol...ion': 'older'}
E         {'vs_retention': 'unknown'} != {'vs_retention': 'older'}
E       AssertionError: assert {'kind': 'hol...n': 'unknown'} == {'kind': 'hol...: 'not-older'}
E         {'vs_retention': 'unknown'} != {'vs_retention': 'not-older'}
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_retention_straddlers_hole_is_named_by_side_and_retention
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_wholly_empty_in_retention_instrument_reads_no_marks_and_not_older
2 failed, 84 deselected in 29.88s
cmp exit 0
2 passed, 84 deselected in 19.86s
backup cmp exit 0
=== PROOF-01 allowlist (neutered scripts/navbreach_anchor_probe.py)
E       AssertionError: assert 'build-error:other' == 'build-error:...MarkHoleError'
E         - build-error:OptionMarkHoleError
E         + build-error:other
E       AssertionError: assert 'build-error:other' == 'build-error:...MarkHoleError'
E         - build-error:OptionMarkHoleError
E         + build-error:other
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_retention_straddlers_hole_is_named_by_side_and_retention
FAILED tests/test_deribit_options_smoothed_probe.py::test_a_wholly_empty_in_retention_instrument_reads_no_marks_and_not_older
2 failed, 84 deselected in 10.37s
cmp exit 0
2 passed, 84 deselected in 23.05s
backup cmp exit 0
=== PROOF-01 exercise-subclass (neutered services/deribit_txn.py)
E               services.deribit_txn.LedgerValuationError: option Deribit row id=2 type='exercise': the exercise row shape is unmeasured (no census), so the smoothed option book cannot tell whether it closes the position; refusing to guess (D-09)
FAILED tests/test_deribit_assignment.py::test_d09_exercise_refusal_is_its_own_class_with_the_same_instrument_census
1 failed, 12 passed, 76 deselected in 10.45s
cmp exit 0
13 passed, 76 deselected in 10.02s
backup cmp exit 0
=== PROOF-01 census-scope (neutered services/deribit_txn.py)
E       AssertionError: assert {'trade': 2, ...piry': 0, ...} == {'trade': 1, ...piry': 0, ...}
FAILED tests/test_deribit_assignment.py::test_d09_exercise_refusal_is_its_own_class_with_the_same_instrument_census
1 failed, 12 passed, 76 deselected in 8.98s
cmp exit 0
13 passed, 76 deselected in 13.50s
backup cmp exit 0
=== PROOF-01 nonnumeric-position (neutered services/deribit_txn.py)
E           ValueError: could not convert string to float: 'abc'
E           services.deribit_txn.LedgerValuationError: Deribit row id=2 type='expiry' has a non-numeric position 'abc'
FAILED tests/test_deribit_assignment.py::test_d09_non_numeric_expiry_position_keeps_the_coerce_float_text_and_the_subclass
1 failed, 12 passed, 76 deselected in 11.16s
cmp exit 0
13 passed, 76 deselected in 11.26s
backup cmp exit 0
=== PROOF-01 hierarchy (neutered services/deribit_txn.py)
FAILED tests/test_smoothed_mtm_core.py::test_the_new_refusals_are_ledger_valuation_errors_but_not_field_missing_errors[OptionMarkHoleError]
1 failed, 73 passed in 12.06s
cmp exit 0
74 passed in 13.06s
backup cmp exit 0
=== PROOF-01 cross-basis-gate (neutered services/deribit_ingest.py)
FAILED tests/test_smoothed_mtm_core.py::test_cash_settlement_options_zero_marks_fetches
FAILED tests/test_smoothed_mtm_core.py::test_mark_to_market_options_zero_marks_fetches
FAILED tests/test_smoothed_mtm_core.py::test_acceptance_B_no_session_lumps - ...
FAILED tests/test_smoothed_mtm_core.py::test_only_the_smoothed_basis_can_raise_the_new_refusals[cash_settlement-hole]
FAILED tests/test_smoothed_mtm_core.py::test_only_the_smoothed_basis_can_raise_the_new_refusals[cash_settlement-exercise]
FAILED tests/test_smoothed_mtm_core.py::test_only_the_smoothed_basis_can_raise_the_new_refusals[cash_settlement-expiry]
FAILED tests/test_smoothed_mtm_core.py::test_only_the_smoothed_basis_can_raise_the_new_refusals[mark_to_market-hole]
FAILED tests/test_smoothed_mtm_core.py::test_only_the_smoothed_basis_can_raise_the_new_refusals[mark_to_market-exercise]
FAILED tests/test_smoothed_mtm_core.py::test_only_the_smoothed_basis_can_raise_the_new_refusals[mark_to_market-expiry]
9 failed, 65 passed in 13.05s
cmp exit 0
74 passed in 12.34s
backup cmp exit 0
=== PROOF-01 side-rule (neutered services/deribit_txn.py)
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[no-cutoff-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[no-cutoff-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-after-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-after-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-before-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-before-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_the_ingest_hands_its_own_hard_cutoff_to_the_hole_guard[1-older]
FAILED tests/test_smoothed_mtm_core.py::test_the_ingest_hands_its_own_hard_cutoff_to_the_hole_guard[100000-not-older]
10 failed, 64 passed in 11.81s
cmp exit 0
74 passed in 8.54s
backup cmp exit 0
=== PROOF-01 exact-message (neutered services/deribit_txn.py)
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[no-cutoff-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[no-cutoff-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[no-cutoff-between-bars]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[no-cutoff-no-marks]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-after-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-after-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-after-day-between-bars]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-after-day-no-marks]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-between-bars]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-no-marks]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-before-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-before-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-before-day-between-bars]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-before-day-no-marks]
FAILED tests/test_smoothed_mtm_core.py::test_the_hole_keeps_its_exact_message_bytes_through_the_real_build
17 failed, 57 passed in 9.09s
cmp exit 0
74 passed in 11.66s
backup cmp exit 0
=== PROOF-01 strict-earlier (neutered services/deribit_txn.py)
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-after-last-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-before-first-bar]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-between-bars]
FAILED tests/test_smoothed_mtm_core.py::test_hole_words_by_side_and_strict_earlier_retention[cutoff-equals-day-no-marks]
4 failed, 70 passed in 9.46s
cmp exit 0
74 passed in 7.46s
```

## Next step after this plan (recorded for the verifier; NOT tasks here)

1. This plan ships in the next 252 ship PR. After the Railway worker deploys it, the orchestrator runs the probe again, founder-gated as before: `railway ssh "cd /app && python -m scripts.deribit_options_smoothed_probe --strategy-id <id>"`. The id is typed on the command line only, and only the lines starting with `{"` are pasted into the phase record.
2. Each reading establishes only what its words say. Nothing below is decided by this plan.
   - `before-first-bar` with `older` is a retention straddler: the head of a held life falls before the cutoff. Every remedy narrows the MTM span, so it goes to a founder question (Founder decision 2026-11-26).
   - `before-first-bar` with `not-older`, and `no-marks` with either word, can still be a straddler. The 913-day horizon is a one-probe estimate that `deribit_ingest.py` (GLB-5) says may be shorter than the venue's real one, which is why its 30-day tolerance band exists. These readings need a founder question or a follow-up measurement of the instrument's real chart horizon before any code fix is chosen.
   - `between-bars` points at an interior gap inside bars the venue did return. That is the one hole reading that leads straight to a defect investigation and a code-fix gap plan.
   - `after-last-bar` points at the end of a held life (the last-settled cap, an expiry or a delisting) and needs measurement before a route is chosen.
   - An exercise or expiry census is an unmeasured row shape, so it goes to a founder question before any shape is accepted.
3. The reading names only the first refusal per member. If the next PROD run clears one cause, run the probe again before calling the member clean.
4. ROADMAP: the 252-07 row is ticked and the Plans count reads 7/7. Phase 252 stays open until the probe passes (founder decision 2026-11-26).

## Known Stubs

None.

## Threat Flags

None. The new attributes are closed words and counts computed at the raise; the probe validator, `_refuse_floats` and `assert_sanitized` guard them (T-252-18), and the tracer drives a real message carrying instrument, day and id and asserts none reaches a line.

## Self-Check: PASSED

The four service and script files exist, and commits 61f19e17c, 08d404aa0 and c3e7c0c8f are ancestors of HEAD.
