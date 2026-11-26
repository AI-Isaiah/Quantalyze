---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
plan: 02
subsystem: analytics-service error copy
tags: [ERRC-01, ast-scan, user-copy, wizardErrors]
requires: []
provides:
  - "ast gate: no production analytics-service string offers the legacy support pointer"
  - "per-function pins for the five contact-form sentences"
affects: [222-03, 222-04]
tech-stack:
  added: []
  patterns: ["ast.Constant scan over git ls-files with anti-vacuity self-test", "hand-typed per-function wording pins"]
key-files:
  created:
    - analytics-service/tests/test_no_contact_support_copy.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/services/csv_validator.py
    - analytics-service/services/job_worker.py
    - analytics-service/routers/portfolio.py
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
decisions:
  - "Rows 6, 7, 8 and 10 of the UI-SPEC sentence register are derived wording (RESEARCH A2), not founder-quoted; the member-cap clause 'use the contact form to ask for a higher limit' is CONTEXT-locked"
metrics:
  tasks: 2
  files: 7
status: complete
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 94f1fc0b3a748c5b715e1235bb55789e879283cd
plan_head_after: 7732a3ca19e945de380d0bdaa5633aec7d81c954
completed: 2026-11-25
---

# Phase 222 Plan 02: AlertTruth Python contact-form copy Summary

Five analytics-service user sentences now name the contact form instead of the legacy support pointer, guarded by an ast scan of all production Python plus one exact pin per sentence, and the TypeScript quote of the key-validation sentence is true again.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | ast scan + five one-literal edits | edd32e2c7 |
| 2 | per-function pins + wizardErrors quote/replay | 7732a3ca1 |

## The five sentences (as shipped)

1. `services/exchange.py` `validate_key_permissions`: "Key validation failed unexpectedly. Use the contact form if this persists." (`error_code` unchanged: VALIDATION_UNEXPECTED)
2. `services/csv_validator.py` `_maybe_auto_normalize_percent_form`: message ends "If your file was already in decimal form, use the contact form."
3. `services/job_worker.py` `run_sync_trades_job`: "Analytics enqueue failed during sync. The next scheduled sync will retry — use the contact form if this persists." Payload keys unchanged (five keys).
4. `services/job_worker.py` `run_stitch_composite_job`: ends "Reduce members or use the contact form to ask for a higher limit." (CONTEXT-locked clause)
5. `routers/portfolio.py` `verify_strategy`: "Verification failed. Use the contact form if this persists."

CHANGELOG note for the ship: rows 1-3 and 5 above (UI-SPEC rows 6, 7, 8, 10) are wording chosen by substitution (RESEARCH A2), not quoted by the founder.

## PROOF-01

### Task 1: RED on pre-fix code (scan names the five sites)

```
E       AssertionError: a production string still offers the legacy support pointer; name the contact form instead (Phase 222 ERRC-01):
E           routers/portfolio.py:2827
E           services/csv_validator.py:420
E           services/exchange.py:1505
E           services/job_worker.py:12428
E           services/job_worker.py:2965
1 failed, 1 passed in 10.46s
```

GREEN after the five edits: `2 passed in 16.10s`.

### Task 2: exchange.py neuter (legacy pointer put back in the VALIDATION_UNEXPECTED sentence)

Backup taken to the scratchpad with `cp` first. Both gates RED, each naming exchange.py:

```
E       AssertionError: a production string still offers the legacy support pointer; name the contact form instead (Phase 222 ERRC-01):
E           services/exchange.py:1505
E       AssertionError: services/exchange.py::validate_key_permissions no longer produces 'Key validation failed unexpectedly. Use the contact form if this persists.'
FAILED tests/test_no_contact_support_copy.py::test_no_production_string_offers_the_legacy_support_pointer
FAILED tests/test_no_contact_support_copy.py::test_each_sentence_names_the_contact_form_in_its_own_function[services/exchange.py-validate_key_permissions-Key validation failed unexpectedly. Use the contact form if this persists.]
2 failed, 5 passed in 36.65s
```

Restore: `cp <backup> services/exchange.py && cmp <backup> services/exchange.py` printed nothing (CMP-SILENT-OK); `git status` showed exchange.py clean afterwards. GREEN: `7 passed in 31.22s`.

## Verification

- `pytest tests/test_no_contact_support_copy.py`: 7 passed (scan, self-test, five pins).
- `pytest tests/test_computation_error_provenance_census.py tests/test_csv_validator.py tests/test_csv_validator_percent_form_2026_05_25.py tests/test_stitch_composite_job.py tests/test_job_worker.py`: 283 passed, 1 skipped. The skip is `tests/test_job_worker.py:4326`, `LANE_DB_URL unset (local dev)`; the lane is not booted here by instruction (no Docker), so that one test did not run locally.
- mypy strict (CI command: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- `npx vitest run src/lib/wizardErrors.test.ts`: 330 passed.
- Acceptance greps: exchange.py / csv_validator.py / portfolio.py `contact support` count 0; job_worker.py 1 (the derive-handler comment, not read by the ast scan); `use the contact form` in job_worker.py 2; `Use the contact form if this persists` in portfolio.py 1; wizardErrors.ts new quote 1; wizardErrors.test.ts legacy count 0.

## Deviations from Plan

None. Plan executed as written. The self-test asserts a count of two plus the label prefix rather than exact line numbers, because the line a merged literal reports is an ast detail.

## Known Stubs

None.

## Threat Flags

None. Only literal text changed; every sentence stays a fixed constant (T-222-05), and the enqueue payload key set is unchanged, with the provenance census green (T-222-06).

## Self-Check: PASSED

- analytics-service/tests/test_no_contact_support_copy.py present; commits edd32e2c7 and 7732a3ca1 are ancestors of HEAD.
