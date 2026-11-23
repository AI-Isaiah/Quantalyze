---
phase: 216-csvstatus-a-malformed-csv-upload-answers-422-with-recoverabl
reviewed: 2026-11-18T15:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - analytics-service/routers/process_key.py
  - analytics-service/tests/test_process_key_scope_rejection_statuses.py
  - analytics-service/tests/test_process_key.py
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - src/lib/process-key-client.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
  necessity: 0
status: issues_found
---

# Phase 216: Code Review Report

**Reviewed:** 2026-11-18T15:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found (LOW/INFO only; nothing at MEDIUM or above)

## Summary

Reviewed `git diff 3f978cbaf` across the five scoped files. I also read the code paths the diff depends on: the `_scope_rejected` block and `_envelope_error` in `routers/process_key.py`, `CsvAdapter.validate` in `services/ingestion/csv_adapter.py`, `services/csv_offload.py`, the `validate_csv` error tail, the `postProcessKey` forwarding path, and the `csv-validate` caller.

**The arm implements the locked contract correctly.** I traced every `ValidationResult` that `CsvAdapter.validate` can return:

- `CSV_TOO_LARGE`, `CSV_FORMAT_UNSUPPORTED`, the upper-cased rule family and `CSV_VALIDATION_FAILED` all have `valid=False` and a non-null code. They enter `_scope_rejected` and leave at the new arm with 422 and `recoverable` False, which is stated explicitly.
- `CSV_UPSTREAM_FAIL` is the only code the adapter emits from an `except` arm. It falls through to the PYAPIFIX-02 pre-gate and stays 424 with `recoverable` True.
- A success has `valid=True`, `error_code=None` and `read_only=None`, so it never enters the gate.
- `run_csv_validation` has no timeout or busy envelope. A transient fault inside it can only surface as an exception, which becomes `CSV_UPSTREAM_FAIL`. So no retryable condition gets misfiled as a 422.

Other properties hold:

- The arm sits after the best-effort draft transition and before the pre-gate, as CONTEXT specifies.
- `source_debug_context` is forwarded, so `pandera_errors` survive and `failure_case` stays off the wire.
- The discriminator is `body.source`, and the teaser row pins that.
- `postProcessKey` forwards any `!res.ok` status and body verbatim (`process-key-client.ts:826-827`), so the 422 needs no TS change.
- `test_process_key_scope_rejection_statuses.py` passes locally: 18 passed. I could not re-run vitest here because the worktree has no `node_modules`. The `removesSites` 64 → 65 move rests on the executor's measured run.

CONTEXT already records that no live caller reaches this arm at HEAD. `csv-validate` sends `step: "validate"` and returns from `_run_validate_only` at 200. I do not re-raise that.

The findings below are comment accuracy, one missing pin, and a log-signal note. None of them changes behaviour.

## Info

### IN-01: [LOW] The rewritten `postProcessKey` docblock says every non-CSV `not val.valid` answers 403, but non-permanent codes answer 424

**File:** `src/lib/process-key-client.ts:761-767`
**Issue:** The phase rewrote this sentence: "so an ordinary non-CSV `not val.valid` moved to 403 beside the two scope arms." That is not what the gate does. A non-CSV `not val.valid` answers 403 only for the five codes in `PERMANENT_VALIDATION_ERROR_CODES` or for the `VALIDATION_UNEXPECTED` fallback. Every other venue code leaves at the PYAPIFIX-02 pre-gate with 424 (`process_key.py`, the `val.error_code not in exchange_svc.PERMANENT_VALIDATION_ERROR_CODES` arm). The old wording was already imprecise. The phase made it more specific by adding "non-CSV", and it is still wrong. The docblock is the TS-side map of upstream statuses, so a reader who trusts it would expect 403 where 424 arrives. Behaviour is not affected, because the client branches on `res.ok` and `body.ok`.
**Fix:** "...so a non-CSV `not val.valid` carrying a permanent code (or no code) answers 403 beside the two scope arms; any other venue code answers 424 `recoverable:true` (PYAPIFIX-02)."

### IN-02: [LOW] The replaced "403-vs-422 split is HOMELESS" paragraph now reads as if the split were resolved

**File:** `src/lib/process-key-client.ts:786-788`
**Issue:** The deleted paragraph said the 403 for all three caller-class arms is "coarse" and needs its own plan. The new text says only "Phase 216 gave the CSV validator verdict its 422". For non-CSV callers nothing changed: ordinary validation failures such as `AUTH_FAILED` still share the scope arms' 403. Dropping the "coarse, unowned" note hides a residual that is still true.
**Fix:** Keep one clause: "Non-CSV ordinary validation failures still share the scope arms' 403; that coarseness remains unowned and is a non-issue here because the envelope is handled by `ok`."

### IN-03: [LOW] Nothing pins the draft transition that runs before the new 422 arm

**File:** `analytics-service/tests/test_process_key_scope_rejection_statuses.py:170-201` (and `analytics-service/routers/process_key.py:2009-2081`)
**Issue:** CONTEXT ("What else does the new arm keep?") says the CSV arm keeps "the same best-effort draft transition before it". Neither the new 422 cases nor the breakdown test in `test_process_key.py` asserts that `supabase.rpc("transition_strategy_verification", {..."p_new_status": "draft"...})` was called on the CSV path. `grep -n "rpc\|transition"` on the status-pin file returns nothing. The breakdown test checks the status, `recoverable` and the rows, but not the RPC. If a later edit moves the 422 return above the RPC, for example to "return early for CSV", the verification row is left un-transitioned and every pin stays green. Severity is LOW because no live caller reaches the arm today.
**Fix:** In `test_csv_validator_verdict_answers_422_not_recoverable`, or in one dedicated case, have `_csv_post` return the supabase mock and assert that `fake.rpc` was called with `"transition_strategy_verification"`, `p_new_status == "draft"` and `p_metadata["errors"][0]["code"] == error_code`.

### IN-04: [INFO] A CSV verdict still emits the SF-1 security log `process_key.write_capable_key_rejected`

**File:** `analytics-service/routers/process_key.py:2003-2009, 2061-2066`
**Issue:** Every CSV validator verdict that reaches the gate first logs `process_key.write_capable_key_rejected` with `read_only=None`, and then logs `process_key.csv_validation_rejected`. SF-1 exists so operators can detect write-capable-key regressions. A malformed upload is not a key event. If this arm ever becomes live, the security signal will carry CSV noise. CONTEXT keeps the shared log line on purpose, and the behaviour predates the phase, so this is recorded only.
**Fix:** None required now. If the arm becomes live, gate the SF-1 line on `body.source != "csv"`, or add `source=body.source` to it so alerting can filter.

---

_Reviewed: 2026-11-18T15:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Review rounds (orchestrator record)

- **Round 1:** gsd-code-reviewer found 0 MEDIUM+ (3 LOW, 1 INFO above, recorded and not fixed per repo rule). The silent-failure-hunter raised **M-1, MEDIUM, data integrity**: no test pinned that the best-effort draft transition runs before the CSV 422 return. IN-03 above is the same gap at LOW.
- **Fix:** commit 766d2c33b, test-only. The CSV 422 case now asserts a `transition_strategy_verification` draft call whose `errors[0].code` equals the case's code. Neutering the RPC turns all 8 rows RED; the router was restored from a byte backup and checked with `cmp`.
- **Round 2:** the silent-failure-hunter confirmed M-1 closed with two neuters (8 RED each) and found no new MEDIUM+ in the whole phase diff.
