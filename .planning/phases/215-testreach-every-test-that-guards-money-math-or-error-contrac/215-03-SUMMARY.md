---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 03
subsystem: testing
tags: [pytest, fastapi, exception-handlers, app-factory, slowapi, ci-python-job]
requires: ["215-02"]
provides:
  - "services/app_error_handlers.py: the 422, 429 and venue-transient 424 handlers moved out of main.py (bodies unchanged) plus install_app_exception_handlers(app)"
  - "tests/app_factory.py build_test_app(*routers, middleware=()) and the conftest app_factory fixture: the only sanctioned FastAPI( construction in the test suite"
  - "tests/test_app_factory_parity.py: same handler objects as main.app, canary 422, production 429 through a factory app"
  - "10 of 21 bare-FastAPI test modules moved onto the factory (11 left for plan 215-04)"
affects: [analytics-service/main.py, analytics-service/services, analytics-service/tests]
tech-stack:
  added: []
  patterns: ["one production installer feeds both main.py and the test factory", "the factory and handler module never import main; only the parity test does, inside a test function"]
key-files:
  created:
    - analytics-service/services/app_error_handlers.py
    - analytics-service/tests/app_factory.py
    - analytics-service/tests/test_app_factory_parity.py
  modified:
    - analytics-service/main.py
    - analytics-service/tests/conftest.py
    - analytics-service/tests/test_raw_5xx_census.py
    - analytics-service/tests/test_benchmark_refresh.py
    - analytics-service/tests/test_ops_alert.py
    - analytics-service/tests/test_prober_cadence_alert.py
    - analytics-service/tests/test_correlation_middleware.py
    - analytics-service/tests/test_debug_key_flow_router.py
    - analytics-service/tests/test_mt5_internal_probe.py
    - analytics-service/tests/test_sfox_internal_probe.py
    - analytics-service/tests/test_mt5_rotate_secret_internal.py
    - analytics-service/tests/test_maybe_single_none_guards.py
    - analytics-service/tests/test_status_contract_exchange_internal.py
key-decisions:
  - "The handlers moved WITH their rationale comment blocks, so the PYAPI-07/08/PYAPIFIX2-01 history travels with the code it explains; only the three add_exception_handler calls were replaced by install_app_exception_handlers"
  - "main.py re-imports validation_exception_handler, rate_limit_exceeded_handler, venue_transient_exception_handler and _retry_after_seconds so main.<name> stays valid for the existing tests"
  - "The census triple for the venue-transient pass-through is now (app_error_handlers.py, venue_transient_exception_handler, JSONResponse); EXPECTED_NON_LITERAL_STATUS_SITES stays 3"
status: complete
completed: 2026-11-15
actuals:
  tokens: 13000
  tasks: 3
  commits: 3
plan_head_before: 8f48122288ed5afc615d727f93c4112b03c1a9a3
plan_head_after: 5ad411a6cadfe6c798ef05fe4c9d13f13cc55668
---

# Phase 215 Plan 03: Test apps carry production's app-global handlers Summary

Production `main.py` and a new test app factory now install the 422 (credential-safe), 429 (`RATE_LIMITED` plus `Retry-After`) and venue-transient 424 handlers through ONE function, `install_app_exception_handlers`, so a router test asserts against the body production actually sends. Ten of the 21 bare-`FastAPI()` modules are on the factory; plan 215-04 moves the other 11.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | SC-3 tracer: installer, factory, parity test | bedbffacd | app_error_handlers.py, main.py, app_factory.py, conftest.py, test_app_factory_parity.py, test_raw_5xx_census.py |
| 2 | Cron, ops, correlation and debug modules on the factory | 0d2ab49f1 | five test modules |
| 3 | Internal and exchange modules on the factory | 5ad411a6c | five test modules |

## What changed

- `services/app_error_handlers.py` (new, leaf module): `_validation_log`, `_validation_detail`, `validation_exception_handler`, `_rate_limit_log`, `_retry_after_seconds`, `rate_limit_exceeded_handler`, `venue_transient_exception_handler` moved byte for byte from `main.py` (the extract was scripted from the line range, not retyped), plus `install_app_exception_handlers(app)` registering 422, 429, venue-transient in main.py's original order. It imports `limiter`, `correlation_id_var` and `VenueTransientHTTPException` from leaf modules; it never imports `main`.
- `main.py`: the moved block and the three registration calls are gone; one `install_app_exception_handlers(app)` call sits at the position of the first registration (before the middleware and routers). The new import is below `configure_logging()`. Imports main.py no longer used were dropped (`Sequence`, `cast`, `RequestValidationError`, `RateLimitExceeded`, `correlation_id_var`, `VenueTransientHTTPException`).
- `tests/app_factory.py` (new): `build_test_app(*routers, middleware=())`.
- `conftest.py`: function-scoped `app_factory` fixture returning `build_test_app`. The ten moved modules build their app inside fixtures or helper functions, so they import `build_test_app` directly (the plan's sanctioned alternative); the fixture is there for plan 215-04 and later router tests.
- `test_raw_5xx_census.py`: the hand-typed venue-transient triple points at `app_error_handlers.py`, with a dated comment; the scan already globs `services/**/*.py`, so the moved site is found. Count stays 3.
- Ten test modules swapped `FastAPI()` + `include_router(...)` for `build_test_app(...)`; `test_correlation_middleware.py` uses `build_test_app(middleware=[CorrelationMiddleware])` and keeps its own route. No limiter line, reset, override or assertion changed.

## Verification

- Per module, run alone (`env -u TEST_SUPABASE_DB_URL python3 -m pytest -p no:cacheprovider -q tests/<m>.py`): `test_app_factory_parity` 3 passed, `test_raw_5xx_census` 19, `test_validation_error_contract` 11, `test_rate_limit_contract` 7, `test_validate_key_venue_transient` 55, entrypoint-ordering test 2; the ten moved modules 27, 59, 15, 4, 15, 2, 9, 16, 3, 28 passed. Other readers of `main.py` also green: `test_structlog_frozen_proxy`, `test_mt5_concurrency`, `test_ops_staleness_parity`, `test_legacy_table_not_named`, `test_local_worker_prod_guard`, `test_mt5_server_clock`, `test_mt5_relogin`.
- mypy strict (CI's command): `Success: no issues found in 140 source files`, after the extract and again with all edits.
- TS guards (vitest, node 22): the seven in Task 3's verify list, 478 passed; plus `seam-discriminator.test.ts` and `keys/[id]/permissions/route.test.ts`, 125 passed. None needed repointing.
- Full suite serial from `analytics-service/`: `1 failed, 14916 passed, 92 skipped`. The one failure is `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`, the known local failure: `pytest: error: unrecognized arguments: -n --dist` (pytest-xdist is not installed locally; it runs in CI).
- `grep -rlaE --include='*.py' '=\s*FastAPI\(' analytics-service/tests | wc -l` = 12 (11 modules left plus `app_factory.py`); `grep -ac 'app.add_exception_handler(' main.py` = 0; `grep -ac 'install_app_exception_handlers(app)' main.py` = 1; neither the factory nor the handler module imports `main` (0 and 0).
- `git diff --stat origin/main -- supabase/migrations` prints nothing (SC-8).

## RED proofs (SC-9)

Each: byte backup in the scratchpad, neuter, run, record, restore with `cp`, `cmp` identical, re-run green. No `git checkout`, `restore` or `stash`.

| # | Neuter | Run | Result | Restore |
| - | ------ | --- | ------ | ------- |
| 1 (Task 1) | `tests/app_factory.py`: delete the `install_app_exception_handlers(app)` line | `tests/test_app_factory_parity.py` | 3 failed: (a) handler objects, (b) canary 422, (c) production 429 | `cmp` identical, 3 passed |
| 2 (Task 2) | same neuter | `test_correlation_middleware.py`, `test_app_factory_parity.py`, `test_validation_error_contract.py` | parity 3 failed; `test_correlation_middleware` 4 passed and `test_validation_error_contract` 11 passed (neither exercises the handlers: the first only reads the correlation header, the second drives `main.app`) | `cmp` identical |
| 3 (Task 3) | `services/app_error_handlers.py`: `install_app_exception_handlers` registers only the 422 handler | `tests/test_app_factory_parity.py` | 2 failed, 1 passed: (a) handler objects and (c) production 429 fail; (b) canary 422 correctly stays green | `cmp` identical, 3 passed |

The plan text for proof 2 says to record which modules fail, with the parity test required to. It does, and the correlation module staying green is recorded rather than hidden: that module guards middleware, not handlers.

## Deviations from Plan

None - plan executed as written. Three small notes, none behavioural:

- The `app_factory` fixture exists but the ten moved modules import `build_test_app` directly, because every one builds its app in a fixture or helper function (the plan allows either).
- `test_prober_cadence_alert.py`: the `client` fixture docstring said "Bare FastAPI app"; reworded to "Factory app (production 422/429 handlers)" because it was no longer true.
- No assertion changed outcome under production handlers in any of the ten modules, so no assertion was re-cut. No module needed to stay bare.

## Threat model

T-215-08 (credential echo): handler bodies moved unchanged by a scripted line-range extract; canary test (b) asserts a planted secret appears zero times through a factory app. T-215-09 (repudiation): parity test (a) binds the factory's handlers to `main.app`'s identical function objects; RED proof 1 removes the installer and all three tests fail. T-215-10 (import side effects): neither the factory nor the handler module imports `main`.

## Known Stubs

None.

## Items that can only be measured in CI

- `tests/test_xdist_group_is_real.py` needs pytest-xdist, absent locally; the new `app_factory` fixture and `tests/app_factory.py` add no shared-DB sentinel words, so the grouping logic is unaffected.
- Coverage: `--cov=services` now counts `services/app_error_handlers.py`; it is exercised by the parity, validation and rate-limit contract tests, so no drop is expected. Read the `python` job's coverage line on the PR head SHA.

## Out-of-scope finding (named only, not fixed)

`scripts/prod-prober/arms/pyapi06.mjs` cites `analytics-service/main.py:742-743` and `:884-893` in comments. Moving the handlers shifted those lines by about 293 (the file is now shorter); the citations were already by line number and nothing pins them. The class is `[164.7-CITATION-DRIFT-01]`. Not edited here; no test reads those comments.

## Self-Check: PASSED

- FOUND: analytics-service/services/app_error_handlers.py, analytics-service/tests/app_factory.py, analytics-service/tests/test_app_factory_parity.py
- FOUND commits bedbffacd, 0d2ab49f1, 5ad411a6c (ancestors of HEAD; `git rev-list --count 8f4812228..HEAD` = 3)
