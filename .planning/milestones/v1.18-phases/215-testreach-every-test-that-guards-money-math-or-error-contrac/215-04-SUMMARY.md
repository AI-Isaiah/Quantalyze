---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 04
subsystem: testing
tags: [pytest, fastapi, app-factory, slowapi, ast-scan, ci-python-job]
requires: ["215-03"]
provides:
  - "All 11 remaining bare-FastAPI test modules build through tests/app_factory.py build_test_app: 0 bare FastAPI( constructions outside the factory"
  - "tests/test_limiter_identity.py: structural 429 discriminator (decorator shape vs in-handler quota shape)"
  - "tests/test_app_factory_parity.py: AST regrowth scans (no FastAPI( outside app_factory.py, no slowapi default 429 handler) with empty allowlists and vacuity floors"
affects: [analytics-service/tests]
tech-stack:
  added: []
  patterns: ["AST scan with empty hand-typed allowlist and a vacuity floor, plus a literal-source self-check proving the scan can fire"]
key-files:
  created: []
  modified:
    - analytics-service/tests/test_csv_fault_capture_170_1.py
    - analytics-service/tests/test_csv_hostile_inputs_170_1.py
    - analytics-service/tests/test_csv_validation_off_event_loop_170_1.py
    - analytics-service/tests/test_match_router.py
    - analytics-service/tests/test_match_holding_returns.py
    - analytics-service/tests/test_status_contract_match_sim_portfolio.py
    - analytics-service/tests/test_simulator_router.py
    - analytics-service/tests/test_limiter_identity.py
    - analytics-service/tests/test_process_key.py
    - analytics-service/tests/test_process_key_200_discriminator.py
    - analytics-service/tests/test_sentry_transaction_redaction_170_1.py
    - analytics-service/tests/test_app_factory_parity.py
key-decisions:
  - "The 429 discriminator keys on body structure: the in-handler quota nests the envelope as a dict under detail; production's decorator 429 has a top-level code RATE_LIMITED with detail a string. Both shapes are asserted (negative on dict detail, positive on the decorator shape)."
  - "The scan's own self-check sources avoid the literal text 'x = FastAPI(' (they use wrap(FastAPI())), so a plain-text census of the tests tree still reads exactly one file."
  - "Vacuity floor is 450 parsed files (458 at authoring over tests/**/*.py), hand-typed, with TESTS_DIR as a module constant so a RED proof can point it at an empty directory."
status: complete
completed: 2026-11-15
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: b4cfc957899e70df64d97950beaa96b65ce675d1
plan_head_after: dc1248764e3e24c15884c4b716145f5ddaec05cd
---

# Phase 215 Plan 04: The last bare FastAPI test apps move onto the factory Summary

The remaining 11 bare-`FastAPI()` test modules now build their app through `build_test_app`, slowapi's default 429 handler is gone from the tests, `test_limiter_identity` tells the two 429 sources apart by body structure, and an AST scan with an empty allowlist keeps either from growing back. SC-3 is fully met: `grep -rlaE --include='*.py' '=\s*FastAPI\(' analytics-service/tests` lists only `tests/app_factory.py`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | CSV and match router modules on the factory | 07e0707c4 | test_csv_fault_capture_170_1, test_csv_hostile_inputs_170_1, test_csv_validation_off_event_loop_170_1, test_match_router, test_match_holding_returns |
| 2 | Simulator, limiter and process-key modules plus the structural 429 discriminator | df60784e8 | test_status_contract_match_sim_portfolio, test_simulator_router, test_limiter_identity, test_process_key, test_process_key_200_discriminator |
| 3 | Last module plus the AST regrowth scan | dc1248764 | test_sentry_transaction_redaction_170_1, test_app_factory_parity |

## What changed

- 25 construction sites over 11 modules (2+2+2+1+1, 4+5+3+3+1, 1) swapped `FastAPI()` + `include_router` for `build_test_app(<routers>)`. Every `app.state.limiter` line, limiter reset, dependency override and assertion is untouched. The swap was scripted with a regex over the exact three-line shape, then reviewed in the diff; unused `FastAPI` imports were removed (kept in `test_csv_validation_off_event_loop_170_1.py` and `test_limiter_identity.py`, where it is still a return/parameter annotation).
- `tests/test_limiter_identity.py`: the slowapi default-handler import, `RateLimitExceeded` import and the three `add_exception_handler` registrations are gone; production's handler (installed by the factory) answers. `_assert_not_the_in_handler_429` no longer greps `"RATE_LIMITED" not in resp.text` (both refusals carry that code now, so it could not fail on the wrong mechanism): it asserts `detail` is not a dict, and positively that the body has top-level `code == "RATE_LIMITED"` with `detail` a string. Docstring updated.
- `tests/test_process_key.py`: `throttled_client` no longer imports or registers slowapi's default 429 handler; the `app` and `throttled_client` docstrings no longer claim "bare" app / "omits the handler". The `_scope_rejected` assertions were not touched (plan 215-08 owns one).
- `tests/test_app_factory_parity.py`: `test_scan_helpers_can_see_what_they_hunt` (literal-source self-check, including that a docstring, a comment or an annotation naming `FastAPI` does not count), `test_no_test_module_constructs_a_fastapi_app_except_the_factory` (empty `FASTAPI_CONSTRUCTION_ALLOWLIST`; `app_factory.py` must hold exactly one construction; at least 450 files parsed), `test_no_test_module_imports_slowapis_default_429_handler` (empty `DEFAULT_429_HANDLER_ALLOWLIST`; same floor). Both scans use `ast` over `tests/**/*.py`, so a `fastapi.FastAPI()` spelling cannot hide.
- Docstrings that called the app "Bare FastAPI" were reworded to "Factory app" in `test_match_router`, `test_status_contract_match_sim_portfolio`, `test_simulator_router`.

## Verification

- Each of the 11 modules run alone (`env -u TEST_SUPABASE_DB_URL python3 -m pytest -p no:cacheprovider -q tests/<m>.py`): csv_fault_capture 9, csv_hostile_inputs 34, csv_validation_off_event_loop 7, match_router 146, match_holding_returns 30, status_contract_match_sim_portfolio 19, simulator_router 63, limiter_identity 76, process_key 114, process_key_200_discriminator 17, sentry_transaction_redaction 5; `test_app_factory_parity` 6 passed.
- Full suite serial from `analytics-service/`: `1 failed, 14919 passed, 92 skipped` (plan 215-03 left 14916 passed; the +3 are the new parity tests). The one failure is the known local `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix` (pytest-xdist is not installed locally).
- mypy strict (CI's command): `Success: no issues found in 140 source files`.
- `grep -rlaE --include='*.py' '_rate_limit_exceeded_handler' analytics-service/tests | grep -vc test_app_factory_parity.py` = 0 (the parity scan names the symbol only as a string constant, which the AST scan ignores).
- `git diff --stat origin/main -- supabase/migrations` prints nothing (SC-8).

## RED proofs (SC-9)

Each: byte backup in the scratchpad, neuter, run, record, restore with `cp`, `cmp` identical, re-run green. No `git checkout`, `restore` or `stash`.

| # | Neuter | Run | Result | Restore |
| - | ------ | --- | ------ | ------- |
| 1 (Task 2) | `test_limiter_identity.py`: both discriminator checks inverted (assert the in-handler dict shape, and that the decorator shape is absent) | `-k TestSimulatorTenantBucketBehaviour` | 2 failed, 2 passed: `test_a_tenant_claimed_caller_is_throttled_at_the_decorator` and `test_one_tenants_exhausted_bucket_does_not_throttle_another` both FAIL | `cmp` identical, 4 passed |
| 2 (Task 3, regrowth of a bare app; also satisfies Task 1's proof, the scan being the guard) | `test_benchmark_refresh.py`: the factory call replaced by a bare `FastAPI()` + `include_router` | `tests/test_app_factory_parity.py` | `test_no_test_module_constructs_a_fastapi_app_except_the_factory` FAILS naming `['test_benchmark_refresh.py']`; 5 others pass | `cmp` identical, parity + `test_benchmark_refresh` + `test_ops_alert` 92 passed |
| 3 (Task 3, regrowth of the default 429 handler) | `test_ops_alert.py`: appended `from slowapi import _rate_limit_exceeded_handler` | `tests/test_app_factory_parity.py` | `test_no_test_module_imports_slowapis_default_429_handler` FAILS naming `['test_ops_alert.py']` | `cmp` identical |
| 4 (Task 3, vacuity) | `test_app_factory_parity.py`: `TESTS_DIR` pointed at an empty directory | `tests/test_app_factory_parity.py` | both scans FAIL with `vacuous scan: parsed 0 test files, floor is 450` | `cmp` identical, 6 passed |

Proof 2 was run before a cosmetic edit to the self-check's literal sources (`wrap(FastAPI())` instead of `x = FastAPI()`, so the plain-text census stays at one file); the scan code was not touched by that edit and the self-check test re-passed.

## Deviations from Plan

None to the plan's intent. No module needed to stay bare, so the allowlists are empty. Notes:

- [Rule 1 - minor] The first version of the self-check wrote `app = FastAPI()` inside string literals, which made the plan's textual acceptance grep (`=\s*FastAPI\(` over the tests tree == 1 file) list the parity test too. Reworded the literals to `wrap(FastAPI())`; the commit was amended before anything left the worktree.
- `test_process_key.py::throttled_client` and the three `test_limiter_identity.py` sites were the only places an assertion's context changed (production's 429 body now answers); only the discriminator in `test_limiter_identity.py` needed re-cutting, as the plan said, and it is proven able to fail (RED proof 1). `test_process_key.py` reads only the 429 status, which is unchanged.

## Threat model

T-215-11 (bare apps regrow): AST scan, empty allowlist, floors of one factory construction and 450 parsed files; RED proofs 2 and 4. T-215-12 (429 bodies): the slowapi default-handler import is banned in tests by the second scan (RED proof 3), so tests see production's 429 body. T-215-SC: no package was installed or changed.

## Known Stubs

None.

## Items that can only be measured in CI

- `tests/test_xdist_group_is_real.py` needs pytest-xdist, absent locally; no shared-DB sentinel words were added by this plan.
- Coverage on the `python` job's head SHA; only test files changed.

## Self-Check: PASSED

- FOUND commits 07e0707c4, df60784e8, dc1248764 (ancestors of HEAD; `git rev-list --count b4cfc9578..HEAD` = 3 before this SUMMARY commit)
- FOUND: analytics-service/tests/test_app_factory_parity.py, analytics-service/tests/test_limiter_identity.py
