---
phase: 216-csvstatus-a-malformed-csv-upload-answers-422-with-recoverabl
verified: 2026-11-18T16:00:00Z
status: passed
score: 9/9 must-haves verified
verified_at_sha: 4e125b1f3befef679423ca8f4a004473da16bc99
drift_subjects:
  - analytics-service/routers/process_key.py
  - analytics-service/tests/test_process_key_scope_rejection_statuses.py
  - analytics-service/tests/test_process_key.py
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - src/lib/process-key-client.ts
behavior_unverified: 0
overrides_applied: 0
---

# Phase 216: CSVSTATUS Verification Report

**Phase Goal:** A malformed CSV upload answers 422 with `recoverable: false`. Auth and scope rejections stay 403, venue blips stay 424. Re-points the Phase 215 status pins on `_scope_rejected` in `routers/process_key.py`.
**Verified:** 2026-11-18
**Status:** passed
**Re-verification:** No, initial verification

**Scope statement (per CONTEXT "Measured at HEAD"):** this verifies the `/process-key` public route contract only. No live wizard surface reaches the CSV arm of this gate today (csv-validate returns 200 from `_run_validate_only`; CSV finalize uses an RPC). The ROADMAP clause "the wizard stops offering Retry" has no live surface at HEAD, and no wizard-visible change is claimed.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | csv source plus non-null `error_code` other than `CSV_UPSTREAM_FAIL` answers 422, `ok:false`, code echoed, `recoverable:false` (rule family, `COERCE_DTYPE('DATETIME64[NS]')`, `CSV_VALIDATION_FAILED`, `CSV_TOO_LARGE`, `CSV_FORMAT_UNSUPPORTED`) | VERIFIED | `process_key.py` new arm in the `_scope_rejected` block: `body.source == "csv" and val.error_code is not None and val.error_code != "CSV_UPSTREAM_FAIL"` returns `status_code=422`, `recoverable=False`. `test_csv_validator_verdict_answers_422_not_recoverable` (8 params) pins literals `== 422` and `is False`; passes. |
| 2 | `CSV_UPSTREAM_FAIL` on csv stays 424 `recoverable:true` | VERIFIED | Excluded by the `!=` clause, falls through to the PYAPIFIX-02 pre-gate. `test_retryable_verdicts_stay_424_recoverable[csv-upstream-fail]` literal 424/True; passes. |
| 3 | Non-csv source with a CSV-looking code (MONOTONIC_DATES, teaser) stays 424 `recoverable:true` | VERIFIED | Discriminator is `body.source`, not the code. `[teaser-csv-looking-code]` row pins 424/True; passes. |
| 4 | Five permanent codes and `VALIDATION_UNEXPECTED` stay 403/false; venue codes stay 424/true; `PERMANENT_VALIDATION_ERROR_CODES` unchanged | VERIFIED | `git diff 3f978cbaf..HEAD --stat` outside `.planning` lists exactly 5 files; no exchange or services file touched. Permanent-code, fallback and `venue_transient_answers_424_recoverable` tests pass (132 passed on both test files). |
| 5 | New arm keeps the envelope: `pandera_errors` forwarded via `source_debug_context`, `failure_case` never on the wire, `write_capable_key_rejected` log and draft transition run before the arm | VERIFIED | Diff shows the arm placed after the SF-1 log and the `transition_strategy_verification` RPC, passing `source_debug_context=val.debug_context`. Commit 766d2c33b adds an assertion on the draft RPC (round-2 SFH confirmed 8 RED when neutered). Breakdown test passes. |
| 6 | Validate-only stays 200 `ok:false`; its pin and the permanent-set pin unchanged | VERIFIED | `_run_validate_only` not in the diff; `test_validate_only_invalid_answers_200_ok_false` passes. |
| 7 | `long_fetch.py` and its `_scope_rejected` untouched | VERIFIED | Not in the diff stat. |
| 8 | No live wizard surface claimed | VERIFIED | SUMMARY "Honest scope" section states it plainly; no code or comment claims a wizard change. TS change is comment-only. |
| 9 | Each clause's pin can fail (neuter, RED, restore from byte backup) | VERIFIED | Independent re-run by this verifier: changed the arm to 424/`recoverable=True` with a byte backup, 9 failed (8 params plus the breakdown test), restored, `cmp` identical. The SUMMARY's four-neuter table is consistent with this. |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/routers/process_key.py` | VERIFIED | Contains `status_code=422` arm, substantive, wired in `process_key` before the pre-gate. |
| `analytics-service/tests/test_process_key_scope_rejection_statuses.py` | VERIFIED | Literal pins with `status_code == 422`. |
| `analytics-service/tests/test_process_key.py` | VERIFIED | Breakdown test asserts 422 and `recoverable` false. |
| `src/lib/seam-venue-vocabulary.invariant.test.ts` | VERIFIED | Count pin 64 to 65 with dated note (vitest not re-run here, no `node_modules` in the worktree; the executor's measured run and the reviewer's trace support it). |
| `src/lib/process-key-client.ts` | VERIFIED | Comment-only diff, CSV-403 and "homeless" wording corrected. |

### Key Links

| From | To | Status |
|------|----|--------|
| `csv_adapter.py` verdict `error_code` | new arm in `process_key.py` (`body.source == "csv"`) | WIRED |
| `process_key.py` arm | status pin test (`_csv_post`, `_teaser_post`) | WIRED, literals not read from router |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Gate contract pins | `python3 -m pytest -p no:cacheprovider -q tests/test_process_key_scope_rejection_statuses.py tests/test_process_key.py` (from `analytics-service/`) | 132 passed | PASS |
| Pins can fail | neuter arm to 424/true, same command | 9 failed, restored, `cmp` identical | PASS |

### Anti-Patterns

No TBD, FIXME or XXX markers added in the diff. No stubs.

### Requirements Coverage

No REQUIREMENTS.md IDs; `216-GOAL` is a phase-local label, satisfied by truths 1 to 9.

### Residual items (recorded, not blocking; review LOW/INFO)

- IN-01 and IN-02: the `postProcessKey` docblock still says a non-CSV `not val.valid` "moved to 403", imprecise for non-permanent venue codes (424), and the "coarse 403 split is unowned" note was dropped. Comment-only, LOW.
- IN-04: CSV verdicts still emit the SF-1 `write_capable_key_rejected` log. Dormant, no live caller.
- Pre-existing, unrelated reds per SUMMARY: `test_xdist_group_is_real` (xdist absent locally) and `factsheet/compute.conventions.test.ts` float snapshots. Not re-run here.

### Human Verification Required

None.

## Gaps Summary

None. The route contract is implemented as locked in CONTEXT, pinned with literals, and the pins were independently shown able to fail.

---

_Verified: 2026-11-18T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
